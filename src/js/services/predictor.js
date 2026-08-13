import { teamsDB } from "../data/teams.js";
import { StateManager } from "../state/appState.js";
import { normalizeCountry } from "./similarity.js";
import { teamRatings } from "../data/teamRatings.js";

const MAX_XG = 6.5;
const POISSON_CAP = 10;
const PRIOR_MATCHES = 10;
const HOME_ADV = 1.18;
const AWAY_FACTOR = 0.92;
const RHO = 0.05;

const FACT = [1];
for (let i = 1; i <= POISSON_CAP; i++) {
  FACT[i] = FACT[i - 1] * i;
}

function clampNumber(num, min, max) {
  return Math.max(min, Math.min(num, max));
}

function parseScore(scoreStr) {
  if (typeof scoreStr !== "string") return null;

  const s = scoreStr
    .trim()
    .replace(/[–—;-]/g, ":");

  const parts = s.split(":");
  if (parts.length !== 2) return null;

  const home = parseInt(parts[0], 10);
  const away = parseInt(parts[1], 10);

  if (isNaN(home) || isNaN(away)) return null;

  return { home, away };
}

function poisson(k, lambda) {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  return Math.exp(-lambda) * Math.pow(lambda, k) / FACT[k];
}

function lowScoreCorrection(i, j, l, m) {
  if (i === 0 && j === 0) {
    return Math.max(0.25, 1 - l * m * RHO);
  }

  if (i === 0 && j === 1) {
    return Math.max(0.25, 1 + l * RHO);
  }

  if (i === 1 && j === 0) {
    return Math.max(0.25, 1 + m * RHO);
  }

  if (i === 1 && j === 1) {
    return Math.max(0.25, 1 - RHO);
  }

  return 1;
}

function ratingNorm(v) {
  return clampNumber((v - 60) / 35, 0, 1);
}

function getRatingPrior(code) {
  const r = teamRatings[code];

  if (!r) {
    return {
      att: 1,
      def: 1,
      mid: 0.5,
      has: false
    };
  }

  return {
    att: 0.75 + ratingNorm(r.attack) * 0.65,
    def: 1.35 - ratingNorm(r.defense) * 0.65,
    mid: ratingNorm(r.midfield),
    has: true
  };
}

function getMatchWeight(game) {
  const ts = Date.parse(game?.lastUpdate || "");

  if (!isNaN(ts)) {
    const days = Math.max(0, (Date.now() - ts) / 86400000);
    return Math.max(0.25, Math.pow(0.5, days / 180));
  }

  return 1;
}

function buildStats(excludeMemoryId = null, excludeGameNumber = null) {
  const stats = {};
  let weightedGoals = 0;
  let weightedAppearances = 0;

  const memories = StateManager.db?.memories || {};

  for (const [memoryId, memory] of Object.entries(memories)) {
    if (!memory || !Array.isArray(memory.games)) continue;

    for (const game of memory.games) {
      if (
        excludeMemoryId != null &&
        excludeGameNumber != null &&
        String(memoryId) === String(excludeMemoryId) &&
        game?.gameNumber === excludeGameNumber
      ) {
        continue;
      }

      if (!game || !Array.isArray(game.matches)) continue;

      const w = getMatchWeight(game);

      for (const m of game.matches) {
        const home = normalizeCountry(m?.home || "");
        const away = normalizeCountry(m?.away || "");
        const score = parseScore(m?.score || "");

        if (!home || !away || !score) continue;

        if (!stats[home]) {
          stats[home] = { weight: 0, gf: 0, ga: 0, raw: 0 };
        }

        if (!stats[away]) {
          stats[away] = { weight: 0, gf: 0, ga: 0, raw: 0 };
        }

        stats[home].weight += w;
        stats[home].gf += score.home * w;
        stats[home].ga += score.away * w;
        stats[home].raw += 1;

        stats[away].weight += w;
        stats[away].gf += score.away * w;
        stats[away].ga += score.home * w;
        stats[away].raw += 1;

        weightedAppearances += 2 * w;
        weightedGoals += (score.home + score.away) * w;
      }
    }
  }

  const priorWeight = 30;
  const priorAvg = 1.42;

  const globalAttack =
    weightedAppearances > 0
      ? (priorWeight * priorAvg + weightedGoals) /
        (priorWeight + weightedAppearances)
      : priorAvg;

  return { stats, globalAttack };
}

function getTeamStrength(code, stats, globalAttack) {
  const prior = getRatingPrior(code);
  const s = stats[code];
  const w = s?.weight || 0;

  let attObs = 1;
  let defObs = 1;

  if (w > 0 && globalAttack > 0) {
    attObs = (s.gf / w) / globalAttack;
    defObs = (s.ga / w) / globalAttack;
  }

  const att = clampNumber(
    (w * attObs + PRIOR_MATCHES * prior.att) / (w + PRIOR_MATCHES),
    0.35,
    3.0
  );

  const def = clampNumber(
    (w * defObs + PRIOR_MATCHES * prior.def) / (w + PRIOR_MATCHES),
    0.35,
    3.0
  );

  return {
    att,
    def,
    mid: prior.mid,
    hasRating: prior.has,
    weight: w,
    raw: s?.raw || 0
  };
}

function getH2H(homeCode, awayCode, excludeMemoryId, excludeGameNumber) {
  let count = 0;
  let sumW = 0;
  let hg = 0;
  let ag = 0;

  const memories = StateManager.db?.memories || {};

  for (const [memoryId, memory] of Object.entries(memories)) {
    if (!memory || !Array.isArray(memory.games)) continue;

    for (const game of memory.games) {
      if (
        excludeMemoryId != null &&
        excludeGameNumber != null &&
        String(memoryId) === String(excludeMemoryId) &&
        game?.gameNumber === excludeGameNumber
      ) {
        continue;
      }

      if (!game || !Array.isArray(game.matches)) continue;

      const w = getMatchWeight(game);

      for (const m of game.matches) {
        const dh = normalizeCountry(m?.home || "");
        const da = normalizeCountry(m?.away || "");
        const p = parseScore(m?.score || "");

        if (!p) continue;

        if (dh === homeCode && da === awayCode) {
          count += 1;
          sumW += w;
          hg += p.home * w;
          ag += p.away * w;
        } else if (dh === awayCode && da === homeCode) {
          count += 1;
          sumW += w;
          hg += p.away * w;
          ag += p.home * w;
        }
      }
    }
  }

  if (!count || sumW <= 0) return null;

  return {
    count,
    avgHome: hg / sumW,
    avgAway: ag / sumW
  };
}

function generateDistribution(lh, la) {
  const matrix = [];
  let total = 0;

  let top = {
    home: 0,
    away: 0,
    prob: -1
  };

  for (let i = 0; i <= POISSON_CAP; i++) {
    matrix[i] = [];

    for (let j = 0; j <= POISSON_CAP; j++) {
      let p =
        poisson(i, lh) *
        poisson(j, la) *
        lowScoreCorrection(i, j, lh, la);

      if (!isFinite(p) || p < 0) p = 0;

      matrix[i][j] = p;
      total += p;

      if (p > top.prob) {
        top = { home: i, away: j, prob: p };
      }
    }
  }

  if (total <= 0) {
    return {
      distribution: [{ home: 1, away: 1, prob: 1 }],
      probs: { home: 0.1, draw: 0.8, away: 0.1 },
      top: { home: 1, away: 1, prob: 1 },
      over25: 0.2,
      btts: 0.4
    };
  }

  const scores = [];
  let home = 0;
  let draw = 0;
  let away = 0;
  let over25 = 0;
  let btts = 0;

  for (let i = 0; i <= POISSON_CAP; i++) {
    for (let j = 0; j <= POISSON_CAP; j++) {
      const p = matrix[i][j] / total;

      scores.push({ home: i, away: j, prob: p });

      if (i > j) home += p;
      else if (i < j) away += p;
      else draw += p;

      if (i + j > 2.5) over25 += p;
      if (i > 0 && j > 0) btts += p;
    }
  }

  scores.sort((a, b) => b.prob - a.prob);

  top.prob = top.prob / total;

  return {
    distribution: scores,
    probs: { home, draw, away },
    top,
    over25,
    btts
  };
}

function estimateConfidence(h, a, h2h) {
  let c = 18;

  if (h.hasRating && a.hasRating) {
    c += 20;
  } else if (h.hasRating || a.hasRating) {
    c += 10;
  }

  const totalWeight = h.weight + a.weight;
  c += 34 * (1 - Math.exp(-totalWeight / 18));

  if (h2h) {
    c += 18 * (1 - Math.exp(-h2h.count / 4));
  }

  return Math.round(clampNumber(c, 5, 93));
}

function hybridPredict(homeCode, awayCode, excludeMemoryId = null, excludeGameNumber = null) {
  const { stats, globalAttack } = buildStats(excludeMemoryId, excludeGameNumber);

  const h = getTeamStrength(homeCode, stats, globalAttack);
  const a = getTeamStrength(awayCode, stats, globalAttack);

  const midDiff = h.mid - a.mid;

  let xgHome =
    globalAttack *
    h.att *
    a.def *
    HOME_ADV *
    (1 + 0.12 * midDiff);

  let xgAway =
    globalAttack *
    a.att *
    h.def *
    AWAY_FACTOR *
    (1 - 0.12 * midDiff);

  const modelParts = ["Rating", "Form"];

  const h2h = getH2H(homeCode, awayCode, excludeMemoryId, excludeGameNumber);

  if (h2h) {
    const influence = Math.min(0.28, 0.07 * Math.sqrt(h2h.count));

    xgHome = xgHome * (1 - influence) + h2h.avgHome * influence;
    xgAway = xgAway * (1 - influence) + h2h.avgAway * influence;

    modelParts.push(`H2H ${Math.round(influence * 100)}%`);
  }

  xgHome = clampNumber(xgHome, 0.1, MAX_XG);
  xgAway = clampNumber(xgAway, 0.1, MAX_XG);

  const dist = generateDistribution(xgHome, xgAway);
  const confidence = estimateConfidence(h, a, h2h);

  let winner = "DRAW";

  if (dist.probs.home > dist.probs.away + 0.08) {
    winner = teamsDB[homeCode]?.name || homeCode;
  } else if (dist.probs.away > dist.probs.home + 0.08) {
    winner = teamsDB[awayCode]?.name || awayCode;
  }

  return {
    homeGoals: dist.top.home,
    awayGoals: dist.top.away,
    winner,
    confidence,
    xgHome: xgHome.toFixed(2),
    xgAway: xgAway.toFixed(2),
    xgHomeNum: xgHome,
    xgAwayNum: xgAway,
    model: `Bayesian Poisson v2 (${modelParts.join(" + ")})`,
    distribution: dist.distribution.slice(0, 6),
    probs: dist.probs,
    over25: dist.over25,
    btts: dist.btts,
    evidence: {
      hasRating: h.hasRating && a.hasRating,
      hasHistory: h.raw > 0 || a.raw > 0,
      homeMatches: h.raw,
      awayMatches: a.raw,
      hasH2H: !!h2h,
      h2hMatches: h2h?.count || 0,
      globalAttack: globalAttack.toFixed(2),
      homeWeight: Number(h.weight.toFixed(2)),
      awayWeight: Number(a.weight.toFixed(2))
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

      const prediction = hybridPredict(
        homeCode,
        awayCode,
        prefer.memoryId ?? null,
        prefer.gameNumber ?? null
      );

      row.prediction = prediction;
      results.push(row);
    });

    return results;
  }
};
