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
            match.explanations.forEach(e => {
              const div = document.createElement("div");
              div.textContent = e;
              explText.appendChild(div);
            });
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
    return Security.sanitizeInput(unsafe);
}

// --- AI CHAT FUNCTIONALITY V4 ---

  // --- Utilities & Toast ---
  const Toast = {
    show: (msg) => {
      let container = document.getElementById('toast-container');
      if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        document.body.appendChild(container);
      }
      const toast = document.createElement('div');
      toast.className = 'toast';
      toast.textContent = msg;
      container.appendChild(toast);
      setTimeout(() => toast.remove(), 2500);
    }
  };

  // HTML Escape for fallback
  function escapeHtml(unsafe) {
    if(typeof unsafe !== 'string') return unsafe;
    return unsafe.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  // Generate Unique ID
  function generateId() {
    return Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
  }

  // --- Markdown & Code Block Configuration ---
  if (window.marked && window.hljs) {
    marked.setOptions({
      highlight: function (code, lang) {
        const language = hljs.getLanguage(lang) ? lang : 'plaintext';
        return hljs.highlight(code, { language }).value;
      },
      langPrefix: 'hljs language-',
      breaks: true,
      gfm: true
    });

    const renderer = new marked.Renderer();
    renderer.code = function(code, language, isEscaped) {
      const validLang = !!(language && hljs.getLanguage(language));
      const langStr = validLang ? language : 'plaintext';
      // marked already highlights via the highlight option, but we need raw code for copying
      const rawCode = encodeURIComponent(code);

      const highlightedCode = validLang ? hljs.highlight(code, { language }).value : escapeHtml(code);

      return `
        <div class="ai-code-block">
          <div class="ai-code-header">
            <span class="ai-code-lang">${langStr}</span>
            <div class="ai-code-controls">
              <button class="btn-code-control btn-toggle-wrap">▤ Wrap</button>
              <button class="btn-code-control btn-toggle-code">▼ Collapse</button>
              <button class="btn-code-control btn-copy-code" data-code="${rawCode}">⧉ Copy</button>
            </div>
          </div>
          <pre><code class="hljs language-${langStr}">${highlightedCode}</code></pre>
        </div>
      `;
    };
    marked.use({ renderer });
  }

  // --- Session Manager ---
  class ChatSessionManager {
    constructor() {
      this.sessions = JSON.parse(localStorage.getItem("we10_ai_sessions")) || {};
      this.currentSessionId = localStorage.getItem("we10_current_session") || null;

      // Migration/Initialization
      if (Object.keys(this.sessions).length === 0) {
         // Check if old history exists
         const oldHistory = JSON.parse(localStorage.getItem("we10_ai_chat_history"));
         if (oldHistory && oldHistory.length > 0) {
             const newId = generateId();
             this.sessions[newId] = this.createNewSessionObj(newId, null, 0, "Imported Session", oldHistory);
             this.currentSessionId = newId;
             this.save();
         }
      }

      if (!this.currentSessionId || !this.sessions[this.currentSessionId]) {
         this.createNewSession();
      }
    }

    save() {
      localStorage.setItem("we10_ai_sessions", JSON.stringify(this.sessions));
      if (this.currentSessionId) {
        localStorage.setItem("we10_current_session", this.currentSessionId);
      }
    }

    createNewSessionObj(id, parentId = null, branchId = 0, title = "New Chat", messages = []) {
      return {
        id: id,
        parentId: parentId,
        branchId: branchId,
        title: title,
        mode: document.getElementById("aiChatMode") ? document.getElementById("aiChatMode").value : "normal",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: messages,
        attachments: [],
        modelUsed: "MiniMax",
        favorite: false,
        pinned: false,
        children: []
      };
    }

    createNewSession() {
      const id = generateId();
      this.sessions[id] = this.createNewSessionObj(id);
      this.currentSessionId = id;
      this.save();
      return id;
    }

    forkSession(messageIndex) {
      const current = this.getCurrentSession();
      if (!current) return;

      const newId = generateId();
      // Calculate new branch ID (count siblings)
      let siblingsCount = 0;
      for (const key in this.sessions) {
        if (this.sessions[key].parentId === current.id) siblingsCount++;
      }

      const forkedMessages = JSON.parse(JSON.stringify(current.messages.slice(0, messageIndex + 1)));
      const newSession = this.createNewSessionObj(newId, current.id, siblingsCount + 1, `${current.title} (Branch ${siblingsCount + 1})`, forkedMessages);

      current.children.push(newId);
      this.sessions[newId] = newSession;
      this.currentSessionId = newId;

      this.sessions[current.id] = current; // update parent's children
      this.save();
      return newId;
    }

    getCurrentSession() {
      return this.sessions[this.currentSessionId];
    }

    updateCurrentSession(updates) {
      if(this.currentSessionId && this.sessions[this.currentSessionId]) {
         this.sessions[this.currentSessionId] = { ...this.sessions[this.currentSessionId], ...updates, updatedAt: Date.now() };
         this.save();
      }
    }

    addMessage(role, content) {
       const session = this.getCurrentSession();
       if(session) {
          session.messages.push({ role, content, timestamp: Date.now() });

          // Auto Title
          if (session.messages.length === 2 && session.title === "New Chat") {
             const userMsg = session.messages.find(m => m.role === 'user');
             if (userMsg) {
                 const words = userMsg.content.split(' ').slice(0, 4).join(' ');
                 session.title = words + (userMsg.content.split(' ').length > 4 ? '...' : '');
             }
          }
          this.updateCurrentSession(session);
       }
    }

    deleteSession(id) {
       if (this.sessions[id]) {
           delete this.sessions[id];
           if (this.currentSessionId === id) {
               const remaining = Object.keys(this.sessions);
               if (remaining.length > 0) this.currentSessionId = remaining[0];
               else this.createNewSession();
           }
           this.save();
       }
    }

    clearAll() {
       this.sessions = {};
       this.createNewSession();
    }
  }

  const sessionManager = new ChatSessionManager();
  let isGenerating = false;
  let abortController = null;

  // --- UI Elements ---
  const aiChatWindow = document.getElementById("aiChatWindow");
  const aiChatInput = document.getElementById("aiChatInput");
  const btnSendAiChat = document.getElementById("btnSendAiChat");
  const btnStopAiChat = document.getElementById("btnStopAiChat");
  const chatSessionList = document.getElementById("chatSessionList");
  const currentChatTitle = document.getElementById("currentChatTitle");
  const aiChatMode = document.getElementById("aiChatMode");

  // Attachments
  const btnUploadAiChat = document.getElementById("btnUploadAiChat");
  const aiChatUploadMenu = document.getElementById("aiChatUploadMenu");
  const aiChatFile = document.getElementById("aiChatFile");
  const aiChatAttachmentPreview = document.getElementById("aiChatAttachmentPreview");
  let currentAttachment = null;

  // --- Render Functions ---

  function renderSidebar() {
      if(!chatSessionList) return;
      chatSessionList.innerHTML = '';

      const searchQ = (document.getElementById("chatSearchInput")?.value || "").toLowerCase();

      const sortedSessions = Object.values(sessionManager.sessions).sort((a, b) => {
          if (a.pinned !== b.pinned) return b.pinned ? 1 : -1;
          return b.updatedAt - a.updatedAt;
      });

      sortedSessions.forEach(session => {
          if (searchQ) {
              const inTitle = session.title.toLowerCase().includes(searchQ);
              const inMsgs = session.messages.some(m => m.content.toLowerCase().includes(searchQ));
              if (!inTitle && !inMsgs) return;
          }

          const div = document.createElement("div");
          div.className = `chat-session-item ${session.id === sessionManager.currentSessionId ? 'active' : ''}`;
          div.innerHTML = `
             <div style="flex-grow: 1; overflow: hidden;" class="session-click-area">
                <div class="chat-session-title">${escapeHtml(session.title)} ${session.pinned ? '📌' : ''} ${session.favorite ? '⭐' : ''}</div>
                <div class="chat-session-meta">${new Date(session.updatedAt).toLocaleDateString()} • ${session.messages.length} msgs</div>
             </div>
             <div class="session-actions">
                <button class="btn-ren" title="Rename">✏️</button>
                <button class="btn-pin ${session.pinned ? 'pin-active' : ''}" title="Pin">📌</button>
                <button class="btn-fav" style="${session.favorite ? 'color: gold;' : ''}" title="Favorite">★</button>
                <button class="btn-del" title="Delete">🗑</button>
             </div>
          `;

          div.querySelector('.session-click-area').addEventListener('click', () => {
              if (isGenerating) return;
              sessionManager.currentSessionId = session.id;
              sessionManager.save();
              renderSidebar();
              renderChatWindow();
          });

          div.querySelector('.btn-ren').addEventListener('click', (e) => {
              e.stopPropagation();
              const newTitle = prompt("Enter new chat title:", session.title);
              if (newTitle !== null && newTitle.trim() !== "") {
                  sessionManager.sessions[session.id].title = newTitle.trim();
                  sessionManager.save();
                  renderSidebar();
                  if(sessionManager.currentSessionId === session.id) renderChatWindow();
              }
          });
          div.querySelector('.btn-pin').addEventListener('click', (e) => { e.stopPropagation(); sessionManager.sessions[session.id].pinned = !session.pinned; sessionManager.save(); renderSidebar(); });
          div.querySelector('.btn-fav').addEventListener('click', (e) => { e.stopPropagation(); sessionManager.sessions[session.id].favorite = !session.favorite; sessionManager.save(); renderSidebar(); });
          div.querySelector('.btn-del').addEventListener('click', (e) => {
              e.stopPropagation();
              if(confirm("Delete this chat session?")) {
                  sessionManager.deleteSession(session.id);
                  renderSidebar();
                  renderChatWindow();
              }
          });

          chatSessionList.appendChild(div);
      });
  }

  function formatTime(ts) {
      if(!ts) return "";
      const d = new Date(ts);
      return d.getHours().toString().padStart(2, '0') + ":" + d.getMinutes().toString().padStart(2, '0');
  }

  function renderChatWindow() {
      if(!aiChatWindow) return;
      aiChatWindow.innerHTML = '';
      const session = sessionManager.getCurrentSession();
      if (!session) return;

      if(currentChatTitle) currentChatTitle.textContent = session.title;
      if(aiChatMode && session.mode) aiChatMode.value = session.mode;

      if (session.messages.length === 0) {
          aiChatWindow.innerHTML = `<div style="color: #aaa; text-align: center; font-size: 0.7rem; margin-top: 20px;">[SYSTEM] AI Assistant Ready. Start typing to begin.</div>`;
          return;
      }

      session.messages.forEach((msg, index) => {
          const container = document.createElement("div");
          container.className = `chat-bubble-container ${msg.role === 'user' ? 'user' : 'ai'}`;

          let metaHtml = ``;
          if (msg.role === 'assistant') {
             metaHtml = `<div class="chat-bubble-meta">
                           <span class="badge badge-model">${session.modelUsed || 'AI'}</span>
                           <span>${formatTime(msg.timestamp)}</span>
                         </div>`;
          } else {
             metaHtml = `<div class="chat-bubble-meta">
                           <span>YOU</span>
                           <span>${formatTime(msg.timestamp)}</span>
                         </div>`;
          }

          let contentHtml = "";
          if (msg.role === 'user') {
              contentHtml = escapeHtml(msg.content).replace(/\n/g, '<br/>');
          } else {
              // Parse Markdown and Sanitize
              if (window.marked && window.DOMPurify) {
                  const rawHtml = marked.parse(msg.content);
                  contentHtml = DOMPurify.sanitize(rawHtml, { ADD_ATTR: ['target'] });
              } else {
                  contentHtml = escapeHtml(msg.content).replace(/\n/g, '<br/>');
              }
          }

          const bubble = document.createElement("div");
          bubble.className = `chat-bubble ${msg.role === 'user' ? 'user' : 'ai'} markdown-body`;
          bubble.innerHTML = contentHtml;

          let actionsHtml = `<div class="bubble-actions">`;
          actionsHtml += `<button class="btn-fork" data-idx="${index}">⑂ Fork Chat</button>`;
          if (msg.role === 'user') actionsHtml += `<button class="btn-edit" data-idx="${index}">✎ Edit</button>`;
          if (msg.role === 'assistant') {
              actionsHtml += `<button class="btn-copy-msg">⧉ Copy Text</button>`;
              actionsHtml += `<button class="btn-regen" data-idx="${index}">↻ Regenerate</button>`;
          }
          actionsHtml += `</div>`;

          container.innerHTML = metaHtml;
          container.appendChild(bubble);
          container.insertAdjacentHTML('beforeend', actionsHtml);

          // Attach events to actions
          container.querySelector('.btn-fork').addEventListener('click', () => {
              if (isGenerating) return;
              const newId = sessionManager.forkSession(index);
              Toast.show("Branch created!");
              renderSidebar();
              renderChatWindow();
          });

          if (msg.role === 'assistant') {
              container.querySelector('.btn-copy-msg').addEventListener('click', () => {
                  navigator.clipboard.writeText(msg.content).then(() => Toast.show("Copied!"));
              });
              container.querySelector('.btn-regen').addEventListener('click', () => {
                  if (isGenerating) return;
                  // Remove this message and all after it
                  session.messages = session.messages.slice(0, index);
                  sessionManager.updateCurrentSession(session);
                  // Grab the last user message to put back in input for flow
                  const lastUser = session.messages[session.messages.length - 1];
                  if(lastUser) {
                      aiChatInput.value = lastUser.content;
                      session.messages.pop(); // remove user message so it can be re-sent
                      sessionManager.updateCurrentSession(session);
                      handleSendAiMessage(); // trigger resend automatically
                  }
              });
          } else if (msg.role === 'user') {
              container.querySelector('.btn-edit').addEventListener('click', () => {
                  if (isGenerating) return;
                  aiChatInput.value = msg.content;
                  aiChatInput.focus();
                  // Truncate history before this message so user can edit and branch from here
                  session.messages = session.messages.slice(0, index);
                  sessionManager.updateCurrentSession(session);
                  renderSidebar();
                  renderChatWindow();
              });
          }

          aiChatWindow.appendChild(container);
      });

      aiChatWindow.scrollTop = aiChatWindow.scrollHeight;

      // Update View Branches button visibility
      const btnViewBranches = document.getElementById("btnViewBranches");
      if (btnViewBranches) {
         const hasBranches = session.children && session.children.length > 0 || session.parentId !== null;
         btnViewBranches.style.display = hasBranches ? "block" : "none";
      }
  }

  // --- Send Message & Streaming Simulation ---

  async function simulateStreaming(text, containerBubble) {
      return new Promise((resolve) => {
          let i = 0;
          // approximate tokens by splitting words and spaces
          const tokens = text.match(/(\s+|\S+)/g) || [text];
          let currentRaw = "";

          const interval = setInterval(() => {
              if (i >= tokens.length || !isGenerating) {
                  clearInterval(interval);
                  // Final render
                  let finalHtml = window.marked && window.DOMPurify ? DOMPurify.sanitize(marked.parse(currentRaw)) : escapeHtml(currentRaw).replace(/\n/g, '<br/>');
                  containerBubble.innerHTML = finalHtml;
                  resolve(currentRaw);
                  return;
              }

              currentRaw += tokens[i];
              i++;

              // Render intermediate (might break markdown temporarily, but gives the effect)
              // For safe streaming rendering, we parse the current chunk
              let intermediateHtml = window.marked && window.DOMPurify ? DOMPurify.sanitize(marked.parse(currentRaw)) : escapeHtml(currentRaw).replace(/\n/g, '<br/>');
              containerBubble.innerHTML = intermediateHtml + '<span class="blink-cursor"></span>';
              aiChatWindow.scrollTop = aiChatWindow.scrollHeight;
          }, 30); // ms per chunk
      });
  }

  async function handleSendAiMessage() {
    if (isGenerating) return;
    const text = aiChatInput.value.trim();
    if (!text) return;

    // Save mode config
    if (aiChatMode) {
        sessionManager.updateCurrentSession({ mode: aiChatMode.value });
    }

    sessionManager.addMessage("user", text);

    aiChatInput.value = "";
    aiChatInput.style.height = "auto";

    renderSidebar();
    renderChatWindow();

    isGenerating = true;
    if(btnSendAiChat) btnSendAiChat.style.display = "none";
    if(btnStopAiChat) btnStopAiChat.style.display = "block";

    // Create empty AI bubble for streaming
    const session = sessionManager.getCurrentSession();
    const container = document.createElement("div");
    container.className = `chat-bubble-container ai`;
    container.innerHTML = `
        <div class="chat-bubble-meta">
            <span class="badge badge-model">Generating...</span>
        </div>
        <div class="chat-bubble ai markdown-body"><span class="blink-cursor"></span></div>
    `;
    aiChatWindow.appendChild(container);
    aiChatWindow.scrollTop = aiChatWindow.scrollHeight;

    const bubbleTarget = container.querySelector('.chat-bubble');

    abortController = new AbortController();

    try {
      // Build payload context (only send current branch history)
      const payloadMessages = session.messages.map(m => ({role: m.role, content: m.content}));

      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            messages: payloadMessages,
            attachment: currentAttachment,
            mode: session.mode
        }),
        signal: abortController.signal
      });

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }

      const data = await response.json();
      let aiReply = "No response.";

      if (data.error) aiReply = data.error;
      else if (data.choices && data.choices[0] && data.choices[0].message) aiReply = data.choices[0].message.content;

      // Update model badge if possible
      const modelBadge = container.querySelector('.badge-model');
      if (modelBadge) modelBadge.textContent = "AI Model"; // Adjust based on actual header info if backend provides

      // Simulate streaming the response
      const finalRawText = await simulateStreaming(aiReply, bubbleTarget);

      // Save to history
      if (isGenerating) { // only save if not fully aborted before stream finished
          sessionManager.addMessage("assistant", finalRawText);
      }

      if (currentAttachment) {
        currentAttachment = null;
        if (aiChatFile) aiChatFile.value = "";
        if (aiChatAttachmentPreview) {
          aiChatAttachmentPreview.style.display = "none";
          aiChatAttachmentPreview.innerHTML = "";
        }
      }

    } catch (err) {
      if (err.name === 'AbortError') {
          bubbleTarget.innerHTML += `<br/><span style="color: #f55; font-size: 0.8em;">[Stopped by User]</span>`;
          // If aborted, save partial state if needed, or do nothing.
      } else {
          bubbleTarget.innerHTML = `<span style="color: #f55;"><strong>ERROR:</strong> ${err.message}</span>`;
      }
    } finally {
      isGenerating = false;
      if(btnSendAiChat) btnSendAiChat.style.display = "block";
      if(btnStopAiChat) btnStopAiChat.style.display = "none";
      aiChatInput.focus();

      renderSidebar();
      renderChatWindow(); // full re-render to attach all events properly
    }
  }

  // --- Event Listeners ---

  if (btnSendAiChat) btnSendAiChat.addEventListener("click", handleSendAiMessage);

  if (btnStopAiChat) {
      btnStopAiChat.addEventListener("click", () => {
          if (isGenerating) {
              isGenerating = false; // Stops simulated streaming
              if (abortController) abortController.abort(); // Stops network request
          }
      });
  }

  if (aiChatInput) {
    aiChatInput.addEventListener("input", function() {
      this.style.height = "auto";
      this.style.height = Math.min(this.scrollHeight, 150) + "px";
    });

    aiChatInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSendAiMessage();
      }
    });
  }

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
    btnUploadAiChat.addEventListener("click", () => {
      aiChatUploadMenu.style.display = aiChatUploadMenu.style.display === "none" ? "flex" : "none";
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
        else if (type === "document") aiChatFile.accept = "application/pdf";

        aiChatUploadMenu.style.display = "none";
        aiChatFile.dataset.fileType = type;
        aiChatFile.click();
      });
    });
  }

  if (aiChatFile) {
    aiChatFile.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (event) => {
        const base64Data = event.target.result.split(",")[1];
        currentAttachment = {
          type: aiChatFile.dataset.fileType,
          base64: base64Data,
          mimeType: file.type || "application/octet-stream",
          filename: file.name
        };

        if (aiChatAttachmentPreview) {
          aiChatAttachmentPreview.innerHTML = `<span>📎 ${escapeHtml(file.name)}</span> <button id="btnRemoveAttachment" style="background: none; border: none; color: #f55; cursor: pointer; font-weight: bold;">X</button>`;
          aiChatAttachmentPreview.style.display = "flex";
          document.getElementById("btnRemoveAttachment").addEventListener("click", () => {
            currentAttachment = null;
            aiChatFile.value = "";
            aiChatAttachmentPreview.style.display = "none";
            aiChatAttachmentPreview.innerHTML = "";
          });
        }
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


  document.getElementById("btnToggleSidebar")?.addEventListener("click", () => {
      const sidebar = document.getElementById("aiSidebar");
      if (sidebar) sidebar.classList.toggle("drawer-open");
  });

  // Initial Render
  renderSidebar();
  renderChatWindow();

});
