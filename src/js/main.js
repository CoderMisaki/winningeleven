import { StateManager } from "./state/appState.js";
import { NavigationManager } from "./ui/navigation.js";
import { UIRenderer } from "./ui/uiRenderer.js";
import { MatchingEngine } from "./services/matchingEngine.js";
import { ImportExportService } from "./services/importExport.js";
import { Security } from "./utils/security.js";

document.addEventListener("DOMContentLoaded", () => {
  // Hubungkan dan inisialisasi basis data sistem
  StateManager.init();

  // Muat visual interface awal (Matching Center)
  NavigationManager.switchToHomeView();

  // --- REGISTRASI EVENT LISTENER UTAMA ---

  // Fungsi Helper untuk Bind Event Aman
  const bindClick = (id, handler) => {
    const el = document.getElementById(id);
    if (el) el.onclick = handler;
  };

  // Navigasi Bar Menu Atas
  bindClick("btnHomeView", () => {
    NavigationManager.switchToHomeView();
  });

  bindClick("btnOpenDatabase", () => {
    NavigationManager.openDatabaseModal();
  });

  bindClick("btnCloseModal", () => {
    NavigationManager.closeDatabaseModal();
  });

  // Navigasi Editor Paket Game (Previous / Next)
  bindClick("btnPrevGame", () => {
    NavigationManager.navigateGames(-1);
  });

  bindClick("btnNextGame", () => {
    NavigationManager.navigateGames(1);
  });

  bindClick("btnAddGame", () => {
    NavigationManager.triggerAddGame();
  });

  bindClick("btnExitEditor", () => {
    NavigationManager.switchToHomeView();
  });

  // Reset Form Pencarian Utama
  bindClick("btnClearForm", () => {
    StateManager.clearHomeQuery();
    UIRenderer.renderMatchGrid();
    const resultsPanel = document.getElementById("resultsPanel");
    if (resultsPanel) resultsPanel.classList.add("hidden");
  });

  // Eksekusi Pencocokan Dataset (Matching Engine)
  bindClick("btnRunMatch", () => {
    const results = MatchingEngine.executeSearch(StateManager.homeQuery);
    const resultsPanel = document.getElementById("resultsPanel");
    const resultsOutput = document.getElementById("resultsOutput");

    const minSimInput = document.getElementById("minSimilarity");
    const minSimThreshold = minSimInput ? parseInt(minSimInput.value, 10) || 0 : 0;

    const filteredResults = results.filter(r => r.similarity >= minSimThreshold);

    resultsPanel.classList.remove("hidden");
    resultsOutput.innerHTML = ""; // Clear existing

    if (filteredResults.length === 0) {
      const errMsg = document.createElement("div");
      errMsg.className = "error-msg";
      errMsg.textContent = "Tidak ditemukan kecocokan pada seluruh Memory (dengan filter yang diberikan).";
      resultsOutput.appendChild(errMsg);
      return;
    }

    const pre = document.createElement("pre");
    pre.className = "log-output";
    
    const header = document.createElement("div");
    header.innerHTML = "================================<br/>   MATCH FOUND REPORT SYSTEMS<br/>================================<br/><br/>";
    pre.appendChild(header);

    filteredResults.forEach((match, index) => {
      const isPerfect = match.similarity === 100;

      const matchBlock = document.createElement("div");

      const rankingText = document.createElement("div");
      rankingText.textContent = `Rank       : #${index + 1}`;
      matchBlock.appendChild(rankingText);

      const memText = document.createElement("div");
      memText.textContent = `Memory     : ${match.memoryName}`;
      matchBlock.appendChild(memText);

      const gameText = document.createElement("div");
      gameText.textContent = `Game       : ${match.gameNumber}`;
      matchBlock.appendChild(gameText);

      const simText = document.createElement("div");
      if (isPerfect) {
        simText.innerHTML = `Similarity : <span class="sim-perfect">${match.similarity}%</span> <span class="sim-badge">[ PERFECT MATCH ]</span>`;
      } else {
        simText.innerHTML = `Similarity : <span class="sim-normal">${match.similarity}%</span>`;
      }
      matchBlock.appendChild(simText);

      if (match.explanations && match.explanations.length > 0) {
        const explText = document.createElement("div");
        explText.style.marginTop = "5px";
        explText.style.color = "#aaa";
        explText.style.fontSize = "0.75rem";
        explText.innerHTML = match.explanations.map(e => `<div>${e}</div>`).join("");
        matchBlock.appendChild(explText);
      }

      if (index < filteredResults.length - 1) {
        const divider = document.createElement("div");
        divider.innerHTML = `--------------------------------<br/>`;
        matchBlock.appendChild(divider);
      }

      pre.appendChild(matchBlock);
    });

    resultsOutput.appendChild(pre);
    
    // Tarik scroll layar agar hasil langsung terlihat di perangkat mobile
    resultsPanel.scrollIntoView({ behavior: "smooth" });
  });

  // Delegasi Event Klik Dinamis di dalam Modal Database
  const dbModalList = document.getElementById("databaseModalList");
  if (dbModalList) {
    dbModalList.onclick = (e) => {
    const target = e.target;
    const id = target.dataset.id;

    if (!id) return;

    if (target.classList.contains("btn-open-mem")) {
      NavigationManager.switchToEditorView(id);
      NavigationManager.closeDatabaseModal();
    } 
    else if (target.classList.contains("btn-export-mem")) {
      ImportExportService.exportMemoryToJSON(id);
    }
    };
  }

  // Handler Event untuk Mengimpor JSON Dataset
  const jsonImportField = document.getElementById("jsonImportField");
  if (jsonImportField) {
    jsonImportField.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) {
      e.target.value = "";
      e.target.dataset.targetId = "";
      return;
    }

    const targetMemoryId = parseInt(e.target.dataset.targetId, 10);
    if (!targetMemoryId) {
      e.target.value = "";
      e.target.dataset.targetId = "";
      return;
    }

    ImportExportService.processImportFile(file, targetMemoryId, (allocatedMemoryId) => {
      UIRenderer.renderDatabaseModal();
    });

    // Reset input element berkas agar dapat mendeteksi file baru kembali di kesempatan berikutnya
    e.target.value = "";
    e.target.dataset.targetId = "";
    };
  }
});
