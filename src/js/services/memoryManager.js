import { StateManager } from "../state/appState.js";

export const MemoryManager = {
  initializeEmptyMemory(memoryId) {
    StateManager.db.memories[memoryId] = {
      memoryNumber: memoryId,
      games: [this.generateBlankGame(1)],
      lastUpdate: new Date().toISOString()
    };
    StateManager.save();
  },

  generateBlankGame(gameNum) {
    return {
      gameNumber: gameNum,
      p1: "",
      matches: Array.from({ length: 7 }, () => ({ home: "", score: "", away: "" })),
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
    StateManager.save();
  },

  deleteMemory(memoryId) {
    StateManager.db.memories[memoryId] = null;
    StateManager.save();
  },

  updateGameField(memoryId, gameIndex, field, value) {
    const memory = StateManager.db.memories[memoryId];
    if (!memory || !memory.games[gameIndex]) return;
    
    memory.games[gameIndex][field] = value;
    memory.games[gameIndex].lastUpdate = new Date().toISOString();
    memory.lastUpdate = new Date().toISOString();
    StateManager.save();
  },

  updateMatchField(memoryId, gameIndex, matchIndex, field, value) {
    const memory = StateManager.db.memories[memoryId];
    if (!memory || !memory.games[gameIndex]) return;

    memory.games[gameIndex].matches[matchIndex][field] = value;
    memory.games[gameIndex].lastUpdate = new Date().toISOString();
    memory.lastUpdate = new Date().toISOString();
    StateManager.save();
  }
};
