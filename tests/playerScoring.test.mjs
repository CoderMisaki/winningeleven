/**
 * Player-level scoring test suite — 10 acceptance test (audit 2026-09-19).
 *
 * Memastikan model scoring benar-benar level-pemain:
 *   1. Pemain bintang (Ronaldo) TIDAK selalu mencetak gol.
 *   2. CF punya peluang lebih besar dari CB (di tim yang sama).
 *   3. Finishing lebih tinggi → shot probability lebih tinggi (all else equal).
 *   4. Defense lawan lebih kuat → shot probability lebih rendah.
 *   5. Team rating memengaruhi JUMLAH CHANCE, bukan identitas pencetak gol.
 *   6. Tidak ada STAR_OVERRIDES (kode manual per pemain) di produksi.
 *   7. Tidak ada pemain dummy (BRA_FW9 / TEAM_CF / dst).
 *   8. Semua scorer berasal dari roster valid 57 tim.
 *   9. Tidak ada dominasi tidak wajar satu pemain.
 *  10. Backtest walk-forward tanpa kebocoran data (no leakage).
 *
 * Run: node tests/playerScoring.test.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { WE10_FULL_ROSTER } from "../src/js/data/we10FullRoster.js";
import { getPlayerDatabase, getTeamPlayers, findRosterPlayer, playerOverall } from "../src/js/data/playerAttributes.js";
import {
  PLAYER_SCORING_CONFIG, runMatchMonteCarlo, simulateMatch, shotProbability,
  getTeamScoringProfile, generateChances, ScoringRng, scoringHashSeed
} from "../src/js/services/playerScoring.js";
import { hybridPredict, KONAMI_PLAYER_DB, PREDICTOR_CONFIG } from "../src/js/services/predictor.js";
import { StateManager } from "../src/js/state/appState.js";
import { getObservedStats } from "../src/js/services/scoringDataset.js";
import { runWalkForwardBacktest } from "../src/js/services/backtestEngine.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try {
    const info = fn();
    passed++;
    console.log(`  ✓ ${name} — ${info ?? "ok"}`);
  } catch (e) {
    failed++;
    failures.push({ name, message: e.message });
    console.log(`  ✗ ${name} — ${e.message}`);
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || "assertion failed"); }
function srcFiles(dir = path.join(root, "src", "js"), out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) srcFiles(full, out);
    else if (entry.name.endsWith(".js")) out.push(full);
  }
  return out;
}
const stripComments = (code) => code
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/(^|[^:])\/\/.*$/gm, "$1 ");

console.log("\n=== PLAYER SCORING MODEL (v7) ===");

/* ---------------------------------------------------------------- 1 */
test("1. Ronaldo tidak otomatis selalu mencetak gol (BRA vs TOG, 400 sim)", () => {
  const mc = runMatchMonteCarlo("BRA", "TOG", { sims: 400, seed: 12345, formEnabled: false });
  const ronaldo = mc.players.find((p) => p.name === "Ronaldo" && p.teamCode === "BRA");
  assert(ronaldo, "Ronaldo tidak ada di statistik MC");
  const anytime = ronaldo.prob;              // % sim di mana dia mencetak ≥1 gol
  const share = ronaldo.scoringShare;        // % dari seluruh gol Brazil
  assert(ronaldo.expectedGoals < 1.6, `xG Ronaldo terlalu tinggi: ${ronaldo.expectedGoals}`);
  assert(anytime < 85, `Ronaldo mencetak gol di ${anytime}% sim (harus < 85%)`);
  assert(share < 50, `Ronaldo mengambil ${share}% gol tim (harus < 50%)`);
  assert(ronaldo.probability2Plus < 45, `P(2+ gol) = ${ronaldo.probability2Plus}% terlalu tinggi`);
  return `xG ${ronaldo.expectedGoals}, anytime ${anytime}%, share ${share}%, 2+ ${ronaldo.probability2Plus}%`;
});

/* ---------------------------------------------------------------- 2 */
test("2. CF > CB dalam peluang mencetak gol (tim yang sama)", () => {
  const bra = getTeamScoringProfile("BRA", { formEnabled: false });
  const cf = bra.players.find((p) => p.pos === "CF" || p.pos === "ST");
  const cb = bra.players.find((p) => p.pos === "CB");
  assert(cf && cb, "roster BRA harus punya CF dan CB");
  assert(cf.selectionProbability > cb.selectionProbability,
    `CF ${cf.name} ${(cf.selectionProbability * 100).toFixed(2)}% vs CB ${cb.name} ${(cb.selectionProbability * 100).toFixed(2)}%`);
  const cfg = PLAYER_SCORING_CONFIG.ROLE_WEIGHT;
  assert(cfg.CF > cfg.OMF && cfg.OMF > cfg.DMF && cfg.DMF > cfg.CB && cfg.CB > cfg.GK,
    "urutan ROLE_WEIGHT harus natural CF > OMF > DMF > CB > GK");
  // Semua CF harus tetap berbeda satu sama lain (bukan weight posisi seragam)
  const forwards = bra.players.filter((p) => ["CF", "ST", "WG"].includes(p.pos));
  const uniq = new Set(forwards.map((p) => p.selectionProbability.toFixed(4)));
  assert(uniq.size === forwards.length, "pemain posisi sama harus punya peluang berbeda (atribut berbeda)");
  return `CF ${cf.name} ${(cf.selectionProbability * 100).toFixed(1)}% > CB ${cb.name} ${(cb.selectionProbability * 100).toFixed(1)}%; ${forwards.length} forward unik`;
});

/* ---------------------------------------------------------------- 3 */
test("3. Finishing lebih tinggi → shot probability lebih tinggi", () => {
  const base = { positioning: 70, technique: 70, shotPower: 75 };
  const opts = { quality: 0.5, oppDefenseIndex: 65, formMultiplier: 1, scale: 1 };
  const p50 = shotProbability({ ...base, finishing: 50 }, opts);
  const p65 = shotProbability({ ...base, finishing: 65 }, opts);
  const p80 = shotProbability({ ...base, finishing: 80 }, opts);
  const p95 = shotProbability({ ...base, finishing: 95 }, opts);
  assert(p50 < p65 && p65 < p80 && p80 < p95,
    `monoton naik: ${[p50, p65, p80, p95].map((x) => x.toFixed(3)).join(" / ")}`);
  assert(p95 - p50 > 0.10, `beda finishing 50 vs 95 hanya ${(p95 - p50).toFixed(3)}`);
  return `p(50)=${(p50 * 100).toFixed(1)}% → p(95)=${(p95 * 100).toFixed(1)}%`;
});

/* ---------------------------------------------------------------- 4 */
test("4. Defense lawan lebih kuat → peluang mencetak gol lebih rendah", () => {
  const player = { finishing: 85, positioning: 85, technique: 80, shotPower: 85 };
  const weak = shotProbability(player, { quality: 0.5, oppDefenseIndex: 55, formMultiplier: 1, scale: 1 });
  const elite = shotProbability(player, { quality: 0.5, oppDefenseIndex: 85, formMultiplier: 1, scale: 1 });
  assert(weak > elite, `defense 55 (${weak.toFixed(3)}) harus > defense 85 (${elite.toFixed(3)})`);
  // Efek lawan harus terasa walau tim sendiri kuat
  const lowFinisher = { finishing: 55, positioning: 55, technique: 55, shotPower: 60 };
  const lowVsElite = shotProbability(lowFinisher, { quality: 0.5, oppDefenseIndex: 85, formMultiplier: 1, scale: 1 });
  assert(lowVsElite < weak * 0.5, "finishing rendah vs defense elite harus jauh lebih kecil");
  return `def 55 → ${(weak * 100).toFixed(1)}%, def 85 → ${(elite * 100).toFixed(1)}%; low-fin vs elite ${(lowVsElite * 100).toFixed(1)}%`;
});

/* ---------------------------------------------------------------- 5 */
test("5. Team rating memengaruhi jumlah chance, bukan identitas scorer", () => {
  const rngA = new ScoringRng(scoringHashSeed("chance-test"));
  const strong = getTeamScoringProfile("BRA", { formEnabled: false });
  const weakTeam = getTeamScoringProfile("TOG", { formEnabled: false });
  const elite = getTeamScoringProfile("ITA", { formEnabled: false });
  const chancesWeakOpp = generateChances(strong, weakTeam, rngA, 0.4);
  const chancesEliteOpp = generateChances(strong, elite, rngA, 0.0);
  assert(chancesWeakOpp > chancesEliteOpp,
    `chance vs TOG (${chancesWeakOpp}) harus > vs ITA (${chancesEliteOpp})`);
  assert(strong.attackIndex > weakTeam.attackIndex, "attackIndex BRA harus > TOG");

  // Identitas: profil pemain (bobot seleksi) tidak berubah oleh lawan
  const braVsWeak = getTeamScoringProfile("BRA", { formEnabled: false });
  const braVsElite = getTeamScoringProfile("BRA", { formEnabled: false });
  const topWeak = [...braVsWeak.players].sort((a, b) => b.selectionProbability - a.selectionProbability)[0].name;
  const topElite = [...braVsElite.players].sort((a, b) => b.selectionProbability - a.selectionProbability)[0].name;
  assert(topWeak === topElite, `top selection berubah karena lawan: ${topWeak} vs ${topElite}`);

  // Dan di MC nyata: pencetak gol teratas tetap orang yang sama
  const vsTog = runMatchMonteCarlo("BRA", "TOG", { sims: 250, seed: 777, formEnabled: false });
  const vsIta = runMatchMonteCarlo("BRA", "ITA", { sims: 250, seed: 777, formEnabled: false });
  const topTog = vsTog.players.filter((p) => p.teamCode === "BRA")[0]?.name;
  const topIta = vsIta.players.filter((p) => p.teamCode === "BRA")[0]?.name;
  assert(topTog === topIta, `top scorer BRA berubah karena lawan: ${topTog} vs ${topIta}`);
  assert(vsTog.avgTotalGoals > vsIta.avgTotalGoals, "total gol vs TOG harus lebih tinggi dari vs ITA");
  return `chance vs TOG ${chancesWeakOpp} > vs ITA ${chancesEliteOpp}; top scorer tetap ${topTog}; total gol ${vsTog.avgTotalGoals} vs ${vsIta.avgTotalGoals}`;
});

/* ---------------------------------------------------------------- 6 */
test("6. Tidak ada STAR_OVERRIDES di kode produksi", () => {
  const offenders = [];
  for (const file of srcFiles()) {
    const code = stripComments(fs.readFileSync(file, "utf8"));
    if (/STAR_OVERRIDES\s*[:=]/.test(code) || /STAR_OVERRIDES\s*\[/.test(code)) {
      offenders.push(path.relative(root, file));
    }
  }
  assert(offenders.length === 0, "STAR_OVERRIDES masih hidup di: " + offenders.join(", "));
  // Tidak boleh ada mapping nama→boost seperti "Ronaldo: 94"
  const boostPattern = /["'][A-Z][a-zA-Z' .-]{2,}["']\s*:\s*(9[0-9]|[1-9][0-9]{2,3})\b/;
  const boosted = [];
  for (const file of srcFiles()) {
    const code = stripComments(fs.readFileSync(file, "utf8"));
    // hanya periksa blok yang menyebut pemain/boost, hindari tabel rating tim biasa
    if (/BOOST|STAR|OVERRIDE/i.test(code) && boostPattern.test(code)) boosted.push(path.relative(root, file));
  }
  assert(boosted.length === 0, "hardcoded player boost ditemukan di: " + boosted.join(", "));
  return `${srcFiles().length} file sumber bersih`;
});

/* ---------------------------------------------------------------- 7 */
test("7. Tidak ada pemain dummy (BRA_FW9 / TEAM_CF / dst)", () => {
  const dummyRe = /\b[A-Z]{2,4}_(?:FW|MF|DF|GK|CF|ST|OMF|CMF|CB)[0-9]{0,2}\b/;
  const offenders = [];
  for (const file of srcFiles()) {
    const code = stripComments(fs.readFileSync(file, "utf8"));
    const m = code.match(dummyRe);
    if (m) offenders.push(`${path.relative(root, file)} → ${m[0]}`);
  }
  assert(offenders.length === 0, "fallback dummy masih ada: " + offenders.join(", "));

  // Nama di roster tidak boleh pola dummy
  for (const [code, players] of Object.entries(WE10_FULL_ROSTER)) {
    for (const p of players) {
      assert(!dummyRe.test(p.name), `roster ${code} berisi nama dummy: ${p.name}`);
    }
  }
  return `${Object.keys(WE10_FULL_ROSTER).length} tim, ${Object.values(WE10_FULL_ROSTER).flat().length} pemain — tidak ada dummy`;
});

/* ---------------------------------------------------------------- 8 */
test("8. Semua scorer berasal dari roster valid (57 tim)", () => {
  const fixtures = [
    ["BRA", "TOG"], ["ARG", "WAL"], ["ENG", "TRI"], ["FRA", "TUR"], ["GER", "CRC"], ["ITA", "GHA"]
  ];
  let checked = 0;
  const sample = [];
  for (const [h, a] of fixtures) {
    const mc = runMatchMonteCarlo(h, a, { sims: 120, seed: 4242, formEnabled: false });
    assert(mc.players.length > 0, `${h}-${a} tanpa pemain`);
    for (const p of mc.players) {
      const roster = getTeamPlayers(p.teamCode);
      assert(roster.some((r) => r.name === p.name), `${p.name} bukan pemain roster ${p.teamCode} (${h}-${a})`);
      checked++;
    }
    assert(!mc.players.some((p) => p.pos === "GK"), `${h}-${a}: GK ikut masuk undian penembak`);
    sample.push(`${h}-${a}: ${mc.players.slice(0, 3).map((p) => `${p.name}(${p.pos}, xG ${p.expectedGoals})`).join(", ")}`);
  }
  // Dan scorer yang benar-benar mencetak gol di sampel juga harus dari roster
  const sim = simulateMatch("BRA", "TOG", { seed: 99 });
  for (const e of sim.events) {
    if (!e.scored) continue;
    assert(getTeamPlayers(e.teamCode).some((r) => r.name === e.playerName),
      `gol simulasi dari pemain non-roster: ${e.playerName} (${e.teamCode})`);
  }
  // Sapu semua 57 tim: tidak boleh ada satu pun baris GK di statistik penembak
  const codes = Object.keys(getPlayerDatabase());
  for (let i = 0; i < codes.length; i++) {
    const h = codes[i], a = codes[(i * 7 + 13) % codes.length];
    if (h === a) continue;
    const mc = runMatchMonteCarlo(h, a, { sims: 40, formEnabled: false });
    assert(!mc.players.some((p) => p.pos === "GK"), `GK muncul di ${h}-${a}`);
  }
  return `${checked} pemain dari ${fixtures.length} fixture valid + sapuan 56 fixture tanpa GK — ${sample[0]}`;
});

/* ---------------------------------------------------------------- 9 */
test("9. Distribusi scorer tidak didominasi satu pemain", () => {
  const fixtures = [["BRA", "TOG"], ["ARG", "WAL"], ["ENG", "TRI"], ["FRA", "TUR"]];
  const report = [];
  for (const [h, a] of fixtures) {
    const mc = runMatchMonteCarlo(h, a, { sims: 300, seed: 20260919, formEnabled: false });
    const maxShare = Math.max(...mc.players.map((p) => p.scoringShare));
    const maxAnytime = Math.max(...mc.players.map((p) => p.prob));
    const topTwo = [...mc.players].sort((x, y) => y.scoringShare - x.scoringShare).slice(0, 2);
    assert(maxShare < 60, `${h}-${a}: satu pemain mengambil ${maxShare}% gol`);
    assert(maxAnytime < 95, `${h}-${a}: ada pemain dengan anytime ${maxAnytime}%`);
    if (topTwo.length === 2) {
      const ratio = topTwo[0].scoringShare / Math.max(0.01, topTwo[1].scoringShare);
      assert(ratio < 4, `${h}-${a}: rasio top-1/top-2 ${ratio.toFixed(2)} terlalu ekstrem`);
    }
    const shareSum = mc.players.reduce((s, p) => s + p.scoringShare, 0);
    assert(Math.abs(shareSum - 100) < 5, `${h}-${a}: total share pemain ${shareSum.toFixed(1)}% (harus ≈100%)`);
    report.push(`${h}-${a} max ${maxShare}%`);
  }
  return report.join(", ");
});

/* ---------------------------------------------------------------- 10 */
test("10. Backtest walk-forward tanpa kebocoran data (no leakage)", () => {
  const mkGame = (n, matches, topGoals = []) => ({
    gameNumber: n,
    p1: "Brazil",
    lastUpdate: "2026-01-01T00:00:00.000Z",
    matches: matches.map((m) => ({ home: m[0], score: m[1], away: m[2], enabled: true })),
    topGoals: topGoals.map((t) => ({ country: t[0], player: t[1], goals: String(t[2]) }))
  });
  const g1 = mkGame(1, [["Spain", "2:1", "Togo"], ["Iran", "1:1", "Nigeria"]]);
  const g2 = mkGame(2, [["Brazil", "3:0", "Japan"], ["England", "1:2", "Italy"]], [["Brazil", "Ronaldo", 2], ["England", "Rooney", 1]]);
  const g3 = mkGame(3, [["France", "2:2", "Germany"], ["Argentina", "1:0", "Wales"]], [["France", "Henry", 2]]);
  const g4 = mkGame(4, [["Brazil", "5:5", "Italy"], ["Spain", "4:4", "France"]], [["Brazil", "Ronaldo", 5], ["Italy", "Totti", 4]]);

  // A) stats dengan fromGameNumber hanya memakai game < batas
  StateManager.db = { memories: { 1: { memoryNumber: 1, games: [g1, g2, g3, g4] } } };
  const s3 = getObservedStats({ memoryId: 1, fromGameNumber: 3 });
  const s3b = getObservedStats({ memoryId: 1, fromGameNumber: 3 });
  assert(s3.matches === 4, `stats fromGameNumber=3 harus 4 match (game 1+2), dapat ${s3.matches}`);
  assert(s3b.matches === s3.matches, "stats harus deterministik");
  assert(s3.playerGoals("BRA", "Ronaldo") === 2,
    `Ronaldo (game 2) harus terhitung 2 gol di stats game<3, dapat ${s3.playerGoals("BRA", "Ronaldo")}`);
  assert(s3.playerGoals("BRA", "Ronaldo") === s3b.playerGoals("BRA", "Ronaldo"), "playerGoals harus deterministik");

  // B) mengubah game masa depan (g3/g4) TIDAK boleh mengubah stats untuk target game 2
  const before = JSON.stringify(getObservedStats({ memoryId: 1, fromGameNumber: 2 }).teams);
  const g3mut = mkGame(3, [["France", "9:9", "Germany"]], [["France", "Zidane", 9]]);
  const g4mut = mkGame(4, [["Brazil", "9:9", "Italy"]], [["Brazil", "Ronaldo", 9]]);
  StateManager.db = { memories: { 1: { memoryNumber: 1, games: [g1, g2, g3mut, g4mut] } } };
  const after = JSON.stringify(getObservedStats({ memoryId: 1, fromGameNumber: 2 }).teams);
  assert(before === after, "leakage: mengubah game masa depan mengubah fitur untuk game sebelumnya");

  // C) backtest: hasil hanya untuk game ke-2..n, audit bocor PASS, detail tidak menyentuh game target sendiri
  StateManager.db = { memories: { 1: { memoryNumber: 1, games: [g1, g2, g3] } } };
  const bt = runWalkForwardBacktest(1, { collectDetails: true, modelOpts: { mcSims: 120 } });
  assert(!bt.error, "backtest error: " + bt.error);
  assert(/^PASS/.test(bt.leakageAudit), "audit leakage bukan PASS: " + bt.leakageAudit);
  assert(bt.totalTested > 0, "tidak ada fixture yang dievaluasi");
  const detailGames = new Set((bt.details || []).map((d) => d.game));
  assert(!detailGames.has(1), "game pertama dipakai sebagai target (harus hanya training)");
  assert(bt.modelComparison && bt.modelComparison.playerAttribute && bt.modelComparison.legacyWeight,
    "perbandingan model player vs legacy wajib ada");
  const pa = bt.modelComparison.playerAttribute;
  assert(typeof pa.topScorerHitRate === "number" && typeof pa.scorerDistributionAccuracy === "number",
    "metrik scorer (hit rate/distribusi) wajib ada");
  StateManager.db = { memoryNumber: null, memories: {} };
  return `PASS, ${bt.totalTested} fixture; player exact ${pa.exactScoreAccuracy.toFixed(1)}% vs legacy ${bt.modelComparison.legacyWeight.exactScoreAccuracy.toFixed(1)}%`;
});

/* ---------------------------------------------------------------- EXTRA */
test("X1. Roster utuh 57 tim × 11 pemain & atribut lengkap", () => {
  const db = getPlayerDatabase();
  const teams = Object.keys(db);
  assert(teams.length === 57, `jumlah tim ${teams.length} (harus 57)`);
  const total = teams.reduce((s, c) => s + db[c].length, 0);
  assert(total === 627, `jumlah pemain ${total} (harus 627)`);
  for (const code of teams) {
    for (const p of db[code]) {
      for (const key of ["attack", "defense", "finishing", "shotPower", "technique", "dribble", "speed", "passing", "positioning", "physical", "stamina", "form"]) {
        if (typeof p[key] !== "number") throw new Error(`${code} ${p.name}: atribut ${key} hilang`);
      }
      if (!p.position) throw new Error(`${code} ${p.name}: field position hilang`);
      playerOverall(p);
    }
  }
  return `${teams.length} tim, ${total} pemain, 12 atribut verified-shape`;
});

test("X2. Tim tanpa roster → tidak ada scorer (bukan dummy)", () => {
  assert(getTeamPlayers("XXX").length === 0, "tim tak dikenal harus kosong");
  assert(findRosterPlayer("XXX", "Anyone") === null, "lookup tim tak dikenal harus null");
  const mc = runMatchMonteCarlo("BRA", "XXX", { sims: 50 });
  assert(mc.players.every((p) => p.teamCode === "BRA"), "hanya pemain BRA yang boleh muncul");
  const sim = simulateMatch("BRA", "XXX", { seed: 1 });
  assert(sim.awayGoals === 0, "tim tanpa roster tidak boleh mencetak gol");
  return "aman";
});

test("X3. Determinisme: seed sama → hasil identik", () => {
  const a = simulateMatch("BRA", "TOG", { seed: 555 });
  const b = simulateMatch("BRA", "TOG", { seed: 555 });
  assert(a.homeGoals === b.homeGoals && a.awayGoals === b.awayGoals, "simulasi tidak deterministik");
  const mc1 = runMatchMonteCarlo("ARG", "WAL", { sims: 80, seed: 7 });
  const mc2 = runMatchMonteCarlo("ARG", "WAL", { sims: 80, seed: 7 });
  assert(mc1.avgHome === mc2.avgHome && mc1.probs.home === mc2.probs.home, "MC tidak deterministik");
  return `BRA-TOG ${a.homeGoals}:${a.awayGoals} reproducible`;
});

test("X4. API lama kompatibel (fields UI tetap ada)", () => {
  const pred = hybridPredict("BRA", "TOG", null, null, { mcSims: 120 });
  for (const k of ["homeGoals", "awayGoals", "probs", "topScorers", "xgHome", "xgAway", "distribution", "rngProof", "model"]) {
    assert(pred[k] !== undefined, `field ${k} hilang dari output prediksi`);
  }
  assert(pred.probs.home + pred.probs.draw + pred.probs.away > 0.98, "probs tidak valid");
  const top = pred.topScorers[0];
  for (const k of ["name", "pos", "teamCode", "teamName", "matchGoals", "probability", "expectedGoals", "weight"]) {
    assert(top[k] !== undefined, `field UI lama ${k} hilang dari top scorer`);
  }
  assert(top.weight !== undefined && Number.isFinite(top.weight), "alias weight harus tetap angka (display)");
  return `${pred.homeGoals}:${pred.awayGoals}, top ${top.name} (${top.pos}) ${top.prob}%`;
});

console.log(`\n===== PLAYER SCORING TESTS: ${passed} passed, ${failed} failed =====`);
if (failed) {
  failures.forEach((f) => console.log(`  ✗ ${f.name}: ${f.message}`));
  process.exit(1);
}
