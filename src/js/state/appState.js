import { teamsDB } from "../data/teams.js";
import { createTopGoalRows } from "../data/topGoalTemplate.js";
import {
  createEmptyGame,
  createEmptyMemory,
  getMemory,
  saveMemory,
  loadMeta,
  saveMeta,
  migrateV1
} from "../services/storage.js";

export const State = {
  teamsDB,
  activeTimeouts: [],
  meta: { activeSlot: 1, activeGameIndex: 0 },
  currentMemory: null,
  saveTimer: null,

  init() {
    for (const key in this.teamsDB) {
      const t = this.teamsDB[key];
      t.power = Math.round(t.offense * 0.22 + t.defense * 0.22 + t.speed * 0.18 + t.technique * 0.18 + t.teamwork * 0.2);
    }
    migrateV1();
    this.meta = loadMeta();
    this.ensureActiveMemory();
  },

  ensureActiveMemory() {
    let mem = getMemory(this.meta.activeSlot);
    if (!mem) {
      mem = createEmptyMemory(this.meta.activeSlot);
      saveMemory(this.meta.activeSlot, mem);
    }

    // Ensure at least one game
    if (!mem.games || mem.games.length === 0) {
      mem.games = [createEmptyGame(1)];
    }

    // Ensure bounds for gameIndex
    if (this.meta.activeGameIndex < 0 || this.meta.activeGameIndex >= mem.games.length) {
       this.meta.activeGameIndex = mem.games.length - 1;
       saveMeta(this.meta);
    }

    if (!mem.topGoals || mem.topGoals.length === 0) {
        mem.topGoals = createTopGoalRows();
    }

    this.currentMemory = mem;
  },

  debouncedSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
       saveMemory(this.meta.activeSlot, this.currentMemory);
       saveMeta(this.meta);
    }, 500);
  },

  getActiveGame() {
    return this.currentMemory.games[this.meta.activeGameIndex];
  },

  switchMemory(slot) {
    if (slot < 1 || slot > 7) return;
    this.meta.activeSlot = slot;
    // when switching memory, reset to latest game
    const mem = getMemory(slot) || createEmptyMemory(slot);
    this.meta.activeGameIndex = Math.max(0, mem.games.length - 1);

    this.ensureActiveMemory();
    this.debouncedSave();
  },

  addGame() {
    const nextNum = this.currentMemory.games.length > 0
        ? this.currentMemory.games[this.currentMemory.games.length - 1].gameNumber + 1
        : 1;
    this.currentMemory.games.push(createEmptyGame(nextNum));
    this.meta.activeGameIndex = this.currentMemory.games.length - 1;
    this.debouncedSave();
  },

  deleteGame(index) {
     if (this.currentMemory.games.length <= 1) return; // don't delete last
     this.currentMemory.games.splice(index, 1);
     // Re-index gameNumbers
     this.currentMemory.games.forEach((g, i) => g.gameNumber = i + 1);
     this.meta.activeGameIndex = Math.max(0, Math.min(this.currentMemory.games.length - 1, this.meta.activeGameIndex));
     this.debouncedSave();
  },

  moveGame(delta) {
    this.meta.activeGameIndex = Math.max(0, Math.min(this.currentMemory.games.length - 1, this.meta.activeGameIndex + delta));
    this.debouncedSave();
  },

  renameMemory(newName) {
    this.currentMemory.name = newName;
    this.debouncedSave();
  },

  // Called from UI inputs
  updateGameField(field, value) {
    const game = this.getActiveGame();
    if (game) {
       game[field] = value;
       this.debouncedSave();
    }
  },

  updateTopGoals(goals) {
    this.currentMemory.topGoals = goals;
    this.debouncedSave();
  },

  clearTimeouts() {
    this.activeTimeouts.forEach(clearTimeout);
    this.activeTimeouts = [];
  },

  addTimeout(tId) {
    this.activeTimeouts.push(tId);
  },
};
