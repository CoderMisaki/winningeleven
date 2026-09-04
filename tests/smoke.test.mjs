/**
 * Smoke test: load index.html in jsdom, run main.js, verify core UI renders.
 * Run: node tests/smoke.test.mjs
 */
import { JSDOM, VirtualConsole } from "jsdom";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const errors = [];
const logs = [];

const virtualConsole = new VirtualConsole();
virtualConsole.on("jsdomError", (e) => {
  const msg = e.stack || e.message || String(e);
  // jsdom tidak mengimplementasikan navigasi dokumen — muncul saat <a download> di-klik
  // (semua fitur export/download). Bukan bug aplikasi, jadi diabaikan.
  if (/Not implemented: navigation/i.test(msg)) return;
  errors.push("[jsdomError] " + msg);
});
virtualConsole.on("error", (...args) => errors.push("[console.error] " + args.map(String).join(" ")));
virtualConsole.on("warn", (...args) => logs.push("[warn] " + args.map(String).join(" ")));
virtualConsole.on("log", (...args) => logs.push("[log] " + args.map(String).join(" ")));

const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

const dom = new JSDOM(html, {
  url: "http://localhost:3000/",
  runScripts: "outside-only",
  pretendToBeVisual: true,
  virtualConsole
});

const { window } = dom;

// ---- Polyfills jsdom doesn't provide ----
if (!window.CompressionStream) {
  // eslint-disable-next-line no-undef
  window.CompressionStream = class {
    constructor(fmt) { this.fmt = fmt; }
  };
}
if (!window.DecopmressionStream && !window.DecompressionStream) {
  window.DecompressionStream = class { constructor(fmt) { this.fmt = fmt; } };
}
if (!window.fetch) {
  window.fetch = async () => ({ ok: false, status: 0, text: async () => "no fetch" });
}
if (!window.matchMedia) {
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
}
window.scrollTo = () => {};
window.HTMLElement.prototype.scrollIntoView = () => {};

// Expose globals the modules expect
globalThis.window = window;
globalThis.document = window.document;
try { Object.defineProperty(globalThis, "navigator", { value: window.navigator, configurable: true }); } catch (_) {}
globalThis.localStorage = window.localStorage;
globalThis.HTMLElement = window.HTMLElement;
globalThis.HTMLInputElement = window.HTMLInputElement;
globalThis.Node = window.Node;
globalThis.Event = window.Event;
globalThis.CustomEvent = window.CustomEvent;
globalThis.DOMParser = window.DOMParser;
globalThis.Blob = window.Blob;
globalThis.URL = window.URL;
globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
globalThis.AbortController = globalThis.AbortController || window.AbortController;
globalThis.TextDecoder = globalThis.TextDecoder || window.TextDecoder;
globalThis.getComputedStyle = window.getComputedStyle.bind(window);
globalThis.MutationObserver = window.MutationObserver;
globalThis.Worker = class { constructor() {} postMessage() {} terminate() {} addEventListener() {} };
globalThis.URL.createObjectURL = () => "blob:mock";
globalThis.URL.revokeObjectURL = () => {};
window.URL.createObjectURL = () => "blob:mock";
window.URL.revokeObjectURL = () => {};

const results = [];
function check(name, fn) {
  try {
    const r = fn();
    results.push({ name, ok: true, info: r });
  } catch (e) {
    results.push({ name, ok: false, info: e.message, stack: e.stack });
  }
}

// Fire DOMContentLoaded after importing main.js (main.js registers listener)
const { pathToFileURL } = await import("node:url");
const mainUrl = pathToFileURL(path.join(root, "src/js/main.js")).href;

try {
  await import(mainUrl);
} catch (e) {
  errors.push("[import main.js] " + (e.stack || e.message));
}

const ev = new window.Event("DOMContentLoaded", { bubbles: true });
window.document.dispatchEvent(ev);

await new Promise((r) => setTimeout(r, 400));

const $ = (sel) => window.document.querySelector(sel);
const $$ = (sel) => Array.from(window.document.querySelectorAll(sel));

check("match grid has 8 rows", () => {
  const n = $$("#matchGridForm .match-row-item").length;
  if (n !== 8) throw new Error("expected 8 rows, got " + n);
  return n + " rows";
});

check("top goals grid has 16 rows", () => {
  const n = $$("#topGoalsForm .top-goal-row-item").length;
  if (n !== 16) throw new Error("expected 16 rows, got " + n);
  return n + " rows";
});

check("B8 toggle button exists", () => {
  const b = $("#btnToggleB8");
  if (!b) throw new Error("btnToggleB8 missing");
  return "ok";
});

check("bagan panel exists", () => {
  if (!$("#baganOutput")) throw new Error("baganOutput missing");
  return "ok";
});

// Fill B1..B8 then generate bagan
const homeTeams = ["Czech", "Chile", "England", "Brazil", "Argentina", "Spain", "Germany", "France"];
const awayTeams = ["Portugal", "France", "Wales", "Argentina", "Wales", "Italy", "Netherlands", "Togo"];
$$("#matchGridForm .match-row-item").forEach((row, i) => {
  const h = row.querySelector(".match-home");
  const s = row.querySelector(".match-score");
  const a = row.querySelector(".match-away");
  h.value = homeTeams[i]; h.dispatchEvent(new window.Event("input", { bubbles: true }));
  s.value = "2:1"; s.dispatchEvent(new window.Event("input", { bubbles: true }));
  a.value = awayTeams[i]; a.dispatchEvent(new window.Event("input", { bubbles: true }));
});
const seedInput = window.document.getElementById("baganSeedInput");
if (seedInput) seedInput.value = "LIVE123";
$("#btnGenerateBagan")?.click();
await new Promise((r) => setTimeout(r, 200));

check("bagan renders schedule table + knockout bracket", () => {
  const txt = $("#baganOutput")?.textContent || "";
  if (/Isi B1-B8 minimal/i.test(txt)) throw new Error("bagan still empty: " + txt.slice(0, 120));
  if (!/TABEL SCHEDULE ROUND 1/i.test(txt)) throw new Error("tabel schedule R1 tidak muncul: " + txt.slice(0, 160));
  if (!/BAGAN KNOCKOUT/i.test(txt)) throw new Error("bagan knockout tidak muncul: " + txt.slice(0, 160));
  const rows = $$("#baganOutput table tbody tr").length;
  if (rows !== 8) throw new Error("tabel schedule harus 8 baris B1-B8, dapat " + rows);
  return `schedule ${rows} baris + bracket ok`;
});

// === PREDICT: pastikan dashboard (tabel skor + GLOBAL TOP GOALS) benar-benar dirender ===
$("#btnPredict")?.click();
await new Promise((r) => setTimeout(r, 1500));

check("predict panel visible", () => {
  if ($("#predictPanel")?.classList.contains("hidden")) throw new Error("predictPanel masih hidden");
  return "ok";
});

check("predict dashboard renders per-match cards", () => {
  const n = $$("#predictOutput .pred-card").length;
  if (n < 1) throw new Error("tidak ada pred-card (dashboard tidak dirender)");
  return n + " kartu";
});

check("predict renders GLOBAL TOP GOALS table", () => {
  const txt = $("#predictOutput")?.textContent || "";
  if (!/GLOBAL TOP GOALS/i.test(txt)) throw new Error("tabel GLOBAL TOP GOALS tidak muncul");
  const tbl = $$("#predictOutput table.result-table").length;
  if (tbl < 1) throw new Error("tabel result-table tidak ditemukan");
  return "ok";
});

check("predict renders per-match score table", () => {
  const txt = $("#predictOutput")?.textContent || "";
  if (!/SKOR PRED/i.test(txt)) throw new Error("tabel SKOR PRED tidak muncul");
  return "ok";
});

check("predict renders top goals section per match", () => {
  const txt = $("#predictOutput")?.textContent || "";
  if (!/PREDIKSI PENCETAK GOL/i.test(txt)) throw new Error("section TOP GOALS per match tidak muncul");
  return "ok";
});

check("predict output has no error banner", () => {
  const txt = $("#predictOutput")?.textContent || "";
  if (/Prediction Pipeline Error/i.test(txt)) throw new Error("predict error: " + txt.slice(0, 200));
  return "ok";
});

const stateMod = await import(pathToFileURL(path.join(root, "src/js/state/appState.js")).href);

check("state persisted home/away for B1", () => {
  const sm = stateMod.StateManager;
  const m = sm.homeQuery.matches[0];
  if (m.home !== "Czech" || m.away !== "Portugal") throw new Error("B1 not stored: " + JSON.stringify(m));
  return JSON.stringify(m);
});

// === APPLY PREDICTION (SPEC R — tidak auto menimpa dataset) ===
check("apply bar (APPLY SCORES / TOP GOALS) tersedia", () => {
  if (!$("#btnApplyScores")) throw new Error("#btnApplyScores tidak ditemukan");
  if (!$("#btnApplyGoals")) throw new Error("#btnApplyGoals tidak ditemukan");
  if (!$("#btnApplyBoth")) throw new Error("#btnApplyBoth tidak ditemukan");
  return "ok";
});

$("#btnApplyBoth")?.click();
await new Promise((r) => setTimeout(r, 400));

check("APPLY SCORES mengisi skor B1-B8", () => {
  const m = stateMod.StateManager.homeQuery.matches;
  const filled = m.filter(x => /^\d+:\d+$/.test(x.score || "")).length;
  if (filled < 8) throw new Error("skor terisi " + filled + "/8");
  return filled + "/8";
});

check("APPLY GOALS mengisi G1-G16", () => {
  const g = stateMod.StateManager.homeQuery.topGoals;
  const filled = g.filter(x => (x.player || "").trim() && (x.country || "").trim()).length;
  if (filled < 1) throw new Error("top goals kosong setelah apply");
  return filled + "/16";
});

check("APPLY tersimpan ke localStorage (persist)", () => {
  const raw = window.localStorage.getItem("we10_tiktok_form_v1");
  if (!raw) throw new Error("homeQuery tidak tersimpan di localStorage");
  const parsed = JSON.parse(raw);
  const filled = (parsed.matches || []).filter(x => /^\d+:\d+$/.test(x.score || "")).length;
  if (filled < 8) throw new Error("skor tidak ikut tersimpan: " + filled);
  return "ok";
});

check("grid B1-B8 menampilkan skor hasil apply", () => {
  const rows = $$("#matchGridForm .match-row-item");
  const s0 = rows[0]?.querySelector(".match-score")?.value || "";
  if (!/^\d+:\d+$/.test(s0)) throw new Error("B1 score di grid kosong: " + s0);
  return s0;
});

// === WHAT IF ===
const wiHome = window.document.getElementById("whatIfHome");
const wiAway = window.document.getElementById("whatIfAway");
const wiHg = window.document.getElementById("whatIfHomeGoals");
const wiAg = window.document.getElementById("whatIfAwayGoals");
if (wiHome) wiHome.value = "Argentina";
if (wiAway) wiAway.value = "Wales";
if (wiHg) wiHg.value = "2";
if (wiAg) wiAg.value = "1";
$("#btnWhatIfRun")?.click();
await new Promise((r) => setTimeout(r, 400));

check("WHAT IF renders top goals", () => {
  const txt = $("#whatIfOutput")?.textContent || "";
  if (/⛔/.test(txt)) throw new Error("whatIf error: " + txt.slice(0, 200));
  if (!/TOP GOALS/i.test(txt)) throw new Error("whatIf tidak menampilkan top goals: " + txt.slice(0, 160));
  if (!/2 : 1|2 - 1|Argentina/i.test(txt)) throw new Error("whatIf hasil tidak sesuai: " + txt.slice(0, 160));
  return txt.slice(0, 70).replace(/\s+/g, " ");
});

check("WHAT IF allocates exactly 3 goals", () => {
  const txt = $("#whatIfOutput")?.textContent || "";
  const gol = [...txt.matchAll(/(\d+) GOL/g)].reduce((s, m) => s + Number(m[1]), 0);
  if (gol !== 3) throw new Error("total gol ter-alokasi = " + gol + " (harus 3)");
  return "3 gol";
});

// === IMPORT MATCHES ===
const importTa = window.document.getElementById("importMatchesTextarea");
if (importTa) importTa.value = "Spain 3:2 England\nGermany 1-0 France\nBrazil 2:2 Argentina";
$("#btnImportMatches")?.click();
await new Promise((r) => setTimeout(r, 200));

check("import matches fills B1-B3", () => {
  const m = stateMod.StateManager.homeQuery.matches;
  if (m[0].home !== "Spain" || m[0].score !== "3:2" || m[0].away !== "England") {
    throw new Error("B1 salah: " + JSON.stringify(m[0]));
  }
  if (m[1].home !== "Germany" || m[1].score !== "1:0") throw new Error("B2 salah: " + JSON.stringify(m[1]));
  if (m[2].home !== "Brazil" || m[2].score !== "2:2") throw new Error("B3 salah: " + JSON.stringify(m[2]));
  return "B1-B3 ok";
});

check("import matches updates the visible grid", () => {
  const rows = $$("#matchGridForm .match-row-item");
  const h0 = rows[0]?.querySelector(".match-home")?.value;
  if (h0 !== "Spain") throw new Error("grid B1 tidak terupdate: " + h0);
  return "ok";
});

// restore B1-B8 for further checks
$$("#matchGridForm .match-row-item").forEach((row, i) => {
  const h = row.querySelector(".match-home");
  const s = row.querySelector(".match-score");
  const a = row.querySelector(".match-away");
  h.value = homeTeams[i]; h.dispatchEvent(new window.Event("input", { bubbles: true }));
  s.value = "2:1"; s.dispatchEvent(new window.Event("input", { bubbles: true }));
  a.value = awayTeams[i]; a.dispatchEvent(new window.Event("input", { bubbles: true }));
});
await new Promise((r) => setTimeout(r, 150));

// Top goals fill
const tg = $$("#topGoalsForm .top-goal-row-item");
tg.forEach((row, i) => {
  const c = row.querySelector(".goal-country");
  const p = row.querySelector(".goal-player");
  const g = row.querySelector(".goal-amount");
  if (c) { c.value = homeTeams[i % 8]; c.dispatchEvent(new window.Event("input", { bubbles: true })); }
  if (p) { p.value = "Player" + i; p.dispatchEvent(new window.Event("input", { bubbles: true })); }
  if (g) { g.value = String(i + 1); g.dispatchEvent(new window.Event("input", { bubbles: true })); }
});
await new Promise((r) => setTimeout(r, 100));

check("top goals persisted", () => {
  const g = stateMod.StateManager.homeQuery.topGoals[0];
  if (!g || g.country !== "Czech" || g.player !== "Player0" || g.goals !== "1") {
    throw new Error("G1 tidak tersimpan: " + JSON.stringify(g));
  }
  return JSON.stringify(g);
});

// === MEMORY DATABASE: create → open editor → grid reflects editor source ===
$("#btnOpenDatabase")?.click();
await new Promise((r) => setTimeout(r, 120));
check("database modal renders slots", () => {
  const cards = $$("#databaseModalList .db-card").length;
  if (cards < 7) throw new Error("slot memory kurang dari 7: " + cards);
  return cards + " slot";
});
$("#databaseModalList .btn-create-mem")?.click();
await new Promise((r) => setTimeout(r, 200));

check("editor view opens for memory 1", () => {
  if (stateMod.StateManager.activeMemoryId !== 1) throw new Error("activeMemoryId = " + stateMod.StateManager.activeMemoryId);
  if ($("#editorNav")?.classList.contains("hidden")) throw new Error("editorNav masih hidden");
  return "ok";
});

check("memory game has 8 matches + 16 topGoals", () => {
  const g = stateMod.StateManager.db.memories[1]?.games?.[0];
  if (!g) throw new Error("game tidak dibuat");
  if (g.matches.length !== 8) throw new Error("matches = " + g.matches.length);
  if (g.topGoals.length !== 16) throw new Error("topGoals = " + g.topGoals.length);
  return "8/16";
});

// Kembali ke home view
$("#btnExitEditor")?.click();
await new Promise((r) => setTimeout(r, 150));
check("exit editor returns to matching center", () => {
  if (stateMod.StateManager.activeMemoryId !== null) throw new Error("activeMemoryId masih " + stateMod.StateManager.activeMemoryId);
  return "ok";
});

// === SIMILARITY SEARCH (fallback jalan di main thread karena jsdom tanpa Worker) ===
$("#btnRunMatch")?.click();
await new Promise((r) => setTimeout(r, 400));
check("similarity search runs without throwing", () => {
  const txt = $("#resultsOutput")?.textContent || "";
  if (/Error Search/i.test(txt)) throw new Error("search error: " + txt.slice(0, 200));
  return txt.slice(0, 60).replace(/\s+/g, " ") || "ok";
});

// === TIKTOK .pnach GENERATOR (tanpa template → fallback pnach) ===
$("#btnGeneratePnach")?.click();
await new Promise((r) => setTimeout(r, 200));
check("pnach generator produces output", () => {
  const txt = $("#tiktokSyncOutput")?.textContent || "";
  if (!/\.pnach generated|9337F97/i.test(txt)) throw new Error("pnach tidak tergenerate: " + txt.slice(0, 200));
  return "ok";
});

// === TIKTOK JSON DOWNLOAD ===
$("#btnDownloadTikTokJson")?.click();
await new Promise((r) => setTimeout(r, 150));
check("tiktok json generator produces output", () => {
  const txt = $("#tiktokSyncOutput")?.textContent || "";
  if (!/tiktok_live\.json/i.test(txt)) throw new Error("json tidak tergenerate: " + txt.slice(0, 200));
  return "ok";
});

console.log("\n===== SMOKE TEST RESULTS =====");
let fails = 0;
for (const r of results) {
  if (r.ok) console.log(`  ✓ ${r.name} — ${r.info}`);
  else { fails++; console.log(`  ✗ ${r.name} — ${r.info}`); }
}
if (errors.length) {
  console.log("\n===== RUNTIME ERRORS =====");
  errors.forEach(e => console.log("  " + e.split("\n").slice(0, 6).join("\n    ")));
}
console.log(`\n${results.length - fails}/${results.length} passed, ${errors.length} runtime errors`);
process.exit(fails || errors.length ? 1 : 0);
