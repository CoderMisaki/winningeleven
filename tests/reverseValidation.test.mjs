/**
 * reverseValidation.test.mjs — validasi 100% reverse Ghidra
 * Run: node tests/reverseValidation.test.mjs
 */
import { validateTikTokSync, selfTestReverseValidation, REVERSE_EVIDENCE, renderValidationProofText } from "../src/js/services/reverseValidation.js";
import { TikTokP2sService } from "../src/js/services/tiktokP2s.js";

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { failed++; failures.push({ name, message: e.message }); console.log(`  ✗ ${name} — ${e.message}`); }
}
function assert(c, m) { if (!c) throw new Error(m || "assert"); }

console.log("\n=== REVERSE VALIDATION 100% ===");

test("REVERSE_EVIDENCE ada FUN_0026c910 & FUN_0028005c", () => {
  assert(REVERSE_EVIDENCE.scoreRandom.functions.some(f => f.addr === "0x0026C910"), "0026C910");
  assert(REVERSE_EVIDENCE.scoreRandom.functions.some(f => f.addr === "0x0028005c"), "0028005c");
  assert(REVERSE_EVIDENCE.scoreRandom.tikTokHook.goals.includes("00401000"), "goals addr");
});

test("selfTestReverseValidation() lulus", () => {
  const r = selfTestReverseValidation();
  assert(r.ok && r.checks > 5, "selfTest");
});

test("validateTikTokSync valid untuk input B1-B8 normal", () => {
  const goals = Array.from({ length: 48 }, (_, i) => (i < 8 ? [3, 2] : [0, 0]));
  const top = Array.from({ length: 24 }, (_, i) => (i === 0 ? { country: "Czech", player: "Koller", goals: "3" } : { country: "", player: "", goals: "0" }));
  const matches = Array.from({ length: 8 }, () => ({ home: "Brazil", away: "Germany" }));
  const res = validateTikTokSync({ goals, topGoals: top, matches });
  assert(res.valid, "harus valid: " + res.errors.join("; "));
  assert(res.proofs.pairing.addr === "0x1323404", "pairing addr");
  assert(res.checks.some(c => c.name.includes("01323404")), "checks pairing");
});

test("validateTikTokSync detect goals out-of-range (clamp 99)", () => {
  const goals = Array.from({ length: 48 }, () => [100, 0]);
  const top = Array.from({ length: 24 }, () => ({ country: "", player: "", goals: "0" }));
  const matches = Array.from({ length: 8 }, () => ({ home: "Brazil", away: "Germany" }));
  const res = validateTikTokSync({ goals, topGoals: top, matches });
  assert(!res.valid && res.errors.some(e => e.includes("0..99")), "harus error clamp 99");
});

test("validateTikTokSync detect pairing invalid (Atlantis)", () => {
  const goals = Array.from({ length: 48 }, () => [1, 0]);
  const top = Array.from({ length: 24 }, () => ({ country: "", player: "", goals: "0" }));
  const matches = Array.from({ length: 8 }, (_, i) => i === 3 ? { home: "Atlantis", away: "Germany" } : { home: "Brazil", away: "Germany" });
  const res = validateTikTokSync({ goals, topGoals: top, matches });
  assert(!res.valid && res.errors.some(e => e.includes("B1-B8")), "harus error pairing");
});

test("TikTokP2sService.validate() wrapper sama", () => {
  const goals = Array.from({ length: 48 }, () => [2, 1]);
  const top = Array.from({ length: 24 }, () => ({ country: "", player: "", goals: "0" }));
  const matches = Array.from({ length: 8 }, () => ({ home: "England", away: "Portugal" }));
  const a = validateTikTokSync({ goals, topGoals: top, matches });
  const b = TikTokP2sService.validate(goals, top, matches);
  assert(JSON.stringify(a.checks) === JSON.stringify(b.checks), "wrapper sama");
});

test("eeMemory 32MB verifikasi bytes 00401000 & 01323404", () => {
  const goals = Array.from({ length: 48 }, (_, i) => (i === 0 ? [3, 2] : [0, 0]));
  const top = Array.from({ length: 24 }, (_, i) => (i === 0 ? { country: "Czech", player: "Koller", goals: "3" } : { country: "", player: "", goals: "0" }));
  const matches = Array.from({ length: 8 }, () => ({ home: "Brazil", away: "Germany" }));
  const mem = new Uint8Array(33554432);
  for (let i = 0; i < 48; i++) { mem[0x00401000 + i*2] = goals[i][0]; mem[0x00401001 + i*2] = goals[i][1]; }
  for (let i = 0; i < 24; i++) mem[0x00401800 + i] = parseInt(top[i].goals,10)||0;
  const view = new DataView(mem.buffer);
  for (let i = 0; i < 8; i++) { view.setUint16(0x01323404 + i*4, 50, true); view.setUint16(0x01323404 + i*4+2, 19, true); }
  const res = validateTikTokSync({ goals, topGoals: top, matches, eeMemory: mem });
  assert(res.valid, "eeMemory harus valid: " + res.errors.join("; "));
  const memBad = new Uint8Array(33554432);
  memBad.set(mem); memBad[0x00401000] = 99;
  const resBad = validateTikTokSync({ goals, topGoals: top, matches, eeMemory: memBad });
  assert(!resBad.valid && resBad.errors.some(e=>e.includes("00401000")), "harus detect mismatch 00401000");
});

test("renderValidationProofText mengandung 100% VALID", () => {
  const goals = Array.from({ length: 48 }, () => [1, 0]);
  const top = Array.from({ length: 24 }, () => ({ country: "", player: "", goals: "0" }));
  const matches = Array.from({ length: 8 }, () => ({ home: "Japan", away: "Korea" }));
  const res = validateTikTokSync({ goals, topGoals: top, matches });
  const txt = renderValidationProofText(res);
  assert(txt.includes("REVERSE VALIDATION"), "header");
  assert(txt.includes("VALID"), "valid");
  assert(txt.includes("FUN_0026c910"), "fungsi");
});

test("penjelasan skor random & top goals tersedia", () => {
  assert(REVERSE_EVIDENCE.playerUp.whyUp.includes("CF"), "whyUp CF");
  assert(REVERSE_EVIDENCE.winAndScore.steps.length >= 5, "steps");
});

console.log(`\n===== REVERSE VALIDATION TESTS: ${passed} passed, ${failed} failed =====`);
if (failed) { failures.forEach(f=>console.log(`  - ${f.name}: ${f.message}`)); process.exit(1); }
process.exit(0);
