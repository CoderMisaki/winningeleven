import { teamsDB } from "../data/teams.js";
import { StateManager } from "../state/appState.js";
import { normalizeCountry } from "./similarity.js";
import { teamRatings } from "../data/teamRatings.js";

export const PREDICTOR_CONFIG = {
  MODEL_VERSION: "WE10 Hybrid Ensemble v3.2 (Bayesian Dixon-Coles)",
  MAX_XG: 6.0,
  MIN_XG: 0.15,
  POISSON_CAP: 10,
  PRIOR_MATCH_WEIGHT: 8.0,
  BASE_GLOBAL_ATTACK: 1.45,
  GLOBAL_HOME_ADVANTAGE: 1.14,
  AWAY_FACTOR: 0.94,
  RHO_CORRECTION: 0.06,
  RECENCY_HALF_LIFE_DAYS: 120,
  MAX_H2H_INFLUENCE: 0.25,
  SIMILAR_CONTEXT_NEIGHBORS: 5,
  MAX_SIMILAR_CONTEXT_INFLUENCE: 0.18
};

const FACT = [1];
for (let i = 1; i <= PREDICTOR_CONFIG.POISSON_CAP; i++) {
  FACT[i] = FACT[i - 1] * i;
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function parseScore(scoreStr) {
  if (typeof scoreStr !== "string") return null;
  const clean = scoreStr.trim().replace(/[-–—;]+/g, ":");
  const parts = clean.split(":");
  if (parts.length !== 2) return null;
  const home = parseInt(parts[0], 10);
  const away = parseInt(parts[1], 10);
  if (isNaN(home) || isNaN(away) || home < 0 || away < 0) return null;
  return { home, away };
}

function poissonProb(k, lambda) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / FACT[k];
}

function tauCorrection(i, j, lambda, mu, rho) {
  if (i === 0 && j === 0) return Math.max(0.2, 1 - lambda * mu * rho);
  if (i === 0 && j === 1) return Math.max(0.2, 1 + lambda * rho);
  if (i === 1 && j === 0) return Math.max(0.2, 1 + mu * rho);
  if (i === 1 && j === 1) return Math.max(0.2, 1 - rho);
  return 1.0;
}

function getRatingPrior(code) {
  const r = teamRatings[code];
  if (!r) {
    return { att: 1.0, def: 1.0, mid: 0.5, spd: 0.5, pow: 0.5, sta: 0.5, overall: 75, has: false };
  }
  const norm = (v) => clamp((v - 65) / 30, 0, 1);
  return {
    att: 0.70 + norm(r.attack) * 0.70,
    def: 1.40 - norm(r.defense) * 0.70,
    mid: norm(r.midfield),
    spd: norm(r.speed),
    pow: norm(r.power),
    sta: norm(r.stamina),
    overall: r.overall,
    has: true
  };
}

function getGameDecayWeight(game) {
  const ts = Date.parse(game?.lastUpdate || "");
  if (!isNaN(ts)) {
    const days = Math.max(0, (Date.now() - ts) / 86400000);
    return Math.max(0.3, Math.pow(0.5, days / PREDICTOR_CONFIG.RECENCY_HALF_LIFE_DAYS));
  }
  return 1.0;
}

function extractDataset(excludeMemoryId = null, excludeGameNumber = null) {
  const memories = StateManager.db?.memories || {};
  const matches = [];
  const stats = {};
  let totalGoals = 0;
  let totalAppearances = 0;

  for (const [memId, memory] of Object.entries(memories)) {
    if (!memory || !Array.isArray(memory.games)) continue;

    for (const game of memory.games) {
      if (!game || !Array.isArray(game.matches)) continue;
      if (
        excludeMemoryId != null &&
        excludeGameNumber != null &&
        String(memId) === String(excludeMemoryId) &&
        game.gameNumber === excludeGameNumber
      ) {
        continue;
      }

      const weight = getGameDecayWeight(game);

      for (const m of game.matches) {
        const home = normalizeCountry(m?.home || "");
        const away = normalizeCountry(m?.away || "");
        const score = parseScore(m?.score || "");
        if (!home || !away || !score) continue;

        matches.push({ home, away, score, weight, gameNumber: game.gameNumber, memoryId: memId });

        if (!stats[home]) stats[home] = { weight: 0, gf: 0, ga: 0, count: 0, homeCount: 0, homeGf: 0 };
        if (!stats[away]) stats[away] = { weight: 0, gf: 0, ga: 0, count: 0, awayCount: 0, awayGf: 0 };

        stats[home].weight += weight;
        stats[home].gf += score.home * weight;
        stats[home].ga += score.away * weight;
        stats[home].count += 1;
        stats[home].homeCount += 1;
        stats[home].homeGf += score.home * weight;

        stats[away].weight += weight;
        stats[away].gf += score.away * weight;
        stats[away].ga += score.home * weight;
        stats[away].count += 1;
        stats[away].awayCount += 1;
        stats[away].awayGf += score.away * weight;

        totalGoals += (score.home + score.away) * weight;
        totalAppearances += 2 * weight;
      }
    }
  }

  const priorWeight = 25;
  const globalAttack = totalAppearances > 0
    ? (priorWeight * PREDICTOR_CONFIG.BASE_GLOBAL_ATTACK + totalGoals) / (priorWeight + totalAppearances)
    : PREDICTOR_CONFIG.BASE_GLOBAL_ATTACK;

  return { matches, stats, globalAttack };
}

function calculateTeamStrength(code, stats, globalAttack) {
  const prior = getRatingPrior(code);
  const s = stats[code];
  const w = s ? s.weight : 0;

  let attObs = prior.att;
  let defObs = prior.def;

  if (w > 0 && globalAttack > 0) {
    attObs = (s.gf / w) / globalAttack;
    defObs = (s.ga / w) / globalAttack;
  }

  const k = PREDICTOR_CONFIG.PRIOR_MATCH_WEIGHT;
  const att = clamp((w * attObs + k * prior.att) / (w + k), 0.35, 2.8);
  const def = clamp((w * defObs + k * prior.def) / (w + k), 0.35, 2.8);

  return {
    att,
    def,
    mid: prior.mid,
    spd: prior.spd,
    pow: prior.pow,
    overall: prior.overall,
    hasRating: prior.has,
    weight: w,
    rawCount: s ? s.count : 0
  };
}

function calculateH2H(homeCode, awayCode, matches) {
  let count = 0;
  let sumW = 0;
  let homeGoals = 0;
  let awayGoals = 0;

  for (const m of matches) {
    if (m.home === homeCode && m.away === awayCode) {
      count++;
      sumW += m.weight;
      homeGoals += m.score.home * m.weight;
      awayGoals += m.score.away * m.weight;
    } else if (m.home === awayCode && m.away === homeCode) {
      count++;
      sumW += m.weight;
      homeGoals += m.score.away * m.weight;
      awayGoals += m.score.home * m.weight;
    }
  }

  if (count === 0 || sumW <= 0) return null;

  return {
    count,
    avgHome: homeGoals / sumW,
    avgAway: awayGoals / sumW
  };
}

function findSimilarContextGoals(homeRating, awayRating, matches) {
  if (!matches.length) return null;

  const targetDiff = (homeRating.overall || 75) - (awayRating.overall || 75);
  const targetMidDiff = (homeRating.mid - awayRating.mid);

  const scoredMatches = matches.map(m => {
    const hPrior = getRatingPrior(m.home);
    const aPrior = getRatingPrior(m.away);
    const matchDiff = hPrior.overall - aPrior.overall;
    const matchMidDiff = hPrior.mid - aPrior.mid;

    const dist = Math.sqrt(
      Math.pow(targetDiff - matchDiff, 2) * 0.6 +
      Math.pow(targetMidDiff - matchMidDiff, 2) * 400 * 0.4
    );
    return { match: m, dist };
  });

  scoredMatches.sort((a, b) => a.dist - b.dist);
  const topK = scoredMatches.slice(0, PREDICTOR_CONFIG.SIMILAR_CONTEXT_NEIGHBORS);
  if (!topK.length) return null;

  let sumSim = 0;
  let hGoals = 0;
  let aGoals = 0;

  topK.forEach(({ match, dist }) => {
    const sim = 1 / (1 + dist);
    sumSim += sim;
    hGoals += match.score.home * sim;
    aGoals += match.score.away * sim;
  });

  if (sumSim <= 0) return null;

  return {
    samples: topK.length,
    avgHome: hGoals / sumSim,
    avgAway: aGoals / sumSim
  };
}

function generateBivariateDistribution(lambdaHome, lambdaAway) {
  const matrix = [];
  let totalProb = 0;
  const cap = PREDICTOR_CONFIG.POISSON_CAP;
  const rho = PREDICTOR_CONFIG.RHO_CORRECTION;

  for (let i = 0; i <= cap; i++) {
    matrix[i] = [];
    for (let j = 0; j <= cap; j++) {
      const p = poissonProb(i, lambdaHome) * poissonProb(j, lambdaAway) * tauCorrection(i, j, lambdaHome, lambdaAway, rho);
      const validP = Math.max(0, isFinite(p) ? p : 0);
      matrix[i][j] = validP;
      totalProb += validP;
    }
  }

  if (totalProb <= 0) totalProb = 1;

  const scorelines = [];
  let pHome = 0;
  let pDraw = 0;
  let pAway = 0;
  let over25 = 0;
  let btts = 0;

  for (let i = 0; i <= cap; i++) {
    for (let j = 0; j <= cap; j++) {
      const pNorm = matrix[i][j] / totalProb;
      scorelines.push({ home: i, away: j, prob: pNorm });
      if (i > j) pHome += pNorm;
      else if (i < j) pAway += pNorm;
      else pDraw += pNorm;
      if (i + j > 2.5) over25 += pNorm;
      if (i > 0 && j > 0) btts += pNorm;
    }
  }

  scorelines.sort((a, b) => b.prob - a.prob);
  const under25 = Math.max(0, 1 - over25);

  return {
    distribution: scorelines,
    topScore: scorelines[0],
    probs: {
      home: clamp(pHome, 0, 1),
      draw: clamp(pDraw, 0, 1),
      away: clamp(pAway, 0, 1)
    },
    markets: {
      over25: clamp(over25, 0, 1),
      under25: clamp(under25, 0, 1),
      btts: clamp(btts, 0, 1)
    }
  };
}

function calculateModelEntropyConfidence(probs, evidence) {
  const p = [probs.home, probs.draw, probs.away].filter(v => v > 0);
  const maxEntropy = Math.log(3);
  let entropy = 0;
  p.forEach(val => {
    entropy -= val * Math.log(val);
  });
  const entropyPenalty = clamp(entropy / maxEntropy, 0, 1);

  let evidenceScore = 20;
  if (evidence.hasRating) evidenceScore += 25;
  evidenceScore += Math.min(30, evidence.homeWeight * 2.5 + evidence.awayWeight * 2.5);
  if (evidence.hasH2H) evidenceScore += Math.min(15, evidence.h2hMatches * 4);
  if (evidence.hasSimilarContext) evidenceScore += 10;

  const coverageNorm = clamp(evidenceScore / 100, 0.1, 1.0);
  const finalConf = coverageNorm * (1 - 0.45 * entropyPenalty) * 100;
  return Math.round(clamp(finalConf, 12, 94));
}

export function hybridPredict(homeCode, awayCode, excludeMemoryId = null, excludeGameNumber = null) {
  const { matches, stats, globalAttack } = extractDataset(excludeMemoryId, excludeGameNumber);
  const h = calculateTeamStrength(homeCode, stats, globalAttack);
  const a = calculateTeamStrength(awayCode, stats, globalAttack);

  const midDiff = h.mid - a.mid;
  const spdDiff = h.spd - a.spd;
  const tacticalFactorHome = 1.0 + (midDiff * 0.12) + (spdDiff * 0.05);
  const tacticalFactorAway = 1.0 - (midDiff * 0.12) - (spdDiff * 0.05);

  let xgHome = globalAttack * h.att * a.def * PREDICTOR_CONFIG.GLOBAL_HOME_ADVANTAGE * tacticalFactorHome;
  let xgAway = globalAttack * a.att * h.def * PREDICTOR_CONFIG.AWAY_FACTOR * tacticalFactorAway;

  const modelParts = ["Ratings", "Form"];

  const h2h = calculateH2H(homeCode, awayCode, matches);
  if (h2h) {
    const h2hWeight = Math.min(PREDICTOR_CONFIG.MAX_H2H_INFLUENCE, 0.08 * Math.sqrt(h2h.count));
    xgHome = (1 - h2hWeight) * xgHome + h2hWeight * h2h.avgHome;
    xgAway = (1 - h2hWeight) * xgAway + h2hWeight * h2h.avgAway;
    modelParts.push(`H2H (${Math.round(h2hWeight * 100)}%)`);
  }

  const simContext = findSimilarContextGoals(h, a, matches);
  if (simContext) {
    const simWeight = PREDICTOR_CONFIG.MAX_SIMILAR_CONTEXT_INFLUENCE;
    xgHome = (1 - simWeight) * xgHome + simWeight * simContext.avgHome;
    xgAway = (1 - simWeight) * xgAway + simWeight * simContext.avgAway;
    modelParts.push(`Context (${Math.round(simWeight * 100)}%)`);
  }

  xgHome = clamp(xgHome, PREDICTOR_CONFIG.MIN_XG, PREDICTOR_CONFIG.MAX_XG);
  xgAway = clamp(xgAway, PREDICTOR_CONFIG.MIN_XG, PREDICTOR_CONFIG.MAX_XG);

  const distResult = generateBivariateDistribution(xgHome, xgAway);

  const evidence = {
    hasRating: h.hasRating && a.hasRating,
    hasHistory: h.rawCount > 0 || a.rawCount > 0,
    homeMatches: h.rawCount,
    awayMatches: a.rawCount,
    homeWeight: Number(h.weight.toFixed(2)),
    awayWeight: Number(a.weight.toFixed(2)),
    hasH2H: !!h2h,
    h2hMatches: h2h ? h2h.count : 0,
    hasSimilarContext: !!simContext,
    globalAttack: Number(globalAttack.toFixed(2))
  };

  const confidence = calculateModelEntropyConfidence(distResult.probs, evidence);

  let winner = "DRAW";
  if (distResult.probs.home > distResult.probs.away + 0.07) {
    winner = teamsDB[homeCode]?.name || homeCode;
  } else if (distResult.probs.away > distResult.probs.home + 0.07) {
    winner = teamsDB[awayCode]?.name || awayCode;
  }

  return {
    homeGoals: distResult.topScore.home,
    awayGoals: distResult.topScore.away,
    winner,
    confidence,
    xgHome: Number(xgHome.toFixed(2)),
    xgAway: Number(xgAway.toFixed(2)),
    model: `${PREDICTOR_CONFIG.MODEL_VERSION} [${modelParts.join(" + ")}]`,
    probs: distResult.probs,
    markets: distResult.markets,
    distribution: distResult.distribution.slice(0, 5),
    evidence
  };
}

export const PredictionService = {
  predictMatches(dataSource) {
    const rows = dataSource?.matches || [];
    const excludeContext = StateManager.activeMemoryId != null && dataSource?.gameNumber
      ? { memoryId: StateManager.activeMemoryId, gameNumber: dataSource.gameNumber }
      : {};

    const results = [];

    rows.forEach((m, idx) => {
      const homeRaw = (m?.home || "").trim();
      const awayRaw = (m?.away || "").trim();
      if (!homeRaw && !awayRaw) return;

      const row = {
        row: idx + 1,
        homeInput: homeRaw,
        awayInput: awayRaw,
        homeName: homeRaw || "?",
        awayName: awayRaw || "?"
      };

      if (!homeRaw || !awayRaw) {
        row.error = "HOME dan AWAY harus terisi.";
        results.push(row);
        return;
      }

      const homeCode = normalizeCountry(homeRaw);
      const awayCode = normalizeCountry(awayRaw);

      if (!teamsDB[homeCode] || !teamsDB[awayCode]) {
        row.error = `Negara tidak dikenal: ${homeRaw || "?"} vs ${awayRaw || "?"}`;
        results.push(row);
        return;
      }

      if (homeCode === awayCode) {
        row.error = `HOME dan AWAY sama: ${teamsDB[homeCode].name}`;
        results.push(row);
        return;
      }

      row.homeCode = homeCode;
      row.awayCode = awayCode;
      row.homeName = teamsDB[homeCode].name;
      row.awayName = teamsDB[awayCode].name;

      const pred = hybridPredict(
        homeCode,
        awayCode,
        excludeContext.memoryId ?? null,
        excludeContext.gameNumber ?? null
      );

      row.prediction = pred;
      results.push(row);
    });

    return results;
  },

  runWalkForwardBacktest(memoryId = 1) {
    const memory = StateManager.db?.memories?.[memoryId];
    if (!memory || !Array.isArray(memory.games) || memory.games.length < 2) {
      return { error: "Minimal 2 games pada memory database diperlukan untuk backtest valid." };
    }

    let totalTested = 0;
    let exactHits = 0;
    let result1X2Hits = 0;
    let top3Hits = 0;
    let top5Hits = 0;
    let sumAbsErrHome = 0;
    let sumAbsErrAway = 0;
    let sumBrier = 0;
    let sumLogLoss = 0;

    for (let gIdx = 1; gIdx < memory.games.length; gIdx++) {
      const targetGame = memory.games[gIdx];
      if (!targetGame || !Array.isArray(targetGame.matches)) continue;

      for (const m of targetGame.matches) {
        const hCode = normalizeCountry(m?.home || "");
        const aCode = normalizeCountry(m?.away || "");
        const actual = parseScore(m?.score || "");
        if (!hCode || !aCode || !actual || !teamsDB[hCode] || !teamsDB[aCode]) continue;

        const pred = hybridPredict(hCode, aCode, memoryId, targetGame.gameNumber);
        totalTested++;

        if (pred.homeGoals === actual.home && pred.awayGoals === actual.away) {
          exactHits++;
        }

        const actual1X2 = actual.home > actual.away ? "HOME" : (actual.away > actual.home ? "AWAY" : "DRAW");
        const pred1X2 = pred.probs.home > Math.max(pred.probs.draw, pred.probs.away)
          ? "HOME"
          : (pred.probs.away > Math.max(pred.probs.home, pred.probs.draw) ? "AWAY" : "DRAW");
        if (actual1X2 === pred1X2) result1X2Hits++;

        const top3 = pred.distribution.slice(0, 3);
        if (top3.some(s => s.home === actual.home && s.away === actual.away)) top3Hits++;

        const top5 = pred.distribution.slice(0, 5);
        if (top5.some(s => s.home === actual.home && s.away === actual.away)) top5Hits++;

        sumAbsErrHome += Math.abs(pred.homeGoals - actual.home);
        sumAbsErrAway += Math.abs(pred.awayGoals - actual.away);

        const oH = actual1X2 === "HOME" ? 1 : 0;
        const oD = actual1X2 === "DRAW" ? 1 : 0;
        const oA = actual1X2 === "AWAY" ? 1 : 0;
        const brier = (Math.pow(pred.probs.home - oH, 2) + Math.pow(pred.probs.draw - oD, 2) + Math.pow(pred.probs.away - oA, 2)) / 3;
        sumBrier += brier;

        const actualProb = actual1X2 === "HOME" ? pred.probs.home : (actual1X2 === "DRAW" ? pred.probs.draw : pred.probs.away);
        sumLogLoss += -Math.log(Math.max(0.01, actualProb));
      }
    }

    if (totalTested === 0) return { error: "Tidak ada pertandingan terisi skor untuk backtest." };

    return {
      totalTested,
      exactScoreAccuracy: (exactHits / totalTested) * 100,
      result1X2Accuracy: (result1X2Hits / totalTested) * 100,
      top3ScoreHitRate: (top3Hits / totalTested) * 100,
      top5ScoreHitRate: (top5Hits / totalTested) * 100,
      maeHomeGoals: sumAbsErrHome / totalTested,
      maeAwayGoals: sumAbsErrAway / totalTested,
      meanBrierScore: sumBrier / totalTested,
      meanLogLoss: sumLogLoss / totalTested
    };
  }
};
