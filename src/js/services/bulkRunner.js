import {
  simulateMatch, getCalibration, getTeamScoringProfile, playerEventKey,
  scoringHashSeed, PLAYER_SCORING_MODEL_VERSION
} from "./playerScoring.js";
import { teamsDB } from "../data/teams.js";
import { playerOverall } from "../data/playerAttributes.js";

/**
 * BulkRunner — mode 100 / 200 / 1000x async chunked (tidak hang, bisa dibatalkan).
 *
 * v7.0 (2026-09-19): setiap iterasi memakai MATCH ENGINE level-pemain
 * (playerScoring.js) — skor DAN pencetak gol lahir dari event yang sama:
 *
 *   kekuatan tim → jumlah chance → kualitas chance → pemilihan pemain
 *   → shot probability (vs defense lawan) → GOAL / MISS
 *
 * Tidak ada undian "weight" manual, tidak ada STAR_OVERRIDES, tidak ada nama
 * dummy. Semua pencetak gol berasal dari roster 57 tim.
 */

/** Metadata pemain (posisi/atribut/peluang dipilih) — di-cache per tim. */
function makeProfileMetaCache() {
  const cache = new Map();
  return function metaFor(code, name, playerIndex) {
    let map = cache.get(code);
    if (!map) {
      const profile = getTeamScoringProfile(code, { formEnabled: true });
      map = new Map();
      for (const e of profile.players) {
        map.set(playerEventKey({ teamCode: code, playerName: e.name, playerIndex: e.index }), {
          playerIndex: e.index,
          pos: e.pos,
          finishing: e.player?.finishing ?? null,
          overall: playerOverall(e.player),
          pickProb: Number((e.selectionProbability * 100).toFixed(2)),
          roleWeight: Number((e.roleWeight ?? 0).toFixed(2)),
          formMultiplier: Number((e.formMultiplier ?? 1).toFixed(3))
        });
      }
      cache.set(code, map);
    }
    return map.get(playerEventKey({ teamCode: code, playerName: name, playerIndex })) || null;
  };
}

export function createBulkRunner() {
  let cancelled = false;
  function cancel() { cancelled = true; }
  function isCancelled() { return cancelled; }

  async function runChunked(validRows, iterations, onProgress) {
    const totalTasks = validRows.length * iterations;
    let completed = 0;
    const start = (typeof performance !== "undefined" ? performance.now() : Date.now());
    const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
    const scoreFreq = new Map();
    const globalScorerFreq = new Map();
    const metaFor = makeProfileMetaCache();
    const calibration = getCalibration(null);

    const perMatch = validRows.map((v) => ({
      row: v.row, homeCode: v.homeCode, awayCode: v.awayCode,
      homeName: v.homeName, awayName: v.awayName, homeFlag: v.homeFlag, awayFlag: v.awayFlag,
      exclude: v.exclude || null,
      scoreMap: new Map(), scorerMap: new Map(), winH: 0, winD: 0, winA: 0,
      sumHomeGoals: 0, sumAwayGoals: 0, sumChances: 0, successful: 0, failed: 0
    }));

    for (let iter = 0; iter < iterations; iter++) {
      if (cancelled) break;
      for (let idx = 0; idx < perMatch.length; idx++) {
        if (cancelled) break;
        const pm = perMatch[idx];

        // Seed deterministik per fixture per iterasi (reproducible, bukan Math.random)
        const seed = scoringHashSeed(`${pm.homeCode}|${pm.awayCode}|iter${iter}|${PLAYER_SCORING_MODEL_VERSION}`);
        let sim;
        try {
          sim = simulateMatch(pm.homeCode, pm.awayCode, { seed, exclude: pm.exclude });
          pm.successful++;
        } catch (e) {
          pm.failed++;
          completed++;
          continue;
        }

        const homeGoals = sim.homeGoals, awayGoals = sim.awayGoals;
        const sk = `${homeGoals}:${awayGoals}`;
        pm.scoreMap.set(sk, (pm.scoreMap.get(sk) || 0) + 1);
        scoreFreq.set(sk, (scoreFreq.get(sk) || 0) + 1);
        pm.sumHomeGoals += homeGoals;
        pm.sumAwayGoals += awayGoals;
        pm.sumChances += (sim.homeChances || 0) + (sim.awayChances || 0);
        if (homeGoals > awayGoals) pm.winH++;
        else if (awayGoals > homeGoals) pm.winA++;
        else pm.winD++;

        // Gol diambil dari EVENT (chance → pemain → shot), bukan undian nama
        const perIter = new Map();
        for (const e of sim.events) {
          if (!e.scored) continue;
          const k = playerEventKey(e);
          const current = perIter.get(k) || { goals: 0, name: e.playerName, teamCode: e.teamCode, playerIndex: e.playerIndex };
          current.goals++;
          perIter.set(k, current);
        }
        for (const [k, event] of perIter) {
          const { name, teamCode, playerIndex } = event;
          const meta = metaFor(teamCode, name, playerIndex);
          if (!meta) continue;
          const existing = pm.scorerMap.get(k);
           if (existing) {
             existing.hits += 1;
             existing.totalGoals += event.goals;
           } else {
             pm.scorerMap.set(k, {
               name, playerIndex, pos: meta.pos, teamCode,
               flag: teamsDB[teamCode]?.flag || "",
               teamName: teamsDB[teamCode]?.name || "",
              finishing: meta.finishing, overall: meta.overall,
              pickProb: meta.pickProb, scoringIndex: meta.overall,
               hits: 1, totalGoals: event.goals
            });
          }
          const gex = globalScorerFreq.get(k);
          if (gex) {
            gex.hits += 1;
             gex.totalGoals += event.goals;
          } else {
            const entry = pm.scorerMap.get(k);
            globalScorerFreq.set(k, { ...entry });
          }
        }

        completed++;
        if (completed % 32 === 0) {
          const elapsed = (now() - start) / 1000;
          const eta = completed > 0 ? (elapsed / completed) * (totalTasks - completed) : 0;
          if (onProgress) onProgress({ completed, total: totalTasks, percent: Math.round(completed / totalTasks * 100), elapsed, eta, perMatch: perMatch.length, iteration: iter });
          await new Promise((r) => setTimeout(r, 0));
          if (cancelled) break;
        }
      }
      if (iter % 8 === 0) await new Promise((r) => setTimeout(r, 0));
    }

    if (cancelled) {
      return { cancelled: true, completed, total: totalTasks, perMatch: [], globalRank: [], scoreRank: [], bulkRngProof: null };
    }
    if (onProgress) {
      const elapsed = (now() - start) / 1000;
      onProgress({ completed, total: totalTasks, percent: 100, elapsed, eta: 0, perMatch: perMatch.length, iteration: iterations - 1 });
    }

    const totalSuccessful = perMatch.reduce((sum, pm) => sum + pm.successful, 0);
    const denom = Math.max(1, iterations);
    const globalRank = [...globalScorerFreq.values()]
      .sort((a, b) => b.hits - a.hits || b.totalGoals - a.totalGoals)
      .map((x) => {
        const freqPct = Number((x.hits / denom * 100).toFixed(1));
        const avgGoals = Number((x.totalGoals / Math.max(1, x.hits)).toFixed(2));
        const proof = `Muncul ${x.hits}x/${iterations} (${freqPct}%) — dari event chance→pemain→shot; posisi ${x.pos || "?"}${x.finishing != null ? `, finishing ${x.finishing}` : ""}${x.pickProb != null ? `, dipilih ${x.pickProb}% tiap chance` : ""}`;
        return { ...x, freqPct, avgGoals, proof };
      });

    const scoreRank = [...scoreFreq.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([s, c]) => ({ scoreline: s, count: c, pct: Number((c / totalSuccessful) * 100).toFixed(1) }));

    const perMatchRank = perMatch.map((pm) => {
      const sRank = [...pm.scoreMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
        .map(([s, c]) => ({ scoreline: s, count: c, pct: Number(c / Math.max(1, pm.successful) * 100).toFixed(1) }));
      const scRank = [...pm.scorerMap.values()]
        .sort((a, b) => b.hits - a.hits || b.totalGoals - a.totalGoals)
        .slice(0, 6)
        .map((x) => ({
          ...x,
          freqPct: Number((x.hits / Math.max(1, pm.successful) * 100).toFixed(1)),
          avgGoals: Number((x.totalGoals / Math.max(1, x.hits)).toFixed(2)),
          proof: `Muncul ${x.hits}x/${pm.successful} (${Number((x.hits / Math.max(1, pm.successful) * 100).toFixed(1))}%) — event model (posisi ${x.pos || "?"}${x.finishing != null ? `, finishing ${x.finishing}` : ""})`
        }));
      const matchDenom = Math.max(1, pm.successful);
      const winRateHome = Number((pm.winH / matchDenom * 100).toFixed(1));
      const winRateAway = Number((pm.winA / matchDenom * 100).toFixed(1));
      const winRateDraw = Number((pm.winD / matchDenom * 100).toFixed(1));
      const avgHome = Number((pm.sumHomeGoals / matchDenom).toFixed(2));
      const avgAway = Number((pm.sumAwayGoals / matchDenom).toFixed(2));
      const mostFrequent = sRank[0]?.scoreline || null;
      let konsistentWinner = "NO DATA";
      if (pm.successful > 0) {
        konsistentWinner = "DRAW";
        if (pm.winH > pm.winA && pm.winH > pm.winD) konsistentWinner = pm.homeName;
        else if (pm.winA > pm.winH && pm.winA > pm.winD) konsistentWinner = pm.awayName;
      }
      return {
        row: pm.row, homeName: pm.homeName, awayName: pm.awayName,
        homeCode: pm.homeCode, awayCode: pm.awayCode, homeFlag: pm.homeFlag, awayFlag: pm.awayFlag,
        topScores: sRank, topScorers: scRank,
        winRateHome, winRateAway, winRateDraw, avgHome, avgAway, mostFrequent, konsistentWinner,
        winH: pm.winH, winD: pm.winD, winA: pm.winA,
        successful: pm.successful, failed: pm.failed,
        avgChancesPerMatch: Number((pm.sumChances / matchDenom / 2).toFixed(2))
      };
    });

    const bulkRngProof = {
      lcg: "Xorshift32 FUN_0014d320: tmp=s^(s<<17); s=tmp^(tmp>>15); nextFloat=s*2.3283064e-10; range/bounded = float*bound clamp<bound",
      seedFormula: `hash(home|away|iter|${PLAYER_SCORING_MODEL_VERSION}) — deterministik, reproducible, tiap iterasi unik, seed awal 1 (FUN_0014d470 duplikasi 2-word)`,
      whyFrequent: "Pemain sering muncul karena model level-pemain: role posisi (CF/ST tertinggi, DF sangat rendah) × atribut (finishing/positioning/technique) × form historis (shrinkage). Tidak ada daftar bintang manual, tidak ada nama dummy.",
      auditNote: "Ghidra 2026-08-23: FUN_0014d320 Xorshift @0014d320 seed 003591d8 (decompile + disassembly 0014d32c-0014d41c + 118 jal hits); FUN_0014d470 srand; FUN_0018a510 dispatcher Konami Cup (RNG128/RNG1x20/RNG4, entry 0x448, +0x20/+0x22/+0x03/+0x446) heap *(004FFCA0)+0x337C. Atribut pemain derived/estimated (bukan decode ROM).",
      avgNote: `Skor rata-rata dari ${totalSuccessful} simulasi berhasil = sum(homeGoals)/${totalSuccessful} & sum(awayGoals)/${totalSuccessful}. Kalibrasi dataset: ${calibration.source} (scale ${calibration.scale.toFixed(3)}).`
    };

    return {
      iterations, totalMatches: perMatch.length,
      globalRank: globalRank.slice(0, 15), scoreRank, perMatch: perMatchRank,
      bulkRngProof, cancelled: false, completed, total: totalTasks
    };
  }

  return {
    run: (validRows, iterations, onProgress) => runChunked(validRows, iterations, onProgress),
    cancel, isCancelled, reset: () => { cancelled = false; }
  };
}
