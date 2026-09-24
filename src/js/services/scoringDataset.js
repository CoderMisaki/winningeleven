/**
 * ============================================================================
 *  SCORING DATASET INDEX  (data historis → kalibrasi + form level-pemain)
 * ============================================================================
 *
 *  Modul ini membaca seluruh pertandingan + Top Goals yang tersimpan di
 *  StateManager (memory user, dan knowledge.json kalau di-import) dan
 *  menyajikannya sebagai:
 *
 *   1. Statistik kalibrasi (rata-rata gol per tim, rasio home/away)
 *      → dipakai match engine untuk men-scale conversion, BUKAN tuning manual.
 *   2. Frekuensi pencetak gol per pemain (goals/appearances)
 *      → dipakai sebagai FORM level-pemain dengan shrinkage Bayesian.
 *
 *  ATURAN ANTI-LEAKAGE
 *  -------------------
 *  Semua konsumen boleh meminta `exclude = { memoryId, gameNumber }`. Index
 *  dibangun sekali (per fingerprint database), lalu kontribusi game target
 *  cukup DIKURANGI (O(1) per game) — jadi walk-forward backtest tidak pernah
 *  melihat skor/topGoals dari game yang sedang diprediksi.
 *
 *  Sumber data ini adalah hasil observasi game (bukan ROM). Semua angka
 *  turunan di sini harus dianggap "derived from observed match records".
 * ============================================================================
 */

import { StateManager } from "../state/appState.js";
import { normalizeCountry } from "./similarity.js";
import { ALLOWED_CODE_SET } from "../data/teamCodes.js";
import { findRosterPlayer, normalizePlayerName } from "../data/playerAttributes.js";

/** Rata-rata gol per tim dari 427 match Konami Cup yang tersimpan di repo
 *  (knowledge.json: home 2.49 / away 2.37). Dipakai hanya sebagai PRIOR ketika
 *  database user belum punya cukup sampel. Bukan data ROM. */
export const DATASET_PRIOR = Object.freeze({
  avgGoalsPerTeam: 2.43,
  homeShare: 0.512,
  sampleSize: 427,
  source: "knowledge.json (427 Konami Cup matches, observasi gameplay) — prior, bukan ROM"
});

export const MIN_CALIBRATION_MATCHES = 30;
export const FORM_PRIOR_TEAM_GOALS = 6;      // kekuatan shrinkage (setara 6 gol tim)
export const FORM_MIN_TEAM_GOALS = 4;        // di bawah ini → form netral
export const FORM_MIN_MULT = 0.72;
export const FORM_MAX_MULT = 1.45;

function parseScore(scoreStr) {
  if (typeof scoreStr !== "string") return null;
  const parts = scoreStr.trim().replace(/[-–—;]+/g, ":").split(":");
  if (parts.length !== 2) return null;
  const home = parseInt(parts[0], 10);
  const away = parseInt(parts[1], 10);
  if (isNaN(home) || isNaN(away) || home < 0 || away < 0) return null;
  return { home, away };
}

function decayForGame(game, fallbackIndex) {
  const ts = Date.parse(game?.lastUpdate || "");
  if (!isNaN(ts)) {
    const days = Math.max(0, (Date.now() - ts) / 86400000);
    return Math.max(0.35, Math.pow(0.5, days / 120)); // half-life 120 hari
  }
  // Tanpa timestamp: game terbaru lebih relevan (half-life 12 game)
  return Math.max(0.35, Math.pow(0.5, Math.max(0, fallbackIndex) / 12));
}

let _indexCache = { key: null, value: null };

function hashDatasetText(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return (hash >>> 0).toString(16);
}

export function getScoringDatasetFingerprint() {
  const memories = StateManager.db?.memories || {};
  const snapshot = [];
  for (const key of Object.keys(memories).sort()) {
    const mem = memories[key];
    if (!mem || !Array.isArray(mem.games)) continue;
    snapshot.push({
      key,
      version: mem.version || 0,
      games: mem.games.map((game) => ({
        gameNumber: game?.gameNumber ?? null,
        lastUpdate: game?.lastUpdate || "",
        matches: Array.isArray(game?.matches) ? game.matches : [],
        topGoals: Array.isArray(game?.topGoals) ? game.topGoals : []
      }))
    });
  }
  return hashDatasetText(JSON.stringify(snapshot));
}

function datasetFingerprint() {
  return getScoringDatasetFingerprint();
}

/** Buang cache (dipanggil setelah import/ubah database atau setelah reset test). */
export function invalidateScoringDatasetCache() {
  _indexCache = { key: null, value: null };
  _statsCache.clear();
}

const _statsCache = new Map();

function buildIndex() {
  const memories = StateManager.db?.memories || {};
  const perGame = [];
  const totals = {
    matches: 0, homeGoals: 0, awayGoals: 0,
    teams: new Map(), // code → { gf, ga, matches }
    players: new Map(), // "lowerName|CODE" → { goals, apps, games, teamCode }
    unresolvedScorerRows: 0
  };

  const memoryKeys = Object.keys(memories);
  for (const memKey of memoryKeys) {
    const mem = memories[memKey];
    if (!mem || !Array.isArray(mem.games)) continue;
    const gameOrder = mem.games.map((g, i) => ({ g, i }))
      .sort((a, b) => (Number(a.g?.gameNumber ?? a.i) - Number(b.g?.gameNumber ?? b.i)));
    gameOrder.forEach(({ g, i }, orderIdx) => {
      if (!g || typeof g !== "object") return;
      const decay = decayForGame(g, gameOrder.length - 1 - orderIdx);
      const entry = {
        memoryId: memKey, gameNumber: g.gameNumber, decay,
        matches: 0, homeGoals: 0, awayGoals: 0,
        teams: new Map(), players: new Map(), hasData: false
      };
      for (const m of (Array.isArray(g.matches) ? g.matches : [])) {
        const home = normalizeCountry(m?.home || "");
        const away = normalizeCountry(m?.away || "");
        const score = parseScore(m?.score || "");
        if (!home || !away || !score) continue;
        if (!ALLOWED_CODE_SET.has(home) || !ALLOWED_CODE_SET.has(away)) continue;
        entry.matches++;
        entry.homeGoals += score.home;
        entry.awayGoals += score.away;
        const bump = (map, code, gf, ga) => {
          const cur = map.get(code) || { gf: 0, ga: 0, matches: 0 };
          cur.gf += gf; cur.ga += ga; cur.matches++;
          map.set(code, cur);
        };
        bump(entry.teams, home, score.home, score.away);
        bump(entry.teams, away, score.away, score.home);
      }
      // Top Goals (pencetak gol) — hanya baris valid dengan nama + negara
      for (const tg of (Array.isArray(g.topGoals) ? g.topGoals : [])) {
        const code = normalizeCountry(tg?.country || "");
        const goals = parseInt(tg?.goals, 10) || 0;
        const rawName = String(tg?.player || "").trim();
        if (!code || !ALLOWED_CODE_SET.has(code) || goals <= 0 || !rawName) continue;
        const roster = findRosterPlayer(code, rawName);
        if (!roster) { totals.unresolvedScorerRows++; continue; }
        const key = `${normalizePlayerName(roster.name)}|${code}`;
        const cur = entry.players.get(key) || { goals: 0, apps: 0, teamCode: code, name: roster.name, pos: roster.pos };
        cur.goals += goals;
        cur.apps += 1;
        entry.players.set(key, cur);
        entry.hasData = true;
      }
      if (entry.matches > 0 || entry.players.size > 0) entry.hasData = true;
      // Selalu simpan (walau kosong) supaya exclusion tetap konsisten
      perGame.push(entry);
      totals.matches += entry.matches;
      totals.homeGoals += entry.homeGoals;
      totals.awayGoals += entry.awayGoals;
      for (const [code, v] of entry.teams) {
        const cur = totals.teams.get(code) || { gf: 0, ga: 0, matches: 0 };
        cur.gf += v.gf; cur.ga += v.ga; cur.matches += v.matches;
        totals.teams.set(code, cur);
      }
      for (const [key, v] of entry.players) {
        const cur = totals.players.get(key) || { goals: 0, apps: 0, teamCode: v.teamCode, name: v.name, pos: v.pos };
        cur.goals += v.goals; cur.apps += v.apps;
        totals.players.set(key, cur);
      }
    });
  }
  return { perGame, totals, fingerprint: datasetFingerprint() };
}

function getIndex() {
  const key = datasetFingerprint();
  if (_indexCache.key === key && _indexCache.value) return _indexCache.value;
  const value = buildIndex();
  _indexCache = { key, value };
  _statsCache.clear();
  return value;
}

function excludeKey(exclude) {
  if (!exclude) return "-";
  const mem = exclude.memoryId != null ? String(exclude.memoryId) : "-";
  const game = exclude.gameNumber != null ? String(exclude.gameNumber) : "-";
  const from = exclude.fromGameNumber != null ? String(exclude.fromGameNumber) : "-";
  return `${mem}:${game}:${from}`;
}

/**
 * Statistik observasi (boleh dikurangi satu game untuk walk-forward).
 * @param {{memoryId?:number|string, gameNumber?:number}|null} exclude
 */
export function getObservedStats(exclude = null) {
  const index = getIndex();
  const key = `${excludeKey(exclude)}|${index.fingerprint}`;
  const cached = _statsCache.get(key);
  if (cached) return cached;

  const { perGame, totals } = index;
  let matches = totals.matches, homeGoals = totals.homeGoals, awayGoals = totals.awayGoals;
  const teams = new Map();
  const players = new Map();
  for (const [code, v] of totals.teams) teams.set(code, { ...v });
  for (const [k, v] of totals.players) players.set(k, { ...v });

  if (exclude && (exclude.memoryId != null || exclude.gameNumber != null || exclude.fromGameNumber != null)) {
    for (const game of perGame) {
      const memMatch = exclude.memoryId == null || String(game.memoryId) === String(exclude.memoryId);
      // mode 1: satu game (exclude.gameNumber) — dipakai uji targeted
      // mode 2: walk-forward (exclude.fromGameNumber) — buang game >= N (target & masa depan)
      const gameMatch = exclude.fromGameNumber != null
        ? Number(game.gameNumber) >= Number(exclude.fromGameNumber)
        : (exclude.gameNumber == null || Number(game.gameNumber) === Number(exclude.gameNumber));
      if (!(memMatch && gameMatch)) continue;
      matches -= game.matches;
      homeGoals -= game.homeGoals;
      awayGoals -= game.awayGoals;
      for (const [code, v] of game.teams) {
        const cur = teams.get(code);
        if (!cur) continue;
        cur.gf -= v.gf; cur.ga -= v.ga; cur.matches -= v.matches;
      }
      for (const [k, v] of game.players) {
        const cur = players.get(k);
        if (!cur) continue;
        cur.goals -= v.goals; cur.apps -= v.apps;
      }
    }
  }
  matches = Math.max(0, matches);
  homeGoals = Math.max(0, homeGoals);
  awayGoals = Math.max(0, awayGoals);

  const totalGoals = homeGoals + awayGoals;
  const stats = {
    matches,
    totalGoals,
    homeGoals,
    awayGoals,
    avgGoalsPerTeam: matches > 0 ? totalGoals / (matches * 2) : 0,
    homeShare: totalGoals > 0 ? homeGoals / totalGoals : DATASET_PRIOR.homeShare,
    teams,
    players,
    teamGoals(code) { const t = teams.get(String(code || "").toUpperCase()); return t ? t.gf : 0; },
    teamMatches(code) { const t = teams.get(String(code || "").toUpperCase()); return t ? t.matches : 0; },
    playerGoals(code, name) {
      const k = `${normalizePlayerName(name)}|${String(code || "").toUpperCase()}`;
      const p = players.get(k);
      return p ? p.goals : 0;
    },
    playerApps(code, name) {
      const k = `${normalizePlayerName(name)}|${String(code || "").toUpperCase()}`;
      const p = players.get(k);
      return p ? p.apps : 0;
    },
    excludeKey: excludeKey(exclude),
    datasetKey: index.fingerprint
  };
  if (_statsCache.size > 64) _statsCache.clear();
  _statsCache.set(key, stats);
  return stats;
}

/**
 * Faktor form level-pemain berbasis data historis (dengan shrinkage).
 *
 *   priorShare      = share gol pemain menurut model statis (tanpa form)
 *   shrunkShare     = (observedGoals + K * priorShare) / (teamGoals + K)
 *   formMultiplier  = clamp(shrunkShare / priorShare, FORM_MIN_MULT, FORM_MAX_MULT)
 *
 * Pemain dengan sampel kecil tidak langsung jadi "superstar" karena K=6
 * setara 6 gol tim. Tanpa data → form netral 1.0.
 */
export function computeFormMultiplier({ code, playerName, priorShare, stats }) {
  const neutral = 1.0;
  if (!stats || stats.matches < 2) return { multiplier: neutral, observedGoals: 0, teamGoals: 0, apps: 0, source: "neutral-no-data" };
  const teamGoals = stats.teamGoals(code);
  if (teamGoals < FORM_MIN_TEAM_GOALS) return { multiplier: neutral, observedGoals: 0, teamGoals, apps: 0, source: "neutral-below-min" };
  const observedGoals = stats.playerGoals(code, playerName);
  const apps = stats.playerApps(code, playerName);
  const prior = Math.max(0.01, Math.min(0.9, priorShare || 0.1));
  const shrunk = (observedGoals + FORM_PRIOR_TEAM_GOALS * prior) / (teamGoals + FORM_PRIOR_TEAM_GOALS);
  const ratio = shrunk / prior;
  const multiplier = Math.max(FORM_MIN_MULT, Math.min(FORM_MAX_MULT, ratio));
  return {
    multiplier,
    observedGoals,
    teamGoals,
    apps,
    staticShare: prior,
    shrunkShare: shrunk,
    source: "observed-with-shrinkage"
  };
}

export function getDatasetCacheStats() {
  return { stats: _statsCache.size, indexed: !!_indexCache.value };
}
