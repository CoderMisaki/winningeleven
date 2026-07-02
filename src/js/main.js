import { StateManager } from "./state/appState.js";
import { NavigationManager } from "./ui/navigation.js";
import { UIRenderer } from "./ui/uiRenderer.js";
import { MatchingEngine } from "./services/matchingEngine.js";
import { ImportExportService } from "./services/importExport.js";
import { Security } from "./utils/security.js";
import { MemoryManager } from "./services/memoryManager.js";

document.addEventListener("DOMContentLoaded", () => {
  window.UIRenderer = UIRenderer;

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

  const gameInput = document.getElementById("currentGameInput");
  if (gameInput) {
    gameInput.addEventListener("change", (e) => {
      const val = parseInt(e.target.value, 10);
      if (!isNaN(val) && val >= 1) {
        NavigationManager.jumpToGame(val);
      } else {
        // Reset to current if invalid
        if(StateManager.activeMemoryId) {
           const currentNum = StateManager.activeGameIndex + 1;
           e.target.value = currentNum;
        }
      }
    });
  }

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

    // --- EVENT DELEGATION FORM INPUT ---
  const matchGridForm = document.getElementById("matchGridForm");
  if (matchGridForm) {
    matchGridForm.addEventListener("input", (e) => {
      const target = e.target;
      if (target.tagName !== "INPUT") return;
      const idx = target.dataset.idx;
      const val = Security.sanitizeInput(target.value);
      const isEditor = StateManager.activeMemoryId !== null;
      let field = "";
      if (target.classList.contains("match-home")) field = "home";
      if (target.classList.contains("match-score")) field = "score";
      if (target.classList.contains("match-away")) field = "away";

      if (field !== "") {
        if (isEditor) {
          MemoryManager.updateMatchField(StateManager.activeMemoryId, StateManager.activeGameIndex, idx, field, val, false);
        } else {
          StateManager.homeQuery.matches[idx][field] = val;
        }
      }
    });
  }

  const topGoalsForm = document.getElementById("topGoalsForm");
  if (topGoalsForm) {
    topGoalsForm.addEventListener("input", (e) => {
      const target = e.target;
      if (target.tagName !== "INPUT") return;
      const idx = target.dataset.idx;
      const val = Security.sanitizeInput(target.value);
      const isEditor = StateManager.activeMemoryId !== null;
      let field = "goals";
      if (target.classList.contains("goal-country")) field = "country";
      if (target.classList.contains("goal-player")) field = "player";
      if (target.classList.contains("goal-amount")) field = "goals";

      if (isEditor) {
        MemoryManager.updateTopGoalField(StateManager.activeMemoryId, StateManager.activeGameIndex, idx, field, val, false);
      } else {
        StateManager.homeQuery.topGoals[idx][field] = val;
      }
    });
  }

  // Eksekusi Pencocokan Dataset (Matching Engine)
  bindClick("btnRunMatch", () => {
    const btn = document.getElementById("btnRunMatch");
    btn.disabled = true;
    const oldText = btn.textContent;
    btn.textContent = "SEARCHING...";

    const resultsPanel = document.getElementById("resultsPanel");
    const resultsOutput = document.getElementById("resultsOutput");
    resultsPanel.classList.remove("hidden");
    resultsOutput.innerHTML = "<div style='text-align:center; padding: 20px;'>Loading...</div>";

    // Allow UI to update before heavy computation
    setTimeout(() => {
        const results = MatchingEngine.executeSearch(StateManager.homeQuery);

        const minSimInput = document.getElementById("minSimilarity");
        const minSimThreshold = minSimInput ? parseInt(minSimInput.value, 10) || 0 : 0;

        const filteredResults = results.filter(r => r.similarity >= minSimThreshold);
        resultsOutput.innerHTML = ""; // Clear existing

        btn.disabled = false;
        btn.textContent = oldText;

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
          const isExcellent = match.similarity >= 95 && match.similarity < 100;
          const isHigh = match.similarity >= 90 && match.similarity < 95;

          const matchBlock = document.createElement("div");

          const rankingText = document.createElement("div");
          rankingText.textContent = `Rank       : #${index + 1}`;
          matchBlock.appendChild(rankingText);

          const memText = document.createElement("div");
          memText.innerHTML = `Memory     : <span class="mem-link" style="cursor:pointer; text-decoration:underline; color:#0f0;" data-mem="${match.memoryId}" data-game="${match.gameNumber}">${match.memoryName} (Game ${match.gameNumber})</span>`;
          matchBlock.appendChild(memText);

          const simText = document.createElement("div");
          if (isPerfect) {
            simText.innerHTML = `Similarity : <span class="sim-perfect">${match.similarity}%</span> <span class="sim-badge" style="background:#0f0; color:#000; padding:2px 5px; font-size:0.7rem;">[ PERFECT MATCH ]</span>`;
          } else if (isExcellent) {
            simText.innerHTML = `Similarity : <span class="sim-normal">${match.similarity}%</span> <span class="sim-badge" style="background:#ff0; color:#000; padding:2px 5px; font-size:0.7rem;">[ EXCELLENT ]</span>`;
          } else if (isHigh) {
             simText.innerHTML = `Similarity : <span class="sim-normal">${match.similarity}%</span> <span class="sim-badge" style="background:#f90; color:#000; padding:2px 5px; font-size:0.7rem;">[ HIGH MATCH ]</span>`;
          } else {
            simText.innerHTML = `Similarity : <span class="sim-normal">${match.similarity}%</span> <span class="sim-badge" style="background:#333; color:#fff; padding:2px 5px; font-size:0.7rem;">[ NORMAL ]</span>`;
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

        // Setup click handler for jumping to editor
        pre.querySelectorAll('.mem-link').forEach(link => {
            link.addEventListener('click', (e) => {
                const memId = e.target.dataset.mem;
                const gameNum = parseInt(e.target.dataset.game, 10);
                NavigationManager.switchToEditorView(memId);
                NavigationManager.jumpToGame(gameNum);
                // Scroll to top to see editor
                window.scrollTo({ top: 0, behavior: 'smooth' });
            });
        });

        // Tarik scroll layar agar hasil langsung terlihat di perangkat mobile
        resultsPanel.scrollIntoView({ behavior: "smooth" });
    }, 50);
  });

  // Delegasi Event Klik Dinamis di dalam Modal Database
  const dbModalList = document.getElementById("databaseModalList");
  if (dbModalList) {
    dbModalList.onclick = (e) => {
    const target = e.target;

    if (target.classList.contains("btn-add-memory-slot")) {
      StateManager.db.maxSlot = (StateManager.db.maxSlot || 7) + 1;
      StateManager.save();
      UIRenderer.renderDatabaseModal();
      const list = document.getElementById("databaseModalList");
      if(list) list.scrollTop = list.scrollHeight;
      return;
    }

    const id = target.dataset.id;

    if (!id) return;

    if (target.classList.contains("btn-create-mem")) {
      UIRenderer.showConfirm("Lanjutkan inisialisasi Memory ini?", () => {
        MemoryManager.initializeEmptyMemory(id);
        NavigationManager.switchToEditorView(id);
        NavigationManager.closeDatabaseModal();
      });
    } else if (target.classList.contains("btn-open-mem")) {
      NavigationManager.switchToEditorView(id);
      NavigationManager.closeDatabaseModal();
    } 
    else if (target.classList.contains("btn-export-mem")) {
      ImportExportService.exportMemoryToJSON(id);
    }
    else if (target.classList.contains("btn-import-mem")) {
      const importField = document.getElementById("jsonImportField");
      if (importField) {
        importField.dataset.targetId = id;
        importField.click();
      }
    }
    else if (target.classList.contains("btn-delete-mem")) {
      UIRenderer.showConfirm("Yakin ingin menghapus seluruh data Memory ini?", () => {
        MemoryManager.deleteMemory(id);
        UIRenderer.renderDatabaseModal();
      });
    }
    else if (target.classList.contains("btn-download-template")) {
      ImportExportService.downloadTemplate(id);
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


// HTML escape function to prevent XSS
function escapeHtml(unsafe) {
    if (!unsafe) return "";
    return unsafe
         .replace(/&/g, "&amp;")
         .replace(/</g, "&lt;")
         .replace(/>/g, "&gt;")
         .replace(/"/g, "&quot;")
         .replace(/'/g, "&#039;");
}

// --- AI CHAT FUNCTIONALITY ---
  const btnSendAiChat = document.getElementById("btnSendAiChat");
  const aiChatInput = document.getElementById("aiChatInput");
  const aiChatWindow = document.getElementById("aiChatWindow");

  let chatHistory = [];

  async function handleSendAiMessage() {
    const text = aiChatInput.value.trim();
    if (!text) return;

    // Append user message to UI
    const userMsg = document.createElement("div");
    userMsg.style.color = "#fff";
    userMsg.innerHTML = `<strong style="color: #0f0;">YOU:</strong> ${escapeHtml(text)}`;
    aiChatWindow.appendChild(userMsg);
    aiChatWindow.scrollTop = aiChatWindow.scrollHeight;

    aiChatInput.value = "";
    aiChatInput.disabled = true;
    btnSendAiChat.disabled = true;

    // Add to history
    chatHistory.push({ role: "user", content: text });

    // Append loading indicator
    const loadingMsg = document.createElement("div");
    loadingMsg.style.color = "#aaa";
    loadingMsg.textContent = "AI is thinking...";
    aiChatWindow.appendChild(loadingMsg);
    aiChatWindow.scrollTop = aiChatWindow.scrollHeight;

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: chatHistory })
      });

      aiChatWindow.removeChild(loadingMsg);

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}: ${await response.text()}`);
      }

      const data = await response.json();
      const aiReply = data.choices && data.choices[0] && data.choices[0].message ? data.choices[0].message.content : "No response.";

      chatHistory.push({ role: "assistant", content: aiReply });

      const aiMsg = document.createElement("div");
      aiMsg.style.color = "#0ff";
      // Basic formatting for newlines
      aiMsg.innerHTML = `<strong style="color: #ff0;">AI:</strong> ${escapeHtml(aiReply).replace(/\n/g, '<br/>')}`;
      aiChatWindow.appendChild(aiMsg);

    } catch (err) {
      if (aiChatWindow.contains(loadingMsg)) aiChatWindow.removeChild(loadingMsg);
      const errMsg = document.createElement("div");
      errMsg.style.color = "#f55";
      errMsg.innerHTML = `<strong>ERROR:</strong> ${err.message}`;
      aiChatWindow.appendChild(errMsg);
    } finally {
      aiChatInput.disabled = false;
      btnSendAiChat.disabled = false;
      aiChatInput.focus();
      aiChatWindow.scrollTop = aiChatWindow.scrollHeight;
    }
  }

  if (btnSendAiChat) {
    btnSendAiChat.addEventListener("click", handleSendAiMessage);
  }

  if (aiChatInput) {
    aiChatInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        handleSendAiMessage();
      }
    });
  }

});
