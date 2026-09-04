/**
 * Logic test suite — regresi untuk bug yang sudah diperbaiki + sanity check engine.
 * Dijalankan di Node murni (tanpa browser) untuk modul yang tidak butuh DOM.
 * Run: node tests/logic.test.mjs
 */
import { SimilarityCalculator, MATCH_WEIGHTS, TOP_GOALS_COUNT } from "../src/js/services/similarity.js";
import { BaganRngService, parseBagScore, resolveTeam } from "../src/js/services/baganRng.js";
import { parseImportLines } from "../src/js/utils/importParser.js";
import {
  hybridPredict, whatIfPredict, LCGRng, hashStringToSeed,
  generateTopScorers, analyzePredictionStability, isValidCountry
} from "../src/js/services/predictor.js";
import { TikTokP2sService, buildKonamiCupPairingsFromMatches, resolveCountryToId } from "../src/js/services/tiktokP2s.js";

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    failures.push({ name, message: e.message });
    console.log(`  ✗ ${name} — ${e.message}`);
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || "assertion failed"); }
function eq(a, b, msg) { if (a !== b) throw new Error(`${msg || "not equal"}: got ${JSON.stringify(a)} expected ${JSON.stringify(b)}`); }

console.log("\n=== SIMILARITY (top goals G1-G16) ===");

function blankGame(topGoals) {
  return {
    p1: "",
    matches: Array.from({ length: 8 }, (_, i) => ({ home: "", score: "", away: "", enabled: i < 7 })),
    topGoals
  };
}

test("top goals G9-G16 ikut dihitung similarity", () => {
  const q = blankGame(Array.from({ length: 16 }, (_, i) =>
    i === 8 ? { country: "Brazil", player: "Ronaldo", goals: "3" } : { country: "", player: "", goals: "" }
  ));
  const tMatch = blankGame(Array.from({ length: 16 }, (_, i) =>
    i === 8 ? { country: "Brazil", player: "Ronaldo", goals: "3" } : { country: "", player: "", goals: "" }
  ));
  const tMiss = blankGame(Array.from({ length: 16 }, (_, i) =>
    i === 8 ? { country: "Togo", player: "Adebayor", goals: "1" } : { country: "", player: "", goals: "" }
  ));
  const hit = SimilarityCalculator.calculate(q, tMatch);
  const miss = SimilarityCalculator.calculate(q, tMiss);
  assert(hit.percentage === 100, `exact match harus 100%, dapat ${hit.percentage}`);
  eq(miss.percentage, 0, "beda total harus 0%");
});

test("TOP_GOALS_COUNT = 16", () => eq(TOP_GOALS_COUNT, 16, "TOP_GOALS_COUNT"));
test("MATCH_WEIGHTS punya 8 slot (B1-B8)", () => eq(MATCH_WEIGHTS.length, 8, "MATCH_WEIGHTS length"));

test("similarity 100% untuk game identik penuh", () => {
  const g = blankGame(Array.from({ length: 16 }, () => ({ country: "", player: "", goals: "" })));
  g.matches[0] = { home: "Brazil", score: "2:1", away: "Germany", enabled: true };
  const r = SimilarityCalculator.calculate(g, JSON.parse(JSON.stringify(g)));
  eq(r.percentage, 100, "identik");
});

console.log("\n=== BAGAN / BRACKET ===");

const baganMatches = [
  { home: "Argentina", away: "Wales", score: "2:1" },
  { home: "Brazil", away: "Germany", score: "1:1" },
  { home: "Spain", away: "France", score: "0:3" },
  { home: "England", away: "Portugal", score: "" },
  { home: "Italy", away: "Holland", score: "2:0" },
  { home: "Japan", away: "Korea", score: "1:0" },
  { home: "Mexico", away: "USA", score: "0:0" },
  { home: "Croatia", away: "Sweden", score: "3:2" }
];

test("parseBagScore mendukung ':', '-', spasi", () => {
  eq(parseBagScore("2:1").home, 2, "2:1 home");
  eq(parseBagScore("2-1").away, 1, "2-1 away");
  eq(parseBagScore(" 3 : 2 ").home, 3, "spasi");
  eq(parseBagScore(""), null, "empty");
  eq(parseBagScore("abc"), null, "invalid");
});

test("resolveTeam mengembalikan kode & bendera", () => {
  const t = resolveTeam("brazil");
  eq(t.code, "BRA", "code BRA");
  assert(typeof t.flag === "string", "flag ada");
  eq(resolveTeam("NegaraAneh").code, "", "unknown → code kosong");
  eq(resolveTeam("NegaraAneh").name, "NegaraAneh", "unknown → nama apa adanya");
});

test("bracket punya 4 round: R1 → R2 → SEMI → FINAL", () => {
  const res = BaganRngService.generateBracketFromMatches(baganMatches, "LIVE123");
  assert(!res.error, "error: " + res.error);
  eq(res.rounds.length, 4, "jumlah round");
  eq(res.rounds[0].matches.length, 8, "R1 8 match");
  eq(res.rounds[1].matches.length, 4, "R2 4 match");
  eq(res.rounds[2].matches.length, 2, "SEMI 2 match");
  eq(res.rounds[3].matches.length, 1, "FINAL 1 match");
  eq(res.rounds[0].name, "ROUND 1", "nama R1");
  eq(res.rounds[3].name, "FINAL", "nama FINAL");
});

test("bracket deterministik — seed sama = hasil sama", () => {
  const a = BaganRngService.generateBracketFromMatches(baganMatches, "LIVE123");
  const b = BaganRngService.generateBracketFromMatches(baganMatches, "LIVE123");
  eq(JSON.stringify(a.rounds.map(r => r.matches.map(m => m.winner?.name))),
     JSON.stringify(b.rounds.map(r => r.matches.map(m => m.winner?.name))), "bracket identik");
  const c = BaganRngService.generateBracketFromMatches(baganMatches, "LIVE999");
  assert(
    JSON.stringify(a.rounds.map(r => r.matches.map(m => m.winner?.name))) !==
    JSON.stringify(c.rounds.map(r => r.matches.map(m => m.winner?.name))),
    "seed beda seharusnya mengubah hasil seri/tanpa skor"
  );
});

test("pemenang R1 mengikuti skor yang diinput", () => {
  const res = BaganRngService.generateBracketFromMatches(baganMatches, "X");
  eq(res.rounds[0].matches[0].winner.name, "Argentina", "B1 2:1 → Argentina");
  eq(res.rounds[0].matches[2].winner.name, "France", "B3 0:3 → France");
});

test("bracket tetap jalan walau B1-B8 belum lengkap", () => {
  const res = BaganRngService.generateBracketFromMatches([{ home: "Brazil", away: "Germany", score: "1:0" }], "S");
  assert(!res.error, "tidak boleh error: " + res.error);
  eq(res.rounds[0].matches.length, 1, "1 match");
  eq(res.champion.name, "Brazil", "juara Brazil");
});

test("generateBracket (legacy API) tetap berfungsi", () => {
  const res = BaganRngService.generateBracket(["Brazil", "Germany", "Spain", "France"], "S");
  assert(!res.error, "error: " + res.error);
  assert(Array.isArray(res.quarters) && res.quarters.length === 2, "quarters = 2");
});

test("deriveSeed konsisten untuk hex / numeric / string", () => {
  eq(BaganRngService.deriveSeed("0xA1B2").seed, 0xA1B2, "hex");
  eq(BaganRngService.deriveSeed("1234567").seed, 1234567, "numeric");
  eq(BaganRngService.deriveSeed("").seed, 0x12345678, "default");
  eq(BaganRngService.deriveSeed("LIVE").seed, BaganRngService.deriveSeed("LIVE").seed, "hash stabil");
});

console.log("\n=== IMPORT PARSER ===");

test("parseImportLines multi-format", () => {
  const { results, errors } = parseImportLines("Spain 3:2 England\nGermany 1 - 0 France\nBrazil2:2Argentina");
  eq(errors.length, 0, "tanpa error");
  eq(results.length, 3, "3 hasil");
  eq(results[0].score, "3:2", "B1");
  eq(results[1].score, "1:0", "B2");
  eq(results[2].home, "Brazil", "B3 home");
});

test("parseImportLines menolak baris rusak", () => {
  const { results, errors } = parseImportLines("Spain England\n99:99 X");
  eq(results.length, 0, "tidak ada hasil valid");
  eq(errors.length, 2, "2 error");
});

console.log("\n=== PREDICTOR ===");

test("LCGRng deterministik & dalam range", () => {
  const a = new LCGRng(12345), b = new LCGRng(12345);
  const seqA = [a.next(), a.next(), a.next()];
  const seqB = [b.next(), b.next(), b.next()];
  eq(JSON.stringify(seqA), JSON.stringify(seqB), "urutan sama");
  const r = new LCGRng(7);
  for (let i = 0; i < 100; i++) { const v = r.range(10); assert(v >= 0 && v < 10, "range 0..9"); }
});

test("hybridPredict deterministik", () => {
  const a = hybridPredict("ARG", "WAL", null, null, { deterministic: true });
  const b = hybridPredict("ARG", "WAL", null, null, { deterministic: true });
  eq(`${a.homeGoals}:${a.awayGoals}`, `${b.homeGoals}:${b.awayGoals}`, "skor identik");
});

test("hybridPredict probs 1X2 ~ 1.0", () => {
  const p = hybridPredict("BRA", "GER", null, null, { deterministic: true });
  const sum = p.probs.home + p.probs.draw + p.probs.away;
  assert(Math.abs(sum - 1) < 1e-6, `total probs ${sum}`);
});

test("topScorers tidak melebihi total gol & GK terfilter", () => {
  for (const [h, a] of [["ARG", "WAL"], ["BRA", "GER"], ["TOG", "JPN"], ["ENG", "FRA"]]) {
    const p = hybridPredict(h, a, null, null, { deterministic: true });
    const total = p.homeGoals + p.awayGoals;
    const sumMatch = p.topScorers.reduce((s, x) => s + (x.matchGoals || 0), 0);
    assert(sumMatch <= total, `${h}-${a}: alokasi ${sumMatch} > skor ${total}`);
    assert(!p.topScorers.some(x => x.pos === "GK"), `${h}-${a}: GK tidak boleh muncul`);
    assert(p.topScorers.every(x => x.teamCode === h || x.teamCode === a), `${h}-${a}: pemain luar tim`);
  }
});

test("whatIf alokasi tepat sesuai skor manual", () => {
  const cases = [["BRA", "GER", 0, 0], ["BRA", "GER", 3, 2], ["ARG", "WAL", 5, 0], ["TOG", "JPN", 1, 1]];
  for (const [h, a, hg, ag] of cases) {
    const w = whatIfPredict(h, a, hg, ag);
    const sum = w.topScorers.reduce((s, x) => s + (x.matchGoals || 0), 0);
    eq(sum, hg + ag, `${h} ${hg}:${ag} ${a}`);
    const homeSum = w.topScorers.filter(x => x.teamCode === w.homeCode).reduce((s, x) => s + (x.matchGoals || 0), 0);
    eq(homeSum, hg, `${h} gol home`);
  }
});

test("isValidCountry 57-fix", () => {
  assert(isValidCountry("Brazil"), "Brazil valid");
  assert(isValidCountry("Holland"), "Holland valid");
  assert(isValidCountry("Serbia & Mont."), "SCG valid");
  assert(!isValidCountry("Atlantis"), "Atlantis invalid");
  assert(!isValidCountry(""), "kosong invalid");
});

test("generateTopScorers tanpa replacement untuk skor kecil", () => {
  const s = generateTopScorers("ARG", "WAL", 2.0, 1.0, { deterministic: true, predictedHome: 2, predictedAway: 1, numSims: 800 });
  const arg = s.filter(x => x.teamCode === "ARG");
  const sum = arg.reduce((t, x) => t + (x.matchGoals || 0), 0);
  eq(sum, 2, "ARG 2 gol");
  assert(arg.every(x => x.matchGoals <= 2), "tidak ada yang >2");
});

test("analyzePredictionStability menolak sampel kosong", () => {
  const s = analyzePredictionStability([]);
  eq(s.level, "UNKNOWN", "level");
});

console.log("\n=== TIKTOK P2S / PNACH ===");

test("resolveCountryToId menangani titik & ampersand", () => {
  eq(resolveCountryToId("Brazil"), 50, "Brazil");
  eq(resolveCountryToId("Serbia & Mont."), 16, "SCG");
  eq(resolveCountryToId("Serbia and Mont."), 16, "SCG and");
  eq(resolveCountryToId("Holland"), 6, "Holland");
  eq(resolveCountryToId("Atlantis"), null, "unknown");
});

test("buildKonamiCupPairingsFromMatches butuh 8 negara valid", () => {
  const ok = buildKonamiCupPairingsFromMatches(Array.from({ length: 8 }, () => ({ home: "Brazil", away: "Germany" })));
  assert(ok && ok.length === 8, "8 pairing");
  const bad = buildKonamiCupPairingsFromMatches(Array.from({ length: 8 }, (_, i) => i === 3
    ? { home: "Atlantis", away: "Germany" }
    : { home: "Brazil", away: "Germany" }));
  eq(bad, null, "harus null kalau ada negara invalid");
});

test("generatePnach mengandung alamat goals, top, idx & pairing", () => {
  const goals = Array.from({ length: 48 }, (_, i) => (i === 0 ? [3, 2] : [0, 0]));
  const top = Array.from({ length: 24 }, (_, i) => i);
  const pairings = Array.from({ length: 8 }, () => ({ homeId: 50, awayId: 19 }));
  const pnach = TikTokP2sService.generatePnach(goals, top, pairings);
  assert(pnach.includes("00401000"), "alamat goals");
  assert(pnach.includes("00401800"), "alamat top");
  assert(pnach.includes("00400004"), "matchIdx");
  assert(pnach.includes("01323404"), "alamat pairing");
  assert(pnach.split("\n").filter(l => l.startsWith("patch=")).length > 20, "banyak baris patch");
});

test("packGoals 96 byte & nilai benar", () => {
  const goals = Array.from({ length: 48 }, (_, i) => (i === 0 ? [3, 2] : [0, 0]));
  const b = TikTokP2sService.packGoals(goals);
  eq(b.length, 96, "panjang");
  eq(b[0], 3, "home");
  eq(b[1], 2, "away");
});

test("packTopNames 768 byte & berisi nama", () => {
  const top = Array.from({ length: 24 }, (_, i) => (i === 0
    ? { country: "Czech", player: "Koller", goals: "3" }
    : { country: "", player: "", goals: "0" }));
  const b = TikTokP2sService.packTopNames(top);
  eq(b.length, 768, "panjang");
  eq(String.fromCharCode(...b.slice(0, 12)).trim(), "Czech Koller", "isi");
});

// ============================================================================
// End-to-end .p2s patch (template ZIP asli dari forensic-fixtures)
// ============================================================================
console.log("\n=== P2S TEMPLATE PATCH (end-to-end) ===");
try {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
  const fixture = path.join(root, "forensic-fixtures", "schedule_A.p2s");
  if (!fs.existsSync(fixture)) {
    console.log("  (skip) fixture tidak ditemukan");
  } else {
    const buf = fs.readFileSync(fixture);
    const goals = Array.from({ length: 48 }, (_, i) => (i === 0 ? [3, 2] : [0, 0]));
    const topObjects = Array.from({ length: 24 }, (_, i) => (i === 0
      ? { country: "Czech", player: "Koller", goals: "3" }
      : { country: "", player: "", goals: "0" }));
    const pairings = buildKonamiCupPairingsFromMatches([
      { home: "Argentina", away: "Costa Rica" }, { home: "Australia", away: "Switzerland" },
      { home: "Portugal", away: "Sweden" }, { home: "England", away: "Bulgaria" },
      { home: "Wales", away: "Korea" }, { home: "Scotland", away: "Belgium" },
      { home: "Saudi Arabia", away: "Croatia" }, { home: "Turkey", away: "Greece" }
    ]);
    const res = await TikTokP2sService.patchP2sTemplate(buf, goals, topObjects, pairings);
    test("patchP2sTemplate mengembalikan blob ZIP valid", () => {
      assert(res && res.blob, "blob harus ada");
      assert(res.blob.size > 5_000_000, `ukuran output ${res.blob.size} < 5MB`);
    });
    const head = new Uint8Array(await res.blob.slice(0, 4).arrayBuffer());
    test("header output = PK ZIP", () => {
      eq(head[0], 0x50, "byte 0");
      eq(head[1], 0x4B, "byte 1");
    });
    test("pairing ter-patch & terverifikasi", () => {
      assert(res.pairingDebug && res.pairingDebug.length, "pairingDebug harus ada");
      assert(res.pairingDebug.some(l => l.includes("PASS")), "harus ada baris PASS");
      assert(res.stats && res.stats.pairingPatched > 0, "stats.pairingPatched");
    });
    test("goals & top tersimpan di eeMemory", () => {
      const mem = res.raw || res.eeDecompressed;
      assert(mem.length >= 33554432, "eeMemory 32MB");
      eq(mem[0x00401000], 3, "goals B1 home");
      eq(mem[0x00401001], 2, "goals B1 away");
    });
  }
} catch (e) {
  failed++;
  failures.push({ name: "p2s end-to-end", message: e.message });
  console.log(`  ✗ p2s end-to-end — ${e.message}`);
}

console.log(`\n===== LOGIC TESTS: ${passed} passed, ${failed} failed =====`);
if (failed) {
  console.log("\nFailures:");
  failures.forEach(f => console.log(`  - ${f.name}: ${f.message}`));
  process.exit(1);
}
process.exit(0);
