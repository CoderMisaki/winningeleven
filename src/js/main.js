import { State } from "./state/appState.js";
import { UIEngine } from "./ui/uiEngine.js";

document.addEventListener("DOMContentLoaded", () => {
  State.init();
  UIEngine.initBindings();
  UIEngine.renderAll();
});
