import { StateManager } from "../state/appState.js";
import { normalizeCountry } from "./similarity.js";
import { teamsDB } from "../data/teams.js";

const HOME_ADVANTAGE = 0.20;
const PRIOR_MATCHES = 5;
const MAX_GOALS = 8;

// WE10 Condition Arrows Mapping
const WE10_CONDITIONS = [
  { name: "TOP FORM", symbol: "🔴 (↑)", factor: 1.15, weight: 15 },
  { name: "GOOD", symbol: "🟧 (↗)", factor: 1.07, weight: 25 },
  { name: "NORMAL", symbol: "🟩 (→)", factor: 1.00, weight: 35 },
  { name: "POOR", symbol: "🟦 (↘)", factor: 0.92, weight: 15 },
  { name: "TERRIBLE", symbol: "🩶 (↓)", factor: 0.85, weight: 10 }
];

// Helper RNG Berbobot untuk Panah Kondisi WE10
function rollWE10Condition() {
  const totalWeight = WE10_CONDITIONS.reduce((acc, c) => acc + c.weight, 0);
  let random = Math.random() * totalWeight;
  for (const cond of WE10_CONDITIONS) {
    if (random < cond.weight) return cond;
    random -= cond.weight;
  }
  return WE10_CONDITIONS[2]; // Fallback to normal
}

// Formula Poisson Distribution untuk Simulasi Gol WE10
function simulatePoissonGoals(lambda) {
  let L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= Math.random();
  } while (p > L);
  return Math.min(k - 1, MAX_GOALS);
}

function parseScore(score) {
  if (typeof score !== "string") return null;
  const s = score.trim().replace(/[-–—;]+/g, ":").replace(/\s+/g, "");
  const m = s.match(/^(\d+):(\d+)$/);
  return m ? { home: parseInt(m[1], 10), away: parseInt(m[2], 10) } : null;
}

function createTeamStats(code) {
  return { code, matches: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0, topGoals: 0 };
}

function buildTeamStats() {
  const stats = {};
  const getTeam = code => (stats[code] ||= createTeamStats(code));
  const memories = StateManager.db?.memories || {};

  for (const memory of Object.values(memories)) {
    if (!memory || !Array.isArray(memory.games)) continue;
    for (const game of memory.games) {
      if (!game) continue;
      if (Array.isArray(game.matches)) {
        for (const m of game.matches) {
          if (!m) continue;
          const home = normalizeCountry(m.home || "");
          const away = normalizeCountry(m.away || "");
          const score = parseScore(m.score || "");
          if (!home || !away || !score || !teamsDB[home] || !teamsDB[away]) continue;

          const h = getTeam(home), a = getTeam(away);
          h.matches++; a.matches++;
          h.goalsFor += score.home; h.goalsAgainst += score.away;
          a.goalsFor += score.away; a.goalsAgainst += score.home;

          if (score.home > score.away) { h.wins++; a.losses++; }
          else if (score.home < score.away) { a.wins++; h.losses++; }
          else { h.draws++; a.draws++; }
        }
      }
      if (Array.isArray(game.topGoals)) {
        for (const g of game.topGoals) {
          const country = normalizeCountry(g.country || "");
          const goals = parseInt(g.goals, 10);
          if (country && teamsDB[country] && !isNaN(goals) && goals > 0) {
            getTeam(country).topGoals += goals;
          }
        }
      }
    }
  }
  return stats;
}

function getGlobalAttack(stats) {
  let totalMatches = 0, totalGoals = 0;
  for (const team of Object.values(stats)) {
    totalMatches += team.matches;
    totalGoals += team.goalsFor;
  }
  return totalMatches === 0 ? 1.3 : totalGoals / totalMatches;
}

export const PredictionService = {
  predictMatches(dataSource) {
    const stats = buildTeamStats();
    const globalAttack = getGlobalAttack(stats);
    const results = [];
    const matches = dataSource?.matches || [];

    matches.forEach((m, idx) => {
      const homeRaw = (m?.home || "").trim();
      const awayRaw = (m?.away || "").trim();
      if (!homeRaw && !awayRaw) return;

      const homeCode = normalizeCountry(homeRaw);
      const awayCode = normalizeCountry(awayRaw);

      if (!teamsDB[homeCode] || !teamsDB[awayCode]) {
        results.push({ row: idx + 1, error: `Negara tidak dikenal: ${homeRaw || "?"} vs ${awayRaw || "?"}` });
        return;
      }

      if (homeCode === awayCode) {
        results.push({ row: idx + 1, error: `HOME & AWAY sama: ${teamsDB[homeCode].name}` });
        return;
      }

      const hStats = stats[homeCode] || createTeamStats(homeCode);
      const aStats = stats[awayCode] || createTeamStats(awayCode);

      // Roll Panah Kondisi WE10 (RNG Engine)
      const homeCond = rollWE10Condition();
      const awayCond = rollWE10Condition();

      // Kalkulasi xG Terbobot + Pengaruh Panah Kondisi WE10
      let baseHomeXg = ((hStats.goalsFor + globalAttack * PRIOR_MATCHES) / (hStats.matches + PRIOR_MATCHES) + (hStats.topGoals * 0.02)) * homeCond.factor + HOME_ADVANTAGE;
      let baseAwayXg = ((aStats.goalsFor + globalAttack * PRIOR_MATCHES) / (aStats.matches + PRIOR_MATCHES) + (aStats.topGoals * 0.02)) * awayCond.factor;

      // Simulasi WE10 via Poisson Distribution
      let homeGoals = simulatePoissonGoals(baseHomeXg);
      let awayGoals = simulatePoissonGoals(baseAwayXg);

      let winner = "DRAW";
      if (homeGoals > awayGoals) winner = teamsDB[homeCode].name;
      else if (awayGoals > homeGoals) winner = teamsDB[awayCode].name;

      const dataQuality = Math.min(1, (hStats.matches + aStats.matches) / 20);
      const confidence = Math.round(Math.min(98, 35 + dataQuality * 40 + Math.abs(baseHomeXg - baseAwayXg) * 15));

      results.push({
        row: idx + 1,
        homeCode,
        awayCode,
        homeName: teamsDB[homeCode].name,
        awayName: teamsDB[awayCode].name,
        homeGoals,
        awayGoals,
        winner,
        confidence,
        xgHome: baseHomeXg.toFixed(2),
        xgAway: baseAwayXg.toFixed(2),
        homeCondition: homeCond.symbol,
        awayCondition: awayCond.symbol,
        homeMatches: hStats.matches,
        awayMatches: aStats.matches
      });
    });

    return results;
  }
};
