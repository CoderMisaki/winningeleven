import { StateManager } from "./state/appState.js";
import { NavigationManager } from "./ui/navigation.js";
import { UIRenderer } from "./ui/uiRenderer.js";
import { MatchingEngine } from "./services/matchingEngine.js";
import { ImportExportService } from "./services/importExport.js";

document.addEventListener("DOMContentLoaded", () => {
  // Hubungkan dan inisialisasi basis data sistem
  StateManager.init();

  // Muat visual interface awal (Matching Center)
  NavigationManager.switchToHomeView();

  // --- REGISTRASI EVENT LISTENER UTAMA ---

  // Navigasi Bar Menu Atas
  document.getElementById("btnHomeView").onclick = () => {
    NavigationManager.switchToHomeView();
  };

  document.getElementById("btnOpenDatabase").onclick = () => {
    NavigationManager.openDatabaseModal();
  };

  document.getElementById("btnCloseModal").onclick = () => {
    NavigationManager.closeDatabaseModal();
  };

  // Navigasi Editor Paket Game (Previous / Next)
  document.getElementById("btnPrevGame").onclick = () => {
    NavigationManager.navigateGames(-1);
  };

  document.getElementById("btnNextGame").onclick = () => {
    NavigationManager.navigateGames(1);
  };

  document.getElementById("btnAddGame").onclick = () => {
    NavigationManager.triggerAddGame();
  };

  // Reset Form Pencarian Utama
  document.getElementById("btnClearForm").onclick = () => {
    StateManager.clearHomeQuery();
    UIRenderer.renderMatchGrid();
    document.getElementById("resultsPanel").classList.add("hidden");
  };

  // Eksekusi Pencocokan Dataset (Matching Engine)
  document.getElementById("btnRunMatch").onclick = () => {
    const results = MatchingEngine.executeSearch(StateManager.homeQuery);
    const resultsPanel = document.getElementById("resultsPanel");
    const resultsOutput = document.getElementById("resultsOutput");

    resultsPanel.classList.remove("hidden");
    resultsOutput.innerHTML = "";

    if (results.length === 0) {
      resultsOutput.innerHTML = `<div style="color: var(--accent-red); font-family: 'Press Start 2P'; font-size: 0.7rem;">Tidak ditemukan kecocokan pada seluruh Memory.</div>`;
      return;
    }

    // Bangun keluaran teks log penelitian
    let outputHTML = `<pre style="font-family: 'Roboto Mono', monospace;">================================<br/>   MATCH FOUND REPORT SYSTEMS<br/>================================<br/><br/>`;
    
    results.forEach((match, index) => {
      const isPerfect = match.similarity === 100;
      outputHTML += `Memory     : ${match.memoryName}<br/>`;
      outputHTML += `Game       : ${match.gameNumber}<br/>`;
      outputHTML += `Similarity : <span style="color: ${isPerfect ? 'var(--accent-green)' : 'var(--accent-gold)'}; font-weight: bold;">${match.similarity}%</span><br/>`;
      if (isPerfect) {
        outputHTML += `<span style="color: var(--accent-green); font-family: 'Press Start 2P'; font-size: 0.6rem;">[ PERFECT MATCH ]</span><br/>`;
      }
      
      if (index < results.length - 1) {
        outputHTML += `--------------------------------<br/>`;
      }
    });

    outputHTML += `</pre>`;
    resultsOutput.innerHTML = outputHTML;
    
    // Tarik scroll layar agar hasil langsung terlihat di perangkat mobile
    resultsPanel.scrollIntoView({ behavior: "smooth" });
  };

  // Delegasi Event Klik Dinamis di dalam Modal Database
  document.getElementById("databaseModalList").onclick = (e) => {
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

  // Handler Event untuk Mengimpor JSON Dataset
  document.getElementById("jsonImportField").onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    ImportExportService.processImportFile(file, (allocatedMemoryId) => {
      UIRenderer.renderDatabaseModal();
      // Reset input element berkas agar dapat mendeteksi file baru kembali
      e.target.value = "";
    });
  };
});
