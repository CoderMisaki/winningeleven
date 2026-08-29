import { StateManager } from "./state/appState.js";
import { NavigationManager } from "./ui/navigation.js";
import { PredictionService, PREDICTOR_CONFIG } from "./services/predictor.js";
import { UIRenderer } from "./ui/uiRenderer.js";
import { MatchingEngine } from "./services/matchingEngine.js";
import { ImportExportService } from "./services/importExport.js";
import { Security } from "./utils/security.js";
import { MemoryManager } from "./services/memoryManager.js";
import { GitHubAgentUI } from "./ui/githubAgentUI.js";
import { BaganRngService } from "./services/baganRng.js";
import { setupCountryAutocomplete } from "./ui/autocomplete.js";

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

          // === AUTO-FILL (SPEC R) — respect PREDICTOR_CONFIG.AUTO_APPLY (default false) ===
          try {
            const validPreds = predictions.filter(p => !p.error && p.prediction);
            if (validPreds.length > 0) {
              const doFillScores = () => {
                let filledScores=0;
                validPreds.forEach(p => {
                  const idx = p.row - 1;
                  if (idx < 0 || idx >= 8) return;
                  const scoreStr = `${p.prediction.homeGoals}:${p.prediction.awayGoals}`;
                  if (isEditor) {
                    MemoryManager.updateMatchField(StateManager.activeMemoryId, StateManager.activeGameIndex, idx, "score", scoreStr, false);
                    if (dataSource.matches[idx]) dataSource.matches[idx].score = scoreStr;
                    filledScores++;
                  } else {
                    StateManager.homeQuery.matches[idx].score = scoreStr;
                    filledScores++;
                  }
                });
                UIRenderer.renderMatchGrid();
                if (!isEditor) StateManager.debouncedSave();
                return filledScores;
              };
              const doFillGoals = () => {
                const globalMap = new Map();
                validPreds.forEach(p => {
                  (p.prediction.topScorers || []).forEach(pl => {
                    const actual = pl.matchGoals != null ? pl.matchGoals : 0;
                    if (actual <= 0) return;
                    const key = pl.name + "|" + pl.teamCode;
                    const ex = globalMap.get(key);
                    if (ex) { ex.totalActual += actual; ex.totalXG += pl.expectedGoals; ex.appearances += 1; ex.maxProb = Math.max(ex.maxProb, pl.prob); ex.reason = pl.reason || ex.reason; }
                    else globalMap.set(key, { name: pl.name, teamCode: pl.teamCode, teamName: pl.teamName, flag: pl.flag, pos: pl.pos, totalActual: actual, totalXG: pl.expectedGoals, appearances: 1, maxProb: pl.prob, reason: pl.reason || "" });
                  });
                });
                if (globalMap.size === 0) {
                  validPreds.forEach(p => {
                    (p.prediction.topScorers || []).slice(0,2).forEach(pl => {
                      const key = pl.name + "|" + pl.teamCode;
                      if (!globalMap.has(key)) globalMap.set(key, { name: pl.name, teamCode: pl.teamCode, teamName: pl.teamName, flag: pl.flag, pos: pl.pos, totalActual: 0, totalXG: pl.expectedGoals, appearances: 1, maxProb: pl.prob, reason: pl.reason || "" });
                    });
                  });
                }
                const globalRank = [...globalMap.values()].sort((a,b)=> (b.totalActual - a.totalActual) || (b.totalXG - a.totalXG) || (b.maxProb - a.maxProb)).slice(0,7);
                let filledGoals=0;
                globalRank.forEach((pl, gi) => {
                  const golInt = String(pl.totalActual > 0 ? pl.totalActual : Math.max(1, Math.round(pl.totalXG)));
                  const countryName = pl.teamName || pl.teamCode;
                  if (isEditor) {
                    MemoryManager.updateTopGoalField(StateManager.activeMemoryId, StateManager.activeGameIndex, gi, "country", countryName, false);
                    MemoryManager.updateTopGoalField(StateManager.activeMemoryId, StateManager.activeGameIndex, gi, "player", pl.name, false);
                    MemoryManager.updateTopGoalField(StateManager.activeMemoryId, StateManager.activeGameIndex, gi, "goals", golInt, false);
                    if (dataSource.topGoals[gi]) { dataSource.topGoals[gi].country = countryName; dataSource.topGoals[gi].player = pl.name; dataSource.topGoals[gi].goals = golInt; }
                  } else {
                    if (StateManager.homeQuery.topGoals[gi]) { StateManager.homeQuery.topGoals[gi].country = countryName; StateManager.homeQuery.topGoals[gi].player = pl.name; StateManager.homeQuery.topGoals[gi].goals = golInt; }
                  }
                  filledGoals++;
                });
                UIRenderer.renderMatchGrid();
                if (!isEditor) StateManager.debouncedSave();
                return filledGoals;
              };

              if (PREDICTOR_CONFIG.AUTO_APPLY) {
                const s = doFillScores(); const g = doFillGoals();
                console.log(`[Predict] Auto-fill (AUTO_APPLY=true): ${s} skor & ${g} top goals`);
              } else {
                const bar = document.createElement("div");
                bar.style.cssText = "background:#001a00;border:1px solid #0f0;padding:8px;margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;";
                bar.innerHTML = `
                  <span style="font-size:0.65rem;color:#0ff;">APPLY PREDICTION?</span>
                  <button id="btnApplyScores" class="btn" style="background:#002a00;border:1px solid #0f0;color:#0f0;padding:6px 10px;cursor:pointer;">APPLY SCORES TO B1-B8</button>
                  <button id="btnApplyGoals" class="btn" style="background:#002a00;border:1px solid #ff0;color:#ff0;padding:6px 10px;cursor:pointer;">APPLY TOP GOALS (G1-G7)</button>
                  <button id="btnApplyBoth" class="btn btn-primary" style="padding:6px 10px;cursor:pointer;">APPLY BOTH</button>
                  <span style="font-size:0.6rem;color:#888;">Dataset tidak akan tertimpa tanpa konfirmasi (SPEC R).</span>
                `;
                predictOutput.appendChild(bar);
                document.getElementById("btnApplyScores")?.addEventListener("click", ()=>{ const n=doFillScores(); const b=document.getElementById("btnApplyScores"); if(b){b.textContent=`✓ ${n} SCORES APPLIED`; b.disabled=true;} });
                document.getElementById("btnApplyGoals")?.addEventListener("click", ()=>{ const n=doFillGoals(); const b=document.getElementById("btnApplyGoals"); if(b){b.textContent=`✓ ${n} GOALS APPLIED`; b.disabled=true;} });
                document.getElementById("btnApplyBoth")?.addEventListener("click", ()=>{ const s=doFillScores(); const g=doFillGoals(); const b=document.getElementById("btnApplyBoth"); if(b){b.textContent=`✓ ${s}+${g} APPLIED`; b.disabled=true;} document.getElementById("btnApplyScores")?.setAttribute("disabled",""); document.getElementById("btnApplyGoals")?.setAttribute("disabled",""); });
              }
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

  // === BAGAN RNG SYNC TIKTOK LIVE ===
  const baganSeedInput = document.getElementById("baganSeedInput");
  const baganOutput = document.getElementById("baganOutput");
  function renderBagan() {
    if (!baganOutput) return;
    const seedRaw = baganSeedInput?.value?.trim() || BaganRngService.getUrlSeed() || "";
    if (baganSeedInput && BaganRngService.getUrlSeed() && !baganSeedInput.value) baganSeedInput.value = BaganRngService.getUrlSeed();
    // Ambil tim dari StateManager (B1-B8) atau homeQuery
    const isEditor = StateManager.activeMemoryId !== null;
    const activeMem = isEditor ? StateManager.db.memories[StateManager.activeMemoryId] : null;
    const dataSource = isEditor && activeMem?.games?.[StateManager.activeGameIndex] ? activeMem.games[StateManager.activeGameIndex] : StateManager.homeQuery;
    const teamCodes = [];
    const teamNames = [];
    (dataSource?.matches || []).forEach(m => {
      const h = (m?.home || "").trim(), a = (m?.away || "").trim();
      if (h) { teamCodes.push(h); teamNames.push(h); }
      if (a) { teamCodes.push(a); teamNames.push(a); }
    });
    // unique, ambil 8 pertama unik
    const uniq = [...new Set(teamCodes.map(c => Security.sanitizeInput(c).toUpperCase()))].filter(Boolean).slice(0, 8);
    const uniqNames = uniq; // pakai kode sebagai nama untuk bagan (bisa di-resolve ke flag)
    if (uniq.length < 2) {
      baganOutput.innerHTML = `<div style="color:#ff0;">Isi B1-B8 minimal 2 tim untuk generate bagan. Seed TikTok: <code style="color:#0ff;">${Security.escapeHtml(seedRaw || "(kosong → default 0x12345678)")}</code></div>`;
      return;
    }
    const res = BaganRngService.generateBracket(uniq, seedRaw);
    if (res.error) { baganOutput.innerHTML = `<div style="color:#f55;">${Security.escapeHtml(res.error)}</div>`; return; }
    const qHtml = res.quarters.map((q, i) => {
      return `<div style="background:#111;border:1px solid #0ff;padding:8px;min-width:140px;text-align:center;">
        <div style="font-size:0.6rem;color:#888;">${q.seedRef}</div>
        <div style="font-weight:bold;color:#fff;">${Security.escapeHtml(q.home)}</div>
        <div style="color:#888;">vs</div>
        <div style="font-weight:bold;color:#fff;">${Security.escapeHtml(q.away)}</div>
      </div>`;
    }).join("");
    baganOutput.innerHTML = `
      <div style="margin-bottom:8px;"><strong style="color:#0ff;">Seed TikTok:</strong> <code style="background:#000;padding:2px 6px;border:1px solid #0ff;color:#0ff;">${Security.escapeHtml(res.tiktokSeedRaw || "(default)")}</code> → <span style="color:#888;">${Security.escapeHtml(res.source)}</span> → <code style="background:#001a00;padding:2px 6px;border:1px solid #0f0;color:#0f0;">0x${res.seed.toString(16).toUpperCase()}</code> <span style="font-size:0.6rem;color:#888;">(sama persis di overlay TikTok jika seed sama)</span></div>
      <div style="display:flex;gap:8px;overflow-x:auto;padding:6px;background:#000;border:1px solid #333;">${qHtml}</div>
      <div style="margin-top:8px;background:#001a1a;border:1px solid #0ff;padding:6px;font-size:0.65rem;">
        <strong>Urutan acak (shuffled):</strong> ${res.shuffled.map(c=>`<span style="background:#002a2a;border:1px solid #333;padding:2px 4px;margin:2px;display:inline-block;">${Security.escapeHtml(c)}</span>`).join("")}
        <div style="margin-top:4px;color:#888;">Proof: ${Security.escapeHtml(res.proof.lcg)} → ${Security.escapeHtml(res.proof.shuffle)} — Seed sama = bracket sama 100%.</div>
        <div style="color:#ff0;">Untuk sync: copy seed dari overlay TikTok Live → paste di input ini → GENERATE BAGAN. Atau buka link: <code>${Security.escapeHtml(window.location.origin + window.location.pathname + "?tiktok_seed=" + encodeURIComponent(res.tiktokSeedRaw || res.seed))}</code></div>
      </div>
    `;
  }
  bindClick("btnGenerateBagan", renderBagan);
  bindClick("btnSyncBaganFromPredict", () => { renderBagan(); document.getElementById("baganRngPanel")?.scrollIntoView({behavior:"smooth"}); });
  bindClick("btnCopyBaganLink", async () => {
    const seedRaw = document.getElementById("baganSeedInput")?.value?.trim() || BaganRngService.getUrlSeed() || "";
    const link = window.location.origin + window.location.pathname + "?tiktok_seed=" + encodeURIComponent(seedRaw || "default");
    try { await navigator.clipboard.writeText(link); baganOutput.innerHTML += `<div style="color:#0f0;margin-top:6px;">✓ Link tercopy: ${Security.escapeHtml(link)}</div>`; } catch { prompt("Copy link:", link); }
  });
  // === WHAT IF — Manual Skor → Top Goals Only (Ghidra RNG Valid) ===
  try {
    const whatIfHome = document.getElementById("whatIfHome");
    const whatIfAway = document.getElementById("whatIfAway");
    const whatIfHg = document.getElementById("whatIfHomeGoals");
    const whatIfAg = document.getElementById("whatIfAwayGoals");
    const whatIfOut = document.getElementById("whatIfOutput");
    if (whatIfHome && whatIfAway) {
      if (typeof setupCountryAutocomplete === "function") {
        setupCountryAutocomplete(whatIfHome, (val)=>{ whatIfHome.value = val; });
        setupCountryAutocomplete(whatIfAway, (val)=>{ whatIfAway.value = val; });
      }
    }
    const runWhatIf = () => {
      if (!whatIfOut) return;
      const hRaw = (whatIfHome?.value || "").trim();
      const aRaw = (whatIfAway?.value || "").trim();
      const hgRaw = (whatIfHg?.value || "").trim();
      const agRaw = (whatIfAg?.value || "").trim();
      if (!hRaw || !aRaw) {
        whatIfOut.innerHTML = `<div style="background:#331100;border:1px solid #ff0;color:#ffcc66;padding:8px;">⛔ Isi HOME & AWAY dulu (negara 57-fix, cth: Argentina / Wales).</div>`;
        return;
      }
      if (hgRaw === "" || agRaw === "") {
        whatIfOut.innerHTML = `<div style="background:#331100;border:1px solid #ff0;color:#ffcc66;padding:8px;">⛔ Isi skor HOME & AWAY (0-20). Contoh: Argentina 2 : 1 Wales</div>`;
        return;
      }
      whatIfOut.innerHTML = `<div style="text-align:center;padding:12px;color:#0ff;">⏳ Mengalokasikan ${Security.escapeHtml(hRaw)} ${hgRaw}:${agRaw} ${Security.escapeHtml(aRaw)} via LCG 1664525 (Ghidra FUN_0016e8d8)…</div>`;
      setTimeout(()=>{
        try {
          const res = PredictionService.whatIf(hRaw, aRaw, hgRaw, agRaw, {});
          UIRenderer.renderWhatIfResult(res, whatIfOut);
          try { whatIfOut.scrollIntoView({behavior:"smooth", block:"nearest"}); } catch(_){}
        } catch (err) {
          whatIfOut.innerHTML = `<div style="background:#330000;border:1px solid #f55;color:#ffaaaa;padding:8px;">⛔ ${Security.escapeHtml(err?.message||String(err))}<br><span style="font-size:0.6rem;color:#aaa;">Pastikan negara ada di 57 resmi (Brazil, Argentina, Mexico … Togo).</span></div>`;
        }
      }, 40);
    };
    bindClick("btnWhatIfRun", runWhatIf);
    bindClick("btnWhatIfClear", ()=>{
      if (whatIfHome) whatIfHome.value = "";
      if (whatIfAway) whatIfAway.value = "";
      if (whatIfHg) whatIfHg.value = "";
      if (whatIfAg) whatIfAg.value = "";
      if (whatIfOut) whatIfOut.innerHTML = `Isi HOME, AWAY & skor (0-20) lalu klik <strong style="color:#0f0;">LIHAT TOP GOALS</strong> — contoh: <em>Argentina 2 : 1 Wales</em>`;
    });
    // Enter support
    [whatIfHome, whatIfAway, whatIfHg, whatIfAg].forEach(el=>{
      if (!el) return;
      el.addEventListener("keydown", (e)=>{ if (e.key==="Enter") { e.preventDefault(); runWhatIf(); }});
    });
  } catch(e){ console.warn("[whatIf] init error", e); }

  // Auto-render jika ada seed di URL atau setelah predict
  if (BaganRngService.getUrlSeed()) setTimeout(renderBagan, 300);
  // Hook: setelah predict, auto-update bagan
  const origPredictBtn = document.getElementById("btnPredict");
  if (origPredictBtn) origPredictBtn.addEventListener("click", () => setTimeout(renderBagan, 800));

  renderSidebar();
  renderChatWindow();

  // Initialize GitHub Agent UI
  GitHubAgentUI.init();
});
