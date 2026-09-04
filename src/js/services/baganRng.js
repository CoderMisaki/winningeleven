// Bagan RNG — Sinkron TikTok Live
// Menggunakan LCGRng yang sama dengan predictor (1664525) agar hasil bracket
// identik antara web & overlay TikTok Live jika seed sama.
//
// FIX AUDIT: generateBracket() sebelumnya hanya menghasilkan 4 pasang quarter-final
// dari 8 tim unik (hasil slice(0,8)), sehingga "tabel bagan" tidak pernah menampilkan
// bagan yang utuh (Round 1 → Round 2 → Semi → Final) dan nama tim ditampilkan apa
// adanya (UPPERCASE, tanpa bendera/kode). Sekarang:
//   - teams = 16 peserta dari B1-B8 (home + away), urutan sesuai Schedule Table
//   - rounds = R1 (8 match) → R2 / 8 besar (4) → SEMI (2) → FINAL (1)
//   - pemenang ditentukan deterministik: skor dipakai kalau ada, kalau tidak LCG
import { LCGRng } from "./predictor.js";
import { teamsDB } from "../data/teams.js";
import { normalizeCountry } from "./similarity.js";

function hashStringToSeed(str) {
  let h = 0x9e3779b9;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 0x85ebca6b) >>> 0;
  return h >>> 0;
}

/** Normalisasi input negara -> { code, name, flag } (fallback: teks mentah) */
export function resolveTeam(raw) {
  const rawStr = String(raw ?? "").trim();
  if (!rawStr) return null;
  const code = normalizeCountry(rawStr);
  if (code && teamsDB[code]) {
    return { code, name: teamsDB[code].name, flag: teamsDB[code].flag || "", raw: rawStr };
  }
  // FIX BUG: negara tidak dikenal sebelumnya tetap diberi "kode" hasil uppercase,
  // sehingga teks bebas keluar sebagai kode tim. Kode harus kosong kalau bukan 57-fix.
  return { code: "", name: rawStr, flag: "", raw: rawStr };
}

/** Parsing skor "2:1" / "2-1" -> { home, away } | null */
export function parseBagScore(scoreStr) {
  if (typeof scoreStr !== "string") return null;
  const clean = scoreStr.trim().replace(/[-–—;]+/g, ":").replace(/\s+/g, "");
  const parts = clean.split(":");
  if (parts.length !== 2) return null;
  const home = parseInt(parts[0], 10);
  const away = parseInt(parts[1], 10);
  if (Number.isNaN(home) || Number.isNaN(away) || home < 0 || away < 0) return null;
  return { home, away };
}

const ROUND_LABELS = ["ROUND 1", "ROUND 2", "SEMI FINAL", "FINAL"];

export const BaganRngService = {
  // Seed sumber TikTok live: bisa ID live, timestamp, atau kode manual yang di-copy dari overlay
  // Agar 100% sama, seed harus string identik di kedua tempat.
  deriveSeed(tiktokSeedRaw) {
    const raw = String(tiktokSeedRaw || "").trim();
    if (!raw) return { seed: 0x12345678, source: "default" };
    // Jika sudah numeric hex, pakai langsung
    if (/^0x[0-9a-f]+$/i.test(raw)) return { seed: parseInt(raw, 16) >>> 0, source: "hex:" + raw };
    if (/^\d+$/.test(raw) && raw.length > 6) return { seed: Number(raw) >>> 0, source: "numeric:" + raw };
    return { seed: hashStringToSeed(raw), source: `hash("${raw}")` };
  },

  // Fisher-Yates shuffle deterministik via LCGRng — sama persis dengan game
  shuffleTeams(teamCodes, seed) {
    const arr = [...teamCodes];
    const rng = new LCGRng(seed);
    for (let i = arr.length - 1; i > 0; i--) {
      const j = rng.range(i + 1);
      const tmp = arr[i]; arr[i] = arr[j]; arr[j] = tmp;
    }
    return { shuffled: arr, rngSteps: arr.length - 1 };
  },

  /**
   * Bangun bagan knockout lengkap dari baris B1-B8.
   * @param {Array<{home?:string, away?:string, score?:string}>} matchRows baris B1..B8
   * @param {string} tiktokSeedRaw seed dari overlay TikTok Live
   * @param {object} opts { shuffle: boolean } — shuffle hanya mengacak URUT R1 (default false
   *        supaya identik dengan Schedule Table yang tampil di game)
   */
  generateBracketFromMatches(matchRows, tiktokSeedRaw, opts = {}) {
    const { seed, source } = this.deriveSeed(tiktokSeedRaw);
    const rows = (Array.isArray(matchRows) ? matchRows : [])
      .slice(0, 8)
      .map((m, i) => {
        const home = resolveTeam(m?.home);
        const away = resolveTeam(m?.away);
        return {
          slot: i + 1,
          label: `B${i + 1}`,
          home, away,
          score: parseBagScore(m?.score),
          complete: !!(home && away)
        };
      })
      .filter(r => r.home || r.away);

    if (rows.length === 0) {
      return { error: "Isi B1-B8 minimal 1 pertandingan untuk generate bagan." };
    }

    // Peserta unik (untuk info & shuffle opsional)
    const participants = [];
    const seen = new Set();
    rows.forEach(r => {
      [r.home, r.away].forEach(t => {
        if (!t) return;
        const key = (t.code || t.name).toUpperCase();
        if (!seen.has(key)) { seen.add(key); participants.push(t); }
      });
    });

    // Opsional shuffle urutan R1 (default: false → identik dengan Schedule Table game)
    let orderedRows = rows;
    if (opts.shuffle === true) {
      const { shuffled } = this.shuffleTeams(rows.map((_, i) => i), seed ^ 0x5bf03635);
      orderedRows = shuffled.map(i => rows[i]);
    }

    // Bangun round secara deterministik
    const rng = new LCGRng((seed ^ 0x1f2e3d4c) >>> 0);
    const rounds = [];
    let current = orderedRows.map(r => ({
      label: r.label,
      home: r.home,
      away: r.away,
      score: r.score,
      sourceSlots: [r.slot]
    }));

    let roundIdx = 0;
    while (current.length >= 1) {
      const isPlayableRound = current.every(m => m.home && m.away);
      const round = {
        index: roundIdx,
        name: ROUND_LABELS[roundIdx] || `ROUND ${roundIdx + 1}`,
        matches: current.map(m => {
          let winner = null;
          let reason = "Menunggu hasil";
          if (m.score) {
            if (m.score.home > m.score.away) { winner = m.home; reason = `Skor ${m.score.home}:${m.score.away}`; }
            else if (m.score.away > m.score.home) { winner = m.away; reason = `Skor ${m.score.home}:${m.score.away}`; }
            else {
              // Seri → tie-break deterministik via LCG (tanpa Math.random)
              const pick = rng.range(2);
              winner = pick === 0 ? m.home : m.away;
              reason = `Seri ${m.score.home}:${m.score.away} → tie-break LCG (pick ${pick === 0 ? "HOME" : "AWAY"})`;
            }
          } else if (isPlayableRound) {
            const pick = rng.range(2);
            winner = pick === 0 ? m.home : m.away;
            reason = `Tanpa skor → LCG pick ${pick === 0 ? "HOME" : "AWAY"}`;
          }
          return {
            label: m.label,
            home: m.home,
            away: m.away,
            score: m.score || null,
            winner,
            reason,
            bye: !m.home || !m.away,
            sourceSlots: m.sourceSlots
          };
        })
      };
      rounds.push(round);

      // Berhenti kalau sudah final (1 match) atau tidak semua match punya 2 tim
      if (current.length === 1) break;
      if (!isPlayableRound) break;

      const winners = round.matches.map(m => m.winner).filter(Boolean);
      if (winners.length < 2) break;

      const next = [];
      for (let i = 0; i < winners.length; i += 2) {
        const a = winners[i];
        const b = winners[i + 1];
        if (!b) { next.push({ label: "BYE", home: a, away: null, score: null, sourceSlots: [] }); continue; }
        next.push({
          label: `${rounds.length === 1 ? "8B" : rounds.length === 2 ? "SF" : "F"}${next.length + 1}`,
          home: a, away: b, score: null,
          sourceSlots: [...(round.matches[i]?.sourceSlots || []), ...(round.matches[i + 1]?.sourceSlots || [])]
        });
      }
      current = next;
      roundIdx++;
      if (roundIdx > 8) break; // safety guard
    }

    const finalRound = rounds[rounds.length - 1];
    const champion = finalRound?.matches?.[0]?.winner || null;

    return {
      seed,
      source,
      tiktokSeedRaw: String(tiktokSeedRaw || ""),
      shuffled: participants.map(p => p.code || p.name),
      participants,
      rounds,
      champion,
      // Backward-compat: field lama `quarters` tetap tersedia (isi = Round 1)
      quarters: (rounds[0]?.matches || []).map((m, i) => ({
        home: m.home?.name || "",
        away: m.away?.name || "",
        homeCode: m.home?.code || "",
        awayCode: m.away?.code || "",
        seedRef: m.label || `Q${i + 1}`
      })),
      proof: {
        lcg: "state = (state*1664525 + 1013904223)>>>0",
        shuffle: "Fisher-Yates via LCGRng.range(n)",
        note: "Seed sama → urutan & pemenang sama di web & overlay TikTok Live. Ganti seed di TikTok overlay & input seed yang sama di sini."
      }
    };
  },

  /**
   * Legacy API — terima array kode/nama tim, bangun bracket pasangan berurutan.
   * Tetap dipertahankan agar pemanggil lama tidak rusak.
   */
  generateBracket(teamCodes, tiktokSeedRaw) {
    const list = Array.isArray(teamCodes) ? teamCodes.filter(Boolean) : [];
    if (list.length < 2) return { error: "Minimal 2 tim untuk bagan (isi B1-B8 dulu)." };
    const rows = [];
    for (let i = 0; i < list.length; i += 2) {
      rows.push({ home: list[i], away: list[i + 1] || null, score: "" });
    }
    const res = this.generateBracketFromMatches(rows, tiktokSeedRaw);
    if (res.error) return res;
    // Pertahankan field `shuffled` versi lama (array string)
    res.shuffled = list;
    return res;
  },

  // URL param helper untuk sync otomatis ?tiktok_seed=...
  getUrlSeed() {
    try {
      const u = new URL(window.location.href);
      return u.searchParams.get("tiktok_seed") || u.searchParams.get("bagan_seed") || u.searchParams.get("seed") || "";
    } catch { return ""; }
  }
};
