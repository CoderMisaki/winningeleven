/**
 * ============================================================================
 *  PLAYER SCORING ENGINE  (player-level, event-based)
 * ============================================================================
 *
 *  ARCHITEKTUR (sesuai target audit)
 *
 *    WE10 roster (nama + posisi)
 *            ↓
 *    Player attributes  (playerAttributes.js — derived/estimated)
 *            ↓
 *    Team strength (rating tim → jumlah & kualitas chance)
 *            ↓
 *    MATCH ENGINE: chance generation
 *            ↓
 *    Player selection (role posisi × atribut × form × stamina)
 *            ↓
 *    Shot probability (finishing/positioning vs defense lawan)
 *            ↓
 *    GOAL / MISS (event per pemain)
 *            ↓
 *    Scorer statistics → skor akhir + top scorers
 *
 *  Prinsip yang dijaga:
 *   - TIDAK ADA daftar bintang manual / STAR_OVERRIDES.
 *   - TIDAK ADA fallback nama dummy ("BRA_FW9"). Tim tanpa roster → tidak
 *     menghasilkan scorer sama sekali (engine menandai `available: false`).
 *   - Skor TIDAK ditentukan dulu lalu nama dipilih acak: gol lahir dari event
 *     chance → pemain → tembakan. Mode "target skor" hanya dipakai kalau skor
 *     memang sudah ditentukan user (what-if / apply ke UI), dan itupun memakai
 *     bobot probabilities tembakan yang sama (conditioned allocation).
 *   - Semua RNG deterministik (LCG Numerical Recipes, keputusan implementasi —
 *     BUKAN replika RNG WE10; konstanta RNG asli tidak ditemukan di ROM,
 *     lihat catatan audit di ghidraTeamAbility.js / predictor.js).
 * ============================================================================
 */

import { getTeamPlayers, getTeamAbilityIndices } from "../data/playerAttributes.js";
import { teamRatings } from "../data/teamRatings.js";
import { getObservedStats, computeFormMultiplier, DATASET_PRIOR, MIN_CALIBRATION_MATCHES } from "./scoringDataset.js";

// ---------------------------------------------------------------------------
// 0. RNG deterministik (NR-LCG 1664525 — implementasi, bukan decode ROM)
// ---------------------------------------------------------------------------
export class ScoringRng {
  constructor(seed) { this.state = (seed >>> 0) || 0x9e3779b9; }
  next() { this.state = (Math.imul(this.state, 1664525) + 1013904223) >>> 0; return this.state; }
  nextFloat() { return this.next() / 0x100000000; }
  range(n) { return n <= 0 ? 0 : this.next() % n; }
  choice(arr) { return arr[this.range(arr.length)]; }
}

export function scoringHashSeed(str) {
  let h = 0x9e3779b9;
  const s = String(str);
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x85ebca6b) >>> 0;
  return h >>> 0;
}

export const PLAYER_SCORING_MODEL_VERSION = "player-attribute v7.0 (event-based)";

// ---------------------------------------------------------------------------
// 1. KONFIGURASI MODEL
// ---------------------------------------------------------------------------
export const PLAYER_SCORING_CONFIG = Object.freeze({
  MODEL_VERSION: PLAYER_SCORING_MODEL_VERSION,

  // --- Chance generation (TEAM MODEL) ---
  CHANCES: {
    BASE: 5.4,          // chance dasar per tim
    MID_FACTOR: 1.9,    // ± oleh dominasi midfield (midDiffNorm -1..1)
    EDGE_FACTOR: 0.32,  // ± oleh (attackIndex - defenseIndex)/10
    JITTER: 3,          // rng.range(3)
    MIN: 3,
    MAX: 10
  },

  // --- Kualitas chance (0..1): makin tinggi makin mudah jadi gol ---
  QUALITY: { BASE: 0.5, EDGE: 0.09, SPREAD: 0.19, MIN: 0.08, MAX: 0.92 },

  // --- Bobot peran posisi dalam pemilihan penembak (model taktis) ---
  ROLE_WEIGHT: {
    CF: 1.00, ST: 0.95, WG: 0.90, WF: 0.90,
    OMF: 0.60, AMF: 0.60,
    SMF: 0.38, CMF: 0.32, DMF: 0.20,
    WB: 0.16, SB: 0.13, CB: 0.10, SW: 0.08,
    GK: 0.00            // GK tidak pernah menembak (own-goal/penalti GK di luar scope model)
  },

  // --- Shot probability (PLAYER MODEL) ---
  SHOT: {
    BASE: 0.30,
    FINISHING: 0.0060,     // per poin di atas 65
    POSITIONING: 0.0035,   // per poin di atas 65
    TECHNIQUE: 0.0025,     // per poin di atas 65
    POWER: 0.0015,         // per poin di atas 70
    QUALITY: 0.40,         // per unit kualitas chance (0..1) di atas 0.5
    OPP_DEFENSE: 0.0080,   // per poin defense lawan di atas 65
    FORM: 0.22,            // per unit (formMultiplier - 1)
    MIN: 0.02,
    MAX: 0.80
  },

  MONTE_CARLO_SIMS: 400,   // probs/markets/xG + statistik pemain
  TOP_SCORERS_LIMIT: 8,
  MAX_GOALS_PER_TEAM: 12
});

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------------------------------------------------------------------------
// 2. KALIBRASI BERBASIS DATASET (bukan tuning manual per pemain)
// ---------------------------------------------------------------------------
let _calibrationCache = { key: null, value: null };
let _referenceConversion = null;
let _profileRev = 1;
const _profileCache = new Map();

export function invalidateScoringCaches() {
  _calibrationCache = { key: null, value: null };
  _referenceConversion = null;
  _profileCache.clear();
}

export function bumpPlayerScoringRevision() {
  _profileRev++;
  invalidateScoringCaches();
}

/**
 * Target skala dari data observasi (rata-rata gol per tim + rasio home).
 * Sampel user < MIN_CALIBRATION_MATCHES → pakai DATASET_PRIOR (427 match
 * Konami Cup yang tersimpan di repo; tetap turunan observasi, bukan angka
 * manual per pemain).
 */
export function getCalibration(exclude = null) {
  const stats = getObservedStats(exclude);
  const key = stats.excludeKey;
  if (_calibrationCache.key === key && _calibrationCache.value) return _calibrationCache.value;

  const useObserved = stats.matches >= MIN_CALIBRATION_MATCHES && stats.avgGoalsPerTeam > 0;
  const target = useObserved ? stats.avgGoalsPerTeam : DATASET_PRIOR.avgGoalsPerTeam;
  const homeShare = useObserved ? stats.homeShare : DATASET_PRIOR.homeShare;
  const reference = getReferenceGoalsPerTeam();
  const value = {
    scale: clamp(target / (reference || target), 0.55, 1.85),
    targetGoalsPerTeam: target,
    homeShare: clamp(homeShare, 0.40, 0.60),
    sampleSize: useObserved ? stats.matches : DATASET_PRIOR.sampleSize,
    calibratedFromData: useObserved,
    source: useObserved ? `observed: ${stats.matches} matches (database user)` : DATASET_PRIOR.source,
    referenceConversionPerTeam: reference
  };
  _calibrationCache = { key, value };
  return value;
}

/**
 * Baseline model pada scale = 1, diukur dengan mini-MC pada dua tim referensi.
 * Dipakai untuk men-scale conversion supaya rata-rata gol simulasi menyamai
 * rata-rata data observasi. Deterministik & di-cache.
 */
export function getReferenceGoalsPerTeam() {
  if (_referenceConversion != null) return _referenceConversion;
  try {
    const sims = 160;
    let goals = 0;
    const home = getTeamScoringProfile("BRA", { formEnabled: false });
    const away = getTeamScoringProfile("ARG", { formEnabled: false });
    for (let i = 0; i < sims; i++) {
      const rng = new ScoringRng((0x00c0ffee ^ Math.imul(i + 1, 0x9e3779b9)) >>> 0);
      const sim = simulateProfiles(home, away, rng, { scale: 1, homeFactor: 1, awayFactor: 1, includeEvents: false });
      goals += sim.homeGoals + sim.awayGoals;
    }
    _referenceConversion = goals / (sims * 2) || 2.2;
  } catch (_) {
    _referenceConversion = 2.2; // fallback aman (estimasi)
  }
  return _referenceConversion;
}

// ---------------------------------------------------------------------------
// 3. PROFIL TIM (cached — tidak dihitung ulang per iterasi Monte Carlo)
// ---------------------------------------------------------------------------
function roleWeightFor(pos) {
  const key = String(pos || "").toUpperCase();
  const w = PLAYER_SCORING_CONFIG.ROLE_WEIGHT[key];
  if (w != null) return w;
  if (key === "FW") return 0.95;
  if (key === "MF") return 0.32;
  if (key === "DF") return 0.10;
  return 0.30;
}

/** Keterlibatan pemain dalam serangan (tanpa form) — dasar share prior. */
function involvementOf(p) {
  return 0.45 * p.attack + 0.30 * p.positioning + 0.25 * p.technique;
}

function selectionWeightOf(player, entry, formMultiplier = 1) {
  const staminaFactor = 0.85 + 0.15 * ((player.stamina || 60) / 99);
  const involvementFactor = 0.45 + 0.55 * (entry.involvement / 100);
  return entry.roleWeight * involvementFactor * staminaFactor * formMultiplier;
}

/**
 * Profil scoring satu tim: daftar pemain + form, indeks attack/defense,
 * dan baseline midfield. Cache key: kode|exclude|formEnabled|revisi.
 * TIDAK ada pemain dummy: tim tanpa roster → available:false, players: [].
 */
export function getTeamScoringProfile(code, opts = {}) {
  const team = String(code || "").toUpperCase();
  const exclude = opts.exclude || null;
  const formEnabled = opts.formEnabled !== false;
  const stats = getObservedStats(exclude);
  const key = `${team}|${stats.excludeKey}|${formEnabled ? 1 : 0}|${_profileRev}`;
  const cached = _profileCache.get(key);
  if (cached) return cached;

  const rawPlayers = getTeamPlayers(team);
  if (!rawPlayers.length) {
    const empty = {
      code: team, available: false, players: [], attackIndex: 60, defenseIndex: 60,
      mid: 0.5, rating: null, formApplied: formEnabled, observedSampleMatches: stats.matches
    };
    _profileCache.set(key, empty);
    return empty;
  }

  const indices = getTeamAbilityIndices(team);
  const rating = teamRatings[team] || null;
  const mid = rating ? clamp((rating.midfield - 65) / 30, 0, 1) : 0.5;

  const entries = rawPlayers.map((p, idx) => ({
    index: idx,
    player: p,
    name: p.name,
    pos: p.pos,
    involvement: involvementOf(p),
    roleWeight: roleWeightFor(p.pos)
  }));

  // 1) bobot statis (tanpa form) → share prior untuk shrinkage
  const rawWeights = entries.map((e) => selectionWeightOf(e.player, e, 1));
  const totalRaw = rawWeights.reduce((s, w) => s + w, 0) || 1;
  entries.forEach((e, i) => { e.staticShare = rawWeights[i] / totalRaw; });

  // 2) form level-pemain dari data historis (shrinkage, dibatasi)
  entries.forEach((e) => {
    const form = formEnabled
      ? computeFormMultiplier({ code: team, playerName: e.name, priorShare: e.staticShare, stats })
      : { multiplier: 1, source: "disabled", observedGoals: 0, teamGoals: 0, apps: 0 };
    e.form = form;
    e.formMultiplier = clamp(form.multiplier, 0.5, 2.0);
  });

  const weights = entries.map((e) => selectionWeightOf(e.player, e, e.formMultiplier));
  const totalWeight = weights.reduce((s, w) => s + w, 0) || 1;
  entries.forEach((e, i) => {
    e.selectionWeight = weights[i];
    e.selectionProbability = weights[i] / totalWeight;
  });

  const profile = {
    code: team,
    available: true,
    players: entries,
    attackIndex: indices.attackIndex,
    defenseIndex: indices.defenseIndex,
    mid,
    rating,
    formApplied: formEnabled,
    observedSampleMatches: stats.matches,
    formSamplePlayers: entries.filter((e) => e.form?.observedGoals > 0).length,
    topSelection: [...entries].sort((a, b) => b.selectionProbability - a.selectionProbability)[0]?.name || null
  };
  if (_profileCache.size > 300) _profileCache.clear();
  _profileCache.set(key, profile);
  return profile;
}

// ---------------------------------------------------------------------------
// 4. MODEL PROBABILITAS
// ---------------------------------------------------------------------------
/** Jumlah chance satu tim (TEAM MODEL: kekuatan tim → banyaknya chance). */
export function generateChances(attackProfile, defenseProfile, rng, midDiffNorm = 0) {
  const cfg = PLAYER_SCORING_CONFIG.CHANCES;
  const edge = (attackProfile.attackIndex - defenseProfile.defenseIndex) / 10;
  const base = cfg.BASE + cfg.MID_FACTOR * midDiffNorm + cfg.EDGE_FACTOR * edge;
  return clamp(Math.round(base + rng.range(cfg.JITTER)), cfg.MIN, cfg.MAX);
}

/** Kualitas satu chance (0..1). */
export function drawChanceQuality(rng, edge = 0) {
  const cfg = PLAYER_SCORING_CONFIG.QUALITY;
  const spread = (rng.nextFloat() + rng.nextFloat() - 1) * cfg.SPREAD;
  return clamp(cfg.BASE + cfg.EDGE * edge + spread, cfg.MIN, cfg.MAX);
}

/** Probabilitas gol untuk SATU pemain pada SATU chance. */
export function shotProbability(player, { quality = 0.5, oppDefenseIndex = 65, formMultiplier = 1, scale = 1 } = {}) {
  const cfg = PLAYER_SCORING_CONFIG.SHOT;
  let p = cfg.BASE;
  p += cfg.FINISHING * ((player.finishing ?? 60) - 65);
  p += cfg.POSITIONING * ((player.positioning ?? 60) - 65);
  p += cfg.TECHNIQUE * ((player.technique ?? 60) - 65);
  p += cfg.POWER * ((player.shotPower ?? 70) - 70);
  p += cfg.QUALITY * (quality - 0.5);
  p -= cfg.OPP_DEFENSE * (oppDefenseIndex - 65);
  p += cfg.FORM * (formMultiplier - 1);
  p *= scale;
  return clamp(p, cfg.MIN, cfg.MAX);
}

/**
 * Pilih penembak untuk satu chance (roulette deterministik).
 * Posisi memengaruhi lewat ROLE_WEIGHT; atribut lewat involvement + stamina;
 * form dari data historis; kualitas chance sedikit menggeser ke positioning.
 */
export function selectAttackingPlayer(profile, quality, rng) {
  // GK DIKELUARKAN dari pool penembak: model ini hanya mensimulasikan peluang
  // open-play/set-piece pemain outfield. Tanpa filter ini, roleWeight GK yang
  // sangat kecil masih bisa terpilih sesekali (mis. 1 chance per 400 sim) dan
  // gol itu tidak akan pernah muncul di daftar scorer UI (GK difilter) sehingga
  // skor dan daftar pencetak gol jadi tidak konsisten.
  const entries = profile.players.filter((e) => String(e.pos).toUpperCase() !== "GK" && (e.roleWeight ?? 0) > 0);
  if (!entries.length) return null;
  const qualityTilt = clamp((quality - 0.5) * 0.5, -0.25, 0.25);
  let total = 0;
  for (const e of entries) {
    const tilt = 1 + (((e.player.positioning ?? 60) - 65) / 100) * qualityTilt * 4;
    e._pickWeight = e.selectionWeight * Math.max(0.2, tilt);
    total += e._pickWeight;
  }
  if (total <= 0) return entries[0];
  let r = rng.nextFloat() * total;
  for (const e of entries) {
    if (r < e._pickWeight) return e;
    r -= e._pickWeight;
  }
  return entries[entries.length - 1];
}

// ---------------------------------------------------------------------------
// 5. MATCH ENGINE — simulasi berbasis event
// ---------------------------------------------------------------------------
export function buildMatchContext(homeCode, awayCode, opts = {}) {
  const home = getTeamScoringProfile(homeCode, opts);
  const away = getTeamScoringProfile(awayCode, opts);
  const calibration = getCalibration(opts.exclude || null);
  const scale = opts.scale != null ? opts.scale : calibration.scale;
  const homeFactor = clamp((2 * calibration.homeShare), 0.94, 1.06); // 1.024 pada data 51.2%
  // Skala konversi per sisi: kalibrasi dataset × faktor tim (form tim/H2H/context
  // dari model tim di predictor.js). Hanya memengaruhi PELUANG GOL tim.
  return {
    home, away, calibration,
    scale,
    homeFactor,
    homeScale: clamp((opts.homeScale != null ? opts.homeScale : 1) * scale, 0.2, 3.0),
    awayScale: clamp((opts.awayScale != null ? opts.awayScale : 1) * scale, 0.2, 3.0)
  };
}

function simulateProfiles(home, away, rng, { scale = 1, homeFactor = 1, awayFactor = 1, includeEvents = true } = {}) {
  const midDiff = (home.mid || 0.5) - (away.mid || 0.5);
  const homeChances = home.available ? generateChances(home, away, rng, midDiff) : 0;
  const awayChances = away.available ? generateChances(away, home, rng, -midDiff) : 0;

  const events = [];
  const runSide = (attackProfile, defenseProfile, chances, side, factor) => {
    let goals = 0;
    for (let i = 0; i < chances; i++) {
      const edge = (attackProfile.attackIndex - defenseProfile.defenseIndex) / 10;
      const quality = drawChanceQuality(rng, edge);
      const entry = selectAttackingPlayer(attackProfile, quality, rng);
      if (!entry) break;
      const p = shotProbability(entry.player, {
        quality,
        oppDefenseIndex: defenseProfile.defenseIndex,
        formMultiplier: entry.formMultiplier,
        scale: factor
      });
      const scored = rng.nextFloat() < p;
      if (scored) goals++;
      if (includeEvents) {
        events.push({
          teamCode: attackProfile.code,
          side,
          playerName: entry.name,
          pos: entry.pos,
          quality: Number(quality.toFixed(3)),
          pGoal: Number(p.toFixed(4)),
          scored,
          formMultiplier: Number(entry.formMultiplier.toFixed(3)),
          selectionProbability: Number(entry.selectionProbability.toFixed(4))
        });
      }
    }
    return goals;
  };

  const homeGoals = runSide(home, away, homeChances, "home", homeFactor * scale);
  const awayGoals = runSide(away, home, awayChances, "away", awayFactor * scale);

  return {
    homeGoals: Math.min(PLAYER_SCORING_CONFIG.MAX_GOALS_PER_TEAM, homeGoals),
    awayGoals: Math.min(PLAYER_SCORING_CONFIG.MAX_GOALS_PER_TEAM, awayGoals),
    homeChances,
    awayChances,
    midDiff,
    events,
    homeProfile: home,
    awayProfile: away
  };
}

/**
 * Simulasi satu pertandingan PENUH (mode bebas): skor DAN pencetak gol lahir
 * dari event yang sama. Ini jalur produksi (predict & bulk).
 */
export function simulateMatch(homeCode, awayCode, opts = {}) {
  const rng = opts.rng || new ScoringRng(opts.seed != null ? opts.seed : 0x5eed1234);
  const ctx = buildMatchContext(homeCode, awayCode, opts);
  const sim = simulateProfiles(ctx.home, ctx.away, rng, {
    scale: 1,
    homeFactor: ctx.homeScale,
    awayFactor: ctx.awayScale,
    includeEvents: opts.includeEvents !== false
  });
  sim.calibration = ctx.calibration;
  sim.ctx = ctx;
  sim.scales = { home: ctx.homeScale, away: ctx.awayScale, calibration: ctx.scale };
  return sim;
}

/**
 * Simulasi dengan skor TERIKAT (what-if / "apply skor" ke UI). Chance, pemain,
 * dan probabilitas tembakan tetap dari model yang sama; yang berbeda hanya
 * "chance mana yang jadi gol": dipilih dengan bobot pGoal (weighted sampling
 * tanpa pengembalian) sampai jumlah gol cocok dengan skor target.
 */
export function simulateMatchToScore(homeCode, awayCode, homeGoals, awayGoals, opts = {}) {
  const rng = opts.rng || new ScoringRng(opts.seed != null ? opts.seed : 0x5eed1234);
  const ctx = buildMatchContext(homeCode, awayCode, opts);
  const base = simulateProfiles(ctx.home, ctx.away, rng, {
    scale: 1, homeFactor: ctx.homeScale, awayFactor: ctx.awayScale, includeEvents: true
  });
  const targetHome = clamp(homeGoals | 0, 0, 20);
  const targetAway = clamp(awayGoals | 0, 0, 20);
  return {
    ...base,
    homeGoals: targetHome,
    awayGoals: targetAway,
    events: conditionEventsToScore(base.events, targetHome, targetAway, rng),
    conditioned: true,
    calibration: ctx.calibration,
    ctx
  };
}

/**
 * Pilih tepat `targetHome`/`targetAway` chance sebagai gol, dengan bobot pGoal.
 * Semua gol tetap berasal dari event pemain (bukan undian nama).
 */
export function conditionEventsToScore(events, targetHome, targetAway, rng) {
  const out = events.map((e) => ({ ...e, scored: false }));
  const applySide = (side, target) => {
    const pool = out.map((e, idx) => ({ e, idx })).filter((x) => x.e.side === side);
    if (!pool.length || target <= 0) return;
    const chosen = new Set();
    const n = Math.min(target, pool.length);
    for (let k = 0; k < n; k++) {
      let total = 0;
      for (const item of pool) if (!chosen.has(item.idx)) total += Math.max(1e-4, item.e.pGoal);
      if (total <= 0) break;
      let r = rng.nextFloat() * total;
      let picked = null;
      for (const item of pool) {
        if (chosen.has(item.idx)) continue;
        const w = Math.max(1e-4, item.e.pGoal);
        if (r < w) { picked = item; break; }
        r -= w;
      }
      if (!picked) picked = pool.find((x) => !chosen.has(x.idx));
      if (!picked) break;
      chosen.add(picked.idx);
    }
    for (const idx of chosen) out[idx].scored = true;
  };
  applySide("home", targetHome);
  applySide("away", targetAway);
  return out;
}

/** Ubah daftar event → ringkasan pencetak gol per pemain. */
export function scorersFromEvents(events) {
  const map = new Map();
  for (const e of events) {
    if (!e.scored) continue;
    const key = `${e.playerName}|${e.teamCode}`;
    const cur = map.get(key) || { name: e.playerName, pos: e.pos, teamCode: e.teamCode, goals: 0, chances: 0 };
    cur.goals++;
    cur.chances++;
    map.set(key, cur);
  }
  for (const e of events) {
    if (e.scored) continue;
    const key = `${e.playerName}|${e.teamCode}`;
    const cur = map.get(key);
    if (cur) cur.chances++;
  }
  return [...map.values()].sort((a, b) => b.goals - a.goals);
}

// ---------------------------------------------------------------------------
// 6. MONTE CARLO SATU PERTANDINGAN (probs, markets, xG, statistik pemain)
// ---------------------------------------------------------------------------
/**
 * Jalankan `sims` simulasi bebas satu fixture dengan seed turunan deterministik.
 * Mengembalikan distribusi skor, 1X2, markets, xG, dan statistik per pemain.
 */
export function runMatchMonteCarlo(homeCode, awayCode, opts = {}) {
  const sims = Math.max(1, opts.sims || PLAYER_SCORING_CONFIG.MONTE_CARLO_SIMS);
  const baseSeed = opts.seed != null ? opts.seed >>> 0 : scoringHashSeed(`${homeCode}|${awayCode}|${PLAYER_SCORING_MODEL_VERSION}`);
  const ctx = buildMatchContext(homeCode, awayCode, opts);

  const scoreMap = new Map();
  const playerStats = new Map();
  let winsH = 0, draws = 0, winsA = 0, over25 = 0, btts = 0, sumH = 0, sumA = 0, totalGoals = 0, chanceTotal = 0;

  const bumpPlayer = (key, name, pos, teamCode, scored) => {
    let cur = playerStats.get(key);
    if (!cur) {
      cur = { name, pos, teamCode, goals: 0, hits: 0, twoPlus: 0, chances: 0 };
      playerStats.set(key, cur);
    }
    cur.chances++;
    if (scored) cur.goals++;
    return cur;
  };

  for (let i = 0; i < sims; i++) {
    const rng = new ScoringRng((baseSeed ^ Math.imul(i + 1, 0x9e3779b9)) >>> 0);
    const sim = simulateProfiles(ctx.home, ctx.away, rng, {
      scale: 1, homeFactor: ctx.homeScale, awayFactor: ctx.awayScale, includeEvents: true
    });
    const key = `${sim.homeGoals}:${sim.awayGoals}`;
    scoreMap.set(key, (scoreMap.get(key) || 0) + 1);
    if (sim.homeGoals > sim.awayGoals) winsH++;
    else if (sim.homeGoals < sim.awayGoals) winsA++;
    else draws++;
    if (sim.homeGoals + sim.awayGoals > 2) over25++;
    if (sim.homeGoals > 0 && sim.awayGoals > 0) btts++;
    sumH += sim.homeGoals; sumA += sim.awayGoals;
    totalGoals += sim.homeGoals + sim.awayGoals;
    chanceTotal += sim.homeChances + sim.awayChances;

    const perSim = new Map();
    for (const e of sim.events) {
      const k = `${e.playerName}|${e.teamCode}`;
      bumpPlayer(k, e.playerName, e.pos, e.teamCode, e.scored);
      if (e.scored) perSim.set(k, (perSim.get(k) || 0) + 1);
    }
    for (const [k, goals] of perSim) {
      const cur = playerStats.get(k);
      if (!cur) continue;
      cur.hits++;
      if (goals >= 2) cur.twoPlus++;
    }
  }

  // normalisasi statistik pemain
  const players = [...playerStats.values()].map((p) => {
    const expectedGoals = p.goals / sims;
    return {
      ...p,
      expectedGoals: Number(expectedGoals.toFixed(4)),
      prob: Number(((p.hits / sims) * 100).toFixed(2)),
      probability2Plus: Number(((p.twoPlus / sims) * 100).toFixed(2)),
      scoringShare: totalGoals > 0 ? Number(((p.goals / totalGoals) * 100).toFixed(2)) : 0,
      goalProbabilityPerChance: p.chances > 0 ? Number((p.goals / p.chances).toFixed(4)) : 0,
      chanceShare: chanceTotal > 0 ? Number(((p.chances / chanceTotal) * 100).toFixed(2)) : 0
    };
  }).sort((a, b) => b.expectedGoals - a.expectedGoals || b.prob - a.prob);

  const distribution = [...scoreMap.entries()]
    .map(([k, c]) => { const [h, a] = k.split(":").map(Number); return { home: h, away: a, prob: c / sims }; })
    .sort((x, y) => y.prob - x.prob);

  const over25P = over25 / sims;
  return {
    sims,
    seed: baseSeed,
    distribution,
    probs: { home: winsH / sims, draw: draws / sims, away: winsA / sims },
    markets: { over25: over25P, under25: 1 - over25P, btts: btts / sims },
    avgHome: Number((sumH / sims).toFixed(3)),
    avgAway: Number((sumA / sims).toFixed(3)),
    avgTotalGoals: Number((totalGoals / sims).toFixed(3)),
    avgChancesPerTeam: Number((chanceTotal / sims / 2).toFixed(2)),
    players,
    calibration: ctx.calibration
  };
}

export function playerKey(code, name) {
  return `${name}|${String(code || "").toUpperCase()}`;
}
