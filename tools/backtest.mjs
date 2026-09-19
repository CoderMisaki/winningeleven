/**
 * ============================================================================
 *  CLI BACKTEST — walk-forward, tanpa kebocoran data (no leakage)
 * ============================================================================
 *
 *  Menjalankan backtest model produksi (player-attribute v7, event-based)
 *  dan MEMBANDINGKANNYA dengan model lama (position weight heuristik) serta
 *  baseline most-common-scoreline — memakai data nyata dari knowledge.json
 *  (hasil observasi gameplay, bukan ROM).
 *
 *  Usage:
 *    node tools/backtest.mjs                              # knowledge.json, 200 MC sim/fixture
 *    node tools/backtest.mjs --sims=400                   # MC lebih berat
 *    node tools/backtest.mjs --file=path/ke/data.json     # dataset lain (format memory)
 *    node tools/backtest.mjs --json                       # cetak JSON mentah saja
 *
 *  Output: tabel di terminal + file BACKTEST_REPORT.md
 * ============================================================================
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

// --- shim localStorage (backtest jalan di Node tanpa browser) ---
if (!globalThis.localStorage) {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
    key: (i) => [...store.keys()][i] ?? null,
    get length() { return store.size; }
  };
}

const { StateManager } = await import("../src/js/state/appState.js");
const { runWalkForwardBacktest } = await import("../src/js/services/backtestEngine.js");
const { PREDICTOR_CONFIG } = await import("../src/js/services/predictor.js");

const argOf = (name, def) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=").slice(1).join("=") : def;
};
const fileArg = argOf("file", path.join(root, "src/js/knowledge.json"));
const sims = parseInt(argOf("sims", "200"), 10) || 200;
const jsonOnly = process.argv.includes("--json");

const dataPath = path.isAbsolute(fileArg) ? fileArg : path.join(root, fileArg);
const raw = JSON.parse(fs.readFileSync(dataPath, "utf8"));

// Normalisasi: file bisa berupa satu memory atau { memories: {...} }
const memories = {};
if (raw && Array.isArray(raw.games)) {
  const id = Number(raw.memoryNumber || 1);
  memories[id] = {
    memoryNumber: id,
    memoryName: raw.memoryName || `Backtest memory ${id}`,
    version: raw.version || 1,
    createdAt: raw.createdAt || null,
    lastUpdate: raw.lastUpdate || null,
    totalGames: raw.games.length,
    games: raw.games
  };
} else if (raw && raw.memories) {
  for (const [k, v] of Object.entries(raw.memories)) {
    if (v && Array.isArray(v.games) && v.games.length) memories[k] = v;
  }
}
const memoryId = Number(Object.keys(memories)[0] || 1);
if (!memories[memoryId]) {
  console.error(`Tidak ada games di ${dataPath}`);
  process.exit(1);
}

StateManager.db = { maxSlot: 7, memories };

const games = memories[memoryId].games.length;
const matches = memories[memoryId].games.reduce((s, g) => s + (g.matches?.length || 0), 0);
console.log(`\n📊 BACKTEST — ${path.relative(root, dataPath)} (memory ${memoryId})`);
console.log(`   ${games} game, ${matches} match, MC ${sims} sim/fixture, model: ${PREDICTOR_CONFIG.MODEL_VERSION}\n`);

const t0 = performance.now();
const res = runWalkForwardBacktest(memoryId, { modelOpts: { probsSims: sims } });
const elapsed = ((performance.now() - t0) / 1000).toFixed(1);

if (res.error) {
  console.error("ERROR:", res.error);
  process.exit(1);
}

if (jsonOnly) {
  console.log(JSON.stringify(res, null, 2));
  process.exit(0);
}

const pct = (v) => `${v.toFixed(1)}%`;
const num = (v) => v.toFixed(3);
const row = (label, player, legacy, delta, d = 1) =>
  `| ${label} | ${player} | ${legacy} | ${delta} |`;

const p = res.modelComparison.playerAttribute;
const l = res.modelComparison.legacyWeight;
const d = res.modelComparison.delta;
const mc = res.baselines.mostCommon;

const table = [
  "| Metrik | Player-attribute v7 (baru) | Legacy position-weight (lama) | Delta |",
  "|---|---|---|---|",
  row("Exact score accuracy", pct(p.exactScoreAccuracy), pct(l.exactScoreAccuracy), `${d.exactScoreAccuracy >= 0 ? "+" : ""}${d.exactScoreAccuracy.toFixed(2)} pt`),
  row("1X2 accuracy", pct(p.result1X2Accuracy), pct(l.result1X2Accuracy), `${d.result1X2Accuracy >= 0 ? "+" : ""}${d.result1X2Accuracy.toFixed(2)} pt`),
  row("Top-3 scoreline hit", pct(p.top3ScoreHitRate), pct(l.top3ScoreHitRate), `${d.top3ScoreHitRate >= 0 ? "+" : ""}${d.top3ScoreHitRate.toFixed(2)} pt`),
  row("Top-5 scoreline hit", pct(p.top5ScoreHitRate), pct(l.top5ScoreHitRate), `${d.top5ScoreHitRate >= 0 ? "+" : ""}${d.top5ScoreHitRate.toFixed(2)} pt`),
  row("MAE home goals", num(p.maeHomeGoals), num(l.maeHomeGoals), `${d.maeHomeGoals <= 0 ? "" : "+"}${d.maeHomeGoals.toFixed(3)}`),
  row("MAE away goals", num(p.maeAwayGoals), num(l.maeAwayGoals), `${d.maeAwayGoals <= 0 ? "" : "+"}${d.maeAwayGoals.toFixed(3)}`),
  row("Brier score (lower better)", num(p.meanBrierScore), num(l.meanBrierScore), `${(p.meanBrierScore - l.meanBrierScore).toFixed(3)}`),
  row("LogLoss (lower better)", num(p.meanLogLoss), num(l.meanLogLoss), `${(p.meanLogLoss - l.meanLogLoss).toFixed(3)}`),
  row("Top scorer hit (top-3 prediksi)", pct(p.topScorerHitRate), pct(l.topScorerHitRate), `${d.topScorerHitRate >= 0 ? "+" : ""}${d.topScorerHitRate.toFixed(2)} pt`),
  row("Top scorer exact (peringkat 1)", pct(p.topScorerExactHitRate), pct(l.topScorerExactHitRate), "—"),
  row("Scorer distribution accuracy", pct(p.scorerDistributionAccuracy), pct(l.scorerDistributionAccuracy), `${d.scorerDistributionAccuracy >= 0 ? "+" : ""}${d.scorerDistributionAccuracy.toFixed(2)} pt`),
  row("Scorer distribution TVD (lower better)", pct(p.scorerDistributionTVD), pct(l.scorerDistributionTVD), "—")
];

console.log(table.join("\n"));
console.log(`\nBaseline most-common-scoreline : exact ${pct(mc.exact)} | MAE ${num(mc.maeH)}/${num(mc.maeA)}`);
console.log(`Fixture dievaluasi            : ${res.totalTested}`);
console.log(`Sampel top scorer (topGoals)  : ${p.topScorerSamples} fixture`);
console.log(`Leakage audit                 : ${res.leakageAudit}`);
console.log(`Runtime                       : ${elapsed}s\n`);

const report = `# Backtest Report — WE10 Player Model v7

Dijalankan: ${new Date().toISOString()} · Data: \`${path.relative(root, dataPath)}\` (${games} game, ${matches} match, ${res.totalTested} fixture dievaluasi) · MC ${sims} sim/fixture · Runtime ${elapsed}s

> Metode: **walk-forward** — prediksi game ke-k hanya memakai game < k (team form \`extractDataset(memoryId, null, fromGameNumber)\`, player form \`exclude.fromGameNumber\`). Tidak ada skor/topGoals masa depan yang bocor.
> Data sumber = observasi gameplay (knowledge.json), **bukan** decode ROM. Atribut pemain = derived/estimated (lihat \`src/js/data/playerAttributes.js\`).

## Model baru vs model lama

${table.join("\n")}

## Baseline

| Baseline | Exact score | MAE H | MAE A |
|---|---|---|---|
| Most-common scoreline | ${pct(mc.exact)} | ${num(mc.maeH)} | ${num(mc.maeA)} |
| Legacy position-weight | ${pct(l.exactScoreAccuracy)} | ${num(l.maeHomeGoals)} | ${num(l.maeAwayGoals)} |
| **Player-attribute v7** | **${pct(p.exactScoreAccuracy)}** | **${num(p.maeHomeGoals)}** | **${num(p.maeAwayGoals)}** |

## Catatan metodologi

- **Team Model**: \`teamRatings.js\` (estimasi 57 tim) + form tim dari histori → jumlah/ kualitas chance.
- **Player Model**: \`playerAttributes.js\` — 12 atribut per pemain (derived/estimated, slot override untuk data ROM terverifikasi); tidak ada STAR_OVERRIDES, tidak ada nama dummy.
- **Match/Goal Event Model**: \`playerScoring.js\` — chance → pemilihan pemain (role posisi × atribut × form × stamina) → shot probability vs defense lawan → goal/miss. Skor adalah konsekuensi event, bukan alokasi nama acak.
- **Kalibrasi**: skala konversi dari dataset (shrinkage), bukan tuning manual per pemain.
- **RNG**: LCG deterministik (Numerical Recipes) — implementasi sendiri, **bukan** replika RNG ROM WE10.
- **Yang masih estimated/unverified**: seluruh nilai atribut pemain (derived), rating tim (rekap eksternal), dan kalibrasi skala global. Tidak ada klaim identik 100% dengan WE10 tanpa bukti reverse-engineering.

## Leakage audit

${res.leakageAudit}
`;

const outPath = path.join(root, "BACKTEST_REPORT.md");
fs.writeFileSync(outPath, report, "utf8");
console.log(`📄 Report ditulis: ${path.relative(process.cwd(), outPath)}`);
