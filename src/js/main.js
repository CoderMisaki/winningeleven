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
  await StateManager.init();

  const bindClick = (id, handler) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("click", handler);
  };

  // 1. Initial Navigation
  NavigationManager.switchToHomeView();

  // 2. Similarity Search Binding
  bindClick("btnRunMatch", async () => {
    const resultsPanel = document.getElementById("resultsPanel");
    const resultsOutput = document.getElementById("resultsOutput");
    if (!resultsPanel || !resultsOutput) return;

    resultsPanel.classList.remove("hidden");
    resultsOutput.innerHTML = "<div style='text-align:center; padding: 15px;'>MENGHITUNG SIMILARITY WE10...</div>";

    try {
      const minSim = Number(document.getElementById("minSimilarity")?.value || 0);
      let results = await MatchingEngine.executeSearch(StateManager.homeQuery);
      results = (results || []).filter(r => r.similarity >= minSim);
      UIRenderer.renderSearchResults(results, resultsOutput);
    } catch (err) {
      resultsOutput.innerHTML = `<div class="error-msg">Error Search: ${Security.escapeHtml(err.message || String(err))}</div>`;
    }
  });

  // 3. Database Modal Delegate Handlers (Include Walk-Forward Backtest)
  const databaseModalList = document.getElementById("databaseModalList");
  const jsonImportField = document.getElementById("jsonImportField");
  let importTargetMemoryId = null;

  if (databaseModalList) {
    databaseModalList.addEventListener("click", (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      const id = Number(btn.dataset.id);

      if (btn.classList.contains("btn-create-mem")) {
        MemoryManager.initializeEmptyMemory(id);
        NavigationManager.closeDatabaseModal();
        NavigationManager.switchToEditorView(id);
      } else if (btn.classList.contains("btn-open-mem")) {
        NavigationManager.closeDatabaseModal();
        NavigationManager.switchToEditorView(id);
      } else if (btn.classList.contains("btn-export-mem")) {
        ImportExportService.exportMemoryToJSON(id);
      } else if (btn.classList.contains("btn-delete-mem")) {
        UIRenderer.showConfirm(`Hapus seluruh data Memory ${id}?`, () => {
          MemoryManager.deleteMemory(id);
          UIRenderer.renderDatabaseModal();
        });
      } else if (btn.classList.contains("btn-import-mem")) {
        importTargetMemoryId = id;
        if (jsonImportField) {
          jsonImportField.value = "";
          jsonImportField.click();
        }
      } else if (btn.classList.contains("btn-download-template")) {
        ImportExportService.downloadTemplate(id);
      } else if (btn.classList.contains("btn-add-memory-slot")) {
        StateManager.db.maxSlot = (StateManager.db.maxSlot || 7) + 1;
        StateManager.save();
        UIRenderer.renderDatabaseModal();
      } else if (btn.classList.contains("btn-backtest-mem")) {
        const res = PredictionService.runWalkForwardBacktest(id);
        if (res.error) {
          UIRenderer.showAlert(res.error);
        } else {
          const msg = `HASIL WALK-FORWARD BACKTEST (MEMORY ${id}):\n\n` +
            `Total Matches Evaluated: ${res.totalTested}\n` +
            `1X2 Hit Rate: ${res.result1X2Accuracy.toFixed(1)}%\n` +
            `Exact Score Accuracy: ${res.exactScoreAccuracy.toFixed(1)}%\n` +
            `Top-3 Scoreline Hit Rate: ${res.top3ScoreHitRate.toFixed(1)}%\n` +
            `Top-5 Scoreline Hit Rate: ${res.top5ScoreHitRate.toFixed(1)}%\n` +
            `MAE Goals: ${res.maeHomeGoals.toFixed(2)} (H) / ${res.maeAwayGoals.toFixed(2)} (A)\n` +
            `Brier Score: ${res.meanBrierScore.toFixed(3)} | LogLoss: ${res.meanLogLoss.toFixed(3)}`;
          UIRenderer.showAlert(msg);
        }
      }
    });
  }

  if (jsonImportField) {
    jsonImportField.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (!file || importTargetMemoryId == null) return;
      ImportExportService.processImportFile(file, importTargetMemoryId, (memId) => {
        UIRenderer.renderDatabaseModal();
        NavigationManager.closeDatabaseModal();
        NavigationManager.switchToEditorView(memId);
      });
      jsonImportField.value = "";
    });
  }

  // 4. Header & Editor Navigation
  bindClick("btnHomeView", () => NavigationManager.switchToHomeView());
  bindClick("btnOpenDatabase", () => NavigationManager.openDatabaseModal());
  bindClick("btnCloseModal", () => NavigationManager.closeDatabaseModal());
  bindClick("btnPrevGame", () => NavigationManager.navigateGames(-1));
  bindClick("btnNextGame", () => NavigationManager.navigateGames(1));
  bindClick("btnAddGame", () => NavigationManager.triggerAddGame());
  bindClick("btnExitEditor", () => NavigationManager.switchToHomeView());

  const gameInput = document.getElementById("currentGameInput");
  if (gameInput) {
    gameInput.addEventListener("change", (e) => {
      const val = parseInt(e.target.value, 10);
      if (!isNaN(val) && val >= 1) NavigationManager.jumpToGame(val);
      else if (StateManager.activeMemoryId) e.target.value = StateManager.activeGameIndex + 1;
    });
  }

  bindClick("btnClearForm", () => {
    StateManager.clearHomeQuery();
    UIRenderer.renderMatchGrid();
    document.getElementById("resultsPanel")?.classList.add("hidden");
    document.getElementById("predictPanel")?.classList.add("hidden");
  });

  // 5. Predict Button Execution
  bindClick("btnPredict", () => {
    const predictPanel = document.getElementById("predictPanel");
    const predictOutput = document.getElementById("predictOutput");
    if (!predictPanel || !predictOutput) return;

    predictPanel.classList.remove("hidden");
    predictOutput.innerHTML = "<div style='text-align:center; padding: 20px; font-family:var(--font-retro);'>CALCULATING WE10 ENSEMBLE...</div>";

    setTimeout(() => {
      try {
        const isEditor = StateManager.activeMemoryId !== null;
        const activeMem = isEditor ? StateManager.db.memories[StateManager.activeMemoryId] : null;
        const dataSource = isEditor && activeMem?.games?.[StateManager.activeGameIndex]
          ? activeMem.games[StateManager.activeGameIndex]
          : StateManager.homeQuery;

        const predictions = PredictionService.predictMatches(dataSource);
        UIRenderer.renderPredictionDashboard(predictions, predictOutput);
      } catch (err) {
        predictOutput.innerHTML = `<div class="error-msg">Prediction Pipeline Error: ${Security.escapeHtml(err.message)}</div>`;
      }
    }, 40);
  });

// ============================================================
// PATCH B: stub sementara untuk variabel chat yang hilang
// ============================================================

const btnUploadAiChat = document.getElementById("btnUploadAiChat");
const aiChatUploadMenu = document.getElementById("aiChatUploadMenu");
const aiChatFile = document.getElementById("aiChatFile");
const aiChatAttachmentPreview = document.getElementById("aiChatAttachmentPreview");
const aiChatWindow = document.getElementById("aiChatWindow");
const aiChatInput = document.getElementById("aiChatInput");
const btnSendAiChat = document.getElementById("btnSendAiChat");

let isGenerating = false;
let currentAttachment = null;

const Toast = {
  show(message) {
    console.log("[TOAST]", message);
  }
};

const sessionManager = {
  sessions: {},
  currentId: null,
  STORAGE_KEY: "we10_ai_sessions",
  init() {
    try {
      const data = localStorage.getItem(this.STORAGE_KEY);
      if (data) {
        this.sessions = JSON.parse(data);
        const keys = Object.keys(this.sessions);
        if (keys.length > 0) {
          // Find the most recent session
          this.currentId = keys.sort((a, b) => this.sessions[b].updatedAt - this.sessions[a].updatedAt)[0];
        }
      }
    } catch (e) {
      console.error("Failed to load sessions", e);
    }
    if (!this.currentId) {
      this.createNewSession();
    }
  },
  save() {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.sessions));
    } catch (e) {
      console.error("Failed to save sessions", e);
    }
  },
  createNewSession() {
    const id = Date.now().toString();
    this.sessions[id] = {
      id,
      title: "New Chat",
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      parentId: null,
      children: []
    };
    this.currentId = id;
    this.save();
    return id;
  },
  clearAll() {
    this.sessions = {};
    this.currentId = null;
    this.save();
    this.createNewSession();
  },
  getCurrentSession() {
    return this.sessions[this.currentId];
  },
  addMessage(role, content) {
    const session = this.getCurrentSession();
    if (!session) return;
    session.messages.push({ role, content, timestamp: Date.now() });

    // Auto-generate title if it's the first user message
    if (session.messages.length === 1 && role === "user") {
        session.title = content.substring(0, 30) + (content.length > 30 ? "..." : "");
    }

    session.updatedAt = Date.now();
    this.save();
  },
  switchSession(id) {
    if (this.sessions[id]) {
      this.currentId = id;
      this.save();
    }
  }
};
sessionManager.init();

function renderSidebar() {
  const list = document.getElementById("chatSessionList");
  if (!list) return;
  list.innerHTML = "";

  const query = (document.getElementById("chatSearchInput")?.value || "").toLowerCase();

  const sessionsArr = Object.values(sessionManager.sessions).sort((a, b) => b.updatedAt - a.updatedAt);

  sessionsArr.forEach(session => {
    if (query && !session.title.toLowerCase().includes(query)) return;

    const div = document.createElement("div");
    div.className = "chat-session-item" + (session.id === sessionManager.currentId ? " active" : "");
    div.dataset.id = session.id;

    div.innerHTML = `
      <div class="chat-session-title">${Security.escapeHtml(session.title)}</div>
      <div class="chat-session-date">${new Date(session.updatedAt).toLocaleDateString()} ${new Date(session.updatedAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div>
    `;

    div.addEventListener("click", () => {
      if(isGenerating) return;
      sessionManager.switchSession(session.id);
      renderSidebar();
      renderChatWindow();
      if(window.innerWidth <= 768) {
          document.getElementById("aiSidebar")?.classList.remove("drawer-open");
      }
    });

    list.appendChild(div);
  });
}
function renderChatWindow() {
  if (!aiChatWindow) return;
  aiChatWindow.innerHTML = "";

  const titleEl = document.getElementById("currentChatTitle");
  const session = sessionManager.getCurrentSession();

  if (titleEl) {
      titleEl.textContent = session ? session.title : "New Chat";
  }

  if (!session || session.messages.length === 0) {
    aiChatWindow.innerHTML = '<div style="color: #aaa; text-align: center; font-size: 0.7rem; margin-top: 20px;">[SYSTEM] AI Assistant Ready. ChatGPT Professional V4 Experience.</div>';
    updateContextBudget();
    return;
  }

  session.messages.forEach(msg => {
    const div = document.createElement("div");
    div.className = `chat-message ${msg.role}`;

    // Check if DOMPurify and marked are available
    let contentHtml = Security.escapeHtml(msg.content);
    if (msg.role === 'assistant' && window.marked && window.DOMPurify) {
       contentHtml = window.DOMPurify.sanitize(window.marked.parse(msg.content));
    } else if (msg.role === 'assistant') {
       // Fallback simple parsing if libraries not loaded
       contentHtml = contentHtml.replace(/\n/g, '<br/>');
    }

    div.innerHTML = `
      <div class="chat-message-meta">
        <span>${msg.role === 'user' ? 'YOU' : 'AI ASSISTANT'}</span>
        <span>${new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
      </div>
      <div class="chat-message-content">${msg.role === 'assistant' ? contentHtml : Security.escapeHtml(msg.content).replace(/\n/g, '<br>')}</div>
    `;
    aiChatWindow.appendChild(div);
  });

  aiChatWindow.scrollTop = aiChatWindow.scrollHeight;
  updateContextBudget();
}



let abortController = null;

if (btnSendAiChat && aiChatInput) {
  const sendChat = async () => {
    if (isGenerating) return;
    const text = aiChatInput.value.trim();
    if (!text && !currentAttachment) return;

    const session = sessionManager.getCurrentSession();
    if (!session) return;

    let userMsg = text;
    if (currentAttachment) {
      userMsg = `[Attachment: ${currentAttachment.filename}] ${text}`;
    }

    sessionManager.addMessage("user", userMsg);
    aiChatInput.value = "";

    // reset attachment UI
    const prevAttachment = currentAttachment;
    currentAttachment = null;
    if (aiChatFile) aiChatFile.value = "";
    if (aiChatAttachmentPreview) {
      aiChatAttachmentPreview.style.display = "none";
      aiChatAttachmentPreview.innerHTML = "";
    }

    renderSidebar();
    renderChatWindow();

    isGenerating = true;
    btnSendAiChat.style.display = "none";
    const btnStop = document.getElementById("btnStopAiChat");
    if (btnStop) btnStop.style.display = "block";

    // Add placeholder for AI response
    const div = document.createElement("div");
    div.className = "chat-message assistant";
    div.innerHTML = `
      <div class="chat-message-meta">
        <span>AI ASSISTANT</span>
        <span>Loading...</span>
      </div>
      <div class="chat-message-content streaming-content">...</div>
    `;
    aiChatWindow.appendChild(div);
    aiChatWindow.scrollTop = aiChatWindow.scrollHeight;

    const contentBox = div.querySelector(".streaming-content");
    let accumulatedResponse = "";

    abortController = new AbortController();

    try {
      const chatMode = document.getElementById("aiChatMode")?.value || "normal";

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: chatMode,
          messages: session.messages.map(m => ({ role: m.role, content: m.content })),
          attachment: prevAttachment ? {
             base64: prevAttachment.base64,
             mimeType: prevAttachment.mimeType,
             filename: prevAttachment.filename
          } : null
        }),
        signal: abortController.signal
      });

      if (!response.ok) {
        throw new Error(`Server error: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder("utf-8");

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const dataStr = line.replace("data: ", "").trim();
            if (dataStr === "[DONE]") {
              break;
            }
            try {
              const parsed = JSON.parse(dataStr);
              if (parsed.error) {
                accumulatedResponse += `<br><span style="color:#f55">${Security.escapeHtml(parsed.error)}</span>`;
                break;
              }
              if (parsed.content) {
                accumulatedResponse += parsed.content;

                // Render streaming (raw text to prevent broken markdown while streaming)
                contentBox.textContent = accumulatedResponse;
                aiChatWindow.scrollTop = aiChatWindow.scrollHeight;
              }
            } catch (e) {
              // Ignore parse errors on incomplete chunks
            }
          }
        }
      }

      // Finalize response
      if (accumulatedResponse) {
          sessionManager.addMessage("assistant", accumulatedResponse);
          // Re-render completely with Markdown
          renderChatWindow();
      }

    } catch (err) {
      if (err.name === 'AbortError') {
        accumulatedResponse += " [Aborted by user]";
      } else {
        accumulatedResponse += `\n\n[Error: ${err.message}]`;
      }
      sessionManager.addMessage("assistant", accumulatedResponse);
      renderChatWindow();
    } finally {
      isGenerating = false;
      btnSendAiChat.style.display = "block";
      if (btnStop) btnStop.style.display = "none";
      abortController = null;
    }
  };

  btnSendAiChat.addEventListener("click", sendChat);

  aiChatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendChat();
    }
  });

  const btnStop = document.getElementById("btnStopAiChat");
  if (btnStop) {
      btnStop.addEventListener("click", () => {
          if (abortController) {
              abortController.abort();
          }
      });
  }
}
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
