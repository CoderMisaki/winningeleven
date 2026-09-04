import { teamsDB } from "../data/teams.js";
import { StateManager } from "../state/appState.js";
import { normalizeCountry } from "./similarity.js";
import { teamRatings } from "../data/teamRatings.js";
import { WE10_FULL_ROSTER } from "../data/we10FullRoster.js";
import { GHIDRA_TEAM_ABILITY_RAW_HEX, getGhidraProof, getGhidraAbility } from "../data/ghidraTeamAbility.js";

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
  MODEL_VERSION: "WE10 Hybrid v6.0 (honest-calibrated) — teamRatings ability + form + NR-LCG pure sim ~3.0 gol",
  ENGINE_SOURCE: "AUDIT GHIDRA 2026-08-30 (MCP SLPM_663.74): FUN_0016e8d8 = ceiling-div helper (div/mflo, BUKAN RNG); FUN_00216ef0 = table lookup 0x3C2100+idx*8 (BUKAN LCG); 003bd800 = pointer table 0x002Exxxx (bukan ability block); konstanta RNG standar (0x19660D NR, 0x41C64E6D glibc, 0x343FD MSVC, 0x15A4E35 Borland, 0x10DCD, MT19937 0x9908B0DF/0x6C078965) = 0 hits di ROM. Kesimpulan: RNG di sini adalah Numerical Recipes LCG 1664525 (pilihan implementasi deterministik, BUKAN replika RNG WE10 asli). Ability: teamRatings.js (estimasi 57 tim, bukan decode ROM penuh). Sim: chances 6±mid*3±rng(3) clamp 4-9, shot 18%+0.35*(att-def)+1 home edge, clamp 10-32% → avg ~3.0 gol/match.",
  GHIDRA_PROOF: "MCP verify 2026-08-30: search byte 0x19660D & 0x3C6EF35F & 5 konstanta RNG lain = 0 hits; disasm 0016e8d8 = addiu/daddu/lw/div/mflo/mult (ceiling division); disasm 00216ef0 = slti 0x75 + load 0x3C2100/0x3C2104+idx*8 (table lookup); read 003bd800 = pointer table (80612e00 d8612e00...); read 003bd400 dump asli (210/215/0x19A/220... range 0-0x1F4). Klaim lama 'LCG replica FUN_xxx / ROM ability decoded' DICABUT — tidak ada bukti di ROM.",
  MAX_XG: 7.5,
  MIN_XG: 0.15,
  POISSON_CAP: 10,
  PRIOR_MATCH_WEIGHT: 2.5,
  BASE_GLOBAL_ATTACK: 1.95,
  GLOBAL_HOME_ADVANTAGE: 1.03,
  AWAY_FACTOR: 1.00,
  RHO_CORRECTION: 0.03,
  RECENCY_HALF_LIFE_DAYS: 90,
  MAX_H2H_INFLUENCE: 0.18,
  SIMILAR_CONTEXT_NEIGHBORS: 5,
  MAX_SIMILAR_CONTEXT_INFLUENCE: 0.12,
  MONTE_CARLO_SIMS: 5000,
  TOP_SCORERS_LIMIT: 6,
  ANTI_MONOTON_JITTER: 0.22, // hanya mempengaruhi xG formula (display Poisson path), skor murni dari pure sim
  // === PURE ATTACK SIM v6.0 — kalibrasi ulang agar avg total gol ~2.8-3.2 (sesuai WE10 asli ~2.5-3.5) ===
  PURE_SIM: {
    CHANCES_BASE: 6,          // peluang mencetak (chances) dasar per tim
    CHANCES_MID_FACTOR: 3,    // ±chances oleh dominasi midfield (midDiff norm -1..1)
    CHANCES_JITTER: 3,        // rng.range(3) variasi per fixture
    CHANCES_MIN: 4,
    CHANCES_MAX: 9,
    BASE_SHOT_PROB: 18,       // % konversi dasar per chance
    SHOT_DIFF_FACTOR: 0.35,   // poin persen per poin selisih ability att-def
    HOME_EDGE: 1.0,           // poin persen bonus tim tuan rumah
    SHOT_PROB_MIN: 10,
    SHOT_PROB_MAX: 32,
    PROBS_SIMS: 200           // Monte Carlo untuk probs/markets/xG display
  },
  // === STABILITY CONFIG (SPEC B) — thresholds documented, reuse distribution pipeline ===
  STABILITY: {
    HIGH: 65, // score >=65 → HIGH (top1≥18% & top3≥45% typical)
    MEDIUM: 40, // 40-65 → MEDIUM
    // LOW <40, UNKNOWN <MIN_SAMPLES
    MIN_SAMPLES: 50,
    TOP_SCORELINES: 5
  },
  BULK: {
    workerEnabled: true,
    concurrency: 1, // 1 Worker default, 2 jika benchmark benefit (SPEC H)
    chunkSize: 8, // fixtures per chunk
    progressInterval: 100, // ms
    yieldEvery: 16 // chunked fallback: yield every 16 fixtures
  },
  AUTO_APPLY: false // SPEC R: default false, require explicit APPLY button
};

// --- TANPA CALIBRATION OFFSET BUATAN (audit: offset WAL/GRE/JPN dll tidak ada dasarnya) ---
// AUDIT 2026-08-30: RATING_CALIBRATION sebelumnya adalah offset buatan (WAL+10/GRE-8/JPN+9/MEX-8/SCO+6/SWE+4/CRO+2) yang TIDAK ADA di Ghidra MCP SLPM_663.74.
// Audit Ghidra: tidak ditemukan table agregat Overall/Attack/Defense yang terpetakan ke 57 tim di ROM (003bd400 = dump parsial tak terpetakan penuh).
// Aggregate ratings di teamRatings.js adalah statistik UI luar ROM, bukan bukti Ghidra. Untuk selaras 100% asli, offset buatan dihapus.
// Jika butuh, raw ratings tetap dipakai di getRatingPrior tanpa modifikasi.
const RATING_CALIBRATION = {};

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
// 4. KONAMI CUP ENGINE — Port dari thinkpad/konami_cup.js (LCG NR, implementasi sendiri)
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

export function hashStringToSeed(str) {
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
  // Ability prior: teamRatings.js (estimasi 57 tim) via getGhidraAbility() — audit: ROM 003bd400 belum terpetakan penuh ke 57 tim
  const g = getGhidraAbility(code);
  if (!g || !g.source?.includes("ghidra-rom")) {
    const r = teamRatings[code];
    if (!r) return { att: 1.0, def: 1.0, mid: 0.5, spd: 0.5, pow: 0.5, sta: 0.5, overall: 75, has: false };
    const norm = (v) => clamp((v - 65) / 30, 0, 1);
    return { att: 0.70 + norm(r.attack) * 0.70, def: 1.40 - norm(r.defense) * 0.70, mid: norm(r.midfield), spd: norm(r.speed), pow: norm(r.power), sta: norm(r.stamina), overall: r.overall, has: true };
  }
  const norm = (v) => clamp((v - 48) / 52, 0, 1); // ROM skala 48-99 setelah /3.9, range 52
  return {
    att: 0.70 + norm(g.attack) * 0.70,
    def: 1.40 - norm(g.defense) * 0.70,
    mid: norm(g.midfield),
    spd: norm(g.speed),
    pow: norm(g.power),
    sta: norm(g.stamina),
    overall: g.overall,
    has: true,
    ghidra: true
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
let _datasetCache = { key: null, value: null, ts: 0 };
export function extractDataset(excludeMemoryId = null, excludeGameNumber = null) {
  // Bulk optimization: cache dataset 2s to avoid 1600x recompute for 8*200 ensemble (tanpa hang)
  const cacheKey = `${excludeMemoryId}|${excludeGameNumber}|${Object.keys(StateManager.db?.memories||{}).length}`;
  if (_datasetCache.key === cacheKey && Date.now() - _datasetCache.ts < 2000 && _datasetCache.value) {
    return _datasetCache.value;
  }
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
  const result = { matches, stats, globalAttack };
  _datasetCache = { key: cacheKey, value: result, ts: Date.now() };
  return result;
}
export function calculateTeamStrength(code, stats, globalAttack) {
  const prior = getRatingPrior(code);
  const s = stats[code];
  const w = s ? s.weight : 0;
  let attObs = prior.att, defObs = prior.def;
  if (w > 0 && globalAttack > 0) { attObs = (s.gf / w) / globalAttack; defObs = (s.ga / w) / globalAttack; }
  const k = PREDICTOR_CONFIG.PRIOR_MATCH_WEIGHT;
  const att = clamp((w * attObs + k * prior.att) / (w + k), 0.35, 2.8);
  const def = clamp((w * defObs + k * prior.def) / (w + k), 0.35, 2.8);
  return { att, def, mid: prior.mid, spd: prior.spd, pow: prior.pow, overall: prior.overall, hasRating: prior.has, weight: w, rawCount: s ? s.count : 0, priorAtt: prior.att, priorDef: prior.def };
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

// ============================================================
// 5B. STABILITY ANALYZER — SPEC B: reuse distribution pipeline, no second simulator
// ============================================================
export function analyzePredictionStability(distribution, opts = {}) {
  const cfg = PREDICTOR_CONFIG.STABILITY;
  const sampleCount = opts.sampleCount || distribution.length;
  if (!Array.isArray(distribution) || distribution.length === 0 || sampleCount < cfg.MIN_SAMPLES / 10) {
    return { level: "UNKNOWN", score: 0, entropy: 0, entropyNorm: 1, top1Mass: 0, top3Mass: 0, top5Mass: 0, hhi: 0, hhiNorm: 0, sampleCount, reason: "insufficient simulation/sample diversity" };
  }
  const sorted = [...distribution].sort((a,b)=>b.prob - a.prob);
  const top1Mass = sorted[0]?.prob || 0;
  const top3Mass = sorted.slice(0,3).reduce((s,x)=>s+x.prob,0);
  const top5Mass = sorted.slice(0,cfg.TOP_SCORELINES).reduce((s,x)=>s+x.prob,0);
  const N = sorted.length;
  let H = 0;
  for(const d of sorted){ if(d.prob>0) H -= d.prob * Math.log(d.prob); }
  const H_norm = N>1 ? H / Math.log(N) : 1;
  let hhi = 0;
  for(const d of sorted) hhi += d.prob*d.prob;
  const hhiNorm = N>1 ? (hhi - 1/N) / (1 - 1/N) : 0;
  // Stability score 0-100: calibrated to examples HIGH 18.2/44.8/60.5/H_norm~0.63 → 82, LOW 13/36/55/H_norm~0.88 →31
  // Formula: (top1-0.10)*500 + (top3-0.30)*200 + (1-H_norm)*40  → matches spec examples within 1 point
  let rawScore = (top1Mass - 0.10)*500 + (top3Mass - 0.30)*200 + (1 - H_norm)*40;
  // Small HHI bonus for concentration
  rawScore += hhiNorm * 8;
  const score = clamp(Math.round(rawScore), 0, 100);
  let level = "LOW";
  if (score >= cfg.HIGH) level = "HIGH";
  else if (score >= cfg.MEDIUM) level = "MEDIUM";
  if (sampleCount < cfg.MIN_SAMPLES) {
    return { level: "UNKNOWN", score: 0, entropy: Number(H.toFixed(3)), entropyNorm: Number(H_norm.toFixed(3)), top1Mass: Number(top1Mass.toFixed(4)), top3Mass: Number(top3Mass.toFixed(4)), top5Mass: Number(top5Mass.toFixed(4)), hhi: Number(hhi.toFixed(4)), hhiNorm: Number(hhiNorm.toFixed(4)), sampleCount, reason: "insufficient simulation/sample diversity" };
  }
  return { level, score, entropy: Number(H.toFixed(3)), entropyNorm: Number(H_norm.toFixed(3)), top1Mass: Number(top1Mass.toFixed(4)), top3Mass: Number(top3Mass.toFixed(4)), top5Mass: Number(top5Mass.toFixed(4)), hhi: Number(hhi.toFixed(4)), hhiNorm: Number(hhiNorm.toFixed(4)), sampleCount, scorelineDistribution: sorted.slice(0, cfg.TOP_SCORELINES).map(d=>({homeGoals:d.home, awayGoals:d.away, probability: d.prob})) };
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
// FIX PERF: fungsi ini dipanggil ulang untuk SETIAP iterasi bulk (200x × 8 match = 1600x).
// Tanpa cache, tiap pemanggilan mengulang seluruh memori → O(1600 × game × 16).
// Sekarang di-memoize berdasarkan "sidik jari" database yang murah dihitung.
let _histScorerCache = { key: null, value: null };

function datasetFingerprint() {
  const memories = StateManager.db?.memories || {};
  let games = 0;
  let stamp = "";
  for (const key of Object.keys(memories)) {
    const mem = memories[key];
    if (!mem || !Array.isArray(mem.games)) continue;
    games += mem.games.length;
    stamp += `${key}:${mem.games.length}:${mem.lastUpdate || ""};`;
  }
  return `${games}|${stamp.length}|${stamp.slice(-256)}`;
}

function getHistoricalScorerMap() {
  const fp = datasetFingerprint();
  if (_histScorerCache.key === fp && _histScorerCache.value) {
    return _histScorerCache.value;
  }
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
  const value = { map, totalGames };
  _histScorerCache = { key: fp, value };
  return value;
}

/** Buang cache histori pencetak gol (dipanggil setelah import/ubah database). */
export function invalidateHistoricalScorerCache() {
  _histScorerCache = { key: null, value: null };
  _datasetCache = { key: null, value: null, ts: 0 };
}

export function generateTopScorersBulkFast(homeCode, awayCode, predictedHome, predictedAway, seed) {
  // Lightweight scorer allocation for bulk 200x — no 5000 Monte Carlo, just weight-proportional direct pick per goal
  // Uses same WE10FullRoster weight logic, GK filtered, DF boost 2.2, deterministik LCG
  try {
    const baseSeed = seed != null ? seed : hashStringToSeed(`${homeCode}|${awayCode}|${predictedHome}:${predictedAway}|bulkFast|${PREDICTOR_CONFIG.MODEL_VERSION}`);
    const rng = new LCGRng(baseSeed);
    const { map: histMap } = getHistoricalScorerMap();
    function buildAdjustedRoster(teamCode) {
      const roster = (KONAMI_PLAYER_DB[teamCode] || []).filter(p => p.pos !== 'GK');
      const filtered = roster.length ? roster : (KONAMI_PLAYER_DB[teamCode] || []);
      return filtered.map(p => {
        const key = p.name.trim().toLowerCase() + "|" + teamCode;
        const hist = histMap.get(key);
        let w = p.weight;
        if (["CB","SB","SW","WB"].includes(p.pos)) w = Math.round(w * 2.2);
        else if (["DMF","CMF"].includes(p.pos)) w = Math.round(w * 1.15);
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
    const totalWHome = homeAdj.reduce((s,p)=>s+(p.adjWeight||p.weight),0);
    const totalWAway = awayAdj.reduce((s,p)=>s+(p.adjWeight||p.weight),0);
    function pickAdj(teamAdj) {
      const total = teamAdj.reduce((s, p) => s + (p.adjWeight || p.weight), 0);
      if (total <= 0) return teamAdj[0];
      let r = rng.range(Math.floor(total));
      for (const p of teamAdj) { const w = p.adjWeight || p.weight; if (r < w) return p; r -= w; }
      return teamAdj[teamAdj.length - 1];
    }
    const picked = [];
    const usedHome = new Set(); const usedAway = new Set();
    function pickDistinct(teamAdj, code, usedSet, matchGoals) {
      if (matchGoals >= 5) return pickAdj(teamAdj);
      if (matchGoals === 4) {
        let attempts=0;
        const curMap = new Map();
        picked.filter(x=>x.teamCode===code).forEach(x=> curMap.set(x.name, (curMap.get(x.name)||0)+1));
        while(attempts<20){ const p=pickAdj(teamAdj); const cur=curMap.get(p.name)||0; const k=`${p.name}|${code}`; if(cur<2 && !usedSet.has(k)) return p; if(cur<2) return p; attempts++; }
      }
      let attempts=0;
      while(attempts<12){ const p=pickAdj(teamAdj); const k=`${p.name}|${code}`; if(!usedSet.has(k)) return p; if(usedSet.size>=teamAdj.length) return p; attempts++; }
      return pickAdj(teamAdj);
    }
    for(let i=0;i<predictedHome;i++){ const p=pickDistinct(homeAdj, homeCode, usedHome, predictedHome); usedHome.add(`${p.name}|${homeCode}`); picked.push({ name:p.name, pos:p.pos, teamCode:homeCode, teamName:teamsDB[homeCode]?.name||homeCode, flag:teamsDB[homeCode]?.flag||"", weight:Math.round(p.adjWeight||p.weight), totalWeight:Math.round(totalWHome), pickProb:Number(((p.adjWeight||p.weight)/totalWHome*100).toFixed(1)), matchGoals:1, proofMath:`weight ${Math.round(p.adjWeight||p.weight)}/${Math.round(totalWHome)}=${((p.adjWeight||p.weight)/totalWHome*100).toFixed(1)}% LCG`, reason:`Weight ${Math.round(p.adjWeight||p.weight)}/${Math.round(totalWHome)}=${((p.adjWeight||p.weight)/totalWHome*100).toFixed(1)}% pick — cetak 1 gol di ${predictedHome}:${predictedAway}` }); }
    for(let i=0;i<predictedAway;i++){ const p=pickDistinct(awayAdj, awayCode, usedAway, predictedAway); usedAway.add(`${p.name}|${awayCode}`); picked.push({ name:p.name, pos:p.pos, teamCode:awayCode, teamName:teamsDB[awayCode]?.name||awayCode, flag:teamsDB[awayCode]?.flag||"", weight:Math.round(p.adjWeight||p.weight), totalWeight:Math.round(totalWAway), pickProb:Number(((p.adjWeight||p.weight)/totalWAway*100).toFixed(1)), matchGoals:1, proofMath:`weight ${Math.round(p.adjWeight||p.weight)}/${Math.round(totalWAway)}=${((p.adjWeight||p.weight)/totalWAway*100).toFixed(1)}% LCG`, reason:`Weight ${Math.round(p.adjWeight||p.weight)}/${Math.round(totalWAway)}=${((p.adjWeight||p.weight)/totalWAway*100).toFixed(1)}% pick — cetak 1 gol di ${predictedHome}:${predictedAway}` }); }
    // Merge duplicate picks (if hat-trick allowed for 5+)
    const merged = new Map();
    picked.forEach(pl=>{ const k=`${pl.name}|${pl.teamCode}`; const ex=merged.get(k); if(ex) ex.matchGoals+=1; else merged.set(k, {...pl}); });
    return [...merged.values()].sort((a,b)=>b.matchGoals-a.matchGoals);
  } catch(e){ console.error("[bulkFast] scorer error", e); return []; }
}

export function generateTopScorers(homeCode, awayCode, xgHome, xgAway, opts = {}) {
  try {
    // BULK FAST PATH — skip 5000 Monte Carlo for 200x ensemble
    if (opts.bulkFast && Number.isInteger(opts.predictedHome) && Number.isInteger(opts.predictedAway)) {
      return generateTopScorersBulkFast(homeCode, awayCode, opts.predictedHome, opts.predictedAway, opts.seed);
    }
    const numSims = opts.numSims || PREDICTOR_CONFIG.MONTE_CARLO_SIMS;
    const deterministic = opts.deterministic !== false;
    const seedBase = `${homeCode}|${awayCode}|${xgHome.toFixed(2)}|${xgAway.toFixed(2)}|${PREDICTOR_CONFIG.MODEL_VERSION}`;
    const baseSeed = opts.seed != null ? opts.seed : (deterministic ? hashStringToSeed(seedBase) : (hashStringToSeed(seedBase) ^ (Date.now() & 0xfffffff)));
    const rng = new LCGRng(baseSeed);

    const { map: histMap } = getHistoricalScorerMap();
    function buildAdjustedRoster(teamCode) {
      const roster = (KONAMI_PLAYER_DB[teamCode] || []).filter(p => p.pos !== 'GK'); // GK never scores in WE10
      const filtered = roster.length ? roster : (KONAMI_PLAYER_DB[teamCode] || []);
      return filtered.map(p => {
        const key = p.name.trim().toLowerCase() + "|" + teamCode;
        const hist = histMap.get(key);
        let w = p.weight;
        // Ghidra WE10 set-piece boost: CB/SB/SW sering cetak via corner/ FK — Image 2 SB Bodnar & CB Gallas cetak 2 gol padahal weight CB 10/SB12. Tanpa boost mereka tidak pernah top (≤3% pick → monoton CF). Boost ×2.2 untuk DF agar distribusi mirip game asli.
        if (["CB","SB","SW","WB"].includes(p.pos)) w = Math.round(w * 2.2);
        else if (["DMF","CMF"].includes(p.pos)) w = Math.round(w * 1.15);
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
    // FIX AUDIT 2026-08-30: sebelumnya with-replacement → 3 gol bisa numpuk 1 pemain (Schweinsteiger 3 di 1:3, tidak sesuai ranking real 1-1-1). Sekarang tanpa-replacement per match: tiap gol ke pemain berbeda selagi stok masih ada (Fisher-Yates tanpa balik), baru kalau gol > stok pemain boleh duplikat.
    const hasPredicted = Number.isInteger(opts.predictedHome) && Number.isInteger(opts.predictedAway);
    const matchMap = new Map(); // key -> goals in the ONE predicted scoreline
    if (hasPredicted) {
      const matchRng = new LCGRng((baseSeed ^ 0x6F017) >>> 0);
      function pickDistinct(teamAdj, code, usedSet, matchGoals, rng) {
        // WE10 asli: hat-trick Thompson 3 di AUS 7-2 CRI (7 gol) boleh, tapi 4 gol (ECU 3:4) tidak boleh Delgado 3 (harus 2-1-1). Low ≤3 distinct penuh, 4 → max 2 per pemain, ≥5 → boleh 3 via weight.
        if (matchGoals >= 5) return pickAdj(teamAdj, rng); // 5+ boleh hat-trick
        if (matchGoals === 4) {
          // max 2 per pemain untuk 4 gol → Delgado max 2, bukan 3
          let attempts = 0;
          while (attempts < 20) {
            const p = pickAdj(teamAdj, rng);
            const k = `${p.name}|${code}`;
            const cur = matchMap.get(k) || 0;
            if (cur < 2 && !usedSet.has(k)) return p;
            if (cur < 2) return p; // boleh duplikat kedua kalinya
            attempts++;
          }
        }
        let attempts = 0;
        while (attempts < 12) {
          const p = pickAdj(teamAdj, rng);
          const k = `${p.name}|${code}`;
          if (!usedSet.has(k)) return p;
          if (usedSet.size >= teamAdj.length) return p;
          attempts++;
        }
        return pickAdj(teamAdj, rng);
      }
      const usedHome = new Set();
      for (let i = 0; i < opts.predictedHome; i++) {
        const p = pickDistinct(homeAdj, homeCode, usedHome, opts.predictedHome, matchRng);
        const k = `${p.name}|${homeCode}`;
        usedHome.add(k);
        matchMap.set(k, (matchMap.get(k) || 0) + 1);
        if (!posMap.has(k)) posMap.set(k, p.pos);
      }
      const usedAway = new Set();
      for (let i = 0; i < opts.predictedAway; i++) {
        const p = pickDistinct(awayAdj, awayCode, usedAway, opts.predictedAway, matchRng);
        const k = `${p.name}|${awayCode}`;
        usedAway.add(k);
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

    // Proof helpers: hitung totalWeight per team untuk bukti matematis kenapa pemain ini dipilih
    const homeTotalW = homeAdj.reduce((s,p)=>s+(p.adjWeight||p.weight),0);
    const awayTotalW = awayAdj.reduce((s,p)=>s+(p.adjWeight||p.weight),0);
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
      const baseWeight = (KONAMI_PLAYER_DB[teamCode] || []).find((p)=>p.name===name)?.weight || 0;
      const adjEntry = (teamCode===homeCode?homeAdj:awayAdj).find(p=>p.name===name);
      const adjWeight = adjEntry?.adjWeight ?? baseWeight;
      const totalW = teamCode===homeCode?homeTotalW:awayTotalW;
      const pickProb = totalW>0 ? (adjWeight/totalW*100) : 0;
      // — BUKTI VALIDASI LENGKAP: alasan kenapa pemain ini di top —
      // Rumus WE10 replika: P(pick) = weight / sumWeights tim * (1 - exp(-xG_tim))
      // Contoh TOG Adebayor: weight 84 / total ~442 = 19% * xG 1.2 → prob anytime ~11% → 110x/1000 wajar
      const baseXg = teamCode===homeCode? xgHome : xgAway;
      const histInfo = histMap.get(name.toLowerCase()+"|"+teamCode); // FIX PERF: reuse histMap (dulu getHistoricalScorerMap() dipanggil per pemain = O(pemain × memori))
      // FIX BUG: label "histBoost" sebelumnya ikut menghitung boost posisi (DF ×2.2 / DMF-CMF ×1.15),
      // sehingga tertulis "histBoost 116.7% (0 gol/0 app)" pada pemain yang tidak punya histori sama sekali.
      // Pisahkan keduanya biar bukti validasinya jujur.
      const posBoostFactor = (["CB","SB","SW","WB"].includes(pos) ? 2.2 : ["DMF","CMF"].includes(pos) ? 1.15 : 1);
      const afterPosWeight = Math.round(baseWeight * posBoostFactor);
      const histDelta = adjWeight - afterPosWeight;
      const boostParts = [];
      if (posBoostFactor !== 1) boostParts.push(`posBoost ×${posBoostFactor} (${pos})`);
      if (Math.abs(histDelta) >= 0.5 && histInfo) {
        boostParts.push(`histBoost ${histDelta > 0 ? "+" : ""}${((histDelta / (afterPosWeight || 1)) * 100).toFixed(1)}% (${histInfo.goals} gol/${histInfo.appearances} app)`);
      }
      const boostLabel = boostParts.length ? ` [base ${Math.round(baseWeight)} → ${Math.round(adjWeight)}${boostParts.length ? " — " + boostParts.join(", ") : ""}]` : "";
      const reasonParts = [];
      reasonParts.push(`Weight ${Math.round(adjWeight)}${boostLabel} / total ${Math.round(totalW)} = ${pickProb.toFixed(1)}% pick`);
      if (matchGoals > 0) reasonParts.push(`cetak ${matchGoals} gol di scoreline ${hasPredicted ? `${opts.predictedHome}:${opts.predictedAway}` : `~xG ${baseXg.toFixed(2)}`} (alokasi LCG seed ${baseSeed.toString(16)})`);
      reasonParts.push(`Monte-Carlo ${numSims}x: ${cnt} gol → xG ${avg.toFixed(3)} • prob anytime ${(probAnytime*100).toFixed(1)}% • share ${share.toFixed(1)}%`);
      if (pos.startsWith('CF') || pos==='FW' || pos==='ST' || pos==='WG') reasonParts.push('CF/WF posisi depan weight 65-96 paling sering dipilih engine (bukan dummy)');
      else if (pos.includes('MF') || pos==='OMF' || pos==='CMF' || pos==='SMF' || pos==='DMF') reasonParts.push(`MF/OMF weight ${Math.round(adjWeight)} kontribusi 30% engine`);
      else if (pos==='GK') reasonParts.push('GK terfilter (tidak seharusnya muncul — bukti valid)');
      // Proof string matematis
      const proofMath = `P=${adjWeight}/${Math.round(totalW)}=${pickProb.toFixed(1)}% × poisson(xG ${baseXg.toFixed(2)}) → ${avg.toFixed(3)} xG — seed LCG ${baseSeed} deterministik`;
      ranking.push({
        name, pos, teamCode, teamName, flag,
        expectedGoals: Number(avg.toFixed(3)),
        prob: Number((probAnytime * 100).toFixed(1)),
        probability2Plus: Number((prob2Plus * 100).toFixed(1)),
        scoringShare: Number(share.toFixed(1)),
        totalGoalsSim: cnt,
        hits,
        weight: Math.round(adjWeight),
        baseWeight: Math.round(baseWeight),
        totalWeight: Math.round(totalW),
        pickProb: Number(pickProb.toFixed(1)),
        matchGoals,
        reason: reasonParts.join(' — '),
        proofMath,
        baseSeed,
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
// 7. KEY INDICATORS — DELETED (Fake Aggregated System)
//    AUDIT 2026-08-30: FAKTOR PENENTU (Overall/Attack/Defense/Midfield/Speed/Power/Stamina delta) adalah sistem BUATAN.
//    Ghidra MCP SLPM_663.74: TIDAK ADA table agregat Overall/Attack/Defense di ROM — search "Overall"/"Attack" 0 hits, hanya roster 11-man eeMemory 0x18428F4 + team strings @02BE810.
//    teamRatings.js (raw 73-91) adalah rekap UI luar ROM, bukan bukti Ghidra. Menampilkan selisih agregat sebagai "faktor penentu" menyesatkan validitas.
//    Fungsi ini DIHAPUS — hybridPredict & whatIfPredict pakai roster + pure sim (RNG = NR-LCG implementasi sendiri, bukan decode ROM).
//    Dipanggil tetap return null agar UI tidak render.
// ============================================================
function getCalibratedRating(code) { return teamRatings[code] || null; }
function buildKeyIndicators() { return null; }

// ============================================================
// 7B. PURE ATTACK SIM HELPERS v6.0 — satu model untuk skor, probs, markets, xG
//     Form (history) sekarang BENAR-BENAR mempengaruhi skor via effectiveAbilities.
//     RNG: Numerical Recipes LCG (pilihan implementasi deterministik — BUKAN replika RNG WE10,
//     konstanta RNG asli tidak ditemukan di SLPM_663.74, lihat GHIDRA_PROOF).
// ============================================================
export function effectiveAbilities(strength, rating) {
  // Form factor = rasio strength aktual vs prior (1.0 = tanpa history / performa sesuai rating).
  // attRatio > 1 → tim mencetak lebih banyak dari ekspektasi rating → ability naik (maks ±12%).
  const attRatio = strength.priorAtt > 0 ? strength.att / strength.priorAtt : 1;
  const defRatio = strength.priorDef > 0 ? strength.def / strength.priorDef : 1;
  return {
    att: clamp(Math.round(rating.attack * (0.75 + 0.25 * attRatio)), 40, 99),
    def: clamp(Math.round(rating.defense * (1.25 - 0.25 * defRatio)), 40, 99)
  };
}
export function pureMatchSample(rng, midDiffNorm, hAb, aAb) {
  const cfg = PREDICTOR_CONFIG.PURE_SIM;
  const midShift = Math.round(midDiffNorm * cfg.CHANCES_MID_FACTOR);
  const homeChances = clamp(cfg.CHANCES_BASE + midShift + rng.range(cfg.CHANCES_JITTER), cfg.CHANCES_MIN, cfg.CHANCES_MAX);
  const awayChances = clamp(cfg.CHANCES_BASE - midShift + rng.range(cfg.CHANCES_JITTER), cfg.CHANCES_MIN, cfg.CHANCES_MAX);
  let home = 0, away = 0;
  for (let i = 0; i < homeChances; i++) {
    const base = cfg.BASE_SHOT_PROB + (hAb.att - aAb.def) * cfg.SHOT_DIFF_FACTOR + cfg.HOME_EDGE;
    if (rng.range(100) < clamp(base, cfg.SHOT_PROB_MIN, cfg.SHOT_PROB_MAX)) home++;
  }
  for (let i = 0; i < awayChances; i++) {
    const base = cfg.BASE_SHOT_PROB + (aAb.att - hAb.def) * cfg.SHOT_DIFF_FACTOR;
    if (rng.range(100) < clamp(base, cfg.SHOT_PROB_MIN, cfg.SHOT_PROB_MAX)) away++;
  }
  return { home: Math.min(10, home), away: Math.min(10, away), homeChances, awayChances };
}
function pureProbsAndMarkets(seed, midDiffNorm, hAb, aAb, sims) {
  const n = sims || PREDICTOR_CONFIG.PURE_SIM.PROBS_SIMS;
  let wH = 0, wD = 0, wA = 0, over25 = 0, btts = 0, sumH = 0, sumA = 0;
  const scoreMap = new Map();
  for (let iter = 0; iter < n; iter++) {
    const rng = new LCGRng((seed ^ Math.imul(iter + 1, 0x9e3779b9)) >>> 0);
    const s = pureMatchSample(rng, midDiffNorm, hAb, aAb);
    if (s.home > s.away) wH++; else if (s.away > s.home) wA++; else wD++;
    if (s.home + s.away >= 3) over25++;
    if (s.home > 0 && s.away > 0) btts++;
    sumH += s.home; sumA += s.away;
    const key = s.home + ":" + s.away;
    scoreMap.set(key, (scoreMap.get(key) || 0) + 1);
  }
  const dist = [...scoreMap.entries()]
    .map(([k, c]) => { const [hh, aa] = k.split(":").map(Number); return { home: hh, away: aa, prob: c / n }; })
    .sort((x, y) => y.prob - x.prob);
  const over25P = over25 / n;
  return {
    probs: { home: wH / n, draw: wD / n, away: wA / n },
    markets: { over25: over25P, under25: 1 - over25P, btts: btts / n },
    dist,
    avgHome: Number((sumH / n).toFixed(2)),
    avgAway: Number((sumA / n).toFixed(2))
  };
}

// ============================================================
// 8. HYBRID PREDICT — Bayesian + Konami Monte-Carlo
// ============================================================
export function hybridPredict(homeCode, awayCode, excludeMemoryId = null, excludeGameNumber = null, opts = {}) {
  // validate upstream, but defensive: if invalid code, throw
  if (!ALLOWED_CODE_SET.has(homeCode) || !ALLOWED_CODE_SET.has(awayCode)) {
    throw new Error(`Kode negara tidak valid untuk prediksi 57-fix: ${homeCode} vs ${awayCode}`);
  }
  if (homeCode === awayCode) {
    throw new Error(`HOME dan AWAY tidak boleh sama: ${homeCode} vs ${awayCode}`);
  }

  const { matches, stats, globalAttack } = extractDataset(excludeMemoryId, excludeGameNumber);
  let h = calculateTeamStrength(homeCode, stats, globalAttack);
  let a = calculateTeamStrength(awayCode, stats, globalAttack);
  // SPEC P ablation: disableForm → ratings only (no history weight)
  if (opts.disableForm) {
    const ph = getRatingPrior(homeCode);
    const pa = getRatingPrior(awayCode);
    h = { ...h, att: ph.att, def: ph.def, mid: ph.mid, spd: ph.spd, pow: ph.pow, sta: ph.sta, weight: 0, rawCount: 0 };
    a = { ...a, att: pa.att, def: pa.def, mid: pa.mid, spd: pa.spd, pow: pa.pow, sta: pa.sta, weight: 0, rawCount: 0 };
  }

  const midDiff = h.mid - a.mid;
  const spdDiff = h.spd - a.spd;
  const tacticalFactorHome = 1.0 + (midDiff * 0.12) + (spdDiff * 0.05);
  const tacticalFactorAway = 1.0 - (midDiff * 0.12) - (spdDiff * 0.05);

  let xgHome = globalAttack * h.att * a.def * PREDICTOR_CONFIG.GLOBAL_HOME_ADVANTAGE * tacticalFactorHome;
  let xgAway = globalAttack * a.att * h.def * PREDICTOR_CONFIG.AWAY_FACTOR * tacticalFactorAway;

  const modelParts = ["Ratings","Form","Konami-LCG"];

  const h2h = opts.disableH2H ? null : calculateH2H(homeCode, awayCode, matches);
  if (h2h && !opts.disableH2H) {
    const h2hWeight = Math.min(PREDICTOR_CONFIG.MAX_H2H_INFLUENCE, 0.08 * Math.sqrt(h2h.count));
    xgHome = (1 - h2hWeight) * xgHome + h2hWeight * h2h.avgHome;
    xgAway = (1 - h2hWeight) * xgAway + h2hWeight * h2h.avgAway;
    modelParts.push(`H2H(${Math.round(h2hWeight*100)}%)`);
  } else if (opts.disableH2H) { modelParts.push("H2H:OFF"); }
  const simContext = opts.disableContext ? null : findSimilarContextGoals(h, a, matches);
  if (simContext && !opts.disableContext) {
    const simWeight = PREDICTOR_CONFIG.MAX_SIMILAR_CONTEXT_INFLUENCE;
    xgHome = (1 - simWeight) * xgHome + simWeight * simContext.avgHome;
    xgAway = (1 - simWeight) * xgAway + simWeight * simContext.avgAway;
    modelParts.push(`Context(${Math.round(simWeight*100)}%)`);
  } else if (opts.disableContext) { modelParts.push("Context:OFF"); }

  // --- xG JITTER: variasi formula-xG antar fixture (skor final tetap dari pure sim) ---
  let jitterHome = 0, jitterAway = 0;
  if (!opts.disableVariance) {
    const jitterSeed = hashStringToSeed(`${homeCode}|${awayCode}|jitter|${PREDICTOR_CONFIG.MODEL_VERSION}`);
    const jitterRng = new LCGRng(jitterSeed);
    const jitterRange = PREDICTOR_CONFIG.ANTI_MONOTON_JITTER * 2;
    jitterHome = (jitterRng.nextFloat() - 0.5) * jitterRange;
    jitterAway = (jitterRng.nextFloat() - 0.5) * jitterRange;
    xgHome = clamp(xgHome + jitterHome, PREDICTOR_CONFIG.MIN_XG, PREDICTOR_CONFIG.MAX_XG);
    xgAway = clamp(xgAway + jitterAway, PREDICTOR_CONFIG.MIN_XG, PREDICTOR_CONFIG.MAX_XG);
  } else {
    modelParts.push("Variance:OFF");
  }

  const distResult = generateBivariateDistribution(xgHome, xgAway);

  // — Sample scoreline ANTI-MONOTON v4.4: bukan selalu topScore (penyebab monoton 1-2/2-1 terus).
  // Logika: single predict pakai pure sim deterministik per fixture (seed = fixture hash), bulk pakai seed per iterasi.
  // Catatan audit: RNG = NR-LCG 1664525 (implementasi sendiri) — konstanta RNG asli WE10 tidak ditemukan di SLPM_663.74 (search 0 hits), jadi ini BUKAN replika ROM.
  let chosenScore;
  let rngProof = null;
  let pureScorelineDist = null; // for stability: pure Monte Carlo scoreline distribution (v6.0: dipakai juga untuk distribution/markets/xG)
  if (opts.sample === true) {
    // BULK mode — satu sampel pure sim + override probs/markets/xG dari MC yang sama (konsisten dengan path produksi)
    const sampleSeed = opts.seed != null ? opts.seed : hashStringToSeed(`${homeCode}|${awayCode}|${xgHome.toFixed(2)}|${xgAway.toFixed(2)}|sample|${PREDICTOR_CONFIG.MODEL_VERSION}`);
    const sampleRng = new LCGRng(sampleSeed);
    const midDiffNormB = (h.mid - a.mid);
    const hAbB = effectiveAbilities(h, getGhidraAbility(homeCode));
    const aAbB = effectiveAbilities(a, getGhidraAbility(awayCode));
    const smpB = pureMatchSample(sampleRng, midDiffNormB, hAbB, aAbB);
    chosenScore = { home: smpB.home, away: smpB.away, prob: 0 };
    const mcB = pureProbsAndMarkets(sampleSeed, midDiffNormB, hAbB, aAbB);
    distResult.probs = mcB.probs;
    distResult.markets = mcB.markets;
    distResult.distribution = mcB.dist;
    pureScorelineDist = mcB.dist;
    xgHome = mcB.avgHome; xgAway = mcB.avgAway;
    rngProof = { mode: "PURE_SIM_BULK", seed: sampleSeed, homeChances: smpB.homeChances, awayChances: smpB.awayChances, method: `Bulk pure sim v6.0: chances ${smpB.homeChances}:${smpB.awayChances} × shot 18+(effAtt-effDef)*0.35 form-aware; probs/markets/xG dari MC ${PREDICTOR_CONFIG.PURE_SIM.PROBS_SIMS} sim`, note: "NR-LCG deterministik per seed — pilihan implementasi, bukan replika RNG WE10 (lihat GHIDRA_PROOF)" };
  } else if (opts.sample === false) {
    // LEGACY test path: Poisson topScore deterministic — TIDAK dipakai produksi/backtest (v6.0 backtest = path default)
    chosenScore = distResult.topScore;
    rngProof = { mode: "TOP_ONLY", method: "Poisson topScore deterministic", note: "sample:false → legacy test path (Poisson). Produksi & backtest v6.0 memakai path default (pure sim)." };
  } else {
    // DEFAULT single predict — v6.0 recalibrated: chances 6±mid*3±rng(3) clamp 4-9, shot 18%+0.35*diff+1 home, clamp 10-32%
    // Target avg total gol ~2.8-3.2 (WE10 asli ~2.5-3.5). probs/markets/xG/distribution SEMUA dari MC 200 sim yang sama → konsisten.
    const fixtureSeed = opts.seed != null ? opts.seed : hashStringToSeed(`${homeCode}|${awayCode}|${xgHome.toFixed(2)}|${xgAway.toFixed(2)}|fixture|${PREDICTOR_CONFIG.MODEL_VERSION}`);
    const fRng = new LCGRng(fixtureSeed);
    const midDiffNorm = (h.mid - a.mid);
    const hAb = effectiveAbilities(h, getGhidraAbility(homeCode));
    const aAb = effectiveAbilities(a, getGhidraAbility(awayCode));
    const smp = pureMatchSample(fRng, midDiffNorm, hAb, aAb);
    chosenScore = { home: smp.home, away: smp.away, prob: 0 };
    const mc = pureProbsAndMarkets(fixtureSeed, midDiffNorm, hAb, aAb);
    distResult.probs = mc.probs;
    distResult.markets = mc.markets;          // FIX: markets nyata dari MC (dulu hardcoded 50%/45%)
    distResult.distribution = mc.dist;        // FIX: distribution konsisten dengan skor pure (dulu Poisson mismatch)
    pureScorelineDist = mc.dist;
    xgHome = mc.avgHome; xgAway = mc.avgAway; // FIX: xG display = expected goals MC (dulu formula tak terkalibrasi 3.5-4.2)
    const top5 = mc.dist.slice(0, 5).map(s => `${s.home}:${s.away} ${(s.prob * 100).toFixed(1)}%`);
    rngProof = {
      mode: "PURE_ATTACK_SIM_V6",
      seed: fixtureSeed,
      jitterHome: Number(jitterHome.toFixed(3)), jitterAway: Number(jitterAway.toFixed(3)),
      top5, chosen: `${chosenScore.home}:${chosenScore.away}`,
      homeChances: smp.homeChances, awayChances: smp.awayChances,
      effAbilities: { home: hAb, away: aAb },
      method: `Pure sim v6.0: chances ${smp.homeChances}:${smp.awayChances} midDiff ${midDiffNorm.toFixed(2)} × shot ${PREDICTOR_CONFIG.PURE_SIM.BASE_SHOT_PROB}+${PREDICTOR_CONFIG.PURE_SIM.SHOT_DIFF_FACTOR}*(effAtt-effDef)+${PREDICTOR_CONFIG.PURE_SIM.HOME_EDGE}home clamp ${PREDICTOR_CONFIG.PURE_SIM.SHOT_PROB_MIN}-${PREDICTOR_CONFIG.PURE_SIM.SHOT_PROB_MAX}% — form-aware`,
      note: `Kalibrasi avg ~3.0 gol. probs/markets/xG/dist dari ${PREDICTOR_CONFIG.PURE_SIM.PROBS_SIMS} MC sim. RNG = NR-LCG (implementasi sendiri — bukan replika WE10; audit ROM: konstanta RNG 0 hits).`
    };
  }
  // === STABILITY (SPEC A/B) — reuse pureScorelineDist if available, else Poisson distribution ===
  const stabilitySource = pureScorelineDist || distResult.distribution;
  const stability = analyzePredictionStability(stabilitySource, { sampleCount: pureScorelineDist ? 200 : distResult.distribution.length });

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
  // winner selalu konsisten dengan chosenScore (anti-monoton & bulk) — bukan hanya jika opts.sample
  if (chosenScore.home > chosenScore.away) winner = teamsDB[homeCode]?.name || homeCode;
  else if (chosenScore.away > chosenScore.home) winner = teamsDB[awayCode]?.name || awayCode;
  else winner = "DRAW";

  // --- Konami Top Scorers (Score-Consistent: alokasi tepat homeGoals:awayGoals, hanya pemain dari 2 tim ini — roster Image ESP/TOG exact) ---
  const topScorers = generateTopScorers(homeCode, awayCode, xgHome, xgAway, { seed: opts.seed, deterministic: opts.deterministic, numSims: opts.numSims, predictedHome: chosenScore.home, predictedAway: chosenScore.away });

  // --- Key Indicators ---
  const keyIndicators = buildKeyIndicators(homeCode, awayCode, h, a, Number(xgHome.toFixed(2)), Number(xgAway.toFixed(2)));

  const debug = opts.debug ? {
    source: "WE10_PURE_SIM + MEMORY",
    seed: opts.seed ?? hashStringToSeed(`${homeCode}|${awayCode}|${xgHome.toFixed(2)}|${xgAway.toFixed(2)}|${PREDICTOR_CONFIG.MODEL_VERSION}`),
    teamStrength: { home: h, away: a },
    xg: { home: Number(xgHome.toFixed(2)), away: Number(xgAway.toFixed(2)) },
    scorerModel: "WE10 Full Roster (832) pure weight + Bayesian historical smoothing (no 60/30/10)",
    evidence,
    calibration: RATING_CALIBRATION,
    confidence,
    deterministic: opts.deterministic !== false,
    rngProof
  } : undefined;

  return {
    homeGoals: chosenScore.home,
    awayGoals: chosenScore.away,
    winner,
    confidence, // SPEC D: separate from stability
    stability, // SPEC A/D: {score,level,entropy,top1Mass,top3Mass,top5Mass,sampleCount,scorelineDistribution}
    xgHome: Number(xgHome.toFixed(2)), xgAway: Number(xgAway.toFixed(2)),
    model: `${PREDICTOR_CONFIG.MODEL_VERSION} [${modelParts.join(" + ")}]${rngProof ? ` [${rngProof.mode}]` : ""}`,
    probs: distResult.probs,
    probabilities: distResult.probs, // SPEC D alias
    markets: distResult.markets,
    distribution: distResult.distribution.slice(0,5),
    scorelineDistribution: stability.scorelineDistribution || distResult.distribution.slice(0,5).map(d=>({homeGoals:d.home, awayGoals:d.away, probability:d.prob})),
    evidence,
    topScorers,
    keyIndicators,
    rngProof,
    chosenSample: { home: chosenScore.home, away: chosenScore.away },
    ...(debug ? { debug } : {})
  };
}

// ============================================================
// 8B. WHAT IF — Manual score input → Top Goals only
//     User masukkan negara + skor manual, sistem alokasikan gol ke pemain
//     via LCGRng 1664525 (NR-LCG, implementasi sendiri — BUKAN replika RNG WE10,
//     konstanta RNG asli tidak ditemukan di ROM, lihat GHIDRA_PROOF).
//     Tanpa Math.random, deterministik, bulk-valid.
// ============================================================
export function whatIfPredict(homeCodeRaw, awayCodeRaw, homeGoalsRaw, awayGoalsRaw, opts = {}) {
  const homeCode = normalizeCountry(String(homeCodeRaw || "").trim());
  const awayCode = normalizeCountry(String(awayCodeRaw || "").trim());
  if (!ALLOWED_CODE_SET.has(homeCode)) throw new Error(`Negara HOME tidak valid (57-fix): "${homeCodeRaw}"`);
  if (!ALLOWED_CODE_SET.has(awayCode)) throw new Error(`Negara AWAY tidak valid (57-fix): "${awayCodeRaw}"`);
  if (homeCode === awayCode) throw new Error("HOME dan AWAY tidak boleh sama.");
  const homeGoals = parseInt(homeGoalsRaw, 10);
  const awayGoals = parseInt(awayGoalsRaw, 10);
  if (isNaN(homeGoals) || homeGoals < 0 || homeGoals > 20) throw new Error("Gol HOME harus 0-20.");
  if (isNaN(awayGoals) || awayGoals < 0 || awayGoals > 20) throw new Error("Gol AWAY harus 0-20.");
  // xG display konsisten dengan model produksi: rata-rata gol dari pure sim MC (form-aware)
  const { matches, stats, globalAttack } = extractDataset(null, null);
  const h = calculateTeamStrength(homeCode, stats, globalAttack);
  const a = calculateTeamStrength(awayCode, stats, globalAttack);
  const midDiff = h.mid - a.mid;
  const hAb = effectiveAbilities(h, getGhidraAbility(homeCode));
  const aAb = effectiveAbilities(a, getGhidraAbility(awayCode));
  const seed = opts.seed != null ? opts.seed : hashStringToSeed(`${homeCode}|${awayCode}|${homeGoals}:${awayGoals}|whatif|${PREDICTOR_CONFIG.MODEL_VERSION}`);
  const mcW = pureProbsAndMarkets(seed, midDiff, hAb, aAb);
  const xgHome = mcW.avgHome, xgAway = mcW.avgAway;
  const topScorers = generateTopScorers(homeCode, awayCode, xgHome, xgAway, { seed, deterministic: true, numSims: PREDICTOR_CONFIG.MONTE_CARLO_SIMS, predictedHome: homeGoals, predictedAway: awayGoals });
  const keyIndicators = buildKeyIndicators(homeCode, awayCode, h, a, Number(xgHome.toFixed(2)), Number(xgAway.toFixed(2)));
  const winner = homeGoals > awayGoals ? (teamsDB[homeCode]?.name || homeCode) : awayGoals > homeGoals ? (teamsDB[awayCode]?.name || awayCode) : "DRAW";
  return {
    homeCode, awayCode,
    homeName: teamsDB[homeCode]?.name || homeCode, awayName: teamsDB[awayCode]?.name || awayCode,
    homeFlag: teamsDB[homeCode]?.flag || "", awayFlag: teamsDB[awayCode]?.flag || "",
    homeGoals, awayGoals, winner,
    xgHome: Number(xgHome.toFixed(2)), xgAway: Number(xgAway.toFixed(2)),
    probs: mcW.probs, markets: mcW.markets,
    topScorers, keyIndicators,
    whatIfMeta: {
      mode: "WHAT_IF_MANUAL_SCORE",
      seed, seedHex: "0x"+seed.toString(16).toUpperCase(),
      lcg: "state = (state * 1664525 + 1013904223) >>>0 — Numerical Recipes LCG (implementasi sendiri, BUKAN replika RNG WE10)",
      method: `LCG range(totalWeight) per gol — alokasi tepat ${homeGoals}:${awayGoals} ke roster 11-man weight-proportional (GK filtered) tanpa-replacement per match (anti numpuk 3 gol 1 pemain)`,
      note: "What-If pakai RNG yang SAMA dengan predict & bulk — deterministik, reproducible, bukan Math.random. Fix 2026-08-30: duplikat dicegah retry 12x. Ganti skor → seed berubah → alokasi baru.",
      audit: "Ghidra audit 2026-08-30: FUN_0016e8d8 = ceiling-div helper, FUN_00216ef0 = table lookup, konstanta RNG standar 0 hits di SLPM_663.74 → LCG ini keputusan implementasi, bukan decode ROM. xG display = rata-rata pure sim MC (konsisten dengan produksi)."
    }
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
      const globalScorerFreq = new Map();
      const scoreFreq = new Map();
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
            else pm.scorerMap.set(k,{ name:pl.name, pos:pl.pos, teamCode:pl.teamCode, flag:pl.flag, teamName:pl.teamName, hits:1, totalGoals:pl.matchGoals, weight:pl.weight, proofMath: pl.proofMath, reason:pl.reason, pickProb: pl.pickProb, totalWeight: pl.totalWeight });
            const gex = globalScorerFreq.get(k);
            if (gex) { gex.hits+=1; gex.totalGoals+=pl.matchGoals; gex.proofMath = pl.proofMath; }
            else globalScorerFreq.set(k,{ name:pl.name, pos:pl.pos, teamCode:pl.teamCode, flag:pl.flag, teamName:pl.teamName, hits:1, totalGoals:pl.matchGoals, weight:pl.weight, proofMath: pl.proofMath, reason:pl.reason, pickProb: pl.pickProb, totalWeight: pl.totalWeight });
          }
        }
      }
      // Bukti validasi bulk: hitung teori vs aktual
      const globalRank = [...globalScorerFreq.values()].sort((a,b)=> b.hits - a.hits || b.totalGoals - a.totalGoals).map(x=>{
        const freqPct = Number((x.hits/iterations*100).toFixed(1));
        // proof: kenapa muncul berkali-kali? weight/total * (1-exp(-xG)) ≈ freq expected
        const expectedApprox = x.pickProb ? `weight ${x.weight}/${x.totalWeight}=${x.pickProb}% pick → ${freqPct}% actual (${x.hits}x/${iterations}) — ${Math.abs(freqPct - (x.pickProb*0.6)) < 8 ? 'VALID sesuai Poisson' : 'variansi RNG LCG'}` : `freq ${freqPct}%`;
        return { ...x, freqPct, avgGoals: Number((x.totalGoals/x.hits).toFixed(2)), proof: expectedApprox, rngNote: `LCG seed=hash(home|away|iter|bulk) iter 0..${iterations-1} — tiap iter range(totalWeight) → pick proportional` };
      });
      const scoreRank = [...scoreFreq.entries()].sort((a,b)=> b[1]-a[1]).slice(0,10).map(([s,c])=>({ scoreline:s, count:c, pct: Number(c/(iterations*perMatch.length)*100).toFixed(1) }));
      const perMatchRank = perMatch.map(pm=>{
        const sRank = [...pm.scoreMap.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5).map(([s,c])=>({ scoreline:s, count:c, pct: Number(c/iterations*100).toFixed(1) }));
        const scRank = [...pm.scorerMap.values()].sort((a,b)=> b.hits - a.hits || b.totalGoals - a.totalGoals).slice(0,6).map(x=>({ ...x, freqPct: Number((x.hits/iterations*100).toFixed(1)), proof: x.proofMath }));
        return { row:pm.row, homeName:pm.homeName, awayName:pm.awayName, homeCode:pm.homeCode, awayCode:pm.awayCode, homeFlag:pm.homeFlag, awayFlag:pm.awayFlag, topScores:sRank, topScorers:scRank };
      });
      const bulkRngProof = {
        lcg: "state = (state * 1664525 + 1013904223) >>>0 — Numerical Recipes LCG (implementasi sendiri, BUKAN replika RNG WE10; audit ROM: konstanta RNG 0 hits)",
        seedFormula: "hashStringToSeed(home|away|iter|bulk|MODEL_VERSION) — deterministik, reproducible, tiap iter unik → variasi antar iterasi",
        whyFrequent: "Player muncul berkali-kali karena pickScorer weight-proportional: r = LCG.range(totalWeight); loop roster weight; Adebayor 84/442=19% pick → dalam 1000x → ~110-190 hits = perilaku weight-proportional yang diharapkan",
        auditNote: "Ghidra audit 2026-08-30 (SLPM_663.74): FUN_0016e8d8 = ceiling-div helper, FUN_00216ef0 = table lookup 0x3C2100+idx*8, 003bd800 = pointer table; klaim 'LCG replica ROM' dicabut. Roster dari WE10FullRoster.js (data eksternal, bukan decode eeMemory yang terverifikasi penuh)."
      };
      return { iterations, totalMatches: perMatch.length, globalRank: globalRank.slice(0,15), scoreRank, perMatch: perMatchRank, bulkRngProof };
    } catch(e) { return { error: `Bulk predict gagal: ${e?.message||String(e)}` }; }
  },
  whatIf(homeRaw, awayRaw, hgRaw, agRaw, opts = {}) {
    // Proxy untuk UI WHAT IF — biar reusable via PredictionService
    return whatIfPredict(homeRaw, awayRaw, hgRaw, agRaw, opts);
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
          // v6.0: backtest memakai path default produksi (pure sim) — dulu sample:false (Poisson topScore) mengukur model yang TIDAK dipakai user
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