import { StateManager } from "../state/appState.js";
import { UIRenderer } from "./uiRenderer.js";
import { MemoryManager } from "../services/memoryManager.js";

export const NavigationManager = {
  switchToHomeView() {
    StateManager.activeMemoryId = null;
    
    document.getElementById("editorNav").classList.add("hidden");
    document.getElementById("homeActions").classList.remove("hidden");
    document.getElementById("panelTitle").textContent = "MATCHING INTERFACE";
    document.getElementById("activeViewIndicator").textContent = "MODE: MATCHING CENTER";
    
    UIRenderer.renderMatchGrid();
  },

  switchToEditorView(memoryId) {
    StateManager.activeMemoryId = parseInt(memoryId, 10);
    StateManager.activeGameIndex = 0; // Mulai dari entri Game paling awal

    document.getElementById("editorNav").classList.remove("hidden");
    document.getElementById("homeActions").classList.add("hidden");
    document.getElementById("resultsPanel").classList.add("hidden");
    
    this.updateEditorTopBar();
    UIRenderer.renderMatchGrid();
  },

  updateEditorTopBar() {
    const memId = StateManager.activeMemoryId;
    const memory = StateManager.db.memories[memId];
    if (!memory || !memory.games?.length) return;
    const currentGame = memory.games[StateManager.activeGameIndex];

    document.getElementById("panelTitle").textContent = `EDITOR: MEMORY ${memId}`;
    document.getElementById("activeViewIndicator").textContent = `MODE: DB EDITOR (MEM ${memId})`;
    const gameInput = document.getElementById("currentGameInput");
    const totalLabel = document.getElementById("totalGamesLabel");
    if (gameInput && totalLabel) {
      gameInput.value = currentGame.gameNumber;
      totalLabel.textContent = `/ ${memory.games.length}`;
    }
  },

  navigateGames(direction) {
    const memId = StateManager.activeMemoryId;
    if (!memId) return;

    const memory = StateManager.db.memories[memId];
    if (!memory || !memory.games?.length) return;
    let newIndex = StateManager.activeGameIndex + direction;

    if (newIndex >= 0) {
      if (newIndex >= memory.games.length) {
         // Auto create missing games
         const diff = newIndex - memory.games.length + 1;
         for(let i=0; i < diff; i++) {
            MemoryManager.addNewGameToMemory(memId);
         }
      }
      StateManager.activeGameIndex = newIndex;
      this.updateEditorTopBar();
      UIRenderer.renderMatchGrid();
    }
  },

  jumpToGame(targetNumber) {
    if (targetNumber > 1000) {
      alert("Maksimal game yang diizinkan adalah 1000.");
      return;
    }
    const memId = StateManager.activeMemoryId;
    if (!memId || targetNumber < 1) return;

    const targetIndex = targetNumber - 1;
    const memory = StateManager.db.memories[memId];
    if (!memory || !memory.games?.length) return;

    if (targetIndex >= memory.games.length) {
      const diff = targetIndex - memory.games.length + 1;
      for (let i = 0; i < diff; i++) {
        MemoryManager.addNewGameToMemory(memId);
      }
    }

    StateManager.activeGameIndex = targetIndex;
    this.updateEditorTopBar();
    UIRenderer.renderMatchGrid();
  },

  triggerAddGame() {
    const memId = StateManager.activeMemoryId;
    if (!memId) return;

    MemoryManager.addNewGameToMemory(memId);
    const memory = StateManager.db.memories[memId];
    if (!memory || !memory.games?.length) return;
    StateManager.activeGameIndex = memory.games.length - 1; // Lompat otomatis ke game baru
    
    this.updateEditorTopBar();
    UIRenderer.renderMatchGrid();
  },

  openDatabaseModal() {
    UIRenderer.renderDatabaseModal();
    document.getElementById("databaseModal").classList.remove("hidden");
  },

  closeDatabaseModal() {
    document.getElementById("databaseModal").classList.add("hidden");
  }
};
