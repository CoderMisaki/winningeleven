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
    const currentGame = memory.games[StateManager.activeGameIndex];

    document.getElementById("panelTitle").textContent = `EDITOR: MEMORY ${memId}`;
    document.getElementById("activeViewIndicator").textContent = `MODE: DB EDITOR (MEM ${memId})`;
    document.getElementById("currentGameLabel").textContent = `GAME ${currentGame.gameNumber} / ${memory.games.length}`;
  },

  navigateGames(direction) {
    const memId = StateManager.activeMemoryId;
    if (!memId) return;

    const memory = StateManager.db.memories[memId];
    const totalGames = memory.games.length;
    let newIndex = StateManager.activeGameIndex + direction;

    if (newIndex >= 0 && newIndex < totalGames) {
      StateManager.activeGameIndex = newIndex;
      this.updateEditorTopBar();
      UIRenderer.renderMatchGrid();
    }
  },

  triggerAddGame() {
    const memId = StateManager.activeMemoryId;
    if (!memId) return;

    MemoryManager.addNewGameToMemory(memId);
    const memory = StateManager.db.memories[memId];
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
