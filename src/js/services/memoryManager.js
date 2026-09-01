import { StateManager } from "../state/appState.js";

export const MemoryManager = {
  initializeEmptyMemory(memoryId) {
    StateManager.db.memories[memoryId] = {
      version: 4,
      memoryName: "Memory " + memoryId,
      memoryNumber: memoryId,
      createdAt: new Date().toISOString(),
      lastUpdate: new Date().toISOString(),
      totalGames: 1,
      games: [this.generateBlankGame(1)]
    };
    StateManager.debouncedSave();
  },

  generateBlankGame(gameNum) {
    return {
      gameNumber: gameNum,
      p1: "",
      matches: Array.from({ length: 8 }, (_, i) => ({ home: "", score: "", away: "", enabled: i < 7 })),
      topGoals: Array.from({ length: 16 }, () => ({ country: "", player: "", goals: "" })),
      b8Enabled: false,
      b8Migrated: true,
      lastUpdate: new Date().toISOString()
    };
  },

  addNewGameToMemory(memoryId) {
  const memory = StateManager.db.memories[memoryId];

  if (!memory) return;

  if (!Array.isArray(memory.games)) {
    memory.games = [];
  }

  const nextGameNumber = memory.games.length + 1;
  const newGame = this.generateBlankGame(nextGameNumber);

  memory.games.push(newGame);
  memory.lastUpdate = new Date().toISOString();
  memory.totalGames = memory.games.length;

  StateManager.debouncedSave();
},

  deleteMemory(memoryId) {
  StateManager.db.memories[memoryId] = null;

  if (StateManager.activeMemoryId === parseInt(memoryId, 10)) {
    StateManager.activeMemoryId = null;
    StateManager.activeGameIndex = 0;
  }

  StateManager.debouncedSave();
},

  updateGameField(memoryId, gameIndex, field, value, immediate = false) {
    const memory = StateManager.db.memories[memoryId];
    if (!memory || !memory.games[gameIndex]) return;
    
    memory.games[gameIndex][field] = value;
    memory.games[gameIndex].lastUpdate = new Date().toISOString();
    memory.lastUpdate = new Date().toISOString();
    if (immediate) {
        StateManager.save();
    } else {
        StateManager.debouncedSave();
    }
  },


  updateTopGoalField(memoryId, gameIndex, goalIndex, field, value, immediate = false) {
    const memory = StateManager.db.memories[memoryId];
    if (!memory || !memory.games[gameIndex]) return;

    if (goalIndex < 0 || goalIndex >= 16) return;

    if (!memory.games[gameIndex].topGoals) {
      memory.games[gameIndex].topGoals = Array.from({ length: 16 }, () => ({ country: "", player: "", goals: "" }));
    }

    memory.games[gameIndex].topGoals[goalIndex][field] = value;
    memory.games[gameIndex].lastUpdate = new Date().toISOString();
    memory.lastUpdate = new Date().toISOString();
    if (immediate) {
        StateManager.save();
    } else {
        StateManager.debouncedSave();
    }
  }
,

  updateMatchField(memoryId, gameIndex, matchIndex, field, value, immediate = false) {
    const memory = StateManager.db.memories[memoryId];
    if (!memory || !memory.games[gameIndex]) return;

    if (matchIndex < 0 || matchIndex >= 8) return;

    // Ensure B8 structure exists
    if (!memory.games[gameIndex].matches[matchIndex]) {
      memory.games[gameIndex].matches[matchIndex] = { home: "", score: "", away: "", enabled: matchIndex < 7 };
    }
    memory.games[gameIndex].matches[matchIndex][field] = value;
    // Keep b8Enabled in sync when B8 enabled field changes
    if (matchIndex === 7 && field === "enabled") {
      memory.games[gameIndex].b8Enabled = !!value;
    }
    // If B8 gets content, auto-enable
    if (matchIndex === 7 && (field === "home" || field === "away" || field === "score") && value) {
      memory.games[gameIndex].matches[7].enabled = true;
      memory.games[gameIndex].b8Enabled = true;
    }
    memory.games[gameIndex].lastUpdate = new Date().toISOString();
    memory.lastUpdate = new Date().toISOString();
    if (immediate) {
        StateManager.save();
    } else {
        StateManager.debouncedSave();
    }
  },

  setB8Enabled(memoryId, gameIndex, enabled) {
    const memory = StateManager.db.memories[memoryId];
    if (!memory || !memory.games[gameIndex]) return;
    const game = memory.games[gameIndex];
    if (!Array.isArray(game.matches) || game.matches.length < 8) {
      // Ensure 8
      const old = game.matches || [];
      game.matches = Array.from({ length: 8 }, (_, i) => old[i] || { home: "", score: "", away: "", enabled: i < 7 });
    }
    game.matches[7].enabled = !!enabled;
    game.b8Enabled = !!enabled;
    game.lastUpdate = new Date().toISOString();
    memory.lastUpdate = new Date().toISOString();
    StateManager.debouncedSave();
  }
};
