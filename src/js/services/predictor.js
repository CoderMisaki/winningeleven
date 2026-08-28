import { teamsDB } from "../data/teams.js";
import { StateManager } from "../state/appState.js";
import { normalizeCountry } from "./similarity.js";
import { teamRatings } from "../data/teamRatings.js";
import { WE10_FULL_ROSTER } from "../data/we10FullRoster.js";

// ============================================================
// 1. DATA REFERENCE & SCOPE LIMIT — 57 Negara Fix (teams.js)
// ============================================================
export const ALLOWED_CODES = Object.freeze(Object.keys(teamsDB).map((c) => c.toUpperCase()));
export const ALLOWED_CODE_SET = new Set(ALLOWED_CODES);
export const ALLOWED_NAMES = Object.freeze(ALLOWED_CODES.map((c) => teamsDB[c].name));
export const ALLOWED_NAMES_SET = new Set(ALLOWED_NAMES.map((n) => n.toLowerCase()));

// Daftar 57 sesuai spesifikasi (urutan resmi)
export const OFFICIAL_57_LIST = Object.freeze([
  "Brazil","Argentina","Mexico","United States","Uruguay","Colombia","Chile","Paraguay","Ecuador","Peru","Costa Rica","Trinidad & Tobago","Italy","France","England","Spain","Germany","Holland","Portugal","Czech","Croatia","Sweden","Greece","Russia","Turkey","Scotland","Wales","Bulgaria","Poland","Slovenia","Finland","Hungary","Switzerland","Romania","Northern Ireland","Ireland","Ukraine","Norway","Belgium","Latvia","Austria","Slovakia","Serbia & Mont.","Denmark","Japan","Korea","Australia","Saudi Arabia","Iran","Nigeria","Cameroon","Ghana","South Africa","Ivory Coast","Angola","Tunisia","Togo"
]);

/**
 * Validasi 57-negara fix
 * Menerima nama bebas (alias, indonesia, short) via normalizeCountry
 */
export function isValidCountry(countryName) {
  if (!countryName || typeof countryName !== "string") return false;
  const trimmed = countryName.trim();
  if (!trimmed) return false;
  const code = normalizeCountry(trimmed);
  return ALLOWED_CODE_SET.has(code);
}
export function isValidCode(code) {
  if (!code || typeof code !== "string") return false;
  return ALLOWED_CODE_SET.has(code.trim().toUpperCase());
}
export function toValidCode(countryName) {
  if (!countryName) return "";
  const code = normalizeCountry(String(countryName).trim());
  return ALLOWED_CODE_SET.has(code) ? code : "";
}
export function getValidationErrorLabel(raw) {
  return raw ? `"${String(raw).trim()}"` : '"(kosong)"';
}

// ============================================================
// 2. PREDICTOR CONFIG — Hybrid: Dixon-Coles Bayesian + Konami LCG
// ============================================================
export const PREDICTOR_CONFIG = {
  MODEL_VERSION: "WE10 Konami Cup Hybrid v4.3 (BULK 100/1000x + Sampled + Roster Image Exact)",
  ENGINE_SOURCE: "thinkpad/konami_cup.js — FUN_00216ef0 @0x003c2100 / FUN_0016e8d8 / LCGRng 1664525 / PLAYER_DB Ghidra SLPM_663.74 + eeMemory 0x18428F4 patch ESP/TOG 11-man + bulk sampling",
  MAX_XG: 6.0,
  MIN_XG: 0.15,
  POISSON_CAP: 10,
  PRIOR_MATCH_WEIGHT: 7.0,
  BASE_GLOBAL_ATTACK: 1.48,
  GLOBAL_HOME_ADVANTAGE: 1.06, // kalibrasi Ghidra: Konami Cup neutral venue (bukan 1.14 liga)
  AWAY_FACTOR: 0.98,
  RHO_CORRECTION: 0.07,
  RECENCY_HALF_LIFE_DAYS: 90,
  MAX_H2H_INFLUENCE: 0.22,
  SIMILAR_CONTEXT_NEIGHBORS: 5,
  MAX_SIMILAR_CONTEXT_INFLUENCE: 0.15,
  // Konami Monte-Carlo
  MONTE_CARLO_SIMS: 5000,
  TOP_SCORERS_LIMIT: 6,
};

// --- GHIDRA-CALIBRATED OFFSET (observasi Konami Cup 7-matches aktual vs prediksi) ---
// Ditemukan: WAL & JPN undervalued, GRE & MEX overvalued di data mentah teamRatings.js
// Verifikasi via 0x003c2100 pointer table + sim LCG seed actual cup (Image 2) + Image 3/4 top scorers
const RATING_CALIBRATION = {
  WAL: { attack: 12, defense: 7, midfield: 6, speed: 4, power: 3, overall: 10 }, // WAL 3-0 GRE (actual) -> butuh dominan
  GRE: { attack: -6, defense: -9, midfield: -5, speed: -2, overall: -8 },
  JPN: { attack: 10, defense: 4, midfield: 6, speed: 3, overall: 9 }, // JPN 2-1 MEX (actual)
  MEX: { attack: -7, defense: -4, midfield: -5, overall: -8 },
  SCO: { attack: 7, defense: 3, midfield: 4, power: 4, overall: 6 }, // SCO 4-2 NIR (Miller 2)
  NIR: { attack: -3, defense: -4, midfield: -2, overall: -3 },
  SWE: { attack: 5, defense: 2, midfield: 3, overall: 4 }, // SWE 4-1 SUI
  SUI: { attack: -2, defense: -5, midfield: -2, overall: -4 },
  CRO: { attack: 4, defense: 3, overall: 2 },
  AUS: { attack: 3, overall: 2 },
};

// ============================================================
// 3. CORE MATH — Poisson + Dixon-Coles
// ============================================================
const FACT = [1];
for (let i = 1; i <= PREDICTOR_CONFIG.POISSON_CAP; i++) FACT[i] = FACT[i - 1] * i;

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

// ============================================================
// 4. KONAMI CUP ENGINE — Port dari thinkpad/konami_cup.js
//    LCGRng + posCategory + pickScorer + PLAYER_DB_57
// ============================================================

// LCG — fallback sceRand / mfc0 Count (konami_cup.js:33)
export class LCGRng {
  constructor(seed) { this.state = seed >>> 0; }
  next() { this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0; return this.state; }
  range(n) { return n <= 0 ? 0 : this.next() % n; }
  choice(arr) { return arr[this.range(arr.length)]; }
  nextFloat() { return this.next() / 0x100000000; }
}

function hashStringToSeed(str) {
  let h = 0x9E3779B9;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 0x85ebca6b) >>> 0;
  return h >>> 0;
}

function posCategory(pos) {
  if (["CF","WF","ST","FW"].includes(pos)) return "FW";
  if (["OMF","CMF","DMF","AMF","MF"].includes(pos)) return "MF";
  return "DF";
}

// PLAYER_DB_57 — adaptasi PLAYER_DB (konami_cup.js:47) ke 57 kode APP
// Weight: CF/WF 80-90 | OMF/CMF 40-75 | DF 8-12  -> 60/30/10 distribution
export const KONAMI_PLAYER_DB = (() => {
  // Ghidra-verified full roster from eeMemory.bin base 0x18428F4 (57 teams, 832 valid players)
  // Weight star overrides calibrated to actual Konami Cup top scorers Image 3/4
  const STAR_OVERRIDES = {
    WAL: { Giggs: 96, Bellamy: 84, Earnshaw: 78, "C. Robinson": 70 },
    SWE: { Ibrahimovic: 92, Larsson: 90, Allback: 75, Elmander: 78 },
    SCO: { Miller: 90, McCulloch: 84, Ferguson: 62, Weir: 18 },
    JPN: { Takahara: 92, Nakamura: 74, Yanagisawa: 72 },
    CRO: { Tudor: 28, Prso: 78, Klasnic: 74 },
    SUI: { Degen: 26, Frei: 78, Streller: 74 },
    NIR: { Healy: 92, Gillespie: 64, Davis: 34 },
    AUS: { Thompson: 86, Culina: 82, Viduka: 80, Cahill: 70 },
    KOR: { "C Y Park": 90, "D H Kim": 88, "Park Ji-Sung": 72 },
    BRA: { Ronaldo: 94, Adriano: 88, Ronaldinho: 84 },
    ENG: { Owen: 88, Rooney: 86, Gerrard: 60 },
    FRA: { Henry: 90, Trezeguet: 82 },
    GER: { Klose: 88, Podolski: 80 },
    ITA: { Toni: 88, Gilardino: 80 },
    ESP: { Torres: 88, Villa: 84 },
    NED: { "Van Nistelrooy": 90, Robben: 84 },
    POR: { Pauleta: 86, "C. Ronaldo": 84 },
    CZE: { Smicer: 82, Nedved: 70, Rosicky: 68, Koller: 85, Baros: 80 },
    PER: { Vargas: 55, Farfan: 72, Guerrero: 75, Pizarro: 76 },
    CHI: { Contreras: 14, Maldonado: 18, Pinilla: 62, "David Pizarro": 58 },
    LVA: { Solonicins: 18, Verpakovskis: 72, Miholaps: 70 },
  };
  const db = {};
  for (const [code, roster] of Object.entries(WE10_FULL_ROSTER)) {
    db[code] = roster.map(p => {
      const starW = STAR_OVERRIDES[code]?.[p.name];
      let w = starW ?? p.weight;
      return { name: p.name, pos: p.pos, weight: w };
    });
  }
  for (const code of ALLOWED_CODES) {
    if (!db[code] || db[code].length === 0) {
      db[code] = [
        { name: `${code}_FW9`, pos:"CF", weight:80 },
        { name: `${code}_FW11`, pos:"WF", weight:65 },
        { name: `${code}_MF8`, pos:"CMF", weight:40 },
        { name: `${code}_MF10`, pos:"OMF", weight:55 },
        { name: `${code}_DF5`, pos:"CB", weight:10 },
      ];
    }
  }
  return db;
})();

function pickScorerForCode(teamCode, rng) {
  const roster = KONAMI_PLAYER_DB[teamCode];
  if (!roster || !roster.length) return { name: `${teamCode}_FW`, pos:"CF", weight:80 };
  // WE10 Engine: pure weight proportional (no 60/30/10 category roll — no Ghidra evidence)
  // Weight already encodes position (FW 70-95, MF 30-60, DF 8-16, GK 8-14)
  const total = roster.reduce((s, p) => s + p.weight, 0);
  if (total <= 0) return roster[0];
  let r = rng.range(total);
  for (const p of roster) { if (r < p.weight) return p; r -= p.weight; }
  return roster[roster.length - 1];
}

function poissonSample(lambda, rng) {
  if (lambda <= 0.001) return 0;
  if (lambda > 12) {
    const u1 = Math.max(1e-7, rng.nextFloat());
    const u2 = rng.nextFloat();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const approx = Math.round(lambda + z * Math.sqrt(lambda));
    return clamp(approx, 0, 10);
  }
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng.nextFloat() || 0.5;
    if (k > 20) break;
  } while (p > L);
  return Math.max(0, k - 1);
}

function getRatingPrior(code) {
  const r = teamRatings[code];
  if (!r) return { att: 1.0, def: 1.0, mid: 0.5, spd: 0.5, pow: 0.5, sta: 0.5, overall: 75, has: false };
  const cal = RATING_CALIBRATION[code] || {};
  const adj = (k) => (r[k] || 75) + (cal[k] || 0);
  const norm = (v) => clamp((v - 65) / 30, 0, 1);
  return {
    att: 0.70 + norm(adj("attack")) * 0.70,
    def: 1.40 - norm(adj("defense")) * 0.70,
    mid: norm(adj("midfield")),
    spd: norm(adj("speed")),
    pow: norm(adj("power")),
    sta: norm(adj("stamina")),
    overall: r.overall + (cal.overall || 0),
    has: true,
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
  let totalGoals = 0, totalAppearances = 0;

  for (const [memId, memory] of Object.entries(memories)) {
    if (!memory || !Array.isArray(memory.games)) continue;
    for (const game of memory.games) {
      if (!game || !Array.isArray(game.matches)) continue;
      if (excludeMemoryId != null && excludeGameNumber != null && String(memId) === String(excludeMemoryId) && game.gameNumber === excludeGameNumber) continue;
      const weight = getGameDecayWeight(game);
      for (const m of game.matches) {
        const home = normalizeCountry(m?.home || "");
        const away = normalizeCountry(m?.away || "");
        const score = parseScore(m?.score || "");
        // 57-filter: hanya hitung jika keduanya valid
        if (!home || !away || !score) continue;
        if (!ALLOWED_CODE_SET.has(home) || !ALLOWED_CODE_SET.has(away)) continue;

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
  const globalAttack = totalAppearances > 0 ? (priorWeight * PREDICTOR_CONFIG.BASE_GLOBAL_ATTACK + totalGoals) / (priorWeight + totalAppearances) : PREDICTOR_CONFIG.BASE_GLOBAL_ATTACK;
  return { matches, stats, globalAttack };
}
function calculateTeamStrength(code, stats, globalAttack) {
  const prior = getRatingPrior(code);
  const s = stats[code];
  const w = s ? s.weight : 0;
  let attObs = prior.att, defObs = prior.def;
  if (w > 0 && globalAttack > 0) { attObs = (s.gf / w) / globalAttack; defObs = (s.ga / w) / globalAttack; }
  const k = PREDICTOR_CONFIG.PRIOR_MATCH_WEIGHT;
  const att = clamp((w * attObs + k * prior.att) / (w + k), 0.35, 2.8);
  const def = clamp((w * defObs + k * prior.def) / (w + k), 0.35, 2.8);
  return { att, def, mid: prior.mid, spd: prior.spd, pow: prior.pow, overall: prior.overall, hasRating: prior.has, weight: w, rawCount: s ? s.count : 0 };
}
function calculateH2H(homeCode, awayCode, matches) {
  let count = 0, sumW = 0, homeGoals = 0, awayGoals = 0;
  for (const m of matches) {
    if (m.home === homeCode && m.away === awayCode) { count++; sumW += m.weight; homeGoals += m.score.home * m.weight; awayGoals += m.score.away * m.weight; }
    else if (m.home === awayCode && m.away === homeCode) { count++; sumW += m.weight; homeGoals += m.score.away * m.weight; awayGoals += m.score.home * m.weight; }
  }
  if (count === 0 || sumW <= 0) return null;
  return { count, avgHome: homeGoals / sumW, avgAway: awayGoals / sumW };
}
function findSimilarContextGoals(homeRating, awayRating, matches) {
  if (!matches.length) return null;
  const targetDiff = (homeRating.overall || 75) - (awayRating.overall || 75);
  const targetMidDiff = (homeRating.mid - awayRating.mid);
  const scored = matches.map((m) => {
    const hPrior = getRatingPrior(m.home), aPrior = getRatingPrior(m.away);
    const matchDiff = hPrior.overall - aPrior.overall;
    const matchMidDiff = hPrior.mid - aPrior.mid;
    const dist = Math.sqrt(Math.pow(targetDiff - matchDiff, 2) * 0.6 + Math.pow(targetMidDiff - matchMidDiff, 2) * 400 * 0.4);
    return { match: m, dist };
  });
  scored.sort((a, b) => a.dist - b.dist);
  const topK = scored.slice(0, PREDICTOR_CONFIG.SIMILAR_CONTEXT_NEIGHBORS);
  if (!topK.length) return null;
  let sumSim = 0, hGoals = 0, aGoals = 0;
  topK.forEach(({ match, dist }) => { const sim = 1 / (1 + dist); sumSim += sim; hGoals += match.score.home * sim; aGoals += match.score.away * sim; });
  if (sumSim <= 0) return null;
  return { samples: topK.length, avgHome: hGoals / sumSim, avgAway: aGoals / sumSim };
}
function generateBivariateDistribution(lambdaHome, lambdaAway) {
  const matrix = []; let totalProb = 0; const cap = PREDICTOR_CONFIG.POISSON_CAP; const rho = PREDICTOR_CONFIG.RHO_CORRECTION;
  for (let i = 0; i <= cap; i++) { matrix[i] = []; for (let j = 0; j <= cap; j++) { const p = poissonProb(i, lambdaHome) * poissonProb(j, lambdaAway) * tauCorrection(i, j, lambdaHome, lambdaAway, rho); const validP = Math.max(0, isFinite(p) ? p : 0); matrix[i][j] = validP; totalProb += validP; } }
  if (totalProb <= 0) totalProb = 1;
  const scorelines = []; let pHome = 0, pDraw = 0, pAway = 0, over25 = 0, btts = 0;
  for (let i = 0; i <= cap; i++) for (let j = 0; j <= cap; j++) { const pNorm = matrix[i][j] / totalProb; scorelines.push({ home: i, away: j, prob: pNorm }); if (i > j) pHome += pNorm; else if (i < j) pAway += pNorm; else pDraw += pNorm; if (i + j > 2.5) over25 += pNorm; if (i > 0 && j > 0) btts += pNorm; }
  scorelines.sort((a, b) => b.prob - a.prob);
  return { distribution: scorelines, topScore: scorelines[0], probs: { home: clamp(pHome, 0, 1), draw: clamp(pDraw, 0, 1), away: clamp(pAway, 0, 1) }, markets: { over25: clamp(over25, 0, 1), under25: clamp(Math.max(0, 1 - over25), 0, 1), btts: clamp(btts, 0, 1) } };
}
function calculateModelEntropyConfidence(probs, evidence) {
  const p = [probs.home, probs.draw, probs.away].filter((v) => v > 0);
  const maxEntropy = Math.log(3);
  let entropy = 0; p.forEach((val) => { entropy -= val * Math.log(val); });
  const entropyPenalty = clamp(entropy / maxEntropy, 0, 1);
  let evidenceScore = 20;
  if (evidence.hasRating) evidenceScore += 25;
  evidenceScore += Math.min(30, evidence.homeWeight * 2.5 + evidence.awayWeight * 2.5);
  if (evidence.hasH2H) evidenceScore += Math.min(15, evidence.h2hMatches * 4);
  if (evidence.hasSimilarContext) evidenceScore += 10;
  const coverageNorm = clamp(evidenceScore / 100, 0.1, 1.0);
  return Math.round(clamp(coverageNorm * (1 - 0.45 * entropyPenalty) * 100, 12, 94));
}
function sampleScoreline(distribution, rng) {
  const r = rng.nextFloat();
  let acc = 0;
  for (const s of distribution) { acc += s.prob; if (r < acc) return s; }
  return distribution[0];
}

// ============================================================
// 6. KONAMI TOP SCORER — WE10 Full Roster + Historical Evidence (no 60/30/10)
// ============================================================
// Historical scorer map: scans StateManager.db topGoals for Bayesian smoothing
function getHistoricalScorerMap() {
  const map = new Map(); // key: "lowerName|CODE" -> { goals, appearances, teamCode, player }
  const memories = StateManager.db?.memories || {};
  let totalGames = 0;
  for (const mem of Object.values(memories)) {
    if (!mem || !Array.isArray(mem.games)) continue;
    for (const g of mem.games) {
      totalGames++;
      for (const tg of g.topGoals || []) {
        if (!tg.player || !tg.country) continue;
        const code = normalizeCountry(tg.country);
        if (!ALLOWED_CODE_SET.has(code)) continue;
        const key = tg.player.trim().toLowerCase() + "|" + code;
        const goals = parseInt(tg.goals, 10) || 0;
        if (goals <= 0) continue;
        const entry = map.get(key) || { goals: 0, appearances: 0, teamCode: code, player: tg.player.trim() };
        entry.goals += goals;
        entry.appearances += 1;
        map.set(key, entry);
      }
    }
  }
  return { map, totalGames };
}

export function generateTopScorers(homeCode, awayCode, xgHome, xgAway, opts = {}) {
  try {
    const numSims = opts.numSims || PREDICTOR_CONFIG.MONTE_CARLO_SIMS;
    const deterministic = opts.deterministic !== false;
    const seedBase = `${homeCode}|${awayCode}|${xgHome.toFixed(2)}|${xgAway.toFixed(2)}|${PREDICTOR_CONFIG.MODEL_VERSION}`;
    const baseSeed = opts.seed != null ? opts.seed : (deterministic ? hashStringToSeed(seedBase) : (hashStringToSeed(seedBase) ^ (Date.now() & 0xfffffff)));
    const rng = new LCGRng(baseSeed);

    const { map: histMap } = getHistoricalScorerMap();
    function buildAdjustedRoster(teamCode) {
      const roster = (KONAMI_PLAYER_DB[teamCode] || []).filter(p => p.pos !== 'GK'); // GK never scores in WE10
      // if filtering leaves empty (should not), fallback to original
      const filtered = roster.length ? roster : (KONAMI_PLAYER_DB[teamCode] || []);
      return filtered.map(p => {
        const key = p.name.trim().toLowerCase() + "|" + teamCode;
        const hist = histMap.get(key);
        let w = p.weight;
        if (hist) {
          const histRate = hist.goals / Math.max(1, hist.appearances);
          const alpha = Math.min(0.35, hist.appearances / 8);
          const histWeight = Math.min(95, Math.max(10, histRate * 22 + 25));
          w = w * (1 - alpha) + histWeight * alpha;
        }
        return { ...p, adjWeight: w };
      });
    }
    const homeAdj = buildAdjustedRoster(homeCode);
    const awayAdj = buildAdjustedRoster(awayCode);
    function pickAdj(teamAdj, rng2) {
      const total = teamAdj.reduce((s, p) => s + (p.adjWeight || p.weight), 0);
      if (total <= 0) return teamAdj[0];
      let r = rng2.range(Math.floor(total));
      for (const p of teamAdj) {
        const w = p.adjWeight || p.weight;
        if (r < w) return p;
        r -= w;
      }
      return teamAdj[teamAdj.length - 1];
    }

    const goalAcc = new Map();
    const hitAcc = new Map();
    const posMap = new Map();
    const twoPlusAcc = new Map();
    let totalGoalsAll = 0;

    for (let s = 0; s < numSims; s++) {
      const gh = poissonSample(xgHome, rng);
      const ga = poissonSample(xgAway, rng);
      const scoredThisSim = new Map();
      for (let i = 0; i < gh; i++) {
        const p = pickAdj(homeAdj, rng);
        const k = `${p.name}|${homeCode}`;
        goalAcc.set(k, (goalAcc.get(k) || 0) + 1);
        if (!posMap.has(k)) posMap.set(k, p.pos);
        scoredThisSim.set(k, (scoredThisSim.get(k) || 0) + 1);
        totalGoalsAll++;
      }
      for (let i = 0; i < ga; i++) {
        const p = pickAdj(awayAdj, rng);
        const k = `${p.name}|${awayCode}`;
        goalAcc.set(k, (goalAcc.get(k) || 0) + 1);
        if (!posMap.has(k)) posMap.set(k, p.pos);
        scoredThisSim.set(k, (scoredThisSim.get(k) || 0) + 1);
        totalGoalsAll++;
      }
      for (const [k, cnt] of scoredThisSim) {
        hitAcc.set(k, (hitAcc.get(k) || 0) + 1);
        if (cnt >= 2) twoPlusAcc.set(k, (twoPlusAcc.get(k) || 0) + 1);
      }
    }

    // === SCORE-CONSISTENT ALLOCATION: distribute exactly predicted score if provided ===
    const hasPredicted = Number.isInteger(opts.predictedHome) && Number.isInteger(opts.predictedAway);
    const matchMap = new Map(); // key -> goals in the ONE predicted scoreline
    if (hasPredicted) {
      const matchRng = new LCGRng((baseSeed ^ 0x6F017) >>> 0);
      for (let i = 0; i < opts.predictedHome; i++) {
        const p = pickAdj(homeAdj, matchRng);
        const k = `${p.name}|${homeCode}`;
        matchMap.set(k, (matchMap.get(k) || 0) + 1);
        if (!posMap.has(k)) posMap.set(k, p.pos);
      }
      for (let i = 0; i < opts.predictedAway; i++) {
        const p = pickAdj(awayAdj, matchRng);
        const k = `${p.name}|${awayCode}`;
        matchMap.set(k, (matchMap.get(k) || 0) + 1);
        if (!posMap.has(k)) posMap.set(k, p.pos);
      }
      // ensure goalAcc contains at least those keys for ranking even if Monte Carlo missed
      for (const [k, cnt] of matchMap) {
        if (!goalAcc.has(k)) {
          goalAcc.set(k, Math.max(1, Math.round(cnt * (numSims * 0.0002)))); // tiny seed for sorting, will be overridden by matchGoals priority
        }
      }
    }

    if (totalGoalsAll === 0 && matchMap.size === 0) {
      const fallback = [];
      const homeRoster = KONAMI_PLAYER_DB[homeCode] || [];
      const awayRoster = KONAMI_PLAYER_DB[awayCode] || [];
      const topHome = [...homeRoster].filter(p=>p.pos!=='GK').sort((a,b)=>b.weight-a.weight)[0] || homeRoster[0];
      const topAway = [...awayRoster].filter(p=>p.pos!=='GK').sort((a,b)=>b.weight-a.weight)[0] || awayRoster[0];
      if (topHome) fallback.push({ name: topHome.name, pos: topHome.pos, teamCode: homeCode, teamName: teamsDB[homeCode]?.name || homeCode, flag: teamsDB[homeCode]?.flag || "", expectedGoals: Number((xgHome*0.45).toFixed(3)), prob: Number(((1 - Math.exp(-xgHome*0.6))*100).toFixed(1)), probability2Plus: 0, scoringShare: 45, weight: topHome.weight, matchGoals: hasPredicted ? (matchMap.get(`${topHome.name}|${homeCode}`)||0) : 0, reason: `Top weight ${topHome.weight} di ${homeCode} (${topHome.pos}) — fallback` });
      if (topAway) fallback.push({ name: topAway.name, pos: topAway.pos, teamCode: awayCode, teamName: teamsDB[awayCode]?.name || awayCode, flag: teamsDB[awayCode]?.flag || "", expectedGoals: Number((xgAway*0.45).toFixed(3)), prob: Number(((1 - Math.exp(-xgAway*0.6))*100).toFixed(1)), probability2Plus: 0, scoringShare: 45, weight: topAway.weight, matchGoals: hasPredicted ? (matchMap.get(`${topAway.name}|${awayCode}`)||0) : 0, reason: `Top weight ${topAway.weight} di ${awayCode} (${topAway.pos}) — fallback` });
      return fallback.slice(0, PREDICTOR_CONFIG.TOP_SCORERS_LIMIT);
    }

    const ranking = [];
    for (const [key, cnt] of goalAcc.entries()) {
      const [name, teamCode] = key.split("|");
      const pos = posMap.get(key) || "CF";
      const teamName = teamsDB[teamCode]?.name || teamCode;
      const flag = teamsDB[teamCode]?.flag || "";
      const avg = cnt / numSims;
      const hits = hitAcc.get(key) || 0;
      const probAnytime = (hits / numSims);
      const prob2Plus = (twoPlusAcc.get(key) || 0) / numSims;
      const share = totalGoalsAll > 0 ? (cnt / totalGoalsAll) * 100 : 0;
      const matchGoals = matchMap.get(key) || 0;
      const weight = (KONAMI_PLAYER_DB[teamCode] || []).find((p)=>p.name===name)?.weight || 0;
      // Reason why this player is ranked here
      const reasonParts = [];
      reasonParts.push(`Weight ${Math.round(weight)} (${pos})`);
      if (matchGoals > 0) reasonParts.push(`cetak ${matchGoals} gol di prediksi ${hasPredicted ? `${opts.predictedHome}:${opts.predictedAway}` : 'xG'}`);
      reasonParts.push(`xG ${avg.toFixed(2)} • prob ${ (probAnytime*100).toFixed(1)}%`);
      if (pos.startsWith('CF') || pos==='FW') reasonParts.push('posisi depan paling sering dipilih engine');
      else if (pos.includes('MF') || pos==='OMF' || pos==='CMF') reasonParts.push('MF/OMF kontribusi 30% engine');
      else if (pos==='GK') reasonParts.push('GK terfilter (tidak seharusnya)');
      ranking.push({
        name, pos, teamCode, teamName, flag,
        expectedGoals: Number(avg.toFixed(3)),
        prob: Number((probAnytime * 100).toFixed(1)),
        probability2Plus: Number((prob2Plus * 100).toFixed(1)),
        scoringShare: Number(share.toFixed(1)),
        totalGoalsSim: cnt,
        hits,
        weight,
        matchGoals,
        reason: reasonParts.join(' — '),
      });
    }
    // Primary sort: matchGoals (actual allocation) then expectedGoals then weight — this answers "kenapa di atas"
    ranking.sort((a,b)=> (b.matchGoals - a.matchGoals) || (b.expectedGoals - a.expectedGoals) || (b.prob - a.prob) || (b.weight - a.weight));
    return ranking.slice(0, PREDICTOR_CONFIG.TOP_SCORERS_LIMIT);
  } catch (e) {
    console.error("[KONAMI] generateTopScorers error", e);
    return [];
  }
}

// ============================================================
// 7. KEY INDICATORS (Faktor Penentu) — rating delta
// ============================================================
function buildKeyIndicators(homeCode, awayCode, h, a, xgHome, xgAway) {
  try {
    const rH = teamRatings[homeCode], rA = teamRatings[awayCode];
    if (!rH || !rA) return null;
    const diff = (k) => rH[k] - rA[k];
    const indicators = [
      { label:"Overall", home:rH.overall, away:rA.overall, diff:diff("overall"), leader: diff("overall")>0? homeCode: diff("overall")<0? awayCode: "SEIMBANG" },
      { label:"Attack", home:rH.attack, away:rA.attack, diff:diff("attack"), leader: diff("attack")>0? homeCode: diff("attack")<0? awayCode: "SEIMBANG" },
      { label:"Defense", home:rH.defense, away:rA.defense, diff:diff("defense"), leader: diff("defense")>0? homeCode: diff("defense")<0? awayCode: "SEIMBANG" },
      { label:"Midfield", home:rH.midfield, away:rA.midfield, diff:diff("midfield"), leader: diff("midfield")>0? homeCode: diff("midfield")<0? awayCode: "SEIMBANG" },
      { label:"Speed", home:rH.speed, away:rA.speed, diff:diff("speed"), leader: diff("speed")>0? homeCode: diff("speed")<0? awayCode: "SEIMBANG" },
      { label:"Power", home:rH.power, away:rA.power, diff:diff("power"), leader: diff("power")>0? homeCode: diff("power")<0? awayCode: "SEIMBANG" },
      { label:"Stamina", home:rH.stamina, away:rA.stamina, diff:diff("stamina"), leader: diff("stamina")>0? homeCode: diff("stamina")<0? awayCode: "SEIMBANG" },
    ];
    const tacticalHome = 1.0 + (h.mid - a.mid)*0.12 + (h.spd - a.spd)*0.05;
    const formHomeW = Number(h.weight.toFixed(1)), formAwayW = Number(a.weight.toFixed(1));
    return { indicators, tacticalHome: Number(tacticalHome.toFixed(3)), xgHome, xgAway, formHomeW, formAwayW, homeCode, awayCode };
  } catch (_) { return null; }
}

// ============================================================
// 8. HYBRID PREDICT — Bayesian + Konami Monte-Carlo
// ============================================================
export function hybridPredict(homeCode, awayCode, excludeMemoryId = null, excludeGameNumber = null, opts = {}) {
  // validate upstream, but defensive: if invalid code, throw
  if (!ALLOWED_CODE_SET.has(homeCode) || !ALLOWED_CODE_SET.has(awayCode)) {
    throw new Error(`Kode negara tidak valid untuk prediksi 57-fix: ${homeCode} vs ${awayCode}`);
  }

  const { matches, stats, globalAttack } = extractDataset(excludeMemoryId, excludeGameNumber);
  const h = calculateTeamStrength(homeCode, stats, globalAttack);
  const a = calculateTeamStrength(awayCode, stats, globalAttack);

  const midDiff = h.mid - a.mid;
  const spdDiff = h.spd - a.spd;
  const tacticalFactorHome = 1.0 + (midDiff * 0.12) + (spdDiff * 0.05);
  const tacticalFactorAway = 1.0 - (midDiff * 0.12) - (spdDiff * 0.05);

  let xgHome = globalAttack * h.att * a.def * PREDICTOR_CONFIG.GLOBAL_HOME_ADVANTAGE * tacticalFactorHome;
  let xgAway = globalAttack * a.att * h.def * PREDICTOR_CONFIG.AWAY_FACTOR * tacticalFactorAway;

  const modelParts = ["Ratings","Form","Konami-LCG"];

  const h2h = calculateH2H(homeCode, awayCode, matches);
  if (h2h) {
    const h2hWeight = Math.min(PREDICTOR_CONFIG.MAX_H2H_INFLUENCE, 0.08 * Math.sqrt(h2h.count));
    xgHome = (1 - h2hWeight) * xgHome + h2hWeight * h2h.avgHome;
    xgAway = (1 - h2hWeight) * xgAway + h2hWeight * h2h.avgAway;
    modelParts.push(`H2H(${Math.round(h2hWeight*100)}%)`);
  }
  const simContext = findSimilarContextGoals(h, a, matches);
  if (simContext) {
    const simWeight = PREDICTOR_CONFIG.MAX_SIMILAR_CONTEXT_INFLUENCE;
    xgHome = (1 - simWeight) * xgHome + simWeight * simContext.avgHome;
    xgAway = (1 - simWeight) * xgAway + simWeight * simContext.avgAway;
    modelParts.push(`Context(${Math.round(simWeight*100)}%)`);
  }

  xgHome = clamp(xgHome, PREDICTOR_CONFIG.MIN_XG, PREDICTOR_CONFIG.MAX_XG);
  xgAway = clamp(xgAway, PREDICTOR_CONFIG.MIN_XG, PREDICTOR_CONFIG.MAX_XG);

  const distResult = generateBivariateDistribution(xgHome, xgAway);

  // — Sample scoreline: jika opts.sample true → variasi seperti game asli (tidak monoton 1-2 terus), else deterministic top prob —
  let chosenScore = distResult.topScore;
  if (opts.sample) {
    const sampleSeed = opts.seed != null ? opts.seed : hashStringToSeed(`${homeCode}|${awayCode}|${xgHome.toFixed(2)}|${xgAway.toFixed(2)}|sample|${PREDICTOR_CONFIG.MODEL_VERSION}`);
    const sampleRng = new LCGRng(sampleSeed);
    chosenScore = sampleScoreline(distResult.distribution, sampleRng);
  }

  const evidence = {
    hasRating: h.hasRating && a.hasRating,
    hasHistory: h.rawCount > 0 || a.rawCount > 0,
    homeMatches: h.rawCount, awayMatches: a.rawCount,
    homeWeight: Number(h.weight.toFixed(2)), awayWeight: Number(a.weight.toFixed(2)),
    hasH2H: !!h2h, h2hMatches: h2h ? h2h.count : 0,
    hasSimilarContext: !!simContext, globalAttack: Number(globalAttack.toFixed(2)),
  };
  const confidence = calculateModelEntropyConfidence(distResult.probs, evidence);

  let winner = "DRAW";
  if (distResult.probs.home > distResult.probs.away + 0.07) winner = teamsDB[homeCode]?.name || homeCode;
  else if (distResult.probs.away > distResult.probs.home + 0.07) winner = teamsDB[awayCode]?.name || awayCode;
  // jika sample, winner ikut sampled score untuk konsistensi
  if (opts.sample) {
    if (chosenScore.home > chosenScore.away) winner = teamsDB[homeCode]?.name || homeCode;
    else if (chosenScore.away > chosenScore.home) winner = teamsDB[awayCode]?.name || awayCode;
    else winner = "DRAW";
  }

  // --- Konami Top Scorers (Score-Consistent: alokasi tepat homeGoals:awayGoals, hanya pemain dari 2 tim ini — roster Image ESP/TOG exact) ---
  const topScorers = generateTopScorers(homeCode, awayCode, xgHome, xgAway, { seed: opts.seed, deterministic: opts.deterministic, numSims: opts.numSims, predictedHome: chosenScore.home, predictedAway: chosenScore.away });

  // --- Key Indicators ---
  const keyIndicators = buildKeyIndicators(homeCode, awayCode, h, a, Number(xgHome.toFixed(2)), Number(xgAway.toFixed(2)));

  const debug = opts.debug ? {
    source: "WE10_GHIDRA + MEMORY",
    seed: opts.seed ?? hashStringToSeed(`${homeCode}|${awayCode}|${xgHome.toFixed(2)}|${xgAway.toFixed(2)}|${PREDICTOR_CONFIG.MODEL_VERSION}`),
    teamStrength: { home: h, away: a },
    xg: { home: Number(xgHome.toFixed(2)), away: Number(xgAway.toFixed(2)) },
    scorerModel: "WE10 Full Roster (832) pure weight + Bayesian historical smoothing (no 60/30/10)",
    evidence,
    calibration: RATING_CALIBRATION,
    confidence,
    deterministic: opts.deterministic !== false
  } : undefined;

  return {
    homeGoals: chosenScore.home,
    awayGoals: chosenScore.away,
    winner, confidence,
    xgHome: Number(xgHome.toFixed(2)), xgAway: Number(xgAway.toFixed(2)),
    model: `${PREDICTOR_CONFIG.MODEL_VERSION} [${modelParts.join(" + ")}]${opts.sample ? " [SAMPLED]" : ""}`,
    probs: distResult.probs, markets: distResult.markets,
    distribution: distResult.distribution.slice(0,5),
    evidence,
    topScorers,
    keyIndicators,
    chosenSample: opts.sample ? { home: chosenScore.home, away: chosenScore.away } : null,
    ...(debug ? { debug } : {})
  };
}

// ============================================================
// 9. PREDICTION SERVICE - 57 validation + error handling
// ============================================================
export const PredictionService = {
  predictMatches(dataSource) {
    try {
      const rows = dataSource?.matches || [];
      const excludeContext = StateManager.activeMemoryId != null && dataSource?.gameNumber
        ? { memoryId: StateManager.activeMemoryId, gameNumber: dataSource.gameNumber }
        : {};
      const results = [];
      const p1Raw = (dataSource?.p1 || "").trim();
      let p1Warning = null;
      if (p1Raw && !isValidCountry(p1Raw)) {
        p1Warning = `P1 "${p1Raw}" di luar 57 resmi - akan diabaikan untuk prediksi.`;
      }
      rows.forEach((m, idx) => {
        const homeRaw = (m?.home || "").trim();
        const awayRaw = (m?.away || "").trim();
        const isB8 = idx === 7;
        const b8Enabled = dataSource.b8Enabled ?? dataSource.matches?.[7]?.enabled ?? false;
        const b8HasContent = !!(homeRaw || awayRaw);
        if (isB8 && !b8Enabled && !b8HasContent) return;
        if (isB8 && !b8Enabled) return;
        if (!homeRaw && !awayRaw) return;
        const row = { row: idx + 1, homeInput: homeRaw, awayInput: awayRaw, homeName: homeRaw || "?", awayName: awayRaw || "?" };
        if (p1Warning) row.p1Warning = p1Warning;
        if (!homeRaw || !awayRaw) {
          row.error = "HOME dan AWAY harus terisi. Isi kedua negara dari 57 daftar resmi (ex: Brazil vs Germany).";
          results.push(row); return;
        }
        const homeCode = normalizeCountry(homeRaw);
        const awayCode = normalizeCountry(awayRaw);
        if (!ALLOWED_CODE_SET.has(homeCode) || !ALLOWED_CODE_SET.has(awayCode)) {
          const bad = [];
          if (!ALLOWED_CODE_SET.has(homeCode)) bad.push(getValidationErrorLabel(homeRaw));
          if (!ALLOWED_CODE_SET.has(awayCode)) bad.push(getValidationErrorLabel(awayRaw));
          row.error = `Negara di luar 57 resmi WE10: ${bad.join(" vs ")} - Hanya 57 negara di teams.js yang didukung.`;
          results.push(row); return;
        }
        if (!teamsDB[homeCode] || !teamsDB[awayCode]) {
          row.error = `Negara tidak dikenal: ${homeRaw || "?"} vs ${awayRaw || "?"}`;
          results.push(row); return;
        }
        if (homeCode === awayCode) {
          row.error = `HOME dan AWAY tidak boleh sama: ${teamsDB[homeCode].name} vs ${teamsDB[homeCode].name}`;
          results.push(row); return;
        }
        row.homeCode = homeCode; row.awayCode = awayCode;
        row.homeName = teamsDB[homeCode].name; row.awayName = teamsDB[awayCode].name;
        row.homeFlag = teamsDB[homeCode].flag; row.awayFlag = teamsDB[awayCode].flag;
        try {
          const pred = hybridPredict(homeCode, awayCode, excludeContext.memoryId ?? null, excludeContext.gameNumber ?? null, { deterministic: true });
          row.prediction = pred;
        } catch (predErr) {
          row.error = `Gagal kalkulasi prediksi: ${predErr?.message || String(predErr)}`;
        }
        results.push(row);
      });
      if (results.length === 0) {
        return [{ row: 0, error: "Isi minimal satu baris HOME vs AWAY dari 57 negara resmi untuk diprediksi.", homeName:"?", awayName:"?" }];
      }
      return results;
    } catch (e) {
      return [{ row: 0, error: `Pipeline prediksi gagal: ${e?.message || String(e)} - cek console.`, homeName:"?", awayName:"?" }];
    }
  },
  bulkPredict(dataSource, iterations = 100) {
    try {
      const valid = this.predictMatches(dataSource).filter(r=>!r.error && r.prediction);
      if (!valid.length) return { error: "Tidak ada match valid untuk bulk predict (isi B1-B7 dulu)." };
      if (iterations < 1 || iterations > 5000) iterations = 100;
      const globalScorerFreq = new Map(); // key -> {name,pos,teamCode,flag,teamName,matches,wins,totalGoals,reason}
      const scoreFreq = new Map(); // "H:A" -> count
      const perMatch = valid.map(v=>({ row:v.row, homeCode:v.homeCode, awayCode:v.awayCode, homeName:v.homeName, awayName:v.awayName, homeFlag:v.homeFlag, awayFlag:v.awayFlag, scoreMap:new Map(), scorerMap:new Map() }));
      for (let iter=0; iter<iterations; iter++) {
        for (const pm of perMatch) {
          const seed = hashStringToSeed(`${pm.homeCode}|${pm.awayCode}|${iter}|bulk|${PREDICTOR_CONFIG.MODEL_VERSION}`);
          const pred = hybridPredict(pm.homeCode, pm.awayCode, null, null, { deterministic:true, seed, sample:true });
          const sk = `${pred.homeGoals}:${pred.awayGoals}`;
          pm.scoreMap.set(sk, (pm.scoreMap.get(sk)||0)+1);
          scoreFreq.set(sk, (scoreFreq.get(sk)||0)+1);
          for (const pl of pred.topScorers) {
            if ((pl.matchGoals||0) <=0) continue;
            const k = `${pl.name}|${pl.teamCode}`;
            const ex = pm.scorerMap.get(k);
            if (ex) { ex.hits+=1; ex.totalGoals+=pl.matchGoals; }
            else pm.scorerMap.set(k,{ name:pl.name, pos:pl.pos, teamCode:pl.teamCode, flag:pl.flag, teamName:pl.teamName, hits:1, totalGoals:pl.matchGoals, weight:pl.weight, reason:pl.reason });
            const gex = globalScorerFreq.get(k);
            if (gex) { gex.hits+=1; gex.totalGoals+=pl.matchGoals; }
            else globalScorerFreq.set(k,{ name:pl.name, pos:pl.pos, teamCode:pl.teamCode, flag:pl.flag, teamName:pl.teamName, hits:1, totalGoals:pl.matchGoals, weight:pl.weight, reason:pl.reason });
          }
        }
      }
      const globalRank = [...globalScorerFreq.values()].sort((a,b)=> b.hits - a.hits || b.totalGoals - a.totalGoals).map(x=>({ ...x, freqPct: Number((x.hits/iterations*100).toFixed(1)), avgGoals: Number((x.totalGoals/x.hits).toFixed(2)) }));
      const scoreRank = [...scoreFreq.entries()].sort((a,b)=> b[1]-a[1]).slice(0,10).map(([s,c])=>({ scoreline:s, count:c, pct: Number(c/(iterations*perMatch.length)*100).toFixed(1) }));
      const perMatchRank = perMatch.map(pm=>{
        const sRank = [...pm.scoreMap.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5).map(([s,c])=>({ scoreline:s, count:c, pct: Number(c/iterations*100).toFixed(1) }));
        const scRank = [...pm.scorerMap.values()].sort((a,b)=> b.hits - a.hits || b.totalGoals - a.totalGoals).slice(0,6).map(x=>({ ...x, freqPct: Number((x.hits/iterations*100).toFixed(1)) }));
        return { row:pm.row, homeName:pm.homeName, awayName:pm.awayName, homeCode:pm.homeCode, awayCode:pm.awayCode, homeFlag:pm.homeFlag, awayFlag:pm.awayFlag, topScores:sRank, topScorers:scRank };
      });
      return { iterations, totalMatches: perMatch.length, globalRank: globalRank.slice(0,15), scoreRank, perMatch: perMatchRank };
    } catch(e) { return { error: `Bulk predict gagal: ${e?.message||String(e)}` }; }
  },
  runWalkForwardBacktest(memoryId = 1) {
    try {
      const memory = StateManager.db?.memories?.[memoryId];
      if (!memory || !Array.isArray(memory.games) || memory.games.length < 2) {
        return { error: "Minimal 2 games pada memory database diperlukan untuk backtest valid." };
      }
      let totalTested = 0, exactHits = 0, result1X2Hits = 0, top3Hits = 0, top5Hits = 0, topScorerHits = 0, topScorerTotal = 0;
      let sumAbsErrHome = 0, sumAbsErrAway = 0, sumBrier = 0, sumLogLoss = 0;
      for (let gIdx = 1; gIdx < memory.games.length; gIdx++) {
        const targetGame = memory.games[gIdx];
        if (!targetGame || !Array.isArray(targetGame.matches)) continue;
        for (const m of targetGame.matches) {
          const hCode = normalizeCountry(m?.home || "");
          const aCode = normalizeCountry(m?.away || "");
          const actual = parseScore(m?.score || "");
          if (!hCode || !aCode || !actual || !teamsDB[hCode] || !teamsDB[aCode]) continue;
          if (!ALLOWED_CODE_SET.has(hCode) || !ALLOWED_CODE_SET.has(aCode)) continue;
          let pred;
          try { pred = hybridPredict(hCode, aCode, memoryId, targetGame.gameNumber, { deterministic: true }); } catch (_) { continue; }
          totalTested++;
          if (pred.homeGoals === actual.home && pred.awayGoals === actual.away) exactHits++;
          const actual1X2 = actual.home > actual.away ? "HOME" : (actual.away > actual.home ? "AWAY" : "DRAW");
          const pred1X2 = pred.probs.home > Math.max(pred.probs.draw, pred.probs.away) ? "HOME" : (pred.probs.away > Math.max(pred.probs.home, pred.probs.draw) ? "AWAY" : "DRAW");
          if (actual1X2 === pred1X2) result1X2Hits++;
          if (pred.distribution.slice(0,3).some((s)=>s.home===actual.home && s.away===actual.away)) top3Hits++;
          if (pred.distribution.slice(0,5).some((s)=>s.home===actual.home && s.away===actual.away)) top5Hits++;
          sumAbsErrHome += Math.abs(pred.homeGoals - actual.home);
          sumAbsErrAway += Math.abs(pred.awayGoals - actual.away);
          const oH = actual1X2==="HOME"?1:0, oD = actual1X2==="DRAW"?1:0, oA = actual1X2==="AWAY"?1:0;
          sumBrier += (Math.pow(pred.probs.home - oH,2)+Math.pow(pred.probs.draw - oD,2)+Math.pow(pred.probs.away - oA,2))/3;
          const actualProb = actual1X2==="HOME"?pred.probs.home : actual1X2==="DRAW"?pred.probs.draw : pred.probs.away;
          sumLogLoss += -Math.log(Math.max(0.01, actualProb));
          const actualTop = (targetGame.topGoals || []).filter(g=>g.player && g.country).map(g=> normalizeCountry(g.country) + ":" + g.player.trim().toLowerCase());
          if (actualTop.length > 0) {
            const predTop3 = pred.topScorers.slice(0,3).map(p=> p.teamCode.toLowerCase()+":"+p.name.trim().toLowerCase());
            topScorerTotal++;
            if (actualTop.some(at => predTop3.some(pt => pt.includes(at.split(":")[1]) || at.includes(pt.split(":")[1])))) topScorerHits++;
          }
        }
      }
      if (totalTested === 0) return { error: "Tidak ada pertandingan valid (57-fix) terisi skor untuk backtest." };
      return {
        totalTested,
        exactScoreAccuracy: (exactHits / totalTested) * 100,
        result1X2Accuracy: (result1X2Hits / totalTested) * 100,
        top3ScoreHitRate: (top3Hits / totalTested) * 100,
        top5ScoreHitRate: (top5Hits / totalTested) * 100,
        topScorerHitRate: topScorerTotal > 0 ? (topScorerHits / topScorerTotal * 100) : 0,
        topScorerSamples: topScorerTotal,
        maeHomeGoals: sumAbsErrHome / totalTested,
        maeAwayGoals: sumAbsErrAway / totalTested,
        meanBrierScore: sumBrier / totalTested,
        meanLogLoss: sumLogLoss / totalTested,
      };
    } catch (e) {
      return { error: `Backtest gagal: ${e?.message || String(e)}` };
    }
  },
};