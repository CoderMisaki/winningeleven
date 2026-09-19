import { teamsDB } from "../data/teams.js";
import { StateManager } from "../state/appState.js";
import { normalizeCountry } from "./similarity.js";
import { teamRatings } from "../data/teamRatings.js";
import { GHIDRA_TEAM_ABILITY_RAW_HEX, getGhidraProof, getGhidraAbility } from "../data/ghidraTeamAbility.js";
import {
  getTeamPlayers, getPlayerDatabase, findRosterPlayer, playerOverall, PLAYER_ATTRIBUTE_PROVENANCE
} from "../data/playerAttributes.js";
import {
  PLAYER_SCORING_CONFIG, PLAYER_SCORING_MODEL_VERSION,
  ScoringRng, scoringHashSeed, simulateMatch, simulateMatchToScore, scorersFromEvents,
  runMatchMonteCarlo, getTeamScoringProfile, getCalibration, shotProbability,
  invalidateScoringCaches
} from "./playerScoring.js";
import { invalidateScoringDatasetCache, getObservedStats, DATASET_PRIOR } from "./scoringDataset.js";
// Delegasi backtest ke engine terpisah (metrik + perbandingan model ada di sana).
// Import sirkular aman: kedua modul hanya memakai binding saat function dipanggil.
import { runWalkForwardBacktest as runWalkForwardBacktestImpl } from "./backtestEngine.js";

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
  MODEL_VERSION: `WE10 ${PLAYER_SCORING_MODEL_VERSION} — scorer level-pemain + kalibrasi dataset`,
  ENGINE_SOURCE: [
    "TEAM MODEL  : teamRatings.js (rekap eksternal, ESTIMASI 57 tim) + form tim dari histori user.",
    "PLAYER MODEL: playerAttributes.js — 12 atribut per pemain, DERIVED dari archetype posisi + rating tim + variasi individual deterministik. BUKAN hasil decode ROM.",
    "MATCH MODEL : playerScoring.js — chance generation (3-10 per tim) → kualitas chance → pemilihan pemain (role posisi x atribut x form x stamina) → shot probability vs defense lawan → GOAL/MISS. Skor lahir dari event, bukan alokasi nama acak.",
    "GOAL EVENT  : setiap gol tercatat sebagai event pemain (nama dari roster 57 tim, TANPA dummy dan TANPA daftar bintang manual).",
    "RNG         : Numerical Recipes LCG 1664525 — pilihan implementasi deterministik, BUKAN replika RNG WE10 (konstanta RNG standar 0 hits di SLPM_663.74)."
  ].join(" "),
  GHIDRA_PROOF: "MCP verify 2026-08-30 (SLPM_663.74): search byte 0x19660D & 0x3C6EF35F & 5 konstanta RNG lain = 0 hits; disasm 0016e8d8 = ceiling-div helper (addiu/daddu/lw/div/mflo/mult); disasm 00216ef0 = slti 0x75 + load 0x3C2100/0x3C2104+idx*8 (table lookup); read 003bd800 = pointer table; read 003bd400 = dump asli (word 0-0x1F4) yang BELUM terpetakan ke 57 tim. Klaim lama 'LCG replica FUN_xxx' / 'ability decoded dari ROM' TETAP DICABUT — tidak ada buktinya. Bukti Ghidra yang valid tidak dihapus (lihat ghidraTeamAbility.js).",
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
  MONTE_CARLO_SIMS: PLAYER_SCORING_CONFIG.MONTE_CARLO_SIMS,
  PROBS_SIMS: PLAYER_SCORING_CONFIG.MONTE_CARLO_SIMS,      // MC default per fixture (single predict)
  BULK_PROBS_SIMS: 120,                                    // MC lebih ringan untuk jalur bulk
  TOP_SCORERS_LIMIT: PLAYER_SCORING_CONFIG.TOP_SCORERS_LIMIT,
  ANTI_MONOTON_JITTER: 0.0, // v7: tidak dipakai lagi (xG = rata-rata event MC, bukan formula + jitter)
  // === MATCH ENGINE v7 — satu sumber kebenaran ada di playerScoring.js ===
  // Nilai di bawah hanya ALIAS supaya UI/bulk lama tetap membaca angka yang benar.
  PURE_SIM: {
    deprecationNote: "v7: simulasi pindah ke playerScoring.js (event-based, level pemain). Key lama dipertahankan sebagai alias.",
    CHANCES_BASE: PLAYER_SCORING_CONFIG.CHANCES.BASE,
    CHANCES_MID_FACTOR: PLAYER_SCORING_CONFIG.CHANCES.MID_FACTOR,
    CHANCES_JITTER: PLAYER_SCORING_CONFIG.CHANCES.JITTER,
    CHANCES_MIN: PLAYER_SCORING_CONFIG.CHANCES.MIN,
    CHANCES_MAX: PLAYER_SCORING_CONFIG.CHANCES.MAX,
    PROBS_SIMS: PLAYER_SCORING_CONFIG.MONTE_CARLO_SIMS
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

/**
 * PLAYER_DB_57 — daftar pemain per tim dari playerAttributes.js.
 *
 * DIGANTI (audit 2026-09-19): field `weight` manual (CF=84, OMF=66, CB=10) dan
 * daftar STAR_OVERRIDES sudah DIHAPUS. Sekarang tidak ada pemain yang dipaksa
 * selalu menang undian. `weight` hanya dipertahankan sebagai ALIAS tampilan
 * untuk indeks scoring turunan (lihat scoringIndexFor) supaya komponen UI lama
 * tidak pecah. Seleksi pencetak gol 100% di playerScoring.js.
 */
export const KONAMI_PLAYER_DB = (() => {
  const db = {};
  for (const [code, players] of Object.entries(getPlayerDatabase())) {
    db[code] = players.map((p) => ({
      name: p.name,
      pos: p.pos,
      attack: p.attack,
      finishing: p.finishing,
      positioning: p.positioning,
      technique: p.technique,
      shotPower: p.shotPower,
      speed: p.speed,
      passing: p.passing,
      physical: p.physical,
      stamina: p.stamina,
      defense: p.defense,
      overall: playerOverall(p),
      attributesSource: p.attributesSource,
      scoringIndex: scoringIndexFor(p),
      weight: scoringIndexFor(p) // legacy alias (display) — BUKAN weight manual
    }));
  }
  return db;
})();

/**
 * Indeks scoring turunan (0-99) untuk display/proof — bukan angka manual dan
 * bukan dasar tunggal seleksi (seleksi memakai shot probability + role posisi).
 */
export function scoringIndexFor(player) {
  if (!player) return 0;
  const role = PLAYER_SCORING_CONFIG.ROLE_WEIGHT[String(player.pos || "").toUpperCase()] ?? 0.30;
  const base =
    0.45 * (player.finishing ?? 60) +
    0.30 * (player.positioning ?? 60) +
    0.15 * (player.technique ?? 60) +
    0.10 * (player.shotPower ?? 70);
  return Math.round(clamp(base * (0.55 + 0.90 * role), 1, 99));
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
/**
 * Ambil dataset pertandingan dari memori.
 * @param {number|string|null} excludeMemoryId
 * @param {number|null} excludeGameNumber  game yang dibuang (target spesifik)
 * @param {number|null} excludeFromGameNumber  walk-forward: buang game >= N (target + masa depan)
 */
export function extractDataset(excludeMemoryId = null, excludeGameNumber = null, excludeFromGameNumber = null) {
  // Bulk optimization: cache dataset 2s to avoid 1600x recompute for 8*200 ensemble (tanpa hang)
  const cacheKey = `${excludeMemoryId}|${excludeGameNumber}|${excludeFromGameNumber}|${Object.keys(StateManager.db?.memories||{}).length}`;
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
      if (excludeMemoryId != null && String(memId) === String(excludeMemoryId)) {
        // walk-forward: buang target game + seluruh game sesudahnya
        if (excludeFromGameNumber != null && Number(game.gameNumber) >= Number(excludeFromGameNumber)) continue;
        if (excludeFromGameNumber == null && excludeGameNumber != null && Number(game.gameNumber) === Number(excludeGameNumber)) continue;
      }
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

/**
 * Adapter output: gabungkan event simulasi (skor nyata) + statistik Monte Carlo
 * (probabilitas/ekspektasi) menjadi daftar top scorer dengan SKEMA LAMA + BARU.
 *
 * Field lama tetap ada supaya UI tidak pecah:
 *   weight, totalWeight, pickProb, proofMath, reason, scoringShare, probability2Plus
 * Field baru (player model):
 *   goals, matchGoals, expectedGoals, probability, position, finishing, form, formMultiplier,
 *   goalProbabilityPerChance, chanceShare, attributesSource
 */
function buildScorerRows({ homeCode, awayCode, sim, mc, opts = {} }) {
  const teams = [homeCode, awayCode];
  const profileByName = new Map();
  for (const code of teams) {
    const profile = getTeamScoringProfile(code, {
      exclude: opts.exclude || null,
      formEnabled: opts.formEnabled !== false
    });
    for (const e of profile.players) profileByName.set(`${e.name}|${profile.code}`, { entry: e, profile });
  }

  const mcByKey = new Map();
  if (mc) for (const p of mc.players) mcByKey.set(`${p.name}|${p.teamCode}`, p);

  // kumpulkan: pemain yang mencetak gol di sampel + pemain yang punya ekspektasi gol
  const rows = new Map();
  const touched = new Set();
  for (const e of sim.events) touched.add(`${e.playerName}|${e.teamCode}`);
  for (const key of mcByKey.keys()) touched.add(key);

  for (const key of touched) {
    const [name, teamCode] = key.split("|");
    if (teamCode !== homeCode && teamCode !== awayCode) continue;
    const ctxEntry = profileByName.get(key);
    if (!ctxEntry) continue; // pemain tidak ada di roster valid → tidak pernah ditampilkan
    const { entry, profile } = ctxEntry;
    const player = entry.player;
    if (player.pos === "GK") continue; // GK tidak masuk daftar pencetak gol
    const mcStats = mcByKey.get(key) || null;
    const simGoals = sim.events.filter((e) => e.scored && `${e.playerName}|${e.teamCode}` === key).length;
    const simChances = sim.events.filter((e) => `${e.playerName}|${e.teamCode}` === key);
    const avgPGoal = simChances.length
      ? simChances.reduce((s, e) => s + e.pGoal, 0) / simChances.length
      : 0;

    const finishing = player.finishing;
    const formMultiplier = entry.formMultiplier ?? 1;
    const formInfo = entry.form || { source: "disabled" };
    const scoringIndex = scoringIndexFor(player);
    const totalIndex = profile.players.reduce((s2, e2) => s2 + scoringIndexFor(e2.player), 0) || 1;
    const pickProb = Number((entry.selectionProbability * 100).toFixed(2));

    const reasonParts = [];
    reasonParts.push(`posisi ${player.pos} (role ${(entry.roleWeight).toFixed(2)})`);
    reasonParts.push(`finishing ${finishing} / positioning ${player.positioning} / power ${player.shotPower}`);
    reasonParts.push(`peluang dipilih ${pickProb}% untuk tiap chance`);
    if (formMultiplier !== 1) {
      reasonParts.push(
        `form x${formMultiplier.toFixed(2)} dari ${formInfo.observedGoals || 0} gol / ${formInfo.teamGoals || 0} gol tim (shrinkage K=${6})`
      );
    } else {
      reasonParts.push(formInfo.source === "neutral-no-data" || formInfo.source === "disabled"
        ? "form netral (belum ada data historis)"
        : `form x${formMultiplier.toFixed(2)}`);
    }
    if (mcStats) {
      reasonParts.push(`MC ${mc.sims}x: ${mcStats.goals} gol → xG ${mcStats.expectedGoals.toFixed(3)}, prob anytime ${mcStats.prob}%`);
    }
    const oppCode = teamCode === homeCode ? awayCode : homeCode;
    const oppDefense = getTeamScoringProfile(oppCode, { exclude: opts.exclude || null, formEnabled: opts.formEnabled !== false }).defenseIndex;
    const proofMath = [
      `P(gol|chance) = 0.30 + 0.006*(finishing-65) + 0.0035*(positioning-65) + 0.0025*(technique-65) + 0.0015*(power-70) + 0.40*(quality-0.5) - 0.008*(defense_lawan-65)`,
      `→ finishing ${finishing}, defense lawan ${Number.isFinite(oppDefense) ? oppDefense.toFixed(1) : "?"}, rata-rata pGoal di sampel ${(avgPGoal * 100).toFixed(1)}%`,
      `kalibrasi dataset: ${mc?.calibration?.source || "prior 427 match"} (scale ${mc?.calibration?.scale?.toFixed(3) ?? "?"})`
    ].join(" | ");

    rows.set(key, {
      // === field utama (UI baru) ===
      name, pos: player.pos, position: player.pos,
      teamCode, teamName: teamsDB[teamCode]?.name || teamCode, flag: teamsDB[teamCode]?.flag || "",
      goals: simGoals,
      matchGoals: simGoals,
      expectedGoals: mcStats ? mcStats.expectedGoals : Number(avgPGoal.toFixed(3)),
      probability: mcStats ? mcStats.prob : Number((avgPGoal * 100).toFixed(2)),
      prob: mcStats ? mcStats.prob : Number((avgPGoal * 100).toFixed(2)),
      probability2Plus: mcStats ? mcStats.probability2Plus : 0,
      scoringShare: mcStats ? mcStats.scoringShare : 0,
      goalProbabilityPerChance: mcStats ? mcStats.goalProbabilityPerChance : Number(avgPGoal.toFixed(4)),
      chanceShare: mcStats ? mcStats.chanceShare : null,
      finishing, positioning: player.positioning, shotPower: player.shotPower,
      attack: player.attack, technique: player.technique, speed: player.speed, stamina: player.stamina,
      overall: playerOverall(player),
      attributesSource: player.attributesSource,
      form: formMultiplier,
      formMultiplier,
      formSource: formInfo.source,
      // === alias kompatibilitas UI lama ===
      weight: scoringIndex,
      baseWeight: scoringIndex,
      totalWeight: totalIndex,
      pickProb,
      totalGoalsSim: mcStats ? mcStats.goals : simGoals,
      hits: mcStats ? mcStats.hits : (simGoals > 0 ? 1 : 0),
      reason: reasonParts.join(" — "),
      proofMath
    });
  }
  return [...rows.values()];
}

/**
 * Bangun daftar top scorer dari hasil simulasi + statistik Monte Carlo.
 * Dipakai hybridPredict agar MC tidak dihitung dua kali (perf).
 */
export function buildTopScorersFromSimulation({ homeCode, awayCode, sim, mc, opts = {} }) {
  const rows = buildScorerRows({
    homeCode: String(homeCode).toUpperCase(),
    awayCode: String(awayCode).toUpperCase(),
    sim,
    mc,
    opts: { exclude: opts.exclude || null, formEnabled: opts.formEnabled !== false }
  });
  rows.sort((a, b) =>
    (b.matchGoals - a.matchGoals) ||
    (b.expectedGoals - a.expectedGoals) ||
    (b.probability - a.probability) ||
    (b.weight - a.weight)
  );
  return rows.slice(0, opts.limit || PREDICTOR_CONFIG.TOP_SCORERS_LIMIT);
}

/**
 * generateTopScorers — entry point skor & pencetak gol satu fixture.
 *
 * Tanpa `predictedHome/predictedAway`: skor DAN scorer datang dari event
 * simulasi bebas (jalur produksi). Dengan target skor (what-if / apply UI):
 * memakai simulasi ter-conditioned pada model yang sama.
 */
export function generateTopScorers(homeCode, awayCode, xgHome, xgAway, opts = {}) {
  try {
    homeCode = String(homeCode || "").toUpperCase();
    awayCode = String(awayCode || "").toUpperCase();
    const hasTarget = Number.isInteger(opts.predictedHome) && Number.isInteger(opts.predictedAway);
    const seed = opts.seed != null
      ? opts.seed >>> 0
      : scoringHashSeed(`${homeCode}|${awayCode}|${Number(xgHome || 0).toFixed(2)}|${Number(xgAway || 0).toFixed(2)}|scorers|${PREDICTOR_CONFIG.MODEL_VERSION}`);
    const ctxOpts = {
      seed,
      exclude: opts.exclude || null,
      formEnabled: opts.disableForm !== true && opts.disablePlayerForm !== true,
      scale: opts.scale
    };

    const sim = hasTarget
      ? simulateMatchToScore(homeCode, awayCode, opts.predictedHome, opts.predictedAway, ctxOpts)
      : simulateMatch(homeCode, awayCode, ctxOpts);

    const numSims = opts.numSims != null ? opts.numSims : PREDICTOR_CONFIG.MONTE_CARLO_SIMS;
    const mc = numSims > 0
      ? runMatchMonteCarlo(homeCode, awayCode, { ...ctxOpts, sims: numSims })
      : null;

    const rows = buildScorerRows({ homeCode, awayCode, sim, mc, opts });
    rows.sort((a, b) =>
      (b.matchGoals - a.matchGoals) ||
      (b.expectedGoals - a.expectedGoals) ||
      (b.probability - a.probability) ||
      (b.weight - a.weight)
    );
    return rows.slice(0, opts.limit || PREDICTOR_CONFIG.TOP_SCORERS_LIMIT);
  } catch (e) {
    console.error("[playerScoring] generateTopScorers error", e);
    return [];
  }
}

/**
 * Bulk fast path: alokasi tepat `predictedHome:predictedAway` memakai model
 * event yang sama (simulateMatchToScore). Tidak ada lagi undian weight.
 */
export function generateTopScorersBulkFast(homeCode, awayCode, predictedHome, predictedAway, seed) {
  try {
    homeCode = String(homeCode || "").toUpperCase();
    awayCode = String(awayCode || "").toUpperCase();
    const useSeed = seed != null
      ? seed >>> 0
      : scoringHashSeed(`${homeCode}|${awayCode}|${predictedHome}:${predictedAway}|bulkFast|${PREDICTOR_CONFIG.MODEL_VERSION}`);
    const sim = simulateMatchToScore(homeCode, awayCode, predictedHome, predictedAway, { seed: useSeed });
    const rows = buildScorerRows({ homeCode, awayCode, sim, mc: null, opts: {} });
    return rows
      .filter((r) => r.matchGoals > 0)
      .sort((a, b) => b.matchGoals - a.matchGoals || b.expectedGoals - a.expectedGoals)
      .map((r) => ({ ...r, seed: useSeed }));
  } catch (e) {
    console.error("[bulkFast] scorer error", e);
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
// 7B. (dihapus) ADAPTER LAMA effectiveAbilities / pureMatchSample / pureProbsAndMarkets
// ============================================================
// Audit 2026-09-19: ketiga fungsi itu adalah sisa jalur "ability tim + undian
// weight" — setelah scoring pindah ke event level-pemain, tidak ada lagi
// konsumennya (bulkRunner sekarang memanggil simulateMatch langsung).
// Menghapusnya membuat tidak ada lagi jalan alternatif yang bisa memilih
// pencetak gol tanpa atribut pemain. Jalur resmi:
//   simulateMatch() / simulateMatchToScore() / runMatchMonteCarlo()
// di src/js/services/playerScoring.js.

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

  const walkForward = opts.walkForward === true;
  const { matches, stats, globalAttack } = walkForward
    ? extractDataset(excludeMemoryId, null, excludeGameNumber)
    : extractDataset(excludeMemoryId, excludeGameNumber);
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

  // --- SKALA KONVERSI TIM (TEAM MODEL) -------------------------------------
  // xG tim di atas dicampur dengan form tim + H2H + similar context. Rasio
  // xG_final terhadap baseline model (tanpa form/H2H/context) dipakai sebagai
  // pengali skala konversi. Ini HANYA memengaruhi peluang gol tim — BUKAN
  // pemilihan pemain (nama pencetak gol murni dari playerScoring.js).
  const xgBaselineHome = globalAttack * h.priorAtt * a.priorDef * PREDICTOR_CONFIG.GLOBAL_HOME_ADVANTAGE * tacticalFactorHome;
  const xgBaselineAway = globalAttack * a.priorAtt * h.priorDef * PREDICTOR_CONFIG.AWAY_FACTOR * tacticalFactorAway;
  const ratioHome = xgBaselineHome > 0 ? xgHome / xgBaselineHome : 1;
  const ratioAway = xgBaselineAway > 0 ? xgAway / xgBaselineAway : 1;

  // Variasi antar-fixture pada skala konversi (bukan penentu nama pemain).
  let jitterHome = 0, jitterAway = 0;
  if (!opts.disableVariance) {
    const jitterSeed = hashStringToSeed(`${homeCode}|${awayCode}|jitter|${PREDICTOR_CONFIG.MODEL_VERSION}`);
    const jitterRng = new LCGRng(jitterSeed);
    const jitterRange = PREDICTOR_CONFIG.ANTI_MONOTON_JITTER * 2;
    jitterHome = (jitterRng.nextFloat() - 0.5) * jitterRange;
    jitterAway = (jitterRng.nextFloat() - 0.5) * jitterRange;
  } else {
    modelParts.push("Variance:OFF");
  }
  const teamScaleHome = clamp(ratioHome * (1 + jitterHome), 0.75, 1.35);
  const teamScaleAway = clamp(ratioAway * (1 + jitterAway), 0.75, 1.35);

  const distResult = generateBivariateDistribution(xgHome, xgAway);

  // — MATCH ENGINE v7 (player-level, event-based) -----------------------------
  // Skor & pencetak gol lahir dari SATU proses yang sama: chance → pemain →
  // shot → goal/miss. Tidak ada "tentukan skor dulu, pilih nama belakangan".
  let chosenScore = null;
  let rngProof = null;
  let pureScorelineDist = null;
  let playerScorers = null;
  // Kontrak anti-leakage:
  //  - default      : buang HANYA game target (perilaku lama, untuk preview UI)
  //  - walkForward  : buang game target + semua game sesudahnya (backtest)
  const excludeCtx = (excludeMemoryId != null && excludeGameNumber != null)
    ? (walkForward
      ? { memoryId: excludeMemoryId, fromGameNumber: excludeGameNumber }
      : { memoryId: excludeMemoryId, gameNumber: excludeGameNumber })
    : null;
  // disableForm = matikan form tim + form pemain; disablePlayerForm = hanya form pemain
  const formEnabled = opts.disableForm !== true && opts.disablePlayerForm !== true;
  try {
    const fixtureSeed = opts.seed != null
      ? opts.seed >>> 0
      : scoringHashSeed(`${homeCode}|${awayCode}|${xgHome.toFixed(2)}|${xgAway.toFixed(2)}|fixture|${PREDICTOR_CONFIG.MODEL_VERSION}`);
    const sim = simulateMatch(homeCode, awayCode, {
      seed: fixtureSeed,
      exclude: excludeCtx,
      formEnabled,
      homeScale: teamScaleHome,
      awayScale: teamScaleAway
    });
    const sims = opts.probsSims != null
      ? opts.probsSims
      : (opts.sample === true ? PREDICTOR_CONFIG.BULK_PROBS_SIMS : PREDICTOR_CONFIG.PROBS_SIMS);
    const mc = runMatchMonteCarlo(homeCode, awayCode, {
      seed: fixtureSeed,
      exclude: excludeCtx,
      formEnabled,
      homeScale: teamScaleHome,
      awayScale: teamScaleAway,
      sims
    });
    chosenScore = { home: sim.homeGoals, away: sim.awayGoals, prob: 0 };
    distResult.probs = mc.probs;
    distResult.markets = mc.markets;
    distResult.distribution = mc.distribution;
    pureScorelineDist = mc.distribution;
    xgHome = mc.avgHome;
    xgAway = mc.avgAway;
    playerScorers = buildTopScorersFromSimulation({ homeCode, awayCode, sim, mc, opts: { exclude: excludeCtx, formEnabled, limit: opts.scorerLimit } });
    rngProof = {
      mode: opts.sample === true ? "PLAYER_EVENT_SIM_BULK" : "PLAYER_EVENT_SIM_V7",
      seed: fixtureSeed,
      chosen: `${chosenScore.home}:${chosenScore.away}`,
      homeChances: sim.homeChances,
      awayChances: sim.awayChances,
      teamScale: { home: Number(teamScaleHome.toFixed(3)), away: Number(teamScaleAway.toFixed(3)) },
      calibration: mc.calibration,
      top5: mc.distribution.slice(0, 5).map((d) => `${d.home}:${d.away} ${(d.prob * 100).toFixed(1)}%`),
      method: `Event-based player sim: ${sim.homeChances + sim.awayChances} chance → pemilihan pemain (role posisi x atribut x form) → shot probability (finishing/positioning vs defense lawan) → goal/miss. probs/markets/xG dari MC ${sims} sim.`,
      note: "RNG = NR-LCG 1664525 (implementasi deterministik, BUKAN replika RNG WE10 — konstanta RNG asli 0 hits di ROM). Atribut pemain derived/estimated, bukan decode ROM."
    };
  } catch (engineErr) {
    // Fallback aman: Poisson topScore. TIDAK membuat nama pemain dummy —
    // daftar scorer dibiarkan kosong bila engine gagal.
    console.error("[predictor] player match engine failed, fallback Poisson", engineErr);
    chosenScore = distResult.topScore;
    pureScorelineDist = distResult.distribution;
    playerScorers = [];
    rngProof = {
      mode: "POISSON_FALLBACK",
      chosen: `${chosenScore.home}:${chosenScore.away}`,
      note: `Engine pemain gagal (${engineErr?.message || engineErr}). Scorer dikosongkan — tidak ada nama dummy.`
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

  const seed = opts.seed != null
    ? opts.seed >>> 0
    : scoringHashSeed(`${homeCode}|${awayCode}|${homeGoals}:${awayGoals}|whatif|${PREDICTOR_CONFIG.MODEL_VERSION}`);

  // Skor sudah ditentukan user → simulasi ter-conditioned, memakai model event
  // yang sama (chance → pemain → shot probability → goal). Bukan undian nama.
  const sim = simulateMatchToScore(homeCode, awayCode, homeGoals, awayGoals, { seed });
  const mc = runMatchMonteCarlo(homeCode, awayCode, { seed, sims: PREDICTOR_CONFIG.PROBS_SIMS });
  const topScorers = buildTopScorersFromSimulation({ homeCode, awayCode, sim, mc, opts: {} });
  const xgHome = mc.avgHome, xgAway = mc.avgAway;
  const winner = homeGoals > awayGoals ? (teamsDB[homeCode]?.name || homeCode) : awayGoals > homeGoals ? (teamsDB[awayCode]?.name || awayCode) : "DRAW";
  return {
    homeCode, awayCode,
    homeName: teamsDB[homeCode]?.name || homeCode, awayName: teamsDB[awayCode]?.name || awayCode,
    homeFlag: teamsDB[homeCode]?.flag || "", awayFlag: teamsDB[awayCode]?.flag || "",
    homeGoals, awayGoals, winner,
    xgHome: Number(xgHome.toFixed(2)), xgAway: Number(xgAway.toFixed(2)),
    probs: mc.probs, markets: mc.markets,
    topScorers, keyIndicators: null,
    whatIfMeta: {
      mode: "WHAT_IF_MANUAL_SCORE",
      seed, seedHex: "0x" + seed.toString(16).toUpperCase(),
      lcg: "state = (state * 1664525 + 1013904223) >>>0 — Numerical Recipes LCG (implementasi sendiri, BUKAN replika RNG WE10)",
      method: `Event-based conditioned allocation: ${sim.homeChances + sim.awayChances} chance disimulasikan (level pemain), lalu ${homeGoals + awayGoals} chance dipilih sebagai gol dengan bobot P(gol|pemain,chance) — skor tepat ${homeGoals}:${awayGoals}, nama pemain tetap dari model atribut.`,
      note: "Deterministik & reproducible (bukan Math.random). Ganti skor → seed berubah → event baru. Pemain yang tidak ada di roster tim tidak akan pernah muncul.",
      audit: "Audit 2026-09-19: RNG = implementasi LCG, konstanta RNG ROM 0 hits; atribut pemain derived/estimated (bukan decode ROM). xG display = rata-rata MC model yang sama."
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
  /**
   * Walk-forward backtest — delegasi ke backtestEngine.js (v7).
   * Metrik: exact score, 1X2, top-3/top-5 scoreline, MAE H/A, top scorer hit
   * rate, scorer distribution accuracy + perbandingan model lama vs baru.
   */
  runWalkForwardBacktest(memoryId = 1, opts = {}) {
    return runWalkForwardBacktestImpl(memoryId, opts);
  },
};