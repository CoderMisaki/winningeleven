import { StateManager } from "../state/appState.js";
import { normalizeCountry } from "./similarity.js";
import { teamsDB } from "../data/teams.js";

const HOME_ADVANTAGE = 0.25;
const PRIOR_MATCHES = 5;
const MAX_GOALS = 8;

function parseScore(score) {
  if (typeof score !== "string") return null;

  const s = score
    .trim()
    .replace(/[-–—;]+/g, ":")
    .replace(/\s+/g, "");

  const m = s.match(/^(\d+):(\d+)$/);

  if (!m) return null;

  return {
    home: parseInt(m[1], 10),
    away: parseInt(m[2], 10)
  };
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

function buildTeamStats() {
  const stats = {};

  const getTeam = code => {
    if (!stats[code]) {
      stats[code] = createTeamStats(code);
    }

    return stats[code];
  };

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

          if (!home || !away || !score) continue;

          if (!teamsDB[home] || !teamsDB[away]) continue;

          const h = getTeam(home);
          const a = getTeam(away);

          h.matches += 1;
          a.matches += 1;

          h.goalsFor += score.home;
          h.goalsAgainst += score.away;

          a.goalsFor += score.away;
          a.goalsAgainst += score.home;

          if (score.home > score.away) {
            h.wins += 1;
            a.losses += 1;
          } else if (score.home < score.away) {
            a.wins += 1;
            h.losses += 1;
          } else {
            h.draws += 1;
            a.draws += 1;
          }
        }
      }

      if (Array.isArray(game.topGoals)) {
        for (const g of game.topGoals) {
          if (!g) continue;

          const country = normalizeCountry(g.country || "");
          const goals = parseInt(g.goals, 10);

          if (!country || !teamsDB[country]) continue;
          if (isNaN(goals) || goals <= 0) continue;

          getTeam(country).topGoals += goals;
        }
      }
    }
  }

  return stats;
}

function getGlobalAttack(stats) {
  let totalTeamMatches = 0;
  let totalGoals = 0;

  for (const team of Object.values(stats)) {
    totalTeamMatches += team.matches;
    totalGoals += team.goalsFor;
  }

  if (totalTeamMatches === 0) {
    return 1.3;
  }

  return totalGoals / totalTeamMatches;
}

function blendStats(team, globalAttack) {
  const t = team || createTeamStats("");

  const attackBase =
    (t.goalsFor + globalAttack * PRIOR_MATCHES) /
    (t.matches + PRIOR_MATCHES);

  const defenseBase =
    (t.goalsAgainst + globalAttack * PRIOR_MATCHES) /
    (t.matches + PRIOR_MATCHES);

  const topGoalBonus = Math.min(0.5, (t.topGoals || 0) * 0.02);

  return {
    attack: attackBase + topGoalBonus,
    defense: defenseBase,
    matches: t.matches || 0,
    topGoals: t.topGoals || 0
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
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
        results.push({
          row: idx + 1,
          error:
            `Negara tidak dikenal atau belum ada data: ` +
            `${homeRaw || "?"} vs ${awayRaw || "?"}`
        });
        return;
      }

      if (homeCode === awayCode) {
        results.push({
          row: idx + 1,
          error: `HOME dan AWAY sama: ${teamsDB[homeCode].name}`
        });
        return;
      }

      const homeStats = blendStats(stats[homeCode], globalAttack);
      const awayStats = blendStats(stats[awayCode], globalAttack);

      let xgHome =
        (homeStats.attack + awayStats.defense) / 2 + HOME_ADVANTAGE;

      let xgAway =
        (awayStats.attack + homeStats.defense) / 2;

      xgHome = clamp(xgHome, 0, MAX_GOALS);
      xgAway = clamp(xgAway, 0, MAX_GOALS);

      let homeGoals = Math.round(xgHome);
      let awayGoals = Math.round(xgAway);

      homeGoals = clamp(homeGoals, 0, MAX_GOALS);
      awayGoals = clamp(awayGoals, 0, MAX_GOALS);

      const diff = xgHome - xgAway;

      if (Math.abs(diff) <= 0.12) {
        const drawGoals = Math.max(0, Math.round((xgHome + xgAway) / 2));
        homeGoals = drawGoals;
        awayGoals = drawGoals;
      } else if (diff > 0.2 && homeGoals <= awayGoals) {
        homeGoals = awayGoals + 1;
      } else if (diff < -0.2 && awayGoals <= homeGoals) {
        awayGoals = homeGoals + 1;
      }

      let winner = "DRAW";
      let winnerCode = null;

      if (homeGoals > awayGoals) {
        winner = teamsDB[homeCode].name;
        winnerCode = homeCode;
      } else if (awayGoals > homeGoals) {
        winner = teamsDB[awayCode].name;
        winnerCode = awayCode;
      }

      const dataQuality = Math.min(
        1,
        ((stats[homeCode]?.matches || 0) +
          (stats[awayCode]?.matches || 0)) /
          20
      );

      const confidence = Math.round(
        Math.min(
          95,
          30 + dataQuality * 40 + Math.abs(diff) * 20
        )
      );

      results.push({
        row: idx + 1,
        homeCode,
        awayCode,
        homeName: teamsDB[homeCode].name,
        awayName: teamsDB[awayCode].name,
        homeGoals,
        awayGoals,
        winner,
        winnerCode,
        confidence,
        xgHome: xgHome.toFixed(2),
        xgAway: xgAway.toFixed(2),
        homeMatches: stats[homeCode]?.matches || 0,
        awayMatches: stats[awayCode]?.matches || 0
      });
    });

    return results;
  }
};
