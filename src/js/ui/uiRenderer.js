// ────────────────────────────────────────────────────────────────────────────
// 📄 PATH: src/js/ui/uiRenderer.js
// ────────────────────────────────────────────────────────────────────────────

import { StateManager } from "../state/appState.js";
import { MemoryManager } from "../services/memoryManager.js"; 
import { teamsDB } from "../data/teams.js";
import { countryAliases } from "../data/countryAliases.js";

export const UIRenderer = {
  renderMatchGrid() {
    const gridContainer = document.getElementById("matchGridForm");
    gridContainer.innerHTML = "";

    const isEditorMode = StateManager.activeMemoryId !== null;
    let activeDataset;

    if (isEditorMode) {
      const currentMemory = StateManager.db.memories[StateManager.activeMemoryId];
      activeDataset = currentMemory.games[StateManager.activeGameIndex];
    } else {
      activeDataset = StateManager.homeQuery;
    }

    // Set nilai elemen input P1 kepala
    document.getElementById("p1Input").value = activeDataset.p1 || "";

    // Bangun 7 baris pertandingan simetris retro khas WE10
    for (let i = 0; i < 7; i++) {
      const matchData = activeDataset.matches[i] || { home: "", score: "", away: "" };
      
      const rowItem = document.createElement("div");
      rowItem.className = "match-row-item";
      rowItem.innerHTML = `
        <div class="match-num">M${i + 1}</div>
        <div class="team-input-wrap">
          <input type="text" class="home-team-field" data-idx="${i}" value="${matchData.home}" placeholder="HOME TEAM" autocomplete="off" />
          <div class="suggestions-box hidden"></div>
        </div>
        <div class="score-box-center">
          <input type="text" class="score-field" data-idx="${i}" value="${matchData.score}" placeholder="0:0" maxlength="5" />
        </div>
        <div class="team-input-wrap">
          <input type="text" class="away-team-field" data-idx="${i}" value="${matchData.away}" placeholder="AWAY TEAM" autocomplete="off" />
          <div class="suggestions-box hidden"></div>
        </div>
      `;
      gridContainer.appendChild(rowItem);
    }

    this.bindGridEvents();
  },

  bindGridEvents() {
    const isEditorMode = StateManager.activeMemoryId !== null;
    const memId = StateManager.activeMemoryId;
    const gIdx = StateManager.activeGameIndex;

    // Listener input P1 dengan Auto-save terintegrasi
    const p1Field = document.getElementById("p1Input");
    p1Field.oninput = (e) => {
      const value = e.target.value;
      if (isEditorMode) {
        MemoryManager.updateGameField(memId, gIdx, "p1", value);
      } else {
        StateManager.homeQuery.p1 = value;
      }
    };

    // Listener untuk input Tim & Skor di Grid pertandingan
    document.querySelectorAll(".match-row-item").forEach((row) => {
      const homeInput = row.querySelector(".home-team-field");
      const awayInput = row.querySelector(".away-team-field");
      const scoreInput = row.querySelector(".score-field");
      const mIdx = parseInt(homeInput.dataset.idx, 10);

      const setupAutocomplete = (inputElement, sideKey) => {
        inputElement.oninput = (e) => {
          const query = e.target.value.toLowerCase();
          const suggestionContainer = inputElement.nextElementSibling;
          
          if (isEditorMode) {
            MemoryManager.updateMatchField(memId, gIdx, mIdx, sideKey, e.target.value);
          } else {
            StateManager.homeQuery.matches[mIdx][sideKey] = e.target.value;
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
            suggestionContainer.innerHTML = "";
            suggestionContainer.classList.remove("hidden");
            matchedTeams.slice(0, 5).forEach(([code, data]) => {
              const div = document.createElement("div");
              div.className = "suggestion-line";
              div.textContent = `${data.flag} ${data.name} (${code})`;
              div.onmousedown = () => {
                inputElement.value = code;
                if (isEditorMode) {
                  MemoryManager.updateMatchField(memId, gIdx, mIdx, sideKey, code);
                } else {
                  StateManager.homeQuery.matches[mIdx][sideKey] = code;
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
            row.querySelectorAll(".suggestions-box").forEach(box => box.classList.add("hidden"));
          }, 200);
        };
      };

      setupAutocomplete(homeInput, "home");
      setupAutocomplete(awayInput, "away");

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
    });
  },

  renderDatabaseModal() {
    const listWrapper = document.getElementById("databaseModalList");
    listWrapper.innerHTML = "";

    for (let i = 1; i <= 7; i++) {
      const memory = StateManager.db.memories[i];
      const card = document.createElement("div");
      card.className = "db-card";

      if (memory) {
        const formattedDate = memory.lastUpdate ? new Date(memory.lastUpdate).toLocaleString("id-ID") : "-";
        card.innerHTML = `
          <div class="db-card-header">
            <span>MEMORY ${i}</span>
            <span style="color: var(--accent-green)">ONLINE</span>
          </div>
          <div class="db-info-row">
            <span>Jumlah Dataset Game:</span>
            <span>${memory.games.length} Game</span>
          </div>
          <div class="db-info-row">
            <span>Last Update:</span>
            <span>${formattedDate}</span>
          </div>
          <div class="db-actions">
            <button class="btn btn-blue btn-open-mem" data-id="${i}">OPEN</button>
            <button class="btn btn-gold btn-export-mem" data-id="${i}">EXPORT</button>
            <button class="btn btn-red btn-delete-mem" data-id="${i}">DELETE</button>
          </div>
        `;
      } else {
        card.innerHTML = `
          <div class="db-card-header">
            <span>MEMORY ${i}</span>
            <span style="color: #777">EMPTY</span>
          </div>
          <div class="db-info-row">
            <span>Dataset Kosong</span>
          </div>
          <div class="db-actions">
            <button class="btn btn-green btn-create-mem" data-id="${i}">CREATE</button>
            <button class="btn btn-gold btn-import-trigger" data-id="${i}">IMPORT JSON</button>
          </div>
        `;
      }
      listWrapper.appendChild(card);
    }
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
        }
      };
    });

    // Tombol Trigger Import Manual per Slot
    document.querySelectorAll(".btn-import-trigger").forEach(btn => {
      btn.onclick = () => {
        document.getElementById("jsonImportField").click();
      };
    });
  }
};
