import {
  simulateMatch, getCalibration, getTeamScoringProfile,
  scoringHashSeed, PLAYER_SCORING_MODEL_VERSION
} from "./playerScoring.js";
import { teamsDB } from "../data/teams.js";

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
  return function metaFor(code, name) {
    let map = cache.get(code);
    if (!map) {
      const profile = getTeamScoringProfile(code, { formEnabled: true });
      map = new Map();
      for (const e of profile.players) {
        map.set(`${e.name}|${code}`, {
          pos: e.pos,
          finishing: e.player?.finishing ?? null,
          overall: e.player?.overall ?? null,
          pickProb: Number((e.selectionProbability * 100).toFixed(2)),
          roleWeight: Number((e.roleWeight ?? 0).toFixed(2)),
          formMultiplier: Number((e.formMultiplier ?? 1).toFixed(3))
        });
      }
      cache.set(code, map);
    }
    return map.get(`${name}|${code}`) || { pos: "", finishing: null, overall: null, pickProb: null, roleWeight: null, formMultiplier: 1 };
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
      scoreMap: new Map(), scorerMap: new Map(), winH: 0, winD: 0, winA: 0,
      sumHomeGoals: 0, sumAwayGoals: 0, sumChances: 0
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
          sim = simulateMatch(pm.homeCode, pm.awayCode, { seed });
        } catch (e) {
          sim = { homeGoals: 0, awayGoals: 0, homeChances: 0, awayChances: 0, events: [] };
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
          const k = `${e.playerName}|${e.teamCode}`;
          perIter.set(k, (perIter.get(k) || 0) + 1);
        }
        for (const [k, goals] of perIter) {
          const [name, teamCode] = k.split("|");
          const meta = metaFor(teamCode, name);
          const existing = pm.scorerMap.get(k);
          if (existing) {
            existing.hits += 1;
            existing.totalGoals += goals;
          } else {
            pm.scorerMap.set(k, {
              name, pos: meta.pos, teamCode,
              flag: teamsDB[teamCode]?.flag || "",
              teamName: teamsDB[teamCode]?.name || teamCode,
              finishing: meta.finishing, overall: meta.overall,
              pickProb: meta.pickProb, scoringIndex: meta.overall,
              hits: 1, totalGoals: goals
            });
          }
          const gex = globalScorerFreq.get(k);
          if (gex) {
            gex.hits += 1;
            gex.totalGoals += goals;
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
      .map(([s, c]) => ({ scoreline: s, count: c, pct: Number(c / (denom * Math.max(1, perMatch.length)) * 100).toFixed(1) }));

    const perMatchRank = perMatch.map((pm) => {
      const sRank = [...pm.scoreMap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
        .map(([s, c]) => ({ scoreline: s, count: c, pct: Number(c / denom * 100).toFixed(1) }));
      const scRank = [...pm.scorerMap.values()]
        .sort((a, b) => b.hits - a.hits || b.totalGoals - a.totalGoals)
        .slice(0, 6)
        .map((x) => ({
          ...x,
          freqPct: Number((x.hits / denom * 100).toFixed(1)),
          avgGoals: Number((x.totalGoals / Math.max(1, x.hits)).toFixed(2)),
          proof: `Muncul ${x.hits}x/${iterations} (${Number((x.hits / denom * 100).toFixed(1))}%) — event model (posisi ${x.pos || "?"}${x.finishing != null ? `, finishing ${x.finishing}` : ""})`
        }));
      const winRateHome = Number((pm.winH / denom * 100).toFixed(1));
      const winRateAway = Number((pm.winA / denom * 100).toFixed(1));
      const winRateDraw = Number((pm.winD / denom * 100).toFixed(1));
      const avgHome = Number((pm.sumHomeGoals / denom).toFixed(2));
      const avgAway = Number((pm.sumAwayGoals / denom).toFixed(2));
      const mostFrequent = sRank[0]?.scoreline || "0:0";
      let konsistentWinner = "DRAW";
      if (pm.winH > pm.winA && pm.winH > pm.winD) konsistentWinner = pm.homeName;
      else if (pm.winA > pm.winH && pm.winA > pm.winD) konsistentWinner = pm.awayName;
      return {
        row: pm.row, homeName: pm.homeName, awayName: pm.awayName,
        homeCode: pm.homeCode, awayCode: pm.awayCode, homeFlag: pm.homeFlag, awayFlag: pm.awayFlag,
        topScores: sRank, topScorers: scRank,
        winRateHome, winRateAway, winRateDraw, avgHome, avgAway, mostFrequent, konsistentWinner,
        winH: pm.winH, winD: pm.winD, winA: pm.winA,
        avgChancesPerMatch: Number((pm.sumChances / denom / 2).toFixed(2))
      };
    });

    const bulkRngProof = {
      lcg: "state = (state * 1664525 + 1013904223) >>>0 — Numerical Recipes LCG (implementasi sendiri, BUKAN replika RNG WE10)",
      seedFormula: `hash(home|away|iter|${PLAYER_SCORING_MODEL_VERSION}) — deterministik, reproducible, tiap iterasi unik`,
      whyFrequent: "Pemain sering muncul karena model level-pemain: role posisi (CF/ST tertinggi, DF sangat rendah) × atribut (finishing/positioning/technique) × form historis (shrinkage). Tidak ada daftar bintang manual, tidak ada nama dummy.",
      auditNote: "Audit Ghidra: FUN_0016e8d8 = ceiling-div helper, FUN_00216ef0 = table lookup, konstanta RNG standar 0 hits → LCG ini implementasi deterministik, bukan decode ROM. Atribut pemain derived/estimated (bukan decode ROM).",
      avgNote: `Skor rata-rata ${iterations}x = sum(homeGoals)/${iterations} & sum(awayGoals)/${iterations}. Kalibrasi dataset: ${calibration.source} (scale ${calibration.scale.toFixed(3)}).`
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
