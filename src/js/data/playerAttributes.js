/**
 * ============================================================================
 *  WE10 PLAYER ATTRIBUTE DATABASE  (DERIVED / ESTIMATED — BUKAN DECODE ROM)
 * ============================================================================
 *
 *  KENAPA FILE INI ADA
 *  -------------------
 *  Model lama memakai `{ name, pos, weight }` di we10FullRoster.js, di mana
 *  "weight" HANYA duplikat posisi (CF=84, OMF=66, CB=10, dst) + daftar manual
 *  STAR_OVERRIDES (Ronaldo=94, Henry=90, ...). Model itu bukan player-level:
 *  semua striker dalam satu tim punya angka identik dan "bintang" dipaksa
 *  selalu menang undian. File ini menggantinya dengan database atribut
 *  per-pemain yang dipakai playerScoring.js.
 *
 *  STATUS DATA (jujur, sesuai audit 2026-09-19)
 *  -------------------------------------------
 *  VERIFIED (ada bukti di repo / citra game):
 *    - `name` + `pos`: WE10_FULL_ROSTER (57 tim x 11 pemain, direkam manual dari
 *      layar game oleh pemilik repo). BUKAN hasil decode struktur ROM.
 *    - teamRatings.js (attack/defense/midfield/...) = rekap eksternal (estimasi),
 *      dipakai hanya sebagai penggeser tim-level. Bukti Ghidra yang VALID
 *      (003bd400 dump, 003be000 strings, FUN_0016e8d8 = ceiling-div helper,
 *      FUN_00216ef0 = table lookup, RNG konstanta standar 0 hits) TIDAK dihapus
 *      — lihat ghidraTeamAbility.js.
 *  DERIVED (dihitung dengan rumus yang didokumentasikan di bawah):
 *    - seluruh 12 atribut (attack, defense, finishing, shotPower, technique,
 *      dribble, speed, passing, positioning, physical, stamina, form).
 *  ESTIMATED (placeholder, tidak di-klaim sebagai data asli):
 *    - variasi individual antar pemain (latent + noise deterministik per nama).
 *      Ini BUKAN decode ROM dan BUKAN daftar bintang manual. Fungsinya hanya
 *      supaya dua pemain dengan posisi sama tidak punya probabilitas identik —
 *      sesuai permintaan model player-level. Perbedaan individual yang SEBENARNYA
 *      harus diisi lewat VERIFIED_PLAYER_ATTRIBUTE_OVERRIDES di bawah begitu ada
 *      data ROM/DataBase yang terverifikasi.
 *
 *  RUMUS DERIVASI (deterministik, tanpa Math.random)
 *  -------------------------------------------------
 *    value = clamp( archetype[pos][attr]                       // tabel peran (DERIVED)
 *                 + sensitivity[attr] * teamShift[attr]        // kekuatan tim (teamRatings, ESTIMATED)
 *                 + latent * LATENT_WEIGHT[attr]               // kualitas umum pemain (ESTIMATED, hash nama)
 *                 + noise[attr] * (hash01(attr) - 0.5) * 2,    // variasi antar atribut (ESTIMATED)
 *                 ATTR_MIN, ATTR_MAX)
 *
 *  Catatan penting: rumus di atas TIDAK mengambil data dari hasil pertandingan.
 *  Data historis (knowledge.json / memory user) dipakai di scoringDataset.js
 *  sebagai FORM (level pemain) dengan shrinkage — bukan untuk mengarang atribut.
 * ============================================================================
 */

import { WE10_FULL_ROSTER } from "./we10FullRoster.js";
import { teamRatings } from "./teamRatings.js";

export const PLAYER_ATTRIBUTE_KEYS = Object.freeze([
  "attack",
  "defense",
  "finishing",
  "shotPower",
  "technique",
  "dribble",
  "speed",
  "passing",
  "positioning",
  "physical",
  "stamina",
  "form"
]);

/** Sumber tiap bagian data — dipakai UI/backtest supaya tidak menyesatkan. */
export const PLAYER_ATTRIBUTE_PROVENANCE = Object.freeze({
  model: "derived-player-attributes v1.0 (2026-09-19)",
  verified: [
    "name + pos per tim (WE10_FULL_ROSTER, rekaman manual dari layar game — bukan decode ROM)",
    "teamRatings.js sebagai penggeser tim-level (rekap eksternal, estimasi)",
    "Bukti Ghidra yang tetap valid: dump 003bd400, team strings 003be000, FUN_0016e8d8 = ceiling-div helper, FUN_00216ef0 = table lookup, 0 hits konstanta RNG standar"
  ],
  derived: [
    "attack, defense, finishing, shotPower, technique, dribble, speed, passing, positioning, physical, stamina, form",
    "position role weights (playerScoring.js) — model taktis, bukan data ROM"
  ],
  estimated: [
    "variasi individual (latent + per-attribute noise) — placeholder deterministik untuk kualitas individu yang belum diketahui",
    "seluruh skala absolut atribut (0-99) belum diverifikasi terhadap ROM"
  ],
  notClaimed: [
    "atribut di sini BUKAN hasil decode SLPM_663.74",
    "model ini BUKAN replika matematis resmi RNG WE10"
  ]
});

// ---------------------------------------------------------------------------
// 1. TABEL PERAN PER POSISI (DERIVED — model taktis, bukan tabel ROM)
// ---------------------------------------------------------------------------
const NEUTRAL_ARCHETYPE = Object.freeze({
  attack: 60, defense: 60, finishing: 55, shotPower: 68, technique: 68, dribble: 62,
  speed: 70, passing: 70, positioning: 65, physical: 72, stamina: 78
});

export const POSITION_ARCHETYPE = Object.freeze({
  GK:  { attack: 22, defense: 90, finishing: 8,  shotPower: 38, technique: 46, dribble: 30, speed: 48, passing: 52, positioning: 56, physical: 74, stamina: 62 },
  SW:  { attack: 44, defense: 86, finishing: 34, shotPower: 62, technique: 62, dribble: 52, speed: 62, passing: 68, positioning: 68, physical: 80, stamina: 76 },
  CB:  { attack: 43, defense: 87, finishing: 36, shotPower: 66, technique: 60, dribble: 50, speed: 63, passing: 66, positioning: 70, physical: 84, stamina: 78 },
  SB:  { attack: 58, defense: 78, finishing: 45, shotPower: 66, technique: 68, dribble: 68, speed: 78, passing: 72, positioning: 62, physical: 74, stamina: 84 },
  WB:  { attack: 63, defense: 74, finishing: 50, shotPower: 68, technique: 70, dribble: 73, speed: 82, passing: 74, positioning: 60, physical: 70, stamina: 88 },
  DMF: { attack: 60, defense: 80, finishing: 52, shotPower: 74, technique: 72, dribble: 64, speed: 66, passing: 78, positioning: 68, physical: 82, stamina: 84 },
  CMF: { attack: 69, defense: 68, finishing: 60, shotPower: 74, technique: 78, dribble: 72, speed: 70, passing: 84, positioning: 68, physical: 74, stamina: 86 },
  SMF: { attack: 74, defense: 60, finishing: 64, shotPower: 74, technique: 80, dribble: 80, speed: 82, passing: 80, positioning: 64, physical: 68, stamina: 84 },
  OMF: { attack: 80, defense: 52, finishing: 71, shotPower: 76, technique: 85, dribble: 82, speed: 74, passing: 85, positioning: 72, physical: 66, stamina: 78 },
  WG:  { attack: 78, defense: 45, finishing: 70, shotPower: 74, technique: 82, dribble: 85, speed: 87, passing: 76, positioning: 66, physical: 62, stamina: 80 },
  CF:  { attack: 82, defense: 38, finishing: 80, shotPower: 84, technique: 78, dribble: 76, speed: 78, passing: 68, positioning: 82, physical: 80, stamina: 78 },
  ST:  { attack: 80, defense: 40, finishing: 78, shotPower: 82, technique: 80, dribble: 78, speed: 76, passing: 72, positioning: 78, physical: 74, stamina: 78 }
});

/** Alias posisi lain (kalau roster berubah) → archetype terdekat. */
const POSITION_ALIAS = Object.freeze({
  WF: "WG", FW: "CF", AMF: "OMF", MF: "CMF", DF: "CB", LB: "SB", RB: "SB", "WB/LB": "WB"
});

// Sensitivitas atribut terhadap kekuatan tim (teamRatings), satuan poin atribut
// per 10 poin shift rating. Nilai ini kalibrasi model (estimasi), bukan data ROM.
const ATTRIBUTE_SENSITIVITY = Object.freeze({
  attack:      { attack: 3.0, midfield: 1.2 },
  defense:     { defense: 3.0, power: 1.0 },
  finishing:   { attack: 2.6 },
  shotPower:   { power: 2.4, attack: 1.0 },
  technique:   { midfield: 2.2, attack: 0.8 },
  dribble:     { speed: 1.4, midfield: 1.4 },
  speed:       { speed: 3.0 },
  passing:     { midfield: 2.6 },
  positioning: { attack: 2.2, midfield: 1.0 },
  physical:    { power: 2.8 },
  stamina:     { stamina: 3.0 },
  form:        {} // form statis netral; form dinamis dihitung playerScoring.js
});

// Bobot "kualitas individu" (hash nama) per atribut — placeholder estimasi.
const LATENT_WEIGHT = Object.freeze({
  attack: 4.0, defense: 4.0, finishing: 5.0, shotPower: 3.0, technique: 4.5, dribble: 4.5,
  speed: 3.0, passing: 4.0, positioning: 4.0, physical: 3.0, stamina: 3.0, form: 0
});
// Noise per atribut (independen) — supaya atribut tidak bergerak seragam.
const ATTRIBUTE_NOISE = Object.freeze({
  attack: 3.0, defense: 3.0, finishing: 3.5, shotPower: 3.0, technique: 3.0, dribble: 3.0,
  speed: 3.5, passing: 3.0, positioning: 3.5, physical: 3.0, stamina: 2.5, form: 0
});

const ATTR_MIN = 1;
const ATTR_MAX = 99;

// ---------------------------------------------------------------------------
// 2. OVERRIDE TERVERIFIKASI (kosong secara default)
//    Isi di sini kalau suatu saat ada hasil decode ROM/DataBase yang SAH.
//    Contoh bentuk: { BRA: { Ronaldo: { finishing: 92, shotPower: 90, _source: "rom-db 0x..." } } }
// ---------------------------------------------------------------------------
export const VERIFIED_PLAYER_ATTRIBUTE_OVERRIDES = Object.create(null);
let _verifiedOverrides = Object.create(null);

/**
 * Daftarkan atribut hasil verifikasi (ROM/database resmi). Nilai di sini
 * dianggap VERIFIED dan menimpa nilai derived.
 * @param {Record<string, Record<string, Record<string, number|string>>>} map
 */
export function registerVerifiedPlayerAttributes(map) {
  if (!map || typeof map !== "object") return 0;
  let count = 0;
  for (const [code, players] of Object.entries(map)) {
    if (!players || typeof players !== "object") continue;
    if (!_verifiedOverrides[code]) _verifiedOverrides[code] = Object.create(null);
    for (const [name, attrs] of Object.entries(players)) {
      if (!attrs || typeof attrs !== "object") continue;
      _verifiedOverrides[code][normalizePlayerName(name)] = { ...attrs };
      count++;
    }
  }
  invalidatePlayerDatabase();
  return count;
}

export function getVerifiedOverrideCount() {
  return Object.values(_verifiedOverrides).reduce((s, m) => s + Object.keys(m).length, 0);
}

export function clearVerifiedPlayerAttributes() {
  _verifiedOverrides = Object.create(null);
  invalidatePlayerDatabase();
}

// ---------------------------------------------------------------------------
// 3. HELPERS DETERMINISTIK
// ---------------------------------------------------------------------------
/** FNV-1a 32-bit → [0,1). Stabil lintas run/browser (bukan Math.random). */
export function hash01(str) {
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  // xorshift akhir untuk menghindari pola linear pada string mirip
  h ^= h >>> 15; h = Math.imul(h, 0x2545f491) >>> 0; h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/** Normalisasi nama pemain: huruf kecil, tanpa aksen/tanda baca, entity HTML dibuang. */
export function normalizePlayerName(raw) {
  return String(raw == null ? "" : raw)
    .replace(/&#x27;|&#39;|&apos;|&#x2f;/gi, "'")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

function archetypeFor(pos) {
  const key = String(pos || "").toUpperCase();
  if (POSITION_ARCHETYPE[key]) return POSITION_ARCHETYPE[key];
  const alias = POSITION_ALIAS[key];
  if (alias && POSITION_ARCHETYPE[alias]) return POSITION_ARCHETYPE[alias];
  return NEUTRAL_ARCHETYPE;
}

function teamShiftFor(code) {
  const r = teamRatings[String(code || "").toUpperCase()];
  const safe = (v, mid) => (typeof v === "number" && isFinite(v) ? (v - mid) / 10 : 0);
  if (!r) return { attack: 0, defense: 0, midfield: 0, speed: 0, power: 0, stamina: 0, hasRating: false };
  return {
    attack: safe(r.attack, 78),
    defense: safe(r.defense, 77),
    midfield: safe(r.midfield, 77),
    speed: safe(r.speed, 79),
    power: safe(r.power, 80),
    stamina: safe(r.stamina, 80),
    hasRating: true
  };
}

// ---------------------------------------------------------------------------
// 4. DERIVASI ATRIBUT PER PEMAIN
// ---------------------------------------------------------------------------
/**
 * Hitung 12 atribut untuk satu pemain. Deterministik & murni (tanpa state).
 * @param {string} code kode tim (BRA, ENG, ...)
 * @param {{name:string, pos:string}} entry entri roster
 * @returns {object} player record lengkap
 */
export function derivePlayerAttributes(code, entry) {
  const team = String(code || "").toUpperCase();
  const name = entry?.name || "";
  const pos = String(entry?.pos || "CMF").toUpperCase();
  const base = archetypeFor(pos);
  const shift = teamShiftFor(team);

  const latent = (hash01(`${team}|${name}|latent`) - 0.5) * 2; // -1..1
  const player = { name, pos, position: pos, teamCode: team, attributesSource: "derived-estimated" };

  for (const attr of PLAYER_ATTRIBUTE_KEYS) {
    if (attr === "form") { player.form = 50; continue; }
    const sens = ATTRIBUTE_SENSITIVITY[attr] || {};
    let value = base[attr] != null ? base[attr] : NEUTRAL_ARCHETYPE[attr] || 60;
    for (const [ratingKey, weight] of Object.entries(sens)) {
      value += weight * (shift[ratingKey] || 0);
    }
    value += latent * (LATENT_WEIGHT[attr] || 0);
    value += (hash01(`${team}|${name}|${attr}`) - 0.5) * 2 * (ATTRIBUTE_NOISE[attr] || 0);
    player[attr] = clamp(Math.round(value), ATTR_MIN, ATTR_MAX);
  }

  // Override terverifikasi (kalau ada) menimpa hasil derivasi
  const ov = _verifiedOverrides[team]?.[normalizePlayerName(name)];
  if (ov) {
    let applied = 0;
    for (const attr of PLAYER_ATTRIBUTE_KEYS) {
      const v = ov[attr];
      if (typeof v === "number" && isFinite(v)) { player[attr] = clamp(Math.round(v), ATTR_MIN, ATTR_MAX); applied++; }
    }
    if (applied > 0) {
      player.attributesSource = "verified";
      player.attributeSourceNote = ov._source || "verified override";
    }
  }
  return player;
}

/** Indeks "overall" turunan (0-99) — dipakai UI/bukti, bukan dasar mutlak seleksi. */
export function playerOverall(player) {
  if (!player) return 0;
  const w = {
    attack: 0.11, defense: 0.11, finishing: 0.12, shotPower: 0.07, technique: 0.09, dribble: 0.08,
    speed: 0.09, passing: 0.09, positioning: 0.09, physical: 0.07, stamina: 0.08
  };
  let total = 0, sum = 0;
  for (const [k, weight] of Object.entries(w)) { total += (player[k] || 0) * weight; sum += weight; }
  return Math.round(total / (sum || 1));
}

// ---------------------------------------------------------------------------
// 5. DATABASE + INDEX (di-cache; tidak dihitung ulang per Monte Carlo)
// ---------------------------------------------------------------------------
let _dbCache = null;
let _indexCache = null;

export function invalidatePlayerDatabase() {
  _dbCache = null;
  _indexCache = null;
}

export function buildPlayerDatabase() {
  const db = {};
  for (const [code, roster] of Object.entries(WE10_FULL_ROSTER)) {
    if (!Array.isArray(roster)) continue;
    db[code] = roster.map((entry) => derivePlayerAttributes(code, entry));
  }
  return db;
}

/** Database atribut per tim. Tidak ada pemain dummy/fallback fabricated. */
export function getPlayerDatabase() {
  if (!_dbCache) _dbCache = buildPlayerDatabase();
  return _dbCache;
}

function buildIndex() {
  const db = getPlayerDatabase();
  const index = {};
  for (const [code, players] of Object.entries(db)) {
    const map = new Map();
    for (const p of players) map.set(normalizePlayerName(p.name), p);
    index[code] = map;
  }
  return index;
}

function getNameIndex() {
  if (!_indexCache) _indexCache = buildIndex();
  return _indexCache;
}

/**
 * Pemain roster untuk tim. Jika tim tidak ada di roster → array kosong
 * (pemanggil WAJIB menangani: "jangan pernah membuat nama pemain dummy").
 */
export function getTeamPlayers(code) {
  const team = String(code || "").toUpperCase();
  return getPlayerDatabase()[team] || [];
}

/** Cari pemain berdasarkan nama pemain di roster tim (exact dulu, lalu fuzzy). */
export function findRosterPlayer(code, rawName) {
  const team = String(code || "").toUpperCase();
  const idx = getNameIndex()[team];
  if (!idx) return null;
  const target = normalizePlayerName(rawName);
  if (!target) return null;
  if (idx.has(target)) return idx.get(target);
  // Prefix / substring (mis. "C y park " → "C Y Park"), hanya jika kandidat unik.
  const partial = [];
  for (const [key, player] of idx) {
    if (key.includes(target) || target.includes(key)) partial.push(player);
  }
  if (partial.length === 1) return partial[0];
  // Levenshtein kecil (typo ringan: "Lamapard" → "Lampard")
  let best = null, bestDist = 3;
  for (const [key, player] of idx) {
    const d = levenshtein(target, key, 2);
    if (d < bestDist) { bestDist = d; best = player; }
  }
  return best;
}

export function levenshtein(a, b, maxDist = 3) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > maxDist) return maxDist + 1;
  let prev = new Array(b.length + 1);
  let cur = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > maxDist) return maxDist + 1;
    const tmp = prev; prev = cur; cur = tmp;
  }
  return prev[b.length];
}

/** Ringkasan indeks tim (attack/defense) dari model pemain — dipakai match engine. */
export function getTeamAbilityIndices(code) {
  const players = getTeamPlayers(code);
  if (!players.length) return { attackIndex: 60, defenseIndex: 60, players: [] };
  const att = players.map((p) => p.attack).sort((a, b) => b - a);
  const def = players.map((p) => p.defense).sort((a, b) => b - a);
  const mean = (arr, n) => arr.slice(0, Math.min(n, arr.length)).reduce((s, v) => s + v, 0) / Math.max(1, Math.min(n, arr.length));
  return { attackIndex: mean(att, 6), defenseIndex: mean(def, 6), players };
}
