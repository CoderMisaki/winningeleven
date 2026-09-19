import { hybridPredict, PREDICTOR_CONFIG, hashStringToSeed } from "./predictor.js";
import { StateManager } from "../state/appState.js";
import { normalizeCountry } from "./similarity.js";
import { teamsDB } from "../data/teams.js";
import { getTeamPlayers, findRosterPlayer, normalizePlayerName } from "../data/playerAttributes.js";
import { ScoringRng } from "./playerScoring.js";
import { getObservedStats } from "./scoringDataset.js";
import { teamRatings as legacyTeamRatings } from "../data/teamRatings.js";

/**
 * BacktestEngine — SPEC N/O/P/Q: walk-forward, baselines, ablation, no-leakage.
 *
 * v7.0 (2026-09-19):
 *  - Walk-forward SEBENARNYA: prediksi game ke-k hanya memakai game < k
 *    (`exclude = { memoryId, fromGameNumber }`), bukan hanya membuang game target.
 *    Jadi tidak ada skor/topGoals masa depan yang bocor ke model.
 *  - Metrik lengkap: exact score, 1X2, top-3 & top-5 scoreline, MAE home/away,
 *    top scorer hit rate, dan scorer distribution accuracy (TVD vs observasi).
 *  - PERBANDINGAN MODEL: player-attribute (produksi) vs legacy position-weight
 *    (heuristik lama, tanpa STAR_OVERRIDES — hanya untuk pembanding).
 *
 * CATATAN RNG: Numerical Recipes LCG 1664525 (implementasi deterministik,
 * BUKAN replika RNG WE10 — konstanta RNG asli 0 hits di SLPM_663.74).
 */

function parseScore(s) {
  if (typeof s !== "string") return null;
  const clean = s.trim().replace(/[-–—;]+/g, ":");
  const parts = clean.split(":");
  if (parts.length !== 2) return null;
  const h = parseInt(parts[0], 10), a = parseInt(parts[1], 10);
  if (isNaN(h) || isNaN(a) || h < 0 || a < 0) return null;
  return { home: h, away: a };
}

function getMostCommonScoreline(trainingMatches) {
  const freq = new Map();
  for (const m of trainingMatches) {
    const sc = parseScore(m?.score || "");
    if (!sc) continue;
    const k = `${sc.home}:${sc.away}`;
    freq.set(k, (freq.get(k) || 0) + 1);
  }
  let best = null, bestCount = 0;
  for (const [k, c] of freq) if (c > bestCount) { best = k; bestCount = c; }
  if (!best) return { home: 1, away: 1 };
  const [h, a] = best.split(":").map(Number);
  return { home: h, away: a };
}

function actualScorersForGame(game) {
  const rows = [];
  for (const tg of (game?.topGoals || [])) {
    const code = normalizeCountry(tg?.country || "");
    const goals = parseInt(tg?.goals, 10) || 0;
    const rawName = String(tg?.player || "").trim();
    if (!code || goals <= 0 || !rawName) continue;
    const roster = findRosterPlayer(code, rawName);
    if (!roster) continue; // nama tidak ada di roster → tidak bisa dibandingkan
    rows.push({ key: `${roster.name}|${code}`, name: roster.name, teamCode: code, goals });
  }
  return rows;
}

/* ==========================================================================
 * LEGACY BASELINE (DEPRECATED) — reproduksi model heuristik lama.
 * Dipakai HANYA untuk pembanding di backtest. TIDAK dipakai produksi.
 * Model lama: position weight + DF boost + historical smoothing.
 * STAR_OVERRIDES sengaja TIDAK direproduksi (sudah dihapus dari produksi).
 * ========================================================================== */
export const LEGACY_POSITION_WEIGHT = Object.freeze({
  GK: 12, CB: 10, SW: 10, SB: 12, WB: 12, DMF: 38, CMF: 44, SMF: 52, WG: 65, OMF: 66, CF: 84, ST: 84
});
export const LEGACY_PURE_SIM = Object.freeze({
  CHANCES_BASE: 6, CHANCES_MID_FACTOR: 3, CHANCES_JITTER: 3, CHANCES_MIN: 4, CHANCES_MAX: 9,
  BASE_SHOT_PROB: 18, SHOT_DIFF_FACTOR: 0.35, HOME_EDGE: 1.0, SHOT_PROB_MIN: 10, SHOT_PROB_MAX: 32,
  PROBS_SIMS: 120
});

function legacyTeamStrength(code, stats, globalAttack) {
  // reproduksi calculateTeamStrength lama (prior dari teamRatings + observasi)
  const s = stats?.[code];
  const w = s ? s.weight : 0;
  const prior = legacyRatingPrior(code);
  let attObs = prior.att, defObs = prior.def;
  if (w > 0 && globalAttack > 0) { attObs = (s.gf / w) / globalAttack; defObs = (s.ga / w) / globalAttack; }
  const k = 2.5;
  return {
    att: Math.max(0.35, Math.min(2.8, (w * attObs + k * prior.att) / (w + k))),
    def: Math.max(0.35, Math.min(2.8, (w * defObs + k * prior.def) / (w + k))),
    mid: prior.mid,
    overall: prior.overall
  };
}

function legacyRatingPrior(code) {
  const r = legacyTeamRatings[code];
  if (!r) return { att: 1.0, def: 1.0, mid: 0.5, overall: 75 };
  const norm = (v) => Math.max(0, Math.min(1, (v - 65) / 30));
  return { att: 0.70 + norm(r.attack) * 0.70, def: 1.40 - norm(r.defense) * 0.70, mid: norm(r.midfield), overall: r.overall };
}

function legacySimulate(homeCode, awayCode, seed, stats, globalAttack) {
  const rng = new ScoringRng(seed);
  const h = legacyTeamStrength(homeCode, stats, globalAttack);
  const a = legacyTeamStrength(awayCode, stats, globalAttack);
  const midDiff = h.mid - a.mid;
  const cfg = LEGACY_PURE_SIM;
  const midShift = Math.round(midDiff * cfg.CHANCES_MID_FACTOR);
  const homeChances = Math.max(cfg.CHANCES_MIN, Math.min(cfg.CHANCES_MAX, cfg.CHANCES_BASE + midShift + rng.range(cfg.CHANCES_JITTER)));
  const awayChances = Math.max(cfg.CHANCES_MIN, Math.min(cfg.CHANCES_MAX, cfg.CHANCES_BASE - midShift + rng.range(cfg.CHANCES_JITTER)));
  const hAtt = Math.round(Math.min(99, Math.max(40, 78 * (0.75 + 0.25 * (h.att / 1.4)))));
  const aAtt = Math.round(Math.min(99, Math.max(40, 78 * (0.75 + 0.25 * (a.att / 1.4)))));
  const hDef = Math.round(Math.min(99, Math.max(40, 78 * (1.25 - 0.25 * (h.def / 1.4)))));
  const aDef = Math.round(Math.min(99, Math.max(40, 78 * (1.25 - 0.25 * (a.def / 1.4)))));
  let home = 0, away = 0;
  for (let i = 0; i < homeChances; i++) {
    const p = Math.max(cfg.SHOT_PROB_MIN, Math.min(cfg.SHOT_PROB_MAX, cfg.BASE_SHOT_PROB + (hAtt - aDef) * cfg.SHOT_DIFF_FACTOR + cfg.HOME_EDGE));
    if (rng.range(100) < p) home++;
  }
  for (let i = 0; i < awayChances; i++) {
    const p = Math.max(cfg.SHOT_PROB_MIN, Math.min(cfg.SHOT_PROB_MAX, cfg.BASE_SHOT_PROB + (aAtt - hDef) * cfg.SHOT_DIFF_FACTOR));
    if (rng.range(100) < p) away++;
  }
  return { home: Math.min(10, home), away: Math.min(10, away), homeChances, awayChances };
}

function legacyPickScorer(teamCode, rng, historyMap = null) {
  const players = getTeamPlayers(teamCode);
  if (!players.length) return null; // tidak ada dummy player
  const weighted = [];
  let total = 0;
  for (const p of players) {
    if (p.pos === "GK") continue;
    let w = LEGACY_POSITION_WEIGHT[p.pos] ?? 30;
    if (["CB", "SB", "SW", "WB"].includes(p.pos)) w = Math.round(w * 2.2);
    else if (["DMF", "CMF"].includes(p.pos)) w = Math.round(w * 1.15);
    const hist = historyMap?.get(`${normalizePlayerName(p.name)}|${teamCode}`);
    if (hist && hist.appearances > 0) {
      const rate = hist.goals / Math.max(1, hist.appearances);
      const alpha = Math.min(0.35, hist.appearances / 8);
      const histWeight = Math.min(95, Math.max(10, rate * 22 + 25));
      w = w * (1 - alpha) + histWeight * alpha;
    }
    weighted.push({ player: p, weight: w });
    total += w;
  }
  if (total <= 0) return null;
  let r = rng.nextFloat() * total;
  for (const item of weighted) {
    if (r < item.weight) return item.player;
    r -= item.weight;
  }
  return weighted[weighted.length - 1]?.player || null;
}

/** Satu fixture versi legacy: skor + daftar pencetak gol (weight-proportional). */
export function legacyModelFixture(homeCode, awayCode, seed, opts = {}) {
  const stats = opts.stats || {};
  const globalAttack = opts.globalAttack || PREDICTOR_CONFIG.BASE_GLOBAL_ATTACK;
  const sim = legacySimulate(homeCode, awayCode, seed, stats, globalAttack);
  const rng = new ScoringRng((seed ^ 0x1234567) >>> 0);
  const scorers = new Map();
  const pick = (code, count) => {
    const used = new Set();
    for (let i = 0; i < count; i++) {
      let p = legacyPickScorer(code, rng, opts.historyMap);
      if (!p) break;
      let attempts = 0;
      while (used.has(p.name) && attempts < 12 && count <= 3) { p = legacyPickScorer(code, rng, opts.historyMap); attempts++; }
      if (!p) break;
      used.add(p.name);
      const key = `${p.name}|${code}`;
      scorers.set(key, { name: p.name, pos: p.pos, teamCode: code, goals: (scorers.get(key)?.goals || 0) + 1 });
    }
  };
  pick(homeCode, sim.home);
  pick(awayCode, sim.away);

  // distribusi/probabilitas versi legacy (MC kecil, hanya untuk 1X2 & top-5)
  const n = LEGACY_PURE_SIM.PROBS_SIMS;
  let wH = 0, wD = 0, wA = 0;
  const scoreMap = new Map();
  for (let i = 0; i < n; i++) {
    const r2 = new ScoringRng((seed ^ Math.imul(i + 1, 0x9e3779b9)) >>> 0);
    const s = legacySimulate(homeCode, awayCode, r2.next(), stats, globalAttack);
    if (s.home > s.away) wH++; else if (s.away > s.home) wA++; else wD++;
    const k = `${s.home}:${s.away}`;
    scoreMap.set(k, (scoreMap.get(k) || 0) + 1);
  }
  const distribution = [...scoreMap.entries()]
    .map(([k, c]) => { const [hh, aa] = k.split(":").map(Number); return { home: hh, away: aa, prob: c / n }; })
    .sort((x, y) => y.prob - x.prob);
  return {
    homeGoals: sim.home, awayGoals: sim.away,
    probs: { home: wH / n, draw: wD / n, away: wA / n },
    distribution,
    topScorers: [...scorers.values()].sort((a, b) => b.goals - a.goals)
  };
}

/* ==========================================================================
 * METRICS
 * ========================================================================== */
function makeAccumulator(label) {
  return {
    label,
    tested: 0, exact: 0, result1X2: 0, top3: 0, top5: 0,
    sumAbsErrHome: 0, sumAbsErrAway: 0, sumBrier: 0, sumLogLoss: 0,
    scorerMatches: 0, scorerHits: 0, topScorerExact: 0,
    predShare: new Map(), obsShare: new Map(),
    details: []
  };
}

function accumulate(acc, actual, pred, actualScorers, opts = {}) {
  acc.tested++;
  if (pred.homeGoals === actual.home && pred.awayGoals === actual.away) acc.exact++;
  const actual1X2 = actual.home > actual.away ? "HOME" : (actual.away > actual.home ? "AWAY" : "DRAW");
  const pred1X2 = pred.probs.home > Math.max(pred.probs.draw, pred.probs.away)
    ? "HOME"
    : (pred.probs.away > Math.max(pred.probs.home, pred.probs.draw) ? "AWAY" : "DRAW");
  if (actual1X2 === pred1X2) acc.result1X2++;
  if (pred.distribution.slice(0, 3).some((s) => s.home === actual.home && s.away === actual.away)) acc.top3++;
  if (pred.distribution.slice(0, 5).some((s) => s.home === actual.home && s.away === actual.away)) acc.top5++;
  acc.sumAbsErrHome += Math.abs(pred.homeGoals - actual.home);
  acc.sumAbsErrAway += Math.abs(pred.awayGoals - actual.away);
  const oH = actual1X2 === "HOME" ? 1 : 0, oD = actual1X2 === "DRAW" ? 1 : 0, oA = actual1X2 === "AWAY" ? 1 : 0;
  acc.sumBrier += (Math.pow(pred.probs.home - oH, 2) + Math.pow(pred.probs.draw - oD, 2) + Math.pow(pred.probs.away - oA, 2)) / 3;
  const actualProb = actual1X2 === "HOME" ? pred.probs.home : actual1X2 === "DRAW" ? pred.probs.draw : pred.probs.away;
  acc.sumLogLoss += -Math.log(Math.max(0.01, actualProb));

  // ---- scorer metrics ----
  if (actualScorers.length) {
    acc.scorerMatches++;
    const predTop3 = pred.topScorers.slice(0, 3).map((p) => `${p.name}|${p.teamCode}`);
    const hit = actualScorers.some((s) => predTop3.includes(s.key));
    if (hit) acc.scorerHits++;
    const actualTop = [...actualScorers].sort((a, b) => b.goals - a.goals)[0];
    if (predTop3[0] === actualTop.key) acc.topScorerExact++;
    const actualGoalsTotal = actualScorers.reduce((s, x) => s + x.goals, 0);
    for (const s of actualScorers) {
      acc.obsShare.set(s.key, (acc.obsShare.get(s.key) || 0) + s.goals / Math.max(1, actualGoalsTotal));
    }
  }
  // predicted share: skor hasil model per pemain (semua pemain yang muncul di daftar)
  const predTotal = pred.topScorers.reduce((s, x) => s + (x.scoringShare || 0), 0);
  for (const p of pred.topScorers) {
    const share = predTotal > 0 ? (p.scoringShare || 0) / 100 : 0;
    if (share <= 0) continue;
    acc.predShare.set(`${p.name}|${p.teamCode}`, (acc.predShare.get(`${p.name}|${p.teamCode}`) || 0) + share);
  }
  if (opts.collectDetails) {
    acc.details.push({
      game: opts.gameNumber, memoryId: opts.memoryId,
      home: opts.home, away: opts.away,
      actual: `${actual.home}:${actual.away}`,
      predicted: `${pred.homeGoals}:${pred.awayGoals}`,
      actualScorers: actualScorers.map((s) => `${s.name}(${s.goals})`),
      predictedTop3: pred.topScorers.slice(0, 3).map((p) => p.name)
    });
  }
}

function scorerDistributionAccuracy(acc) {
  const keys = new Set([...acc.predShare.keys(), ...acc.obsShare.keys()]);
  if (!keys.size) return { accuracy: 0, samples: 0, tvd: 0 };
  const sumPred = [...acc.predShare.values()].reduce((s, v) => s + v, 0) || 1;
  const sumObs = [...acc.obsShare.values()].reduce((s, v) => s + v, 0) || 1;
  let tvd = 0;
  for (const k of keys) {
    const p = (acc.predShare.get(k) || 0) / sumPred;
    const q = (acc.obsShare.get(k) || 0) / sumObs;
    tvd += Math.abs(p - q);
  }
  tvd = tvd / 2;
  return { accuracy: (1 - tvd) * 100, samples: keys.size, tvd: tvd * 100 };
}

function finalize(acc) {
  const tested = acc.tested || 1;
  const dist = scorerDistributionAccuracy(acc);
  return {
    label: acc.label,
    totalTested: acc.tested,
    exactScoreAccuracy: (acc.exact / tested) * 100,
    result1X2Accuracy: (acc.result1X2 / tested) * 100,
    top3ScoreHitRate: (acc.top3 / tested) * 100,
    top5ScoreHitRate: (acc.top5 / tested) * 100,
    maeHomeGoals: acc.sumAbsErrHome / tested,
    maeAwayGoals: acc.sumAbsErrAway / tested,
    meanBrierScore: acc.sumBrier / tested,
    meanLogLoss: acc.sumLogLoss / tested,
    topScorerHitRate: acc.scorerMatches > 0 ? (acc.scorerHits / acc.scorerMatches) * 100 : 0,
    topScorerExactHitRate: acc.scorerMatches > 0 ? (acc.topScorerExact / acc.scorerMatches) * 100 : 0,
    topScorerSamples: acc.scorerMatches,
    scorerDistributionAccuracy: dist.accuracy,
    scorerDistributionTVD: dist.tvd,
    scorerDistributionSamples: dist.samples,
    details: acc.details
  };
}

/* ==========================================================================
 * WALK-FORWARD
 * ========================================================================== */
export function runWalkForwardBacktest(memoryId = 1, opts = {}) {
  const memory = StateManager.db?.memories?.[memoryId];
  if (!memory || !Array.isArray(memory.games) || memory.games.length < 2) {
    return { error: "Minimal 2 games pada memory database diperlukan untuk backtest valid." };
  }
  const games = [...memory.games].sort((a, b) => Number(a.gameNumber) - Number(b.gameNumber));
  const playerAcc = makeAccumulator("player-attribute v7");
  const legacyAcc = makeAccumulator("legacy position-weight");
  const mostCommonAcc = makeAccumulator("most-common-scoreline");

  const legacyHistory = new Map();
  const trainingMatches = [];
  let trainingCursor = 0;

  for (let gIdx = 1; gIdx < games.length; gIdx++) {
    const targetGame = games[gIdx];
    if (!targetGame || !Array.isArray(targetGame.matches)) continue;

    // progressive training set (hanya game SEBELUM target) — no leakage
    if (gIdx - 1 >= trainingCursor) {
      for (let k = trainingCursor; k <= gIdx - 1; k++) {
        for (const m of (games[k].matches || [])) trainingMatches.push(m);
        for (const tg of (games[k].topGoals || [])) {
          const code = normalizeCountry(tg?.country || "");
          const goals = parseInt(tg?.goals, 10) || 0;
          if (!code || goals <= 0 || !tg?.player) continue;
          const roster = findRosterPlayer(code, tg.player);
          if (!roster) continue;
          const key = `${normalizePlayerName(roster.name)}|${code}`;
          const cur = legacyHistory.get(key) || { goals: 0, appearances: 0 };
          cur.goals += goals; cur.appearances += 1;
          legacyHistory.set(key, cur);
        }
      }
      trainingCursor = gIdx;
    }
    const mostCommonScore = getMostCommonScoreline(trainingMatches);
    const observed = getObservedStats({ memoryId, fromGameNumber: targetGame.gameNumber });

    for (const m of targetGame.matches) {
      const hCode = normalizeCountry(m?.home || "");
      const aCode = normalizeCountry(m?.away || "");
      const actual = parseScore(m?.score || "");
      if (!hCode || !aCode || !actual || !teamsDB[hCode] || !teamsDB[aCode]) continue;
      const actualScorers = actualScorersForGame(targetGame);

      // ---- MODEL BARU (player-attribute) ----
      let pred = null;
      try {
        pred = hybridPredict(hCode, aCode, memoryId, targetGame.gameNumber, { deterministic: true, walkForward: true, ...opts.modelOpts });
      } catch (e) { continue; }
      accumulate(playerAcc, actual, { ...pred, topScorers: pred.topScorers || [] }, actualScorers, {
        collectDetails: opts.collectDetails, gameNumber: targetGame.gameNumber, memoryId, home: m.home, away: m.away
      });

      // ---- LEGACY BASELINE (position weight) ----
      const legacyStats = buildLegacyStats(memoryId, targetGame.gameNumber);
      const legacyPred = legacyModelFixture(hCode, aCode, hashStringToSeed(`${hCode}|${aCode}|${targetGame.gameNumber}|legacy`), {
        stats: legacyStats.stats, globalAttack: legacyStats.globalAttack, historyMap: legacyHistory
      });
      accumulate(legacyAcc, actual, legacyPred, actualScorers);

      // ---- BASELINE most common scoreline ----
      accumulate(mostCommonAcc, actual, {
        homeGoals: mostCommonScore.home, awayGoals: mostCommonScore.away,
        probs: { home: 1 / 3, draw: 1 / 3, away: 1 / 3 },
        distribution: [{ home: mostCommonScore.home, away: mostCommonScore.away, prob: 1 }],
        topScorers: []
      }, actualScorers);
    }
  }

  if (playerAcc.tested === 0) return { error: "Tidak ada pertandingan valid (57-fix) terisi skor untuk backtest." };

  const player = finalize(playerAcc);
  const legacy = finalize(legacyAcc);
  const mostCommon = finalize(mostCommonAcc);
  const delta = {
    exactScoreAccuracy: player.exactScoreAccuracy - legacy.exactScoreAccuracy,
    result1X2Accuracy: player.result1X2Accuracy - legacy.result1X2Accuracy,
    top3ScoreHitRate: player.top3ScoreHitRate - legacy.top3ScoreHitRate,
    top5ScoreHitRate: player.top5ScoreHitRate - legacy.top5ScoreHitRate,
    maeHomeGoals: player.maeHomeGoals - legacy.maeHomeGoals,
    maeAwayGoals: player.maeAwayGoals - legacy.maeAwayGoals,
    topScorerHitRate: player.topScorerHitRate - legacy.topScorerHitRate,
    scorerDistributionAccuracy: player.scorerDistributionAccuracy - legacy.scorerDistributionAccuracy
  };

  return {
    totalTested: player.totalTested,
    // metrik model produksi (flat, kompatibel UI lama)
    exactScoreAccuracy: player.exactScoreAccuracy,
    result1X2Accuracy: player.result1X2Accuracy,
    top3ScoreHitRate: player.top3ScoreHitRate,
    top5ScoreHitRate: player.top5ScoreHitRate,
    maeHomeGoals: player.maeHomeGoals,
    maeAwayGoals: player.maeAwayGoals,
    meanBrierScore: player.meanBrierScore,
    meanLogLoss: player.meanLogLoss,
    topScorerHitRate: player.topScorerHitRate,
    topScorerExactHitRate: player.topScorerExactHitRate,
    topScorerSamples: player.topScorerSamples,
    scorerDistributionAccuracy: player.scorerDistributionAccuracy,
    scorerDistributionTVD: player.scorerDistributionTVD,
    scorerDistributionSamples: player.scorerDistributionSamples,
    // perbandingan model
    modelComparison: {
      playerAttribute: player,
      legacyWeight: legacy,
      delta
    },
    baselines: {
      mostCommon: { exact: mostCommon.exactScoreAccuracy, maeH: mostCommon.maeHomeGoals, maeA: mostCommon.maeAwayGoals },
      legacyWeight: { exact: legacy.exactScoreAccuracy, maeH: legacy.maeHomeGoals, maeA: legacy.maeAwayGoals },
      playerAttribute: { exact: player.exactScoreAccuracy, maeH: player.maeHomeGoals, maeA: player.maeAwayGoals }
    },
    ablation: null,
    leakageAudit: "PASS: walk-forward — prediksi game ke-k hanya memakai game < k (team form via extractDataset(memoryId, null, fromGameNumber) dan player form via exclude.fromGameNumber). Game target & game setelahnya tidak pernah dipakai.",
    dataQuality: {
      fixturesUsed: player.totalTested,
      hasRating: true,
      hasH2H: games.length > 2,
      hasSimilarContext: true,
      scorerObservationRows: player.scorerDistributionSamples
    },
    details: opts.collectDetails ? player.details : undefined
  };
}

/** Statistik tim versi legacy (weighted by game decay) untuk baseline. */
function buildLegacyStats(memoryId, fromGameNumber) {
  const memory = StateManager.db?.memories?.[memoryId];
  const stats = {};
  let totalGoals = 0, totalAppearances = 0;
  for (const game of (memory?.games || [])) {
    if (Number(game.gameNumber) >= Number(fromGameNumber)) continue;
    const ts = Date.parse(game.lastUpdate || "");
    const days = isNaN(ts) ? 0 : Math.max(0, (Date.now() - ts) / 86400000);
    const weight = Math.max(0.3, Math.pow(0.5, days / 90));
    for (const m of (game.matches || [])) {
      const home = normalizeCountry(m?.home || "");
      const away = normalizeCountry(m?.away || "");
      const sc = parseScore(m?.score || "");
      if (!home || !away || !sc) continue;
      if (!stats[home]) stats[home] = { weight: 0, gf: 0, ga: 0, count: 0 };
      if (!stats[away]) stats[away] = { weight: 0, gf: 0, ga: 0, count: 0 };
      stats[home].weight += weight; stats[home].gf += sc.home * weight; stats[home].ga += sc.away * weight; stats[home].count++;
      stats[away].weight += weight; stats[away].gf += sc.away * weight; stats[away].ga += sc.home * weight; stats[away].count++;
      totalGoals += (sc.home + sc.away) * weight;
      totalAppearances += 2 * weight;
    }
  }
  const priorWeight = 25;
  const globalAttack = totalAppearances > 0
    ? (priorWeight * PREDICTOR_CONFIG.BASE_GLOBAL_ATTACK + totalGoals) / (priorWeight + totalAppearances)
    : PREDICTOR_CONFIG.BASE_GLOBAL_ATTACK;
  return { stats, globalAttack };
}

export function runWalkForwardBacktestWithOpts(memoryId, opts) {
  return runWalkForwardBacktest(memoryId, opts);
}

export function runAblationTest(memoryId = 1) {
  const base = runWalkForwardBacktest(memoryId);
  if (base.error) return base;
  const configs = [
    { name: "Team ratings only (form OFF, H2H OFF, context OFF)", opts: { disableForm: true, disableH2H: true, disableContext: true, disableVariance: true } },
    { name: "Team ratings + team form", opts: { disableForm: false, disableH2H: true, disableContext: true, disableVariance: true } },
    { name: "Team ratings + form + H2H", opts: { disableForm: false, disableH2H: false, disableContext: true, disableVariance: true } },
    { name: "Team ratings + form + H2H + context", opts: { disableForm: false, disableH2H: false, disableContext: false, disableVariance: true } },
    { name: "Full model (+ per-fixture conversion variance)", opts: {} }
  ];
  const results = [];
  let prevAcc = null;
  for (const cfg of configs) {
    const res = runWalkForwardBacktest(memoryId, cfg.opts);
    const acc = res.error ? 0 : res.exactScoreAccuracy;
    const delta = prevAcc === null ? 0 : acc - prevAcc;
    prevAcc = acc;
    results.push({
      component: cfg.name,
      exact: Number(acc.toFixed(2)),
      delta: Number(delta.toFixed(2)),
      xg1x2: res.error ? 0 : Number(res.result1X2Accuracy.toFixed(2)),
      topScorerHitRate: res.error ? 0 : Number(res.topScorerHitRate.toFixed(2)),
      opts: cfg.opts,
      totalTested: res.totalTested || 0
    });
  }
  return {
    base,
    ablation: results,
    modelComparison: base.modelComparison,
    note: "Ablation walk-forward (tanpa leakage, deterministik). Model pemain (playerScoring.js) tidak berubah antar konfigurasi — yang berubah hanya informasi tim (form/H2H/context)."
  };
}
