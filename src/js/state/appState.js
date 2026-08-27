import { StorageService } from "../services/storage.js";
import { Security } from "../utils/security.js";

function makeEmptyQuery() {
  return {
    p1: "",
    matches: Array.from({ length: 7 }, () => ({
      home: "",
      score: "",
      away: ""
    })),
    topGoals: Array.from({ length: 7 }, () => ({
      country: "",
      player: "",
      goals: ""
    }))
  };
}

function cleanText(value) {
  if (typeof value !== "string") return "";

  let out = Security.decodeHtml(value);
  out = out.replace(/\s+/g, " ").trim();

  return out;
}

function cleanScore(value) {
  if (typeof value !== "string") return "";

  let out = cleanText(value);

  if (!out) return "";

  // Normalisasi:
  // 8-0 -> 8:0
  // 3;3 -> 3:3
  // 1 : 2 -> 1:2
  out = out
    .replace(/[-–—;]+/g, ":")
    .replace(/\s+/g, "");

  return out;
}

export const StateManager = {
  db: {
    maxSlot: 7,
    memories: {}
  },

  homeQuery: makeEmptyQuery(),

  activeMemoryId: null,
  activeGameIndex: 0,

  saveTimer: null,

  async init() {
    try {
      this.db = await StorageService.loadData();
    } catch (e) {
      console.error("Gagal load storage utama", e);
      this.db = StorageService.generateInitialStructure();
    }

    if (!this.db || typeof this.db !== "object") {
      this.db = StorageService.generateInitialStructure();
    }

    if (!this.db.memories || typeof this.db.memories !== "object") {
      this.db.memories = StorageService.generateInitialStructure().memories;
    }

    // Pastikan maxSlot valid
    let highestKey = 7;

    for (const key of Object.keys(this.db.memories)) {
      const num = parseInt(key, 10);
      if (!isNaN(num) && num > highestKey) {
        highestKey = num;
      }
    }

    if (typeof this.db.maxSlot !== "number" || this.db.maxSlot < highestKey) {
      this.db.maxSlot = highestKey;
    }

    let modified = false;

    for (const key of Object.keys(this.db.memories)) {
      const memory = this.db.memories[key];

      if (!memory || typeof memory !== "object") {
        this.db.memories[key] = null;
        modified = true;
        continue;
      }

      if (!Array.isArray(memory.games)) {
        memory.games = [];
        modified = true;
      }

      if (!memory.version || memory.version < 3) {
        memory.version = 3;
        modified = true;
      }

      if (!memory.memoryName) {
        memory.memoryName = "Memory " + key;
        modified = true;
      }

      if (!memory.createdAt) {
        memory.createdAt = new Date().toISOString();
        modified = true;
      }

      if (!memory.lastUpdate) {
        memory.lastUpdate = new Date().toISOString();
        modified = true;
      }

      const seenGames = new Set();
      const uniqueGames = [];

      for (const game of memory.games) {
        if (!game || typeof game !== "object") {
          modified = true;
          continue;
        }

        // Bersihkan P1
        game.p1 = cleanText(game.p1 || "");

        // Bersihkan matches
        const oldMatches = Array.isArray(game.matches) ? game.matches : [];
        game.matches = Array.from({ length: 7 }, (_, i) => {
          const m = oldMatches[i] || {};

          return {
            home: cleanText(m.home || ""),
            score: cleanScore(m.score || ""),
            away: cleanText(m.away || "")
          };
        });

        // Bersihkan top goals
        const oldGoals = Array.isArray(game.topGoals) ? game.topGoals : [];
        game.topGoals = Array.from({ length: 7 }, (_, i) => {
          const g = oldGoals[i] || {};

          return {
            country: cleanText(g.country || ""),
            player: cleanText(g.player || ""),
            goals: cleanText(g.goals || "")
          };
        });

        // Duplicate game detection berdasarkan isi, bukan metadata
        const hash = JSON.stringify({
          p1: game.p1,
          matches: game.matches,
          topGoals: game.topGoals
        });

        if (!seenGames.has(hash)) {
          seenGames.add(hash);
          uniqueGames.push(game);
        } else {
          modified = true;
        }
      }

      memory.games = uniqueGames;

      // Rapikan nomor game
      memory.games.forEach((game, idx) => {
        if (game.gameNumber !== idx + 1) {
          game.gameNumber = idx + 1;
          modified = true;
        }

        if (!game.lastUpdate) {
          game.lastUpdate = new Date().toISOString();
          modified = true;
        }
      });

      memory.totalGames = memory.games.length;
    }

    if (modified) {
      this.save();
    }
  },

  save() {
    Promise.resolve(StorageService.saveData(this.db)).catch(e => {
      console.error("StateManager save gagal", e);
    });
  },

  debouncedSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer);

    this.saveTimer = setTimeout(() => {
      this.save();
    }, 300);
  },

  clearHomeQuery() {
    this.homeQuery = makeEmptyQuery();
  }
};
