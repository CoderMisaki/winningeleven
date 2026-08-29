// Bagan RNG — Sinkron TikTok Live
// Menggunakan LCGRng yang sama dengan predictor (1664525) agar hasil bracket
// identik antara web & overlay TikTok Live jika seed sama.
import { LCGRng } from "./predictor.js";

function hashStringToSeed(str) {
  let h = 0x9e3779b9;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 0x85ebca6b) >>> 0;
  return h >>> 0;
}

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

  // Generate bagan knockout 8 tim (quarter → semi → final)
  // teamCodes = array kode 57-fix, mis 8 tim dari B1-B8
  generateBracket(teamCodes, tiktokSeedRaw) {
    const { seed, source } = this.deriveSeed(tiktokSeedRaw);
    const teams = teamCodes.filter(Boolean).slice(0, 8);
    if (teams.length < 2) return { error: "Minimal 2 tim untuk bagan (isi B1-B8 dulu)." };
    // Jika ganjil, pad dengan BYE
    while (teams.length < 8 && teams.length % 2 !== 0) teams.push("BYE");
    const { shuffled } = this.shuffleTeams(teams, seed);
    // Quarter pairs
    const quarters = [];
    for (let i = 0; i < shuffled.length; i += 2) {
      const home = shuffled[i], away = shuffled[i + 1] || "BYE";
      quarters.push({ home, away, seedRef: `Q${i / 2 + 1}` });
    }
    // Untuk preview TikTok, semi/final belum diisi — hanya struktur
    return {
      seed, source, tiktokSeedRaw: String(tiktokSeedRaw || ""),
      shuffled, quarters,
      proof: {
        lcg: "state = (state*1664525 + 1013904223)>>>0",
        shuffle: "Fisher-Yates via LCGRng.range(n)",
        note: "Seed sama → urutan sama di web & overlay TikTok Live. Ganti seed di TikTok overlay & input seed yang sama di sini."
      }
    };
  },

  // URL param helper untuk sync otomatis ?tiktok_seed=...
  getUrlSeed() {
    try {
      const u = new URL(window.location.href);
      return u.searchParams.get("tiktok_seed") || u.searchParams.get("bagan_seed") || u.searchParams.get("seed") || "";
    } catch { return ""; }
  }
};
