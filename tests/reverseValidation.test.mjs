import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WE10_FULL_ROSTER } from "../src/js/data/we10FullRoster.js";
import { teamsDB } from "../src/js/data/teams.js";
import { getTeamPlayers } from "../src/js/data/playerAttributes.js";
import { hybridPredict, whatIfPredict } from "../src/js/services/predictor.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const memory12 = process.env.WE10_MEMORY12 || path.resolve(root, "..", "..", "memory12");
let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed++;
    console.log(`  ✗ ${name} — ${error.message}`);
  }
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}

console.log("\n=== REVERSE / IDENTITY VALIDATION ===");
test("project roster is exactly 57 teams x 11 players", () => {
  const codes = Object.keys(teamsDB);
  assert(codes.length === 57, `teams=${codes.length}`);
  assert(Object.keys(WE10_FULL_ROSTER).length === 57, "roster team count");
  for (const code of codes) {
    assert(WE10_FULL_ROSTER[code]?.length === 11, `${code} roster length`);
  }
});
test("prediction names and countries are canonical project data", () => {
  for (const [home, away] of [["BRA", "GER"], ["ARG", "WAL"], ["TOG", "JPN"]]) {
    const prediction = hybridPredict(home, away, null, null, { probsSims: 24 });
    assert(teamsDB[home] && teamsDB[away], "fixture countries");
    for (const scorer of prediction.topScorers) {
      assert(teamsDB[scorer.teamCode], `unknown team ${scorer.teamCode}`);
      assert(getTeamPlayers(scorer.teamCode).some((player) => player.name === scorer.name), `unknown player ${scorer.name}`);
    }
    const total = prediction.homeGoals + prediction.awayGoals;
    const allocated = prediction.topScorers.reduce((sum, scorer) => sum + (scorer.matchGoals || 0), 0);
    assert(allocated <= total, `goal allocation ${allocated} > ${total}`);
  }
});
test("conditioned score conserves goals through 20", () => {
  for (const goals of [0, 5, 15, 20]) {
    const result = whatIfPredict("BRA", "GER", goals, 0);
    const allocated = result.topScorers.reduce((sum, scorer) => sum + (scorer.matchGoals || 0), 0);
    assert(allocated === goals, `${goals}:0 allocated ${allocated}`);
  }
});
test("WE10 memory12 ELF/AFS signatures are readable when present", () => {
  if (!fs.existsSync(memory12)) {
    console.log("    (skip) memory12 tidak ada");
    return;
  }
  const elfPath = path.join(memory12, "SLPM_663.74");
  const afsPath = path.join(memory12, "0_TEXT.AFS");
  if (fs.existsSync(elfPath)) {
    const elf = fs.readFileSync(elfPath);
    assert(elf.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])), "ELF magic");
    assert(elf.includes(Buffer.from("ball_random")), "ball_random string");
  }
  if (fs.existsSync(afsPath)) {
    const afs = fs.readFileSync(afsPath);
    assert(afs.subarray(0, 4).equals(Buffer.from("AFS\0")), "AFS magic");
    assert(afs.includes(Buffer.from("WEPLDATA")), "WEPLDATA data block");
  }
});

console.log(`\n===== REVERSE / IDENTITY TESTS: ${passed} passed, ${failed} failed =====`);
if (failed) process.exit(1);
