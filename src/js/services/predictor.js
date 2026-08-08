import { teamRatings } from "../data/teamRatings.js";
import { StateManager } from "../state/appState.js";
import { normalizeCountry } from "./similarity.js";
import { teamsDB } from "../data/teams.js";
import { Security } from "../utils/security.js";

const HOME_ADVANTAGE = 0.18;
const PRIOR_MATCHES = 6;
const MAX_GOALS = 8;
const MAX_SOURCES = 6;

const RATING_NEUTRAL_BASE = 1.46;
const RATING_HOME_BOOST = 0.27;
const RATING_DIVISOR = 34;
const MIN_RATING_XG = 0.18;
const MAX_RATING_XG = 6.2;


function normalizeScore(score) {
  if (typeof score !== "string") return "";
  return score
    .trim()
    .replace(/[-–—;]+/g, ":")
    .replace(/\s+/g, "");
}

function parseScore(score) {
  const s = normalizeScore(score);
  const m = s.match(/^(\d+):(\d+)$/);
  if (!m) return null;
  return {
    home: parseInt(m[1], 10),
    away: parseInt(m[2], 10)
  };
}

function reverseScore(score) {
  const s = normalizeScore(score);
  const parts = s.split(":");
  if (parts.length !== 2) return s;
  return `${parts[1]}:${parts[0]}`;
}

function scoreDistance(a, b) {
  const qa = parseScore(a);
  const qb = parseScore(b);
  if (!qa || !qb) return 999;
  return Math.abs(qa.home - qb.home) + Math.abs(qa.away - qb.away);
}

function createTeamStats(code) {
  return {
    code,
    matches: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    topGoals: 0
  };
}

function buildTeamStats(exclude = {}) {
  const stats = {};
  const getTeam = code => (stats[code] ||= createTeamStats(code));
  const memories = StateManager.db?.memories || {};

  for (const [memoryId, memory] of Object.entries(memories)) {
    if (!memory || !Array.isArray(memory.games)) continue;

    for (const game of memory.games) {
      if (!game || !Array.isArray(game.matches)) continue;

      const isExcluded =
        exclude.memoryId != null &&
        exclude.gameNumber != null &&
        String(memoryId) === String(exclude.memoryId) &&
        game.gameNumber === exclude.gameNumber;

      if (isExcluded) continue;

      for (const m of game.matches) {
        if (!m) continue;

        const home = normalizeCountry(m.home || "");
        const away = normalizeCountry(m.away || "");
        const score = parseScore(m.score || "");

        if (!home || !away || !score || !teamsDB[home] || !teamsDB[away]) continue;

        const h = getTeam(home);
        const a = getTeam(away);

        h.matches++;
        a.matches++;

        h.goalsFor += score.home;
        h.goalsAgainst += score.away;

        a.goalsFor += score.away;
        a.goalsAgainst += score.home;

        if (score.home > score.away) {
          h.wins++;
          a.losses++;
        } else if (score.home < score.away) {
          a.wins++;
          h.losses++;
        } else {
          h.draws++;
          a.draws++;
        }
      }

      if (Array.isArray(game.topGoals)) {
        for (const g of game.topGoals) {
          const country = normalizeCountry(g?.country || "");
          const goals = parseInt(g?.goals, 10);

          if (country && teamsDB[country] && Number.isInteger(goals) && goals > 0) {
            getTeam(country).topGoals += goals;
          }
        }
      }
    }
  }

  return stats;
}

function getGlobalAttack(stats) {
  let totalMatches = 0;
  let totalGoals = 0;

  for (const team of Object.values(stats)) {
    totalMatches += team.matches;
    totalGoals += team.goalsFor;
  }

  return totalMatches === 0 ? 1.3 : totalGoals / totalMatches;
}

function poissonProbability(lambda, k) {
  if (!Number.isFinite(lambda)) return 0;
  if (lambda <= 0) return k === 0 ? 1 : 0;

  let p = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) {
    p *= lambda / i;
  }
  return p;
}

function mostLikelyScore(lambdaHome, lambdaAway) {
  let best = { home: 0, away: 0, prob: -1 };

  for (let h = 0; h <= MAX_GOALS; h++) {
    for (let a = 0; a <= MAX_GOALS; a++) {
      const prob =
        poissonProbability(lambdaHome, h) *
        poissonProbability(lambdaAway, a);

      if (prob > best.prob) {
        best = { home: h, away: a, prob };
      }
    }
  }

  return best;
}

function clampNumber(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function ratingAttackScore(r) {
  if (!r) return 0;

  return (
    r.attack * 0.45 +
    r.midfield * 0.25 +
    r.speed * 0.15 +
    r.power * 0.10 +
    r.stamina * 0.05
  );
}

function ratingDefenseScore(r) {
  if (!r) return 0;

  return (
    r.defense * 0.45 +
    r.midfield * 0.20 +
    r.power * 0.15 +
    r.stamina * 0.10 +
    r.speed * 0.10
  );
}

function estimateFromRatings(homeCode, awayCode, stats) {
  const H = teamRatings && teamRatings[homeCode] ? teamRatings[homeCode] : null;
  const A = teamRatings && teamRatings[awayCode] ? teamRatings[awayCode] : null;

  if (!H || !A) return null;

  const hAtt = ratingAttackScore(H);
  const aAtt = ratingAttackScore(A);
  const hDef = ratingDefenseScore(H);
  const aDef = ratingDefenseScore(A);

  // Expected goals dasar dari selisih attack vs defense.
  // exponential dipakai supaya perbedaan rating tidak menghasilkan nilai negatif.
  let xgHome = (RATING_NEUTRAL_BASE + RATING_HOME_BOOST) *
    Math.exp((hAtt - aDef) / RATING_DIVISOR);

  let xgAway = RATING_NEUTRAL_BASE *
    Math.exp((aAtt - hDef) / RATING_DIVISOR);

  // Kontrol lini tengah.
  // Tim dengan midfield lebih baik mendapat sedikit boost, lawan sedikit nerf.
  const midControl = clampNumber((H.midfield - A.midfield) / 100, -0.18, 0.18);
  xgHome *= 1 + (midControl * 0.55);
  xgAway *= 1 - (midControl * 0.55);

  xgHome = clampNumber(xgHome, MIN_RATING_XG, MAX_RATING_XG);
  xgAway = clampNumber(xgAway, MIN_RATING_XG, MAX_RATING_XG);

  const best = mostLikelyScore(xgHome, xgAway);

  let winner = "DRAW";
  if (best.home > best.away) {
    winner = teamsDB[homeCode] ? teamsDB[homeCode].name : homeCode;
  } else if (best.away > best.home) {
    winner = teamsDB[awayCode] ? teamsDB[awayCode].name : awayCode;
  }

  const homeMatches = stats && stats[homeCode] ? stats[homeCode].matches : 0;
  const awayMatches = stats && stats[awayCode] ? stats[awayCode].matches : 0;
  const totalMatches = homeMatches + awayMatches;

  // Confidence dihitung dari:
  // - selisih xG
  // - selisih overall
  // - jumlah data histori jika ada
  const overallDiff = (H.overall - A.overall) + 2.5;
  let confidence =
    34 +
    (Math.abs(xgHome - xgAway) * 11) +
    (Math.abs(overallDiff) * 0.55) +
    Math.min(10, totalMatches * 0.3);

  confidence = Math.round(clampNumber(confidence, 22, 93));

  return {
    estimated: true,
    dataType: "ESTIMASI RATING WE10 (MATEMATIKA)",
    model: "WE10 rating (attack/defense/midfield) + Poisson",
    homeGoals: best.home,
    awayGoals: best.away,
    winner,
    confidence,
    xgHome: xgHome.toFixed(2),
    xgAway: xgAway.toFixed(2),
    xgHomeNum: xgHome,
    xgAwayNum: xgAway,
    homeMatches,
    awayMatches
  };
}

function estimateFromHistory(homeCode, awayCode, exclude = {}, preStats = null, preGlobalAttack = null) {
  const stats = preStats || buildTeamStats(exclude);
  const globalAttack = typeof preGlobalAttack === "number"
    ? preGlobalAttack
    : getGlobalAttack(stats);

  const hStats = stats[homeCode] || createTeamStats(homeCode);
  const aStats = stats[awayCode] || createTeamStats(awayCode);

  const homeAttack =
    (hStats.goalsFor + globalAttack * PRIOR_MATCHES) /
    (hStats.matches + PRIOR_MATCHES);

  const homeDefense =
    (hStats.goalsAgainst + globalAttack * PRIOR_MATCHES) /
    (hStats.matches + PRIOR_MATCHES);

  const awayAttack =
    (aStats.goalsFor + globalAttack * PRIOR_MATCHES) /
    (aStats.matches + PRIOR_MATCHES);

  const awayDefense =
    (aStats.goalsAgainst + globalAttack * PRIOR_MATCHES) /
    (aStats.matches + PRIOR_MATCHES);

  let xgHome = ((homeAttack + awayDefense) / 2) + HOME_ADVANTAGE;
  let xgAway = (awayAttack + homeDefense) / 2;

  if (!Number.isFinite(xgHome)) xgHome = globalAttack;
  if (!Number.isFinite(xgAway)) xgAway = globalAttack;

  xgHome = Math.max(0.05, Math.min(MAX_GOALS, xgHome));
  xgAway = Math.max(0.05, Math.min(MAX_GOALS, xgAway));

  const best = mostLikelyScore(xgHome, xgAway);

  let winner = "DRAW";
  if (best.home > best.away) {
    winner = teamsDB[homeCode] ? teamsDB[homeCode].name : homeCode;
  } else if (best.away > best.home) {
    winner = teamsDB[awayCode] ? teamsDB[awayCode].name : awayCode;
  }

  const dataQuality = Math.min(1, (hStats.matches + aStats.matches) / 30);

  let confidence =
    20 +
    dataQuality * 42 +
    Math.abs(xgHome - xgAway) * 12;

  confidence = Math.round(Math.min(88, confidence));

  return {
    estimated: true,
    dataType: "ESTIMASI HISTORI DATASET",
    model: "Histori pertandingan + Poisson",
    homeGoals: best.home,
    awayGoals: best.away,
    winner,
    confidence,
    xgHome: xgHome.toFixed(2),
    xgAway: xgAway.toFixed(2),
    xgHomeNum: xgHome,
    xgAwayNum: xgAway,
    homeMatches: hStats.matches,
    awayMatches: aStats.matches
  };
}

function estimateMatch(homeCode, awayCode, exclude = {}) {
  const stats = buildTeamStats(exclude);
  const globalAttack = getGlobalAttack(stats);

  const ratingEst = estimateFromRatings(homeCode, awayCode, stats);
  const historyEst = estimateFromHistory(homeCode, awayCode, exclude, stats, globalAttack);

  // Jika rating tidak tersedia, fallback ke histori lama.
  if (!ratingEst) {
    return historyEst;
  }

  const homeMatches = stats && stats[homeCode] ? stats[homeCode].matches : 0;
  const awayMatches = stats && stats[awayCode] ? stats[awayCode].matches : 0;
  const totalMatches = homeMatches + awayMatches;

  // Jika histori sangat sedikit, prioritaskan rating WE10.
  if (totalMatches < 4) {
    return ratingEst;
  }

  // Jika histori cukup, blend rating + histori.
  // Rating tetap dominan supaya era WE10 terjaga.
  const historyWeight = Math.min(0.35, totalMatches / 90);
  const ratingWeight = 1 - historyWeight;

  const xgHome =
    (ratingEst.xgHomeNum * ratingWeight) +
    (historyEst.xgHomeNum * historyWeight);

  const xgAway =
    (ratingEst.xgAwayNum * ratingWeight) +
    (historyEst.xgAwayNum * historyWeight);

  const best = mostLikelyScore(xgHome, xgAway);

  let winner = "DRAW";
  if (best.home > best.away) {
    winner = teamsDB[homeCode] ? teamsDB[homeCode].name : homeCode;
  } else if (best.away > best.home) {
    winner = teamsDB[awayCode] ? teamsDB[awayCode].name : awayCode;
  }

  let confidence =
    (ratingEst.confidence * 0.72) +
    (historyEst.confidence * 0.28) +
    Math.min(5, totalMatches * 0.15);

  confidence = Math.round(clampNumber(confidence, 22, 94));

  return {
    ...ratingEst,
    dataType: totalMatches >= 8
      ? "ESTIMASI RATING WE10 + HISTORI"
      : ratingEst.dataType,
    model: totalMatches >= 8
      ? "WE10 rating + histori + Poisson"
      : ratingEst.model,
    homeGoals: best.home,
    awayGoals: best.away,
    winner,
    confidence,
    xgHome: xgHome.toFixed(2),
    xgAway: xgAway.toFixed(2),
    xgHomeNum: xgHome,
    xgAwayNum: xgAway,
    homeMatches,
    awayMatches
  };
}

function collectTopGoals(game) {
  if (!game || !Array.isArray(game.topGoals)) return [];

  return game.topGoals
    .map(g => ({
      country: Security.decodeHtml((g?.country || "").trim()),
      player: Security.decodeHtml((g?.player || "").trim()),
      goals: (g?.goals || "").trim()
    }))
    .filter(g => g.country || g.player || g.goals);
}

function findDatasetSources(homeCode, awayCode, queryScore, prefer = {}) {
  const sources = [];
  const qScore = normalizeScore(queryScore || "");
  const memories = StateManager.db?.memories || {};

  for (const [memoryId, memory] of Object.entries(memories)) {
    if (!memory || !Array.isArray(memory.games)) continue;

    for (const game of memory.games) {
      if (!game || !Array.isArray(game.matches)) continue;

      game.matches.forEach((m, matchIndex) => {
        const datasetHome = normalizeCountry(m?.home || "");
        const datasetAway = normalizeCountry(m?.away || "");

        if (!datasetHome || !datasetAway) return;
        if (!teamsDB[datasetHome] || !teamsDB[datasetAway]) return;

        let orientation = null;

        if (datasetHome === homeCode && datasetAway === awayCode) {
          orientation = "exact";
        } else if (datasetHome === awayCode && datasetAway === homeCode) {
          orientation = "reverse";
        } else {
          return;
        }

        const datasetScore = normalizeScore(m?.score || "");
        const parsedScore = parseScore(datasetScore);

        let relevance = orientation === "exact" ? 100 : 85;

        if (parsedScore) relevance += 25;

        if (qScore) {
          const targetFromInputPerspective =
            orientation === "reverse"
              ? reverseScore(datasetScore)
              : datasetScore;

          const dist = scoreDistance(qScore, targetFromInputPerspective);

          if (dist === 0) relevance += 60;
          else if (dist === 1) relevance += 25;
          else if (dist === 2) relevance += 10;
        }

        if (
          prefer.memoryId != null &&
          prefer.gameNumber != null &&
          String(memoryId) === String(prefer.memoryId) &&
          game.gameNumber === prefer.gameNumber
        ) {
          relevance += 45;
        }

        const topGoals = collectTopGoals(game);
        if (topGoals.length > 0) relevance += 5;

        sources.push({
          memoryId: Number(memoryId),
          memoryName: memory.memoryName || `Memory ${memoryId}`,
          gameNumber: game.gameNumber,
          matchIndex: matchIndex + 1,
          p1: Security.decodeHtml((game.p1 || "").trim()),
          lastUpdate: game.lastUpdate || "",
          orientation,
          datasetHome,
          datasetAway,
          datasetScore,
          parsedScore,
          topGoals,
          relevance
        });
      });
    }
  }

  sources.sort((a, b) => {
    if (b.relevance !== a.relevance) return b.relevance - a.relevance;
    if (a.memoryId !== b.memoryId) return a.memoryId - b.memoryId;
    return a.gameNumber - b.gameNumber;
  });

  return sources;
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
        row.error = "HOME dan AWAY harus diisi untuk mencari data valid.";
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

      const rawSources = findDatasetSources(
        homeCode,
        awayCode,
        m?.score || "",
        prefer
      );

      const sourcesWithResult = rawSources.map(source => {
        let result;

        if (source.parsedScore) {
          let inputHomeGoals;
          let inputAwayGoals;

          if (source.orientation === "exact") {
            inputHomeGoals = source.parsedScore.home;
            inputAwayGoals = source.parsedScore.away;
          } else {
            inputHomeGoals = source.parsedScore.away;
            inputAwayGoals = source.parsedScore.home;
          }

          let winner = "DRAW";
          if (inputHomeGoals > inputAwayGoals) {
            winner = teamsDB[homeCode].name;
          } else if (inputAwayGoals > inputHomeGoals) {
            winner = teamsDB[awayCode].name;
          }

          result = {
            estimated: false,
            dataType:
              source.orientation === "exact"
                ? "DATASET ASLI (URUTAN SAMA)"
                : "DATASET ASLI (URUTAN TERBALIK)",
            homeGoals: inputHomeGoals,
            awayGoals: inputAwayGoals,
            winner,
            confidence: 100,
            xgHome: null,
            xgAway: null,
            homeMatches: null,
            awayMatches: null
          };
        } else {
          result = estimateMatch(homeCode, awayCode, {
            memoryId: source.memoryId,
            gameNumber: source.gameNumber
          });
        }

        return {
          ...source,
          result
        };
      });

      row.datasetCount = sourcesWithResult.length;
      row.sources = sourcesWithResult.slice(0, MAX_SOURCES);

      if (row.datasetCount === 0) {
        row.noDataset = true;
        row.estimate = estimateMatch(homeCode, awayCode, {});
      } else {
        const best = row.sources[0];
        row.memoryName = best.memoryName;
        row.gameNumber = best.gameNumber;
        row.topGoals = best.topGoals;
        row.homeGoals = best.result.homeGoals;
        row.awayGoals = best.result.awayGoals;
        row.winner = best.result.winner;
        row.confidence = best.result.confidence;
        row.xgHome = best.result.xgHome;
        row.xgAway = best.result.xgAway;
      }

      results.push(row);
    });

    return results;
  }
};
