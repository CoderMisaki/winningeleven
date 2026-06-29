import { StateManager } from "../state/appState.js";

export const MemoryManager = {
  initializeEmptyMemory(memoryId) {
    StateManager.db.memories[memoryId] = {
      version: 3,
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
      matches: Array.from({ length: 7 }, () => ({ home: "", score: "", away: "" })),
      topGoals: Array.from({ length: 7 }, () => ({ country: "", player: "", goals: "" })),
      lastUpdate: new Date().toISOString()
    };
  },

  addNewGameToMemory(memoryId) {
    const memory = StateManager.db.memories[memoryId];
    if (!memory) return;
    const nextGameNumber = memory.games.length + 1;
    const newGame = this.generateBlankGame(nextGameNumber);
    memory.games.push(newGame);
    memory.lastUpdate = new Date().toISOString();
    memory.totalGames = memory.games.length;
    StateManager.debouncedSave();
  },

  deleteMemory(memoryId) {
    StateManager.db.memories[memoryId] = null;
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

    if (goalIndex < 0 || goalIndex >= 7) return;

    if (!memory.games[gameIndex].topGoals) {
      memory.games[gameIndex].topGoals = Array.from({ length: 7 }, () => ({ country: "", player: "", goals: "" }));
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

    if (matchIndex < 0 || matchIndex >= 7) return;

    memory.games[gameIndex].matches[matchIndex][field] = value;
    memory.games[gameIndex].lastUpdate = new Date().toISOString();
    memory.lastUpdate = new Date().toISOString();
    if (immediate) {
        StateManager.save();
    } else {
        StateManager.debouncedSave();
    }
  }
};
