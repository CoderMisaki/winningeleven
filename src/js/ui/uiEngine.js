import { State } from "../state/appState.js";
import { TOP_GOAL_ROWS, createTopGoalRows } from "../data/topGoalTemplate.js";
import { findTeam, searchTeams } from "../services/teamSearch.js";
import { SimulationEngine } from "../services/simulation.js";
import { getMemory, saveMemory, deleteMemory } from "../services/storage.js";
import { exportMemory, importMemory } from "../services/importExport.js";
import { findMatches } from "../services/matchingEngine.js";

const $ = (id) => document.getElementById(id);
const esc = (value = "") => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

export const UIEngine = {
  initBindings() {
    this.bindTeamInput($("homeInput"), "home");
    this.bindTeamInput($("awayInput"), "away");
    $("scoreInput").addEventListener("input", (e) => {
      e.target.value = e.target.value.replace(/[^0-9\-]/g, "").slice(0, 7);
      State.updateGameField("score", e.target.value);
      this.renderSchedule();
    });
    $("p1Input").addEventListener("input", (e) => {
      State.updateGameField("p1", e.target.value);
    });

    $("prevGameBtn").addEventListener("click", () => { State.moveGame(-1); this.renderAll(); });
    $("nextGameBtn").addEventListener("click", () => { State.moveGame(1); this.renderAll(); });
    $("addGameBtn").addEventListener("click", () => { State.addGame(); this.renderAll(); });
    $("deleteGameBtn").addEventListener("click", () => { State.deleteGame(State.meta.activeGameIndex); this.renderAll(); });

    $("openMemoryModalBtn").addEventListener("click", () => { this.renderMemoryModal(); $("memoryModal").showModal(); });
    $("closeMemoryModalBtn").addEventListener("click", () => $("memoryModal").close());

    $("openSearchModalBtn").addEventListener("click", () => { this.renderSearchModal(); $("searchModal").showModal(); });
    $("closeSearchModalBtn").addEventListener("click", () => $("searchModal").close());
    $("executeSearchBtn").addEventListener("click", () => this.executeSearch());

    // Hide import input handler logic
    let pendingSlotForImport = null;
    $("importFileInput").addEventListener("change", (e) => {
      if (e.target.files.length > 0 && pendingSlotForImport) {
         importMemory(e.target.files[0], pendingSlotForImport, () => {
             // If importing to current slot, reload state
             if (pendingSlotForImport === State.meta.activeSlot) {
                 State.switchMemory(pendingSlotForImport);
                 this.renderAll();
             }
             this.renderMemoryModal(); // refresh list
         });
      }
      e.target.value = ""; // clear
    });

    this.importTrigger = (slot) => {
       const mem = getMemory(slot);
       if (mem && mem.games && mem.games.length > 1) {
          if (!confirm(`Memory ${slot} sudah memiliki data. Overwrite?`)) return;
       }
       pendingSlotForImport = slot;
       $("importFileInput").click();
    };
  },

  renderAll() {
    const memory = State.currentMemory;
    const game = State.getActiveGame();

    $("memoryTitleTab").textContent = memory.name;
    $("gameNumberDisplay").textContent = `Game ${game.gameNumber}`;
    $("p1Input").value = game.p1 || "";
    $("homeInput").value = game.home || "";
    $("awayInput").value = game.away || "";
    $("scoreInput").value = game.score || "";

    this.renderSchedule();
    this.renderTopGoals();
  },

  bindTeamInput(input, side) {
    const wrap = input.parentElement;
    const apply = (code) => {
      input.value = code;
      State.updateGameField(side, code);
      this.renderSchedule();
    };
    input.addEventListener("input", () => {
      const hit = findTeam(input.value);
      if (hit) State.updateGameField(side, hit);
      else State.updateGameField(side, input.value); // save literal if no hit
      this.showSuggestions(wrap, input.value, apply);
      this.renderSchedule();
    });
    input.addEventListener("blur", () => setTimeout(() => wrap.querySelector(".suggestions")?.remove(), 150));
  },

  showSuggestions(wrap, query, onPick) {
    wrap.querySelector(".suggestions")?.remove();
    const results = searchTeams(query);
    if (!results.length) return;
    const box = document.createElement("div");
    box.className = "suggestions";
    results.forEach(({ code, team }) => {
      const item = document.createElement("div");
      item.className = "suggestion-item";
      item.textContent = `${team.flag} ${team.name} (${code})`;
      item.addEventListener("mousedown", () => onPick(code));
      box.appendChild(item);
    });
    wrap.appendChild(box);
  },

  renderSchedule() {
    const list = $("scheduleList");
    list.innerHTML = "";
    const games = State.currentMemory.games;
    games.forEach((m, i) => {
      const h = State.teamsDB[m.home], a = State.teamsDB[m.away];
      const row = document.createElement("div");
      row.className = `match-row ${i === State.meta.activeGameIndex ? 'active-match-row' : ''}`;
      row.id = `row-${i}`;
      // Allow clicking schedule to jump to game
      row.addEventListener("click", () => {
         State.meta.activeGameIndex = i;
         State.debouncedSave();
         this.renderAll();
      });

      row.innerHTML = `<div class="team-container left-team"><div class="team-info"><span class="team-name ${h ? "" : "empty-name"}">${esc(h?.name || m.home || "---")}</span><div class="flag-box ${h ? "" : "empty-flag"}">${esc(h?.flag || "")}</div></div></div><div class="center-display" id="score-center-${i}"><div class="score-box"><span class="score-text">${esc(m.score || "-")}</span></div></div><div class="team-container right-team"><div class="team-info"><span class="team-name ${a ? "" : "empty-name"}">${esc(a?.name || m.away || "---")}</span><div class="flag-box ${a ? "" : "empty-flag"}">${esc(a?.flag || "")}</div></div></div>`;
      list.appendChild(row);
    });
  },

  renderTopGoals() {
    const list = $("topGoalsList");
    const saved = State.currentMemory.topGoals?.length ? State.currentMemory.topGoals : createTopGoalRows();
    list.innerHTML = "";
    saved.slice(0, TOP_GOAL_ROWS).forEach((g, i) => {
      const item = document.createElement("div");
      item.className = "top-goal-item";
      item.innerHTML = `<span class="goal-rank">${i + 1}</span><div class="top-goal-fields"><div class="smart-input-wrap"><input id="topGoalCountry-${i}" data-code="${esc(g.code || "")}" value="${esc(g.code || "")}" placeholder="JPN"></div><input id="topGoalPlayer-${i}" value="${esc(g.player || "")}" placeholder="Nama pemain"><input id="topGoalGoals-${i}" value="${esc(g.goals || "")}" placeholder="Goal" inputmode="numeric"></div>`;
      list.appendChild(item);

      const applyTG = () => {
          const arr = Array.from({ length: TOP_GOAL_ROWS }, (_, idx) => ({
             code: $(`topGoalCountry-${idx}`)?.dataset.code || $(`topGoalCountry-${idx}`)?.value || "",
             player: $(`topGoalPlayer-${idx}`)?.value || "",
             goals: $(`topGoalGoals-${idx}`)?.value || ""
          }));
          State.updateTopGoals(arr);
      };

      const wrap = $(`topGoalCountry-${i}`).parentElement;
      $(`topGoalCountry-${i}`).addEventListener("input", (e) => {
        const code = findTeam(e.target.value);
        if (code) e.target.dataset.code = code;
        this.showSuggestions(wrap, e.target.value, c => { e.target.value = c; e.target.dataset.code = c; applyTG(); });
        applyTG();
      });
      $(`topGoalPlayer-${i}`).addEventListener("input", applyTG);
      $(`topGoalGoals-${i}`).addEventListener("input", (e) => {
         e.target.value = e.target.value.replace(/\D/g, "").slice(0, 3);
         applyTG();
      });
    });
  },

  renderMemoryModal() {
    const container = $("memoryListContainer");
    container.innerHTML = "";
    for (let i = 1; i <= 7; i++) {
       const mem = getMemory(i);
       const numGames = mem ? mem.games.length : 0;

       const row = document.createElement("div");
       row.className = "memory-list-item";

       const info = document.createElement("div");
       info.className = "memory-info";
       info.innerHTML = `<strong>Memory ${i}</strong> <span>${numGames > 0 ? numGames + ' Game' : 'Empty'}</span>`;

       const actions = document.createElement("div");
       actions.className = "memory-actions";

       if (numGames > 0 || (mem && mem.name)) {
          const openBtn = document.createElement("button");
          openBtn.className = "btn btn-import";
          openBtn.textContent = "Open";
          openBtn.onclick = () => { State.switchMemory(i); $("memoryModal").close(); this.renderAll(); };

          const expBtn = document.createElement("button");
          expBtn.className = "btn";
          expBtn.textContent = "Export";
          expBtn.onclick = () => exportMemory(i);

          const delBtn = document.createElement("button");
          delBtn.className = "btn btn-clear";
          delBtn.textContent = "Delete";
          delBtn.onclick = () => {
             if (confirm(`Hapus Memory ${i}?`)) {
                 deleteMemory(i);
                 if (State.meta.activeSlot === i) {
                     State.switchMemory(1);
                     $("memoryModal").close();
                     this.renderAll();
                 } else {
                     this.renderMemoryModal();
                 }
             }
          };
          actions.append(openBtn, expBtn, delBtn);
       } else {
          const createBtn = document.createElement("button");
          createBtn.className = "btn btn-import";
          createBtn.textContent = "Create";
          createBtn.onclick = () => { State.switchMemory(i); $("memoryModal").close(); this.renderAll(); };
          actions.appendChild(createBtn);
       }

       const impBtn = document.createElement("button");
       impBtn.className = "btn";
       impBtn.textContent = "Import";
       impBtn.onclick = () => this.importTrigger(i);
       actions.appendChild(impBtn);

       row.append(info, actions);
       container.appendChild(row);
    }
  },

  renderSearchModal() {
    const container = $("searchGamesContainer");
    container.innerHTML = "";
    $("searchResultsContainer").innerHTML = "";
    $("searchP1").value = "";

    // Create 7 empty inputs
    for (let i = 0; i < 7; i++) {
       const row = document.createElement("div");
       row.className = "search-game-row";
       row.innerHTML = `
          <span class="row-badge">${i+1}</span>
          <div class="smart-input-wrap"><input id="shome-${i}" placeholder="Home" autocomplete="off"></div>
          <input class="score-input" id="sscore-${i}" placeholder="0-0">
          <div class="smart-input-wrap"><input id="saway-${i}" placeholder="Away" autocomplete="off"></div>
       `;
       container.appendChild(row);

       const bind = (id) => {
          const input = $(id);
          const wrap = input.parentElement;
          input.addEventListener("input", () => {
             this.showSuggestions(wrap, input.value, c => input.value = c);
          });
          input.addEventListener("blur", () => setTimeout(() => wrap.querySelector(".suggestions")?.remove(), 150));
       };
       bind(`shome-${i}`);
       bind(`saway-${i}`);
       $(`sscore-${i}`).addEventListener("input", e => e.target.value = e.target.value.replace(/[^0-9\-]/g, "").slice(0, 7));
    }
  },

  executeSearch() {
     const p1 = $("searchP1").value;
     const games = [];
     for (let i = 0; i < 7; i++) {
        const h = $(`shome-${i}`).value.trim();
        const a = $(`saway-${i}`).value.trim();
        const s = $(`sscore-${i}`).value.trim();
        if (h || a) games.push({ home: h, away: a, score: s });
     }

     const resContainer = $("searchResultsContainer");
     resContainer.innerHTML = "";

     const results = findMatches(games, p1);

     if (results.length === 0) {
        resContainer.innerHTML = `<div class="no-results">Tidak ditemukan kecocokan pada seluruh Memory.</div>`;
        return;
     }

     // Output top result exactly as requested, then list others
     let html = "";
     results.forEach((r, idx) => {
        if (idx === 0) {
            html += `<div class="result-block perfect-match">
               <div class="rb-header">HASIL PENCOCOKAN</div>
               <div class="rb-row"><span>Memory</span> <span>${r.memoryName}</span></div>
               <div class="rb-row"><span>Mulai dari</span> <span>Game ${r.startIdxNumber}</span></div>
               <div class="rb-row"><span>Similarity</span> <span style="color:var(--accent-secondary)">${r.similarity}%</span></div>
               ${r.similarity === 100 ? `<div class="rb-row"><span>Status</span> <span style="color:var(--accent-secondary)">Perfect Match</span></div>` : ''}
               <button class="btn btn-predict mt-sm jump-btn" data-slot="${r.slot}" data-idx="${r.startIndex}">Buka Memory</button>
            </div>`;
        } else {
            html += `<div class="result-block-minor">
               <span>${r.memoryName}</span>
               <span>Game ${r.startIdxNumber}</span>
               <span>${r.similarity}%</span>
               <button class="btn jump-btn" data-slot="${r.slot}" data-idx="${r.startIndex}">Buka</button>
            </div>`;
        }
     });

     resContainer.innerHTML = html;

     // Bind jump buttons
     resContainer.querySelectorAll('.jump-btn').forEach(btn => {
         btn.addEventListener('click', (e) => {
             const slot = parseInt(e.target.dataset.slot);
             const idx = parseInt(e.target.dataset.idx);
             State.meta.activeSlot = slot;
             State.meta.activeGameIndex = idx;
             State.ensureActiveMemory();
             State.debouncedSave();
             $("searchModal").close();
             this.renderAll();
         });
     });
  }
};
