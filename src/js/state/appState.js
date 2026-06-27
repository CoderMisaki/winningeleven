import { teamsDB } from "../data/teams.js";
import { createTopGoalRows } from "../data/topGoalTemplate.js";
import { createEmptyGame, createEmptyMemory, loadMemoryStore, saveMemoryStore } from "../services/storage.js";

export const State = {
  teamsDB,
  currentMatches: [],
  activeTimeouts: [],
  store: createEmptyMemory(1),

  init() {
    for (const key in this.teamsDB) {
      const t = this.teamsDB[key];
      t.power = Math.round(t.offense * 0.22 + t.defense * 0.22 + t.speed * 0.18 + t.technique * 0.18 + t.teamwork * 0.2);
    }
    this.store = loadMemoryStore();
    this.ensureActiveMemory();
  },

  ensureActiveMemory() {
    if (!this.store.memories[this.store.activeSlot]) {
      this.store.memories[this.store.activeSlot] = { name: `Memory ${this.store.activeSlot}`, activeGameIndex: 0, games: [createEmptyGame(1)] };
    }
    const memory = this.getActiveMemory();
    if (!memory.games?.length) memory.games = [createEmptyGame(1)];
    memory.games.forEach((game, index) => {
      game.label = game.label || `Game ${index + 1}`;
      game.matches = game.matches || [];
      game.topGoals = game.topGoals?.length ? game.topGoals : createTopGoalRows();
    });
  },

  getActiveMemory() { return this.store.memories[this.store.activeSlot]; },
  getActiveGame() { return this.getActiveMemory().games[this.getActiveMemory().activeGameIndex]; },
  save() { saveMemoryStore(this.store); },
  switchMemory(slot) { this.store.activeSlot = slot; this.ensureActiveMemory(); this.save(); },
  addMemory() { const slots = Object.keys(this.store.memories).map(Number); const next = Math.max(0, ...slots) + 1; this.store.activeSlot = next; this.ensureActiveMemory(); this.save(); },
  addGame() { const memory = this.getActiveMemory(); memory.games.push(createEmptyGame(memory.games.length + 1)); memory.activeGameIndex = memory.games.length - 1; this.save(); },
  moveGame(delta) { const memory = this.getActiveMemory(); memory.activeGameIndex = Math.max(0, Math.min(memory.games.length - 1, memory.activeGameIndex + delta)); this.save(); },
  persistActiveGame(matches, topGoals) { const game = this.getActiveGame(); game.matches = matches; game.topGoals = topGoals; game.updatedAt = new Date().toISOString(); this.save(); },
  clearTimeouts() { this.activeTimeouts.forEach(clearTimeout); this.activeTimeouts = []; },
  addTimeout(tId) { this.activeTimeouts.push(tId); },
};
