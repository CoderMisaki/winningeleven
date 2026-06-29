import { StorageService } from "../services/storage.js";

export const StateManager = {
  db: { memories: {} },
  
  // Data input temporer pencarian halaman utama
  homeQuery: {
    p1: "",
    matches: Array.from({ length: 7 }, () => ({ home: "", score: "", away: "" })),
    topGoals: Array.from({ length: 7 }, () => ({ country: "", player: "", goals: "" }))
  },

  // State navigasi aktif
  activeMemoryId: null, // Jika null, user berada di halaman Matching Center (Home)
  activeGameIndex: 0,   // Indeks game yang aktif saat membuka editor memory

  init() {
    this.db = StorageService.loadData();
    if (!this.db.maxSlot) {
      this.db.maxSlot = 7;
      let highestKey = 7;
      for (const key of Object.keys(this.db.memories)) {
        const num = parseInt(key, 10);
        if (!isNaN(num) && num > highestKey) {
          highestKey = num;
        }
      }
      this.db.maxSlot = highestKey;
    }

    // Migration & Integrity Checks
    let modified = false;
    for (const key of Object.keys(this.db.memories)) {
      const memory = this.db.memories[key];
      if (memory && memory.games) {
        // Upgrade version
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

        // Integrity Checks: Remove duplicate games, reorder gameNumber, fix missing fields
        const seenGames = new Set();
        const uniqueGames = [];

        memory.games.forEach((game) => {
          // Serialize for duplicate check (only content, not gameNumber or metadata)
          const dataToHash = { p1: game.p1, matches: game.matches, topGoals: game.topGoals };
          const hash = JSON.stringify(dataToHash);

          if (!seenGames.has(hash)) {
            seenGames.add(hash);
            uniqueGames.push(game);
          } else {
             modified = true; // Was duplicate
          }
        });

        if (memory.games.length !== uniqueGames.length) {
            memory.games = uniqueGames;
        }

        memory.games.forEach((game, idx) => {
          if (game.gameNumber !== idx + 1) {
             game.gameNumber = idx + 1;
             modified = true;
          }

          if (!game.matches || game.matches.length !== 7) {
             const oldMatches = game.matches || [];
             game.matches = Array.from({ length: 7 }, (_, i) => oldMatches[i] || { home: "", score: "", away: "" });
             modified = true;
          }

          if (!game.topGoals || game.topGoals.length !== 7) {
             const oldGoals = game.topGoals || [];
             game.topGoals = Array.from({ length: 7 }, (_, i) => oldGoals[i] || { country: "", player: "", goals: "" });
             modified = true;
          }
        });

        memory.totalGames = memory.games.length;
      }
    }

    if (modified) {
      this.save();
    }
  },

  saveTimer: null,

  save() {
    StorageService.saveData(this.db);
  },

  debouncedSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.save();
    }, 300);
  },

  clearHomeQuery() {
    this.homeQuery = {
      p1: "",
      matches: Array.from({ length: 7 }, () => ({ home: "", score: "", away: "" })),
    topGoals: Array.from({ length: 7 }, () => ({ country: "", player: "", goals: "" }))
    };
  }
};
