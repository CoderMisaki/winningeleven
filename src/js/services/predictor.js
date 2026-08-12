import { teamsDB } from "../data/teams.js";
import { StateManager } from "../state/appState.js";
import { normalizeCountry } from "./matchingEngine.js";
import { Security } from "../utils/security.js";
import { teamRatings } from "../data/teamRatings.js";

const MAX_SOURCES = 5;
const MAX_GOALS = 8;
const POISSON_CAP = 12;

function parseScore(scoreStr) {
  if (!scoreStr) return null;
  const parts = scoreStr.split(":");
  if (parts.length === 2) {
    const home = parseInt(parts[0].trim(), 10);
    const away = parseInt(parts[1].trim(), 10);
    if (!isNaN(home) && !isNaN(away)) {
      return { home, away };
    }
  }
  return null;
}

function normalizeScore(scoreStr) {
  const p = parseScore(scoreStr);
  if (!p) return "";
  return `${p.home}:${p.away}`;
}

function reverseScore(scoreStr) {
  const p = parseScore(scoreStr);
  if (!p) return "";
  return `${p.away}:${p.home}`;
}

function scoreDistance(score1, score2) {
  const p1 = parseScore(score1);
  const p2 = parseScore(score2);
  if (!p1 || !p2) return 999;
  return Math.abs(p1.home - p2.home) + Math.abs(p1.away - p2.away);
}

function clampNumber(num, a, b) {
  return Math.max(Math.min(num, Math.max(a, b)), Math.min(a, b));
}

// ----------------------------------------------------
// POISSON DISTRIBUTION
// ----------------------------------------------------
function factorial(n) {
  if (n === 0 || n === 1) return 1;
  let result = 1;
  for (let i = 2; i <= n; i++) {
    result *= i;
  }
  return result;
}

function poisson(k, lambda) {
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k);
}

function generateScoreDistribution(xgHome, xgAway) {
  const scores = [];
  let probHomeWin = 0;
  let probDraw = 0;
  let probAwayWin = 0;

  for (let i = 0; i <= POISSON_CAP; i++) {
    for (let j = 0; j <= POISSON_CAP; j++) {
      const prob = poisson(i, xgHome) * poisson(j, xgAway);
      if (prob > 0.0001) {
        scores.push({ home: i, away: j, prob });
        if (i > j) probHomeWin += prob;
        else if (i < j) probAwayWin += prob;
        else probDraw += prob;
      }
    }
  }

  scores.sort((a, b) => b.prob - a.prob);

  // Normalize
  const total = probHomeWin + probDraw + probAwayWin;
  probHomeWin /= total;
  probDraw /= total;
  probAwayWin /= total;

  return {
    distribution: scores,
    probs: {
      home: probHomeWin,
      draw: probDraw,
      away: probAwayWin
    }
  };
}

// ----------------------------------------------------
// TEAM STATS DARI DATASET MEMORY (EXCLUDING CURRENT GAME)
// ----------------------------------------------------
function buildTeamStats(excludeMemoryId = null, excludeGameNumber = null) {
  const stats = {};
  const memories = StateManager.db?.memories || {};

  for (const [memoryId, memory] of Object.entries(memories)) {
    if (!memory || !Array.isArray(memory.games)) continue;

    for (const game of memory.games) {
      // Exclude game yang sedang diedit/dijadikan query
      if (
        excludeMemoryId != null &&
        excludeGameNumber != null &&
        String(memoryId) === String(excludeMemoryId) &&
        game.gameNumber === excludeGameNumber
      ) {
        continue;
      }

      if (!game || !Array.isArray(game.matches)) continue;

      game.matches.forEach(m => {
        const homeCode = normalizeCountry(m?.home || "");
        const awayCode = normalizeCountry(m?.away || "");
        const parsed = parseScore(m?.score || "");

        if (homeCode && awayCode && parsed) {
          if (!stats[homeCode]) stats[homeCode] = { gf: 0, ga: 0, matches: 0 };
          if (!stats[awayCode]) stats[awayCode] = { gf: 0, ga: 0, matches: 0 };

          stats[homeCode].gf += parsed.home;
          stats[homeCode].ga += parsed.away;
          stats[homeCode].matches += 1;

          stats[awayCode].gf += parsed.away;
          stats[awayCode].ga += parsed.home;
          stats[awayCode].matches += 1;
        }
      });
    }
  }
  return stats;
}

function getGlobalAttack(stats) {
  let totalGoals = 0;
  let totalMatches = 0;
  for (const code in stats) {
    totalGoals += stats[code].gf;
    totalMatches += stats[code].matches;
  }
  if (totalMatches === 0) return 1.5;
  return totalGoals / totalMatches;
}

// ----------------------------------------------------
// HYBRID PREDICTOR: RATING -> HISTORY -> ENSEMBLE -> CONTEXT -> POISSON
// ----------------------------------------------------

// 1. WE10 Rating Base
function getRatingBase(code) {
  const rt = teamRatings[code];
  if (!rt) return null;

  // Normalize rating WE10 (biasanya range 65-95) ke 0-1 scale.
  const nAtk = clampNumber((rt.attack - 65) / 30, 0.1, 1.5);
  const nDef = clampNumber((rt.defense - 65) / 30, 0.1, 1.5);
  const nMid = clampNumber((rt.midfield - 65) / 30, 0.1, 1.5);
  // Tambahan untuk home advantage di base rating (opsional, ditaruh di calculate nanti)

  return { nAtk, nDef, nMid };
}

function estimateFromRatings(homeCode, awayCode) {
  const h = getRatingBase(homeCode);
  const a = getRatingBase(awayCode);

  if (!h || !a) return null; // Jika negara tidak ada di rating (cold-start terburuk)

  // Base xG dari Rating WE10
  // Home = Home Attack * Away Defense * Home Advantage * Midfield Control
  const midfieldRatio = h.nMid / (h.nMid + a.nMid);
  const homeAdvantage = 1.15;

  const baseHome = 1.3; // Base WE10 average goals per team per match

  const xgHome = baseHome * h.nAtk * (1.5 - a.nDef) * homeAdvantage * (midfieldRatio * 2);
  const xgAway = baseHome * a.nAtk * (1.5 - h.nDef) * (1/homeAdvantage) * ((1 - midfieldRatio) * 2);

  return {
    xgHome,
    xgAway,
    confidence: 30 // Rating only punya low confidence karena statis
  };
}

// 2. Historical Form
function estimateFromHistory(homeCode, awayCode, stats, globalAttack) {
  const hStats = stats[homeCode] || { gf: 0, ga: 0, matches: 0 };
  const aStats = stats[awayCode] || { gf: 0, ga: 0, matches: 0 };

  if (hStats.matches === 0 && aStats.matches === 0) return null;

  // Attack Strength = (Tim Avg GF) / Global Avg
  let hAttStr = 1.0;
  if (hStats.matches > 0) {
    hAttStr = (hStats.gf / hStats.matches) / globalAttack;
  }

  let aDefStr = 1.0;
  if (aStats.matches > 0) {
    aDefStr = (aStats.ga / aStats.matches) / globalAttack;
  }

  let aAttStr = 1.0;
  if (aStats.matches > 0) {
    aAttStr = (aStats.gf / aStats.matches) / globalAttack;
  }

  let hDefStr = 1.0;
  if (hStats.matches > 0) {
    hDefStr = (hStats.ga / hStats.matches) / globalAttack;
  }

  const xgHome = hAttStr * aDefStr * globalAttack * 1.15; // + Home advantage
  const xgAway = aAttStr * hDefStr * globalAttack * 0.85;

  const totalMatches = hStats.matches + aStats.matches;
  const confidence = clampNumber(30 + Math.min(totalMatches, 30), 30, 60);

  return {
    xgHome,
    xgAway,
    confidence
  };
}

// 3. H2H Ensemble
function estimateFromH2H(homeCode, awayCode, excludeMemoryId, excludeGameNumber) {
  const h2hMatches = [];
  const memories = StateManager.db?.memories || {};

  for (const [memoryId, memory] of Object.entries(memories)) {
    if (!memory || !Array.isArray(memory.games)) continue;

    for (const game of memory.games) {
      if (
        excludeMemoryId != null &&
        excludeGameNumber != null &&
        String(memoryId) === String(excludeMemoryId) &&
        game.gameNumber === excludeGameNumber
      ) {
        continue;
      }

      if (!game || !Array.isArray(game.matches)) continue;

      game.matches.forEach(m => {
        const dHome = normalizeCountry(m?.home || "");
        const dAway = normalizeCountry(m?.away || "");
        const parsed = parseScore(m?.score || "");

        if (parsed) {
          if (dHome === homeCode && dAway === awayCode) {
            h2hMatches.push({ home: parsed.home, away: parsed.away, exact: true });
          } else if (dHome === awayCode && dAway === homeCode) {
            h2hMatches.push({ home: parsed.away, away: parsed.home, exact: false });
          }
        }
      });
    }
  }

  if (h2hMatches.length === 0) return null;

  let totalHomeGoals = 0;
  let totalAwayGoals = 0;

  h2hMatches.forEach(m => {
    totalHomeGoals += m.home;
    totalAwayGoals += m.away;
  });

  const xgHome = totalHomeGoals / h2hMatches.length;
  const xgAway = totalAwayGoals / h2hMatches.length;

  const confidence = clampNumber(50 + (h2hMatches.length * 5), 50, 95);

  return {
    xgHome,
    xgAway,
    confidence,
    matchCount: h2hMatches.length
  };
}

// 4. Similarity Context (simplified for now, bisa dikembangkan lagi)
// Misalnya kalau di game yg sama (context) ada tim yg mirip (bisa pakai data similarity)

// Main Hybrid Predictor
function hybridPredict(homeCode, awayCode, excludeMemoryId = null, excludeGameNumber = null) {
  const stats = buildTeamStats(excludeMemoryId, excludeGameNumber);
  const globalAttack = getGlobalAttack(stats);

  const ratingEst = estimateFromRatings(homeCode, awayCode);
  const histEst = estimateFromHistory(homeCode, awayCode, stats, globalAttack);
  const h2hEst = estimateFromH2H(homeCode, awayCode, excludeMemoryId, excludeGameNumber);

  let finalXgHome = 1.0;
  let finalXgAway = 1.0;
  let finalConfidence = 0;
  let modelStr = [];

  // Weights (dinamis tergantung availability data)
  let wRating = 0;
  let wHist = 0;
  let wH2H = 0;

  if (h2hEst) {
    wH2H = clampNumber(0.4 + (h2hEst.matchCount * 0.05), 0.4, 0.7);
    if (histEst) wHist = (1 - wH2H) * 0.7;
    if (ratingEst) wRating = (1 - wH2H) * (histEst ? 0.3 : 1.0);
    else if (!histEst) wH2H = 1.0; // Hanya punya H2H (sangat jarang)
  } else {
    // Tidak ada H2H
    if (histEst && ratingEst) {
      const histMatches = (stats[homeCode]?.matches || 0) + (stats[awayCode]?.matches || 0);
      wHist = clampNumber(histMatches / 60, 0.2, 0.7); // Max 70% for history
      wRating = 1 - wHist;
    } else if (histEst) {
      wHist = 1.0;
    } else if (ratingEst) {
      wRating = 1.0;
    }
  }

  // Hitung final xG
  let totalWeight = wRating + wHist + wH2H;
  if (totalWeight === 0) {
    // Fallback ekstrim (tidak ada di rating, tidak ada histori)
    finalXgHome = 1.5;
    finalXgAway = 1.5;
    finalConfidence = 10;
    modelStr.push("Pure Random Fallback");
  } else {
    finalXgHome =
      ((ratingEst?.xgHome || 0) * wRating) +
      ((histEst?.xgHome || 0) * wHist) +
      ((h2hEst?.xgHome || 0) * wH2H);

    finalXgAway =
      ((ratingEst?.xgAway || 0) * wRating) +
      ((histEst?.xgAway || 0) * wHist) +
      ((h2hEst?.xgAway || 0) * wH2H);

    finalConfidence =
      ((ratingEst?.confidence || 0) * wRating) +
      ((histEst?.confidence || 0) * wHist) +
      ((h2hEst?.confidence || 0) * wH2H);

    if (wRating > 0) modelStr.push(`Rating (${Math.round(wRating*100)}%)`);
    if (wHist > 0) modelStr.push(`Histori (${Math.round(wHist*100)}%)`);
    if (wH2H > 0) modelStr.push(`H2H (${Math.round(wH2H*100)}%)`);
  }

  // Boundary limits
  finalXgHome = clampNumber(finalXgHome, 0.1, MAX_GOALS);
  finalXgAway = clampNumber(finalXgAway, 0.1, MAX_GOALS);

  const dist = generateScoreDistribution(finalXgHome, finalXgAway);
  const topScore = dist.distribution[0];

  let winner = "DRAW";
  if (dist.probs.home > dist.probs.away + 0.1) winner = teamsDB[homeCode]?.name || homeCode; // Win threshold
  else if (dist.probs.away > dist.probs.home + 0.1) winner = teamsDB[awayCode]?.name || awayCode;

  return {
    homeGoals: topScore.home,
    awayGoals: topScore.away,
    winner,
    confidence: Math.round(finalConfidence),
    xgHome: finalXgHome.toFixed(2),
    xgAway: finalXgAway.toFixed(2),
    xgHomeNum: finalXgHome,
    xgAwayNum: finalXgAway,
    model: "Hybrid: " + modelStr.join(" + "),
    distribution: dist.distribution.slice(0, 5), // Top 5 scores
    probs: dist.probs,
    evidence: {
      hasH2H: !!h2hEst,
      h2hMatches: h2hEst?.matchCount || 0,
      hasRating: !!ratingEst,
      hasHistory: !!histEst,
      homeMatches: stats[homeCode]?.matches || 0,
      awayMatches: stats[awayCode]?.matches || 0
    }
  };
}

export const PredictionService = {
  predictMatches(dataSource) {
    const rows = dataSource?.matches || [];

    const prefer =
      StateManager.activeMemoryId != null && dataSource?.gameNumber
        ? {
            memoryId: StateManager.activeMemoryId,
            gameNumber: dataSource.gameNumber
          }
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
        row.error = "HOME dan AWAY harus diisi untuk melakukan prediksi.";
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

      // Gunakan Hybrid Predictor
      const prediction = hybridPredict(homeCode, awayCode, prefer.memoryId, prefer.gameNumber);

      row.prediction = prediction;
      results.push(row);
    });

    return results;
  }
};
