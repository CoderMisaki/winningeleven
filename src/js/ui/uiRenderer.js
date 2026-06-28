// ────────────────────────────────────────────────────────────────────────────
// 📄 PATH: src/js/ui/uiRenderer.js
// ────────────────────────────────────────────────────────────────────────────

import { StateManager } from "../state/appState.js";
import { MemoryManager } from "../services/memoryManager.js"; 
import { teamsDB } from "../data/teams.js";
import { countryAliases } from "../data/countryAliases.js";
import { NavigationManager } from "./navigation.js";
import { ImportExportService } from "../services/importExport.js";
import { Security } from "../utils/security.js";

export const UIRenderer = {
  renderMatchGrid() {
    const gridContainer = document.getElementById("matchGridForm");
    if (!gridContainer) return;

    gridContainer.textContent = "";

    const isEditorMode = StateManager.activeMemoryId !== null;
    let activeDataset = null;

    if (isEditorMode) {
      const currentMemory = StateManager.db.memories[StateManager.activeMemoryId];
      if (currentMemory && currentMemory.games) {
        activeDataset = currentMemory.games[StateManager.activeGameIndex];
      }
    } else {
      activeDataset = StateManager.homeQuery;
    }

    if (!activeDataset) {
      console.error("Dataset aktif tidak ditemukan");
      return;
    }

    const matches = Array.isArray(activeDataset.matches)
      ? activeDataset.matches
      : Array.from({ length: 7 }, () => ({ home: "", score: "", away: "" }));

    const topGoals = Array.isArray(activeDataset.topGoals)
      ? activeDataset.topGoals
      : Array.from({ length: 7 }, () => ({ country: "", player: "", goals: "" }));

    // Set nilai elemen input P1 kepala
    const p1Input = document.getElementById("p1Input");
    if (p1Input) p1Input.value = activeDataset.p1 || "";

    // Bangun 7 baris pertandingan simetris retro khas WE10
    for (let i = 0; i < 7; i++) {
      const matchData = matches[i] || { home: "", score: "", away: "" };
      
      const rowItem = document.createElement("div");
      rowItem.className = "match-row-item";
      const matchNumSpan = document.createElement("div");
      matchNumSpan.className = "match-num";
      matchNumSpan.textContent = `B${i + 1}`;
      rowItem.appendChild(matchNumSpan);

      const homeWrap = document.createElement("div");
      homeWrap.className = "team-input-wrap";
      const homeInput = document.createElement("input");
      homeInput.type = "text";
      homeInput.className = "home-team-field";
      homeInput.dataset.idx = i;
      homeInput.placeholder = "HOME TEAM";
      homeInput.value = matchData.home;
      homeInput.autocomplete = "off";
      const homeSug = document.createElement("div");
      homeSug.className = "suggestions-box hidden";
      homeWrap.appendChild(homeInput);
      homeWrap.appendChild(homeSug);
      rowItem.appendChild(homeWrap);

      const scoreWrap = document.createElement("div");
      scoreWrap.className = "score-box-center";
      const scoreInput = document.createElement("input");
      scoreInput.type = "text";
      scoreInput.className = "score-field";
      scoreInput.dataset.idx = i;
      scoreInput.placeholder = "0:0";
      scoreInput.value = matchData.score;
      scoreInput.maxLength = 5;
      scoreWrap.appendChild(scoreInput);
      rowItem.appendChild(scoreWrap);

      const awayWrap = document.createElement("div");
      awayWrap.className = "team-input-wrap";
      const awayInput = document.createElement("input");
      awayInput.type = "text";
      awayInput.className = "away-team-field";
      awayInput.dataset.idx = i;
      awayInput.placeholder = "AWAY TEAM";
      awayInput.value = matchData.away;
      awayInput.autocomplete = "off";
      const awaySug = document.createElement("div");
      awaySug.className = "suggestions-box hidden";
      awayWrap.appendChild(awayInput);
      awayWrap.appendChild(awaySug);
      rowItem.appendChild(awayWrap);

      gridContainer.appendChild(rowItem);
    }

    // Render Top Goals
    const topGoalsContainer = document.getElementById("topGoalsForm");
    if (topGoalsContainer) {
      topGoalsContainer.textContent = "";
      for (let i = 0; i < 7; i++) {
        const goalData = topGoals[i] || { country: "", player: "", goals: "" };

        const goalRowItem = document.createElement("div");
        goalRowItem.className = "top-goal-row-item";
        const rankSpan = document.createElement("div");
        rankSpan.className = "top-goal-num";
        rankSpan.textContent = `${i + 1}`;
        goalRowItem.appendChild(rankSpan);

        const countryWrap = document.createElement("div");
        countryWrap.className = "team-input-wrap";
        const countryInput = document.createElement("input");
        countryInput.type = "text";
        countryInput.className = "goal-country-field";
        countryInput.dataset.idx = i;
        countryInput.placeholder = "COUNTRY";
        countryInput.value = goalData.country;
        countryInput.autocomplete = "off";
        const countrySug = document.createElement("div");
        countrySug.className = "suggestions-box hidden";
        countryWrap.appendChild(countryInput);
        countryWrap.appendChild(countrySug);
        goalRowItem.appendChild(countryWrap);

        const playerWrap = document.createElement("div");
        playerWrap.className = "team-input-wrap";
        const playerInput = document.createElement("input");
        playerInput.type = "text";
        playerInput.className = "goal-player-field";
        playerInput.dataset.idx = i;
        playerInput.placeholder = "PLAYER NAME";
        playerInput.value = goalData.player;
        playerInput.autocomplete = "off";
        playerWrap.appendChild(playerInput);
        goalRowItem.appendChild(playerWrap);

        const goalsWrap = document.createElement("div");
        goalsWrap.className = "score-box-center";
        const goalsInput = document.createElement("input");
        goalsInput.type = "text";
        goalsInput.className = "goal-score-field";
        goalsInput.dataset.idx = i;
        goalsInput.placeholder = "0";
        goalsInput.value = goalData.goals;
        goalsInput.maxLength = 3;
        goalsWrap.appendChild(goalsInput);
        goalRowItem.appendChild(goalsWrap);

        topGoalsContainer.appendChild(goalRowItem);
      }
    }

    this.bindGridEvents();
  },


  bindGridEvents() {
    const isEditorMode = StateManager.activeMemoryId !== null;
    const memId = StateManager.activeMemoryId;
    const gIdx = StateManager.activeGameIndex;

    const setupAutocomplete = (inputElement, sideKey, mIdx) => {
      inputElement.oninput = (e) => {
        const query = e.target.value.toLowerCase();
        const suggestionContainer = inputElement.nextElementSibling;

        if (sideKey === 'p1') {
          if (isEditorMode) {
            MemoryManager.updateGameField(memId, gIdx, "p1", Security.sanitizeInput(e.target.value));
          } else {
            StateManager.homeQuery.p1 = Security.sanitizeInput(e.target.value);
          }
        } else {
          if (isEditorMode) {
            MemoryManager.updateMatchField(memId, gIdx, mIdx, sideKey, Security.sanitizeInput(e.target.value));
          } else {
            StateManager.homeQuery.matches[mIdx][sideKey] = Security.sanitizeInput(e.target.value);
          }
        }

        if (!query) { suggestionContainer.classList.add("hidden"); return; }

        // Filter tim berdasarkan database kode, nama, atau alias 3 huruf
        const matchedTeams = Object.entries(teamsDB).filter(([code, data]) => {
          const aliases = countryAliases[code] || [];
          return code.toLowerCase().startsWith(query) ||
                 data.name.toLowerCase().startsWith(query) ||
                 aliases.some(a => a.startsWith(query));
        });

        if (matchedTeams.length > 0) {
          suggestionContainer.textContent = "";
          suggestionContainer.classList.remove("hidden");
          matchedTeams.slice(0, 5).forEach(([code, data]) => {
            const div = document.createElement("div");
            div.className = "suggestion-line";
            div.textContent = `${data.flag} ${data.name} (${code})`;
            div.onmousedown = () => {
              inputElement.value = code;
              if (sideKey === 'p1') {
                if (isEditorMode) {
                  MemoryManager.updateGameField(memId, gIdx, "p1", code);
                } else {
                  StateManager.homeQuery.p1 = code;
                }
              } else {
                if (isEditorMode) {
                  MemoryManager.updateMatchField(memId, gIdx, mIdx, sideKey, code);
                } else {
                  StateManager.homeQuery.matches[mIdx][sideKey] = code;
                }
              }
              suggestionContainer.classList.add("hidden");
            };
            suggestionContainer.appendChild(div);
          });
        } else {
          suggestionContainer.classList.add("hidden");
        }
      };

      inputElement.onblur = () => {
        setTimeout(() => {
          if (inputElement.nextElementSibling) {
            inputElement.nextElementSibling.classList.add("hidden");
          }
        }, 200);
      };
    };

    // Listener input P1 dengan Auto-save terintegrasi
    const p1Field = document.getElementById("p1Input");
    if (p1Field) {
      setupAutocomplete(p1Field, 'p1', null);
    }

    // Listener untuk input Tim & Skor di Grid pertandingan
    document.querySelectorAll(".match-row-item").forEach((row) => {
      const homeInput = row.querySelector(".home-team-field");
      const awayInput = row.querySelector(".away-team-field");
      const scoreInput = row.querySelector(".score-field");
      const mIdx = parseInt(homeInput.dataset.idx, 10);

      setupAutocomplete(homeInput, "home", mIdx);
      setupAutocomplete(awayInput, "away", mIdx);

      scoreInput.oninput = (e) => {
        // Hanya izinkan format angka dan pemisah titik dua (:)
        let val = e.target.value.replace(/[^0-9:]/g, "");
        e.target.value = val;
        
        if (isEditorMode) {
          MemoryManager.updateMatchField(memId, gIdx, mIdx, "score", val);
        } else {
          StateManager.homeQuery.matches[mIdx].score = val;
        }
      };

      scoreInput.onblur = (e) => {
        let val = e.target.value.trim();
        if (val !== "" && !/^\d{1,2}:\d{1,2}$/.test(val)) {
          alert("Format score tidak valid! Harus berformat x:y (maks 99:99)");
          e.target.value = "";
          if (isEditorMode) {
            MemoryManager.updateMatchField(memId, gIdx, mIdx, "score", "");
          } else {
            StateManager.homeQuery.matches[mIdx].score = "";
          }
        }
      };
    });

    document.querySelectorAll(".top-goal-row-item").forEach((row) => {
      const countryInput = row.querySelector(".goal-country-field");
      const playerInput = row.querySelector(".goal-player-field");
      const goalsInput = row.querySelector(".goal-score-field");
      const gIdxLocal = parseInt(countryInput.dataset.idx, 10);

      // We need a specific autocomplete handler for top goals since the sideKey approach is different
      countryInput.oninput = (e) => {
        const query = e.target.value.toLowerCase();
        const suggestionContainer = countryInput.nextElementSibling;

        if (isEditorMode) {
          MemoryManager.updateTopGoalField(memId, gIdx, gIdxLocal, "country", Security.sanitizeInput(e.target.value));
        } else {
          if (!StateManager.homeQuery.topGoals) StateManager.homeQuery.topGoals = Array.from({ length: 7 }, () => ({ country: "", player: "", goals: "" }));
          StateManager.homeQuery.topGoals[gIdxLocal].country = Security.sanitizeInput(e.target.value);
        }

        if (!query) { suggestionContainer.classList.add("hidden"); return; }

        const matchedTeams = Object.entries(teamsDB).filter(([code, data]) => {
          const aliases = countryAliases[code] || [];
          return code.toLowerCase().startsWith(query) ||
                 data.name.toLowerCase().startsWith(query) ||
                 aliases.some(a => a.startsWith(query));
        });

        if (matchedTeams.length > 0) {
          suggestionContainer.textContent = "";
          suggestionContainer.classList.remove("hidden");
          matchedTeams.slice(0, 5).forEach(([code, data]) => {
            const div = document.createElement("div");
            div.className = "suggestion-line";
            div.textContent = `${data.flag} ${data.name} (${code})`;
            div.onmousedown = () => {
              countryInput.value = code;
              if (isEditorMode) {
                MemoryManager.updateTopGoalField(memId, gIdx, gIdxLocal, "country", code);
              } else {
                StateManager.homeQuery.topGoals[gIdxLocal].country = code;
              }
              suggestionContainer.classList.add("hidden");
            };
            suggestionContainer.appendChild(div);
          });
        } else {
          suggestionContainer.classList.add("hidden");
        }
      };

      countryInput.onblur = () => {
        setTimeout(() => {
          if (countryInput.nextElementSibling) {
            countryInput.nextElementSibling.classList.add("hidden");
          }
        }, 200);
      };

      playerInput.oninput = (e) => {
        if (isEditorMode) {
          MemoryManager.updateTopGoalField(memId, gIdx, gIdxLocal, "player", Security.sanitizeInput(e.target.value));
        } else {
          if (!StateManager.homeQuery.topGoals) StateManager.homeQuery.topGoals = Array.from({ length: 7 }, () => ({ country: "", player: "", goals: "" }));
          StateManager.homeQuery.topGoals[gIdxLocal].player = Security.sanitizeInput(e.target.value);
        }
      };

      goalsInput.oninput = (e) => {
        let val = e.target.value.replace(/[^0-9]/g, "");
        e.target.value = val;

        if (isEditorMode) {
          MemoryManager.updateTopGoalField(memId, gIdx, gIdxLocal, "goals", val);
        } else {
          if (!StateManager.homeQuery.topGoals) StateManager.homeQuery.topGoals = Array.from({ length: 7 }, () => ({ country: "", player: "", goals: "" }));
          StateManager.homeQuery.topGoals[gIdxLocal].goals = val;
        }
      };
    });
  },

  renderDatabaseModal() {
    const listWrapper = document.getElementById("databaseModalList");
    listWrapper.textContent = "";

    const memoryKeys = Object.keys(StateManager.db.memories).map(Number).filter(n => !isNaN(n));
    const maxId = Math.max(7, ...memoryKeys);

    for (let i = 1; i <= maxId; i++) {
      const memory = StateManager.db.memories[i];
      const card = document.createElement("div");
      card.className = "db-card";

      if (memory) {
        const formattedDate = memory.lastUpdate ? new Date(memory.lastUpdate).toLocaleString("id-ID") : "-";

        const header = document.createElement("div");
        header.className = "db-card-header";
        const titleSpan = document.createElement("span");
        titleSpan.textContent = `MEMORY ${i}`;
        const statusSpan = document.createElement("span");
        statusSpan.className = "status-online";
        statusSpan.textContent = "ONLINE";
        header.appendChild(titleSpan);
        header.appendChild(statusSpan);
        card.appendChild(header);

        const row1 = document.createElement("div");
        row1.className = "db-info-row";
        const r1L = document.createElement("span"); r1L.textContent = "Jumlah Dataset Game:";
        const r1R = document.createElement("span"); r1R.textContent = `${memory.games.length} Game`;
        row1.appendChild(r1L); row1.appendChild(r1R);
        card.appendChild(row1);

        const row2 = document.createElement("div");
        row2.className = "db-info-row";
        const r2L = document.createElement("span"); r2L.textContent = "Last Update:";
        const r2R = document.createElement("span"); r2R.textContent = formattedDate;
        row2.appendChild(r2L); row2.appendChild(r2R);
        card.appendChild(row2);

        const actions = document.createElement("div");
        actions.className = "db-actions";
        const btnOpen = document.createElement("button"); btnOpen.className = "btn btn-open-mem"; btnOpen.dataset.id = i; btnOpen.textContent = "OPEN";
        const btnExport = document.createElement("button"); btnExport.className = "btn btn-export-mem"; btnExport.dataset.id = i; btnExport.textContent = "EXPORT";
        const btnDelete = document.createElement("button"); btnDelete.className = "btn btn-delete-mem"; btnDelete.dataset.id = i; btnDelete.textContent = "DELETE";
        actions.appendChild(btnOpen); actions.appendChild(btnExport); actions.appendChild(btnDelete);
        card.appendChild(actions);

      } else {
        const header = document.createElement("div");
        header.className = "db-card-header";
        const titleSpan = document.createElement("span");
        titleSpan.textContent = `MEMORY ${i}`;
        const statusSpan = document.createElement("span");
        statusSpan.className = "status-empty";
        statusSpan.textContent = "EMPTY";
        header.appendChild(titleSpan);
        header.appendChild(statusSpan);
        card.appendChild(header);

        const row1 = document.createElement("div");
        row1.className = "db-info-row";
        const r1L = document.createElement("span"); r1L.textContent = "Dataset Kosong";
        row1.appendChild(r1L);
        card.appendChild(row1);

        const actions = document.createElement("div");
        actions.className = "db-actions";
        const btnCreate = document.createElement("button"); btnCreate.className = "btn btn-create-mem"; btnCreate.dataset.id = i; btnCreate.textContent = "CREATE";
        const btnImport = document.createElement("button"); btnImport.className = "btn btn-import-trigger"; btnImport.dataset.id = i; btnImport.textContent = "IMPORT JSON";
        const btnTemplate = document.createElement("button"); btnTemplate.className = "btn btn-download-template"; btnTemplate.dataset.id = i; btnTemplate.textContent = "DOWNLOAD TEMPLATE";
        actions.appendChild(btnCreate); actions.appendChild(btnImport); actions.appendChild(btnTemplate);
        card.appendChild(actions);
      }
      listWrapper.appendChild(card);
    }

    // Add memory slot card
    const addCard = document.createElement("div");
    addCard.className = "db-card";
    addCard.style.alignItems = "center";
    addCard.style.justifyContent = "center";
    addCard.style.cursor = "pointer";
    const addSpan = document.createElement("span");
    addSpan.className = "btn-add-memory";
    addSpan.style.fontSize = "2rem";
    addSpan.style.width = "100%";
    addSpan.style.textAlign = "center";
    addSpan.textContent = "+";
    addCard.appendChild(addSpan);
    listWrapper.appendChild(addCard);

    this.bindModalActions();
  },

  bindModalActions() {
    // Tombol Aksi Create Memory
    document.querySelectorAll(".btn-create-mem").forEach(btn => {
      btn.onclick = () => {
        const id = btn.dataset.id;
        MemoryManager.initializeEmptyMemory(id);
        this.renderDatabaseModal();
      };
    });

    // Tombol Aksi Delete Memory
    document.querySelectorAll(".btn-delete-mem").forEach(btn => {
      btn.onclick = () => {
        const id = btn.dataset.id;
        if (confirm(`Apakah anda yakin menghapus permanen seluruh dataset pada Memory ${id}?`)) {
          MemoryManager.deleteMemory(id);
          this.renderDatabaseModal();

          if (StateManager.activeMemoryId === parseInt(id, 10)) {
            NavigationManager.switchToHomeView();
          }
        }
      };
    });

    // Tombol Trigger Import Manual per Slot
    document.querySelectorAll(".btn-import-trigger").forEach(btn => {
      btn.onclick = () => {
        const importField = document.getElementById("jsonImportField");
        importField.dataset.targetId = btn.dataset.id;
        importField.click();
      };
    });


    // Tombol Download Template
    document.querySelectorAll(".btn-download-template").forEach(btn => {
      btn.onclick = () => {
        const id = btn.dataset.id;
        ImportExportService.downloadTemplate(id);
      };
    });

    // Tombol Add Memory
    const addMemoryBtn = document.querySelector(".btn-add-memory");
    if (addMemoryBtn) {
      addMemoryBtn.parentElement.onclick = () => {
        const memoryKeys = Object.keys(StateManager.db.memories).map(Number).filter(n => !isNaN(n));
        const maxId = Math.max(7, ...memoryKeys);
        const newId = maxId + 1;
        MemoryManager.initializeEmptyMemory(newId);
        this.renderDatabaseModal();
      };
    }
  }
};
