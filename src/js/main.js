import { StateManager } from "./state/appState.js";
import { NavigationManager } from "./ui/navigation.js";
import { PredictionService } from "./services/predictor.js";
import { UIRenderer } from "./ui/uiRenderer.js";
import { MatchingEngine } from "./services/matchingEngine.js";
import { ImportExportService } from "./services/importExport.js";
import { Security } from "./utils/security.js";
import { MemoryManager } from "./services/memoryManager.js";

document.addEventListener("DOMContentLoaded", async () => {
  window.UIRenderer = UIRenderer;

  // Hubungkan dan inisialisasi basis data sistem
  // 1. Inisialisasi State
  await StateManager.init();

  // 2. Registrasi Event Helper & Tombol DULUAN



  // Fungsi Helper untuk Bind Event Aman
  const bindClick = (id, handler) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("click", handler);
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
    const predictPanel = document.getElementById("predictPanel");
    if (predictPanel) predictPanel.classList.add("hidden");
  });

  bindClick("btnPredict", () => {
  const predictPanel = document.getElementById("predictPanel");
  const predictOutput = document.getElementById("predictOutput");

  if (!predictPanel || !predictOutput) return;

  predictPanel.classList.remove("hidden");
  predictOutput.innerHTML =
    "<div style='text-align:center; padding: 20px;'>PREDICTING...</div>";

  setTimeout(() => {
    try {
      const isEditor = StateManager.activeMemoryId !== null;
      const activeMem = isEditor
        ? StateManager.db.memories[StateManager.activeMemoryId]
        : null;

      const dataSource =
        isEditor &&
        activeMem &&
        activeMem.games &&
        activeMem.games[StateManager.activeGameIndex]
          ? activeMem.games[StateManager.activeGameIndex]
          : StateManager.homeQuery;

      const predictions = PredictionService.predictMatches(dataSource);

      predictOutput.innerHTML = "";

      if (!predictions.length) {
        predictOutput.innerHTML =
          "<div class='error-msg'>Isi minimal HOME dan AWAY pada salah satu baris.</div>";
        return;
      }

      const pre = document.createElement("pre");
      pre.className = "log-output";

      const header = document.createElement("div");
      header.innerHTML =
        "================================<br/>" +
        "      WE10 HYBRID PREDICTOR<br/>" +
        "================================<br/><br/>";
      pre.appendChild(header);

      predictions.forEach(p => {
        const block = document.createElement("div");
        block.style.marginBottom = "20px";

        const titleLine = document.createElement("div");
        titleLine.style.fontWeight = "bold";
        titleLine.style.color = "#fff";
        titleLine.textContent = `INPUT B${p.row}: ${p.homeName} vs ${p.awayName}`;
        block.appendChild(titleLine);

        if (p.error) {
          const errLine = document.createElement("div");
          errLine.style.color = "#f55";
          errLine.textContent = p.error;
          block.appendChild(errLine);
        } else if (p.prediction) {
          const pred = p.prediction;

          const estBox = document.createElement("div");
          estBox.style.marginTop = "8px";
          estBox.style.padding = "10px";
          estBox.style.border = "1px solid #444";
          estBox.style.background = "#111";
          estBox.style.borderRadius = "4px";

          // Prediction Result
          const scoreLine = document.createElement("div");
          scoreLine.style.fontWeight = "bold";
          scoreLine.style.color = "#0ff";
          scoreLine.style.fontSize = "1.1rem";
          scoreLine.style.marginBottom = "8px";
          scoreLine.textContent =
            `PREDIKSI: ${p.homeName} ${pred.homeGoals} : ${pred.awayGoals} ${p.awayName}`;
          estBox.appendChild(scoreLine);

          // Probabilities (1X2)
          const probGrid = document.createElement("div");
          probGrid.style.display = "grid";
          probGrid.style.gridTemplateColumns = "1fr 1fr 1fr";
          probGrid.style.gap = "5px";
          probGrid.style.marginBottom = "10px";

          const pHome = document.createElement("div");
          pHome.style.textAlign = "center";
          pHome.style.background = "#222";
          pHome.style.padding = "4px";
          pHome.style.border = pred.probs.home > Math.max(pred.probs.draw, pred.probs.away) ? "1px solid #0f0" : "1px solid #333";
          pHome.innerHTML = `<div style="font-size:0.75rem;color:#888;">HOME</div><div>${(pred.probs.home * 100).toFixed(1)}%</div>`;

          const pDraw = document.createElement("div");
          pDraw.style.textAlign = "center";
          pDraw.style.background = "#222";
          pDraw.style.padding = "4px";
          pDraw.style.border = pred.probs.draw > Math.max(pred.probs.home, pred.probs.away) ? "1px solid #0f0" : "1px solid #333";
          pDraw.innerHTML = `<div style="font-size:0.75rem;color:#888;">DRAW</div><div>${(pred.probs.draw * 100).toFixed(1)}%</div>`;

          const pAway = document.createElement("div");
          pAway.style.textAlign = "center";
          pAway.style.background = "#222";
          pAway.style.padding = "4px";
          pAway.style.border = pred.probs.away > Math.max(pred.probs.home, pred.probs.draw) ? "1px solid #0f0" : "1px solid #333";
          pAway.innerHTML = `<div style="font-size:0.75rem;color:#888;">AWAY</div><div>${(pred.probs.away * 100).toFixed(1)}%</div>`;

          probGrid.appendChild(pHome);
          probGrid.appendChild(pDraw);
          probGrid.appendChild(pAway);
          estBox.appendChild(probGrid);

          // Model info
          const infoGrid = document.createElement("div");
          infoGrid.style.display = "grid";
          infoGrid.style.gridTemplateColumns = "1fr 1fr";
          infoGrid.style.gap = "10px";
          infoGrid.style.fontSize = "0.85rem";

          const leftInfo = document.createElement("div");
          leftInfo.style.color = "#aaa";
          leftInfo.innerHTML = `
            <div><span style="color:#888">Model:</span> ${pred.model}</div>
            <div><span style="color:#888">Conf:</span> ${pred.confidence}%</div>
            <div><span style="color:#888">xG:</span> ${pred.xgHome} : ${pred.xgAway}</div>
          `;

          const rightInfo = document.createElement("div");
          rightInfo.style.color = "#aaa";

          let evidenceHtml = `<div><span style="color:#888">Evidence:</span></div>`;
          evidenceHtml += `<div>- Rating: ${pred.evidence.hasRating ? 'Ya' : 'Tidak'}</div>`;
          if (pred.evidence.hasHistory) {
            evidenceHtml += `<div>- History: ${pred.evidence.homeMatches} (H) / ${pred.evidence.awayMatches} (A) matches</div>`;
          } else {
            evidenceHtml += `<div>- History: Tidak ada</div>`;
          }
          if (pred.evidence.hasH2H) {
            evidenceHtml += `<div>- H2H: ${pred.evidence.h2hMatches} matches</div>`;
          } else {
            evidenceHtml += `<div>- H2H: Tidak ada</div>`;
          }
          rightInfo.innerHTML = evidenceHtml;

          infoGrid.appendChild(leftInfo);
          infoGrid.appendChild(rightInfo);
          estBox.appendChild(infoGrid);

          // Top Scores
          if (pred.distribution && pred.distribution.length > 0) {
            const topScoresContainer = document.createElement("div");
            topScoresContainer.style.marginTop = "10px";
            topScoresContainer.style.paddingTop = "10px";
            topScoresContainer.style.borderTop = "1px solid #333";
            topScoresContainer.style.fontSize = "0.8rem";

            let distHtml = `<div style="color:#888; margin-bottom:4px;">Top Score Distribution:</div>`;
            distHtml += `<div style="display:flex; flex-wrap:wrap; gap:8px;">`;

            pred.distribution.forEach((s, i) => {
              distHtml += `<div style="background:#222; padding:2px 6px; border-radius:3px;">
                <span style="color:#ddd">${s.home}:${s.away}</span>
                <span style="color:#0aa">(${(s.prob * 100).toFixed(1)}%)</span>
              </div>`;
            });

            distHtml += `</div>`;
            topScoresContainer.innerHTML = distHtml;
            estBox.appendChild(topScoresContainer);
          }

          block.appendChild(estBox);
        }

        pre.appendChild(block);
      });

      predictOutput.appendChild(pre);

    } catch (e) {
      predictOutput.innerHTML = `<div class="error-msg">Error: ${e.message}</div>`;
      console.error(e);
    }
  }, 50);
});



  // Attachments logic


  document.getElementById("btnNewChat")?.addEventListener("click", () => {
      if(isGenerating) return;
      sessionManager.createNewSession();
      renderSidebar();
      renderChatWindow();
  });

  document.getElementById("chatSearchInput")?.addEventListener("input", renderSidebar);

  document.getElementById("btnExportChats")?.addEventListener("click", () => {
      const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(sessionManager.sessions, null, 2));
      const downloadAnchorNode = document.createElement('a');
      downloadAnchorNode.setAttribute("href", dataStr);
      downloadAnchorNode.setAttribute("download", "we10_ai_sessions.json");
      document.body.appendChild(downloadAnchorNode);
      downloadAnchorNode.click();
      downloadAnchorNode.remove();
  });

  const importChatsFile = document.getElementById("importChatsFile");
  document.getElementById("btnImportChats")?.addEventListener("click", () => {
      importChatsFile?.click();
  });

  importChatsFile?.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (event) => {
          try {
              const importedData = JSON.parse(event.target.result);
              // Merge sessions
              sessionManager.sessions = { ...sessionManager.sessions, ...importedData };
              sessionManager.save();
              Toast.show("Chats Imported Successfully!");
              renderSidebar();
              renderChatWindow();
          } catch (err) {
              Toast.show("Error parsing JSON file");
          }
      };
      reader.readAsText(file);
      importChatsFile.value = ""; // reset
  });


  document.getElementById("btnClearChats")?.addEventListener("click", () => {
      if(confirm("Clear ALL chat sessions? This cannot be undone.")) {
          sessionManager.clearAll();
          renderSidebar();
          renderChatWindow();
      }
  });

  // Attachments logic

  if (btnUploadAiChat && aiChatUploadMenu) {
    btnUploadAiChat.addEventListener("click", (e) => {
      e.stopPropagation();
      const isVisible = aiChatUploadMenu.style.display === "flex";
      aiChatUploadMenu.style.display = isVisible ? "none" : "flex";
    });

    document.addEventListener("click", (e) => {
      if (aiChatUploadMenu && e.target !== btnUploadAiChat && !aiChatUploadMenu.contains(e.target)) {
        aiChatUploadMenu.style.display = "none";
      }
    });
  }

  if (aiChatUploadMenu && aiChatFile) {
    const menuButtons = aiChatUploadMenu.querySelectorAll("button");
    menuButtons.forEach(btn => {
      btn.addEventListener("click", (e) => {
        const type = e.target.dataset.type;
        if (type === "image") aiChatFile.accept = "image/*";
        else if (type === "audio") aiChatFile.accept = "audio/*";
        else if (type === "video") aiChatFile.accept = "video/*";
        else if (type === "document") {
          aiChatFile.accept =
            ".pdf,.txt,.md,.json,.csv,application/pdf,text/plain,text/markdown,application/json";
        }

        aiChatUploadMenu.style.display = "none";
        aiChatFile.dataset.fileType = type;
        aiChatFile.click();
      });
    });
  }

  if (aiChatFile) {
  aiChatFile.addEventListener("change", e => {
    const file = e.target.files[0];

    if (!file) return;

    const MAX_FILE_MB = 4;
    const MAX_FILE_SIZE = MAX_FILE_MB * 1024 * 1024;

    if (file.size > MAX_FILE_SIZE) {
      Toast.show(`File terlalu besar. Maksimal ${MAX_FILE_MB}MB.`);
      aiChatFile.value = "";
      return;
    }

    const reader = new FileReader();

    reader.onload = event => {
      const base64Data = event.target.result.split(",")[1];

      currentAttachment = {
        type: aiChatFile.dataset.fileType || "document",
        base64: base64Data,
        mimeType: file.type || "application/octet-stream",
        filename: file.name
      };

      if (aiChatAttachmentPreview) {
        aiChatAttachmentPreview.innerHTML =
          `<span>📎 ${Security.escapeHtml(file.name)}</span> ` +
          `<button id="btnRemoveAttachment" style="background:none; border:none; color:#f55; cursor:pointer; font-weight:bold;">X</button>`;

        aiChatAttachmentPreview.style.display = "flex";

        document.getElementById("btnRemoveAttachment").addEventListener("click", () => {
          currentAttachment = null;
          aiChatFile.value = "";
          aiChatAttachmentPreview.style.display = "none";
          aiChatAttachmentPreview.innerHTML = "";
        });
      }
    };

    reader.onerror = () => {
      Toast.show("Gagal membaca file.");
      aiChatFile.value = "";
    };

    reader.readAsDataURL(file);
  });
}

  // Delegate event listener for Copy Code & Collapse buttons
  if (aiChatWindow) {
    aiChatWindow.addEventListener("click", (e) => {
      if (e.target.classList.contains("btn-copy-code")) {
        const codeToCopy = decodeURIComponent(e.target.dataset.code);
        navigator.clipboard.writeText(codeToCopy).then(() => {
          const originalText = e.target.textContent;
          e.target.textContent = "✓ Copied";
          Toast.show("Code Copied!");
          setTimeout(() => { e.target.textContent = originalText; }, 2000);
        });
            } else if (e.target.classList.contains("btn-toggle-wrap")) {
        const pre = e.target.closest('.ai-code-block').querySelector('pre');
        if (pre) {
            pre.classList.toggle('wrap-text');
        }
      } else if (e.target.classList.contains("btn-toggle-code")) {
        const block = e.target.closest('.ai-code-block');
        if (block) {
            block.classList.toggle('code-collapsed');
            e.target.textContent = block.classList.contains('code-collapsed') ? "▶ Expand" : "▼ Collapse";
        }
      }
    });
  }

  // View Branches Dummy Handler
  document.getElementById("btnViewBranches")?.addEventListener("click", () => {
      const session = sessionManager.getCurrentSession();
      let treeInfo = `Current Branch ID: ${session.id}\nParent: ${session.parentId || 'Root'}\nChildren: ${session.children.join(', ') || 'None'}`;
      alert(`Conversation Tree Info:\n\n${treeInfo}\n\n(UI for tree visualization to be implemented)`);
  });



  const btnToggleSidebar = document.getElementById("btnToggleSidebar");
  if (btnToggleSidebar) {
    btnToggleSidebar.addEventListener("click", (e) => {
      e.stopPropagation();
      const sidebar = document.getElementById("aiSidebar");
      if (sidebar) sidebar.classList.toggle("drawer-open");
  });
  }


  const btnCloseSidebar = document.getElementById("btnCloseSidebar");
  if (btnCloseSidebar) {
    btnCloseSidebar.addEventListener("click", (e) => {
      e.stopPropagation();
      const sidebar = document.getElementById("aiSidebar");
      if (sidebar) sidebar.classList.remove("drawer-open");
  });
  }



  // --- Offline Mode ---
  function updateOnlineStatus() {
      const isOnline = navigator.onLine;
      const indicator = document.getElementById("offlineIndicator");
      if (indicator) {
          indicator.style.display = isOnline ? "none" : "block";
      }
      if (aiChatInput) {
          aiChatInput.disabled = !isOnline;
          aiChatInput.placeholder = isOnline ? "Message AI..." : "Offline mode - Chat disabled";
      }
      if (btnSendAiChat) btnSendAiChat.disabled = !isOnline;
      if (btnUploadAiChat) btnUploadAiChat.disabled = !isOnline;
  }

  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);
  updateOnlineStatus(); // init


  // --- Token Budget Estimator ---
  function updateContextBudget() {
      const session = sessionManager.getCurrentSession();
      if (!session) return;

      const indicator = document.getElementById("contextBudgetIndicator");
      if (!indicator) return;

      // Rough estimation: 4 chars = 1 token
      let totalChars = 0;
      session.messages.forEach(m => {
          totalChars += m.content.length;
      });

      const estTokens = Math.round(totalChars / 4);
      const MAX_TOKENS = 8192;

      indicator.textContent = `Est. Context: ${estTokens} / ${MAX_TOKENS} tokens`;

      if (estTokens > MAX_TOKENS * 0.9) {
          indicator.style.color = "#f55";
          indicator.textContent += " (Approaching Limit!)";
      } else if (estTokens > MAX_TOKENS * 0.75) {
          indicator.style.color = "gold";
      } else {
          indicator.style.color = "#888";
      }
  }

  // Initial Render
  renderSidebar();
  renderChatWindow();

});
