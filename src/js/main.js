import { State } from "./state/appState.js";
import { UIEngine } from "./ui/uiEngine.js";

document.addEventListener("DOMContentLoaded", () => {
  State.init();
  UIEngine.hydrateFromGame();
  document.getElementById("importBtn").addEventListener("click", () => UIEngine.importTeams());
  document.getElementById("predictBtn").addEventListener("click", () => UIEngine.predictAll());
  document.getElementById("clearBtn").addEventListener("click", () => UIEngine.clearAll());
  document.getElementById("saveMemoryBtn").addEventListener("click", () => UIEngine.saveActiveGame());
  document.getElementById("addMemoryBtn").addEventListener("click", () => { State.addMemory(); UIEngine.hydrateFromGame(); });
  document.getElementById("addGameBtn").addEventListener("click", () => { UIEngine.saveActiveGame(); State.addGame(); UIEngine.hydrateFromGame(); });
  document.getElementById("prevGameBtn").addEventListener("click", () => { UIEngine.saveActiveGame(); State.moveGame(-1); UIEngine.hydrateFromGame(); });
  document.getElementById("nextGameBtn").addEventListener("click", () => { UIEngine.saveActiveGame(); State.moveGame(1); UIEngine.hydrateFromGame(); });
  document.getElementById("prevCupBtn").addEventListener("click", () => { UIEngine.saveActiveGame(); State.moveGame(-1); UIEngine.hydrateFromGame(); });
  document.getElementById("nextCupBtn").addEventListener("click", () => { UIEngine.saveActiveGame(); State.moveGame(1); UIEngine.hydrateFromGame(); });
  document.getElementById("memorySelect").addEventListener("change", (e) => { UIEngine.saveActiveGame(); State.switchMemory(Number(e.target.value)); UIEngine.hydrateFromGame(); });
  document.getElementById("importInput").addEventListener("input", (e) => { e.target.value = UIEngine.normalizeTextInput(e.target.value, false); });
  document.getElementById("rowCount").addEventListener("change", () => UIEngine.clearAll());
});
