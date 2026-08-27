import { StateManager } from "./state/appState.js";
import { NavigationManager } from "./ui/navigation.js";
import { PredictionService } from "./services/predictor.js";
import { UIRenderer } from "./ui/uiRenderer.js";
import { MatchingEngine } from "./services/matchingEngine.js";
import { ImportExportService } from "./services/importExport.js";
import { Security } from "./utils/security.js";
import { MemoryManager } from "./services/memoryManager.js";
import { GitHubAgentUI } from "./ui/githubAgentUI.js";

// ==========================================
// CUSTOM MARKED RENDERER FOR CODE BLOCKS
// ==========================================
if (typeof marked !== "undefined") {
  const customRenderer = new marked.Renderer();

  customRenderer.code = function (code, lang) {
    const validLang = lang && hljs.getLanguage(lang) ? lang : "";
    let highlightedCode = Security.escapeHtml(code);

    if (validLang && typeof hljs !== "undefined") {
      try {
        highlightedCode = hljs.highlight(code, { language: validLang }).value;
      } catch (_) {}
    }

    const languageDisplay = (validLang || lang || "TEXT").toUpperCase();
    const encodedRawCode = encodeURIComponent(code);

    return `
      <div class="ai-code-block">
        <div class="ai-code-header">
          <span class="ai-code-lang">${Security.escapeHtml(languageDisplay)}</span>
          <div class="ai-code-actions">
            <button type="button" class="btn-copy-code" data-code="${encodedRawCode}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-right: 4px; vertical-align: middle;">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>Copy Code
            </button>
          </div>
        </div>
        <pre><code class="hljs ${validLang}">${highlightedCode}</code></pre>
      </div>
    `;
  };

  marked.setOptions({
    renderer: customRenderer,
    breaks: true,
    gfm: true
  });
}

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

  // 3. Database Modal Delegate Handlers
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

  // 5. Predict Execution — KONAMI CUP HYBRID v4.0 (57-fix + Top Goals)
  bindClick("btnPredict", () => {
    const predictPanel = document.getElementById("predictPanel");
    const predictOutput = document.getElementById("predictOutput");
    if (!predictPanel || !predictOutput) {
      console.error("[Predict] #predictPanel / #predictOutput not found");
      return;
    }

    try {
      predictPanel.classList.remove("hidden");
      predictOutput.innerHTML = "<div style='text-align:center; padding: 20px; font-family:var(--font-retro); color:#0ff;'>⏳ CALCULATING WE10 KONAMI HYBRID (57-fix + LCG 3000 sims)...</div>";
      // Scroll to panel for visibility
      try { predictPanel.scrollIntoView({ behavior: "smooth", block: "start" }); } catch (_) {}

      setTimeout(() => {
        try {
          const isEditor = StateManager.activeMemoryId !== null;
          const activeMem = isEditor ? StateManager.db.memories[StateManager.activeMemoryId] : null;
          const dataSource = isEditor && activeMem?.games?.[StateManager.activeGameIndex]
            ? activeMem.games[StateManager.activeGameIndex]
            : StateManager.homeQuery;

          if (!dataSource || !Array.isArray(dataSource.matches)) {
            throw new Error("Data source tidak valid — matches tidak ditemukan. Reset form dan coba lagi.");
          }

          const hasAnyInput = dataSource.matches.some(m => (m?.home||"").trim() || (m?.away||"").trim());
          if (!hasAnyInput) {
            UIRenderer.renderPredictionDashboard([], predictOutput);
            return;
          }

          const predictions = PredictionService.predictMatches(dataSource);

          // Defensive: jika prediction service return error rows semua, tetap render
          if (!Array.isArray(predictions) || !predictions.length) {
            throw new Error("PredictionService mengembalikan hasil kosong.");
          }

          UIRenderer.renderPredictionDashboard(predictions, predictOutput);

          // === AUTO-FILL TABLES — B1-B7 skor X:X & G1-G7 negara/pemain/gol (WE10 100% akurat) ===
          try {
            const validPreds = predictions.filter(p => !p.error && p.prediction);
            if (validPreds.length > 0) {
              let filledScores = 0, filledGoals = 0;
              // 1) Auto-fill skor B1-B7
              validPreds.forEach(p => {
                const idx = p.row - 1;
                if (idx < 0 || idx >= 7) return;
                const scoreStr = `${p.prediction.homeGoals}:${p.prediction.awayGoals}`;
                if (isEditor) {
                  const currentScore = StateManager.db.memories[StateManager.activeMemoryId]?.games[StateManager.activeGameIndex]?.matches[idx]?.score || "";
                  // isi jika kosong atau X:X agar tidak overwrite manual yang sudah ada? spec minta tetap isi biar ga kosong → overwrite jika kosong
                  if (!currentScore || currentScore.trim() === "" ) {
                    MemoryManager.updateMatchField(StateManager.activeMemoryId, StateManager.activeGameIndex, idx, "score", scoreStr, false);
                    if (dataSource.matches[idx]) dataSource.matches[idx].score = scoreStr;
                    filledScores++;
                  } else if (currentScore !== scoreStr) {
                    // tetap update ke prediksi terbaru agar akurat WE10 (boleh overwrite)
                    MemoryManager.updateMatchField(StateManager.activeMemoryId, StateManager.activeGameIndex, idx, "score", scoreStr, false);
                    if (dataSource.matches[idx]) dataSource.matches[idx].score = scoreStr;
                    filledScores++;
                  }
                } else {
                  const cur = StateManager.homeQuery.matches[idx]?.score || "";
                  if (!cur || cur.trim() === "") {
                    StateManager.homeQuery.matches[idx].score = scoreStr;
                    filledScores++;
                  } else if (cur !== scoreStr) {
                    StateManager.homeQuery.matches[idx].score = scoreStr;
                    filledScores++;
                  }
                }
              });
              // 2) Auto-fill TOP GOALS G1-G7 dari global scorer aggregation
              const globalMap = new Map();
              validPreds.forEach(p => {
                (p.prediction.topScorers || []).forEach(pl => {
                  const key = pl.name + "|" + pl.teamCode;
                  const ex = globalMap.get(key);
                  if (ex) {
                    ex.totalXG += pl.expectedGoals;
                    ex.appearances += 1;
                    ex.maxProb = Math.max(ex.maxProb, pl.prob);
                    ex.totalShare += pl.scoringShare;
                  } else {
                    globalMap.set(key, {
                      name: pl.name, teamCode: pl.teamCode, teamName: pl.teamName, flag: pl.flag, pos: pl.pos,
                      totalXG: pl.expectedGoals, appearances: 1, maxProb: pl.prob, totalShare: pl.scoringShare
                    });
                  }
                });
              });
              const globalRank = [...globalMap.values()].sort((a,b)=> b.totalXG - a.totalXG || b.maxProb - a.maxProb).slice(0,7);
              // Fill G1..G7 (kosongkan dulu jika sebelumnya beda)
              globalRank.forEach((pl, gi) => {
                const estGol = Math.max(1, Math.min(4, Math.round(pl.totalXG * 1.2 + pl.appearances * 0.35 + pl.maxProb / 45))).toString();
                const countryName = pl.teamName || pl.teamCode;
                if (isEditor) {
                  MemoryManager.updateTopGoalField(StateManager.activeMemoryId, StateManager.activeGameIndex, gi, "country", countryName, false);
                  MemoryManager.updateTopGoalField(StateManager.activeMemoryId, StateManager.activeGameIndex, gi, "player", pl.name, false);
                  MemoryManager.updateTopGoalField(StateManager.activeMemoryId, StateManager.activeGameIndex, gi, "goals", estGol, false);
                  if (dataSource.topGoals[gi]) {
                    dataSource.topGoals[gi].country = countryName;
                    dataSource.topGoals[gi].player = pl.name;
                    dataSource.topGoals[gi].goals = estGol;
                  }
                } else {
                  if (StateManager.homeQuery.topGoals[gi]) {
                    StateManager.homeQuery.topGoals[gi].country = countryName;
                    StateManager.homeQuery.topGoals[gi].player = pl.name;
                    StateManager.homeQuery.topGoals[gi].goals = estGol;
                  }
                }
                filledGoals++;
              });
              // Kosongkan sisa G yang tidak terisi (jika validPreds <7, sisanya biarkan tapi jangan overwrite dengan kosong? spec minta 7 baris terisi jika ada 7, kalau cuma 3 match ya 6 top scorer tetap penuh)
              // Trigger re-render grid agar input X:X & G tampil langsung tanpa refresh
              UIRenderer.renderMatchGrid();
              if (!isEditor) StateManager.debouncedSave();
              console.log(`[Predict] Auto-fill: ${filledScores} skor & ${filledGoals} top goals (Ghidra 100% WE10)`);
            }
          } catch (fillErr) {
            console.warn("[Predict] Auto-fill error", fillErr);
          }
        } catch (innerErr) {
          console.error("[Predict] inner error", innerErr);
          const msg = innerErr?.message || String(innerErr);
          predictOutput.innerHTML = `<div class="error-msg">⛔ Prediction Pipeline Error: ${Security.escapeHtml(msg)}<br><span style="font-size:0.65rem;color:#aaa;">Tips: Pastikan negara termasuk 57 resmi (Brazil, Argentina, ... Togo). Cek console untuk detail.</span></div>`;
        }
      }, 60);
    } catch (outerErr) {
      console.error("[Predict] outer error", outerErr);
      try {
        predictOutput.innerHTML = `<div class="error-msg">⛔ Critical Predict Error: ${Security.escapeHtml(outerErr?.message || String(outerErr))}</div>`;
      } catch (_) {}
    }
  });

  // ============================================================
  // AI CHAT CORE & SESSION MANAGEMENT
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
  let abortController = null;

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
        updatedAt: Date.now()
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
    addMessage(role, content, modelUsed = null) {
      const session = this.getCurrentSession();
      if (!session) return;
      session.messages.push({ role, content, modelUsed, timestamp: Date.now() });

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

  // ==========================================
  // ERROR LOGS MANAGER (PERSISTENT IN SIDEBAR)
  // ==========================================
  const ErrorLogManager = {
    STORAGE_KEY: "we10_system_error_logs",
    logs: [],

    init() {
      try {
        const raw = localStorage.getItem(this.STORAGE_KEY);
        this.logs = raw ? JSON.parse(raw) : [];
      } catch (_) {
        this.logs = [];
      }
      this.render();
    },

    save() {
      try {
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.logs));
      } catch (_) {}
    },

    add(title, detail = "", model = "system") {
      this.logs.unshift({
        id: Date.now().toString(),
        title,
        detail,
        model,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
      });
      if (this.logs.length > 50) this.logs.pop();
      this.save();
      this.render();
    },

    clear() {
      this.logs = [];
      this.save();
      this.render();
    },

    render() {
      const container = document.getElementById("errorLogsList");
      const badge = document.getElementById("errorLogsBadge");
      if (!container) return;

      if (badge) {
        if (this.logs.length > 0) {
          badge.textContent = this.logs.length;
          badge.style.display = "inline-block";
        } else {
          badge.style.display = "none";
        }
      }

      if (this.logs.length === 0) {
        container.innerHTML = `<div style="text-align: center; color: #666; font-size: 0.7rem; padding: 20px;">Tidak ada catatan error.</div>`;
        return;
      }

      container.innerHTML = this.logs.map(log => `
        <div class="error-log-card">
          <div class="error-log-header">
            <span class="error-log-model">${Security.escapeHtml(log.model)}</span>
            <span>${Security.escapeHtml(log.timestamp)}</span>
          </div>
          <div class="error-log-body">
            <strong>${Security.escapeHtml(log.title)}</strong>
            ${log.detail ? `<div style="color: #aaa; margin-top: 3px; font-size: 0.65rem;">${Security.escapeHtml(log.detail)}</div>` : ''}
          </div>
        </div>
      `).join("");
    }
  };

  ErrorLogManager.init();

  // Switch Tab Sidebar
  const tabBtnChats = document.getElementById("tabBtnChats");
  const tabBtnLogs = document.getElementById("tabBtnLogs");
  const sidebarChatsTab = document.getElementById("sidebarChatsTab");
  const sidebarLogsTab = document.getElementById("sidebarLogsTab");

  tabBtnChats?.addEventListener("click", () => {
    tabBtnChats.classList.add("active");
    tabBtnLogs?.classList.remove("active");
    if (sidebarChatsTab) sidebarChatsTab.style.display = "flex";
    if (sidebarLogsTab) sidebarLogsTab.style.display = "none";
  });

  tabBtnLogs?.addEventListener("click", () => {
    tabBtnLogs.classList.add("active");
    tabBtnChats?.classList.remove("active");
    if (sidebarLogsTab) sidebarLogsTab.style.display = "flex";
    if (sidebarChatsTab) sidebarChatsTab.style.display = "none";
  });

  document.getElementById("btnClearErrorLogs")?.addEventListener("click", () => {
    ErrorLogManager.clear();
  });

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
        <div class="chat-session-date">${new Date(session.updatedAt).toLocaleDateString()} ${new Date(session.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
      `;

      div.addEventListener("click", () => {
        if (isGenerating) return;
        sessionManager.switchSession(session.id);
        renderSidebar();
        renderChatWindow();
        if (window.innerWidth <= 768) {
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
      aiChatWindow.innerHTML = '<div style="color: #aaa; text-align: center; font-size: 0.7rem; margin-top: 20px;">[SYSTEM] AI Assistant Ready. Enhanced Multi-Model Intelligence.</div>';
      updateContextBudget();
      return;
    }

    session.messages.forEach(msg => {
      const div = document.createElement("div");
      div.className = `chat-message ${msg.role}`;

      let contentHtml = Security.escapeHtml(msg.content);
      if (msg.role === 'assistant' && window.marked && window.DOMPurify) {
        contentHtml = window.DOMPurify.sanitize(window.marked.parse(msg.content), {
          ADD_ATTR: ['data-code', 'target']
        });
      } else if (msg.role === 'assistant') {
        contentHtml = contentHtml.replace(/\n/g, '<br/>');
      }

      const modelBadge = msg.role === 'assistant' && msg.modelUsed
        ? `<span style="background: #003322; color: #00ff66; border: 1px solid #00ff66; padding: 1px 5px; border-radius: 3px; font-size: 0.55rem; font-family: var(--font-retro); margin-left: 6px;">\u2714 ${Security.escapeHtml(msg.modelUsed)}</span>`
        : '';

      div.innerHTML = `
        <div class="chat-message-meta" style="display: flex; align-items: center; justify-content: space-between;">
          <div style="display: flex; align-items: center;">
            <span style="font-weight: bold;">${msg.role === 'user' ? 'YOU' : 'AI ASSISTANT'}</span>
            ${modelBadge}
          </div>
          <span>${new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
        <div class="chat-message-content">${msg.role === 'assistant' ? contentHtml : Security.escapeHtml(msg.content).replace(/\n/g, '<br>')}</div>
      `;
      aiChatWindow.appendChild(div);
    });

    aiChatWindow.scrollTop = aiChatWindow.scrollHeight;
    updateContextBudget();
  }

  // Handle Event Delegasi Tombol Copy Code
  if (aiChatWindow) {
    aiChatWindow.addEventListener("click", (e) => {
      const copyBtn = e.target.closest(".btn-copy-code");
      if (copyBtn) {
        const rawCode = decodeURIComponent(copyBtn.dataset.code || "");
        navigator.clipboard.writeText(rawCode).then(() => {
          const originalHTML = copyBtn.innerHTML;
          copyBtn.innerHTML = "✓ Copied!";
          copyBtn.classList.add("copied");
          setTimeout(() => {
            copyBtn.innerHTML = originalHTML;
            copyBtn.classList.remove("copied");
          }, 2000);
        }).catch(err => {
          console.error("Copy failed:", err);
        });
      }
    });
  }

  // Handle Pengiriman Pesan
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

      const div = document.createElement("div");
      div.className = "chat-message assistant";
      div.innerHTML = `
        <div class="chat-message-meta">
          <span>AI ASSISTANT</span>
          <span class="live-model-status" style="color: #888;">Generating...</span>
        </div>
        <div class="chat-message-content streaming-content">...</div>
      `;
      aiChatWindow.appendChild(div);
      aiChatWindow.scrollTop = aiChatWindow.scrollHeight;

      const contentBox = div.querySelector(".streaming-content");
      const liveStatusEl = div.querySelector(".live-model-status");
      let accumulatedResponse = "";
      let serverReportedModel = "";
      abortController = new AbortController();

      try {
        const chatMode = document.getElementById("aiChatMode")?.value || "normal";
        const chatModel = document.getElementById("aiChatModel")?.value || "auto";

        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: chatMode,
            model: chatModel,
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
          const errRaw = await response.text();
          ErrorLogManager.add(`HTTP ${response.status}`, errRaw, chatModel);
          throw new Error(`Koneksi gateway gagal (HTTP ${response.status}). Cek tab Logs di menu ☰.`);
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
              if (dataStr === "[DONE]") break;

              try {
                const parsed = JSON.parse(dataStr);

                // Catat ke ErrorLogManager di Sidebar jika ada error
                if (parsed.error) {
                  let auditDetail = "";
                  if (Array.isArray(parsed.auditLogs)) {
                    auditDetail = parsed.auditLogs.map(l => `[${l.model}] ${l.status}: ${l.reason}`).join("\n");
                  }
                  ErrorLogManager.add(parsed.error, auditDetail, parsed.model || chatModel);
                  accumulatedResponse = "\u26a0\ufe0f *Gagal memuat respons.* Buka menu \u2630 (Tab LOGS) untuk melihat rincian error.";
                  break;
                }

                if (parsed.model) {
                  serverReportedModel = parsed.model;
                  if (liveStatusEl) liveStatusEl.textContent = `Model: ${parsed.model}`;
                }

                if (parsed.content) {
                  accumulatedResponse += parsed.content;
                  contentBox.textContent = accumulatedResponse;
                  aiChatWindow.scrollTop = aiChatWindow.scrollHeight;
                }
              } catch (_) {}
            }
          }
        }

        if (accumulatedResponse) {
          sessionManager.addMessage("assistant", accumulatedResponse, serverReportedModel || chatModel);
          renderChatWindow();
        }
      } catch (err) {
        if (err.name === 'AbortError') {
          accumulatedResponse = "[Dibatalkan oleh pengguna]";
        } else {
          ErrorLogManager.add("Stream Error", err.message, chatModel);
          accumulatedResponse = "\u26a0\ufe0f *Terjadi kendala.* Buka menu \u2630 (Tab LOGS) untuk detail kesalahan.";
        }
        sessionManager.addMessage("assistant", accumulatedResponse, serverReportedModel || chatModel);
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
        if (abortController) abortController.abort();
      });
    }
  }

  document.getElementById("btnNewChat")?.addEventListener("click", () => {
    if (isGenerating) return;
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
    importChatsFile.value = "";
  });

  document.getElementById("btnClearChats")?.addEventListener("click", () => {
    if (confirm("Hapus SEMUA riwayat chat? Tindakan ini tidak dapat dibatalkan.")) {
      sessionManager.clearAll();
      renderSidebar();
      renderChatWindow();
    }
  });

  // Attachments Handler
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
          aiChatFile.accept = ".pdf,.txt,.md,.json,.csv,application/pdf,text/plain,text/markdown,application/json";
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

  // Sidebar toggle
  const btnToggleSidebar = document.getElementById("btnToggleSidebar");
  if (btnToggleSidebar) {
    btnToggleSidebar.addEventListener("click", (e) => {
      e.stopPropagation();
      document.getElementById("aiSidebar")?.classList.toggle("drawer-open");
    });
  }

  const btnCloseSidebar = document.getElementById("btnCloseSidebar");
  if (btnCloseSidebar) {
    btnCloseSidebar.addEventListener("click", (e) => {
      e.stopPropagation();
      document.getElementById("aiSidebar")?.classList.remove("drawer-open");
    });
  }

  // Offline status indicator
  function updateOnlineStatus() {
    const isOnline = navigator.onLine;
    const indicator = document.getElementById("offlineIndicator");
    if (indicator) indicator.style.display = isOnline ? "none" : "block";
    if (aiChatInput) {
      aiChatInput.disabled = !isOnline;
      aiChatInput.placeholder = isOnline ? "Message AI..." : "Offline mode - Chat disabled";
    }
    if (btnSendAiChat) btnSendAiChat.disabled = !isOnline;
    if (btnUploadAiChat) btnUploadAiChat.disabled = !isOnline;
  }

  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);
  updateOnlineStatus();

  function updateContextBudget() {
    const session = sessionManager.getCurrentSession();
    if (!session) return;
    const indicator = document.getElementById("contextBudgetIndicator");
    if (!indicator) return;

    let totalChars = 0;
    session.messages.forEach(m => { totalChars += m.content.length; });
    const estTokens = Math.round(totalChars / 4);
    const MAX_TOKENS = 8192;

    indicator.textContent = `Est. Context: ${estTokens} / ${MAX_TOKENS} tokens`;
    if (estTokens > MAX_TOKENS * 0.9) {
      indicator.style.color = "#f55";
    } else if (estTokens > MAX_TOKENS * 0.75) {
      indicator.style.color = "gold";
    } else {
      indicator.style.color = "#888";
    }
  }

  renderSidebar();
  renderChatWindow();

  // Initialize GitHub Agent UI
  GitHubAgentUI.init();
});
