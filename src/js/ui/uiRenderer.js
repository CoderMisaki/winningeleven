import { StateManager } from "../state/appState.js";
import { MemoryManager } from "../services/memoryManager.js";
import { Security } from "../utils/security.js";
import { setupCountryAutocomplete } from "./autocomplete.js";

export const UIRenderer = {
  showAlert(message) {
    const modal = document.getElementById("confirmModal");
    const msgEl = document.getElementById("confirmMessage");
    const btnYes = document.getElementById("btnConfirmYes");
    const btnNo = document.getElementById("btnConfirmNo");

    if (!modal || !msgEl || !btnYes || !btnNo) {
      alert(message);
      return;
    }

    // Hide No button for alert
    btnNo.style.display = "none";
    btnYes.textContent = "OK";

    msgEl.textContent = message;
    modal.classList.remove("hidden");

    const cleanup = () => {
      modal.classList.add("hidden");
      btnYes.onclick = null;
      btnYes.textContent = "Yes";
      btnNo.style.display = "inline-block";
    };

    btnYes.onclick = () => {
      cleanup();
    };
  },

  showConfirm(message, onYes) {
    const modal = document.getElementById("confirmModal");
    const msgEl = document.getElementById("confirmMessage");
    const btnYes = document.getElementById("btnConfirmYes");
    const btnNo = document.getElementById("btnConfirmNo");

    if (!modal || !msgEl || !btnYes || !btnNo) {
      // Fallback
      if (confirm(message)) onYes();
      return;
    }

    btnNo.style.display = "inline-block";
    btnYes.textContent = "Yes";

    msgEl.textContent = message;
    modal.classList.remove("hidden");

    const cleanup = () => {
      modal.classList.add("hidden");
      btnYes.onclick = null;
      btnNo.onclick = null;
    };

    btnYes.onclick = () => {
      cleanup();
      onYes();
    };

    btnNo.onclick = () => {
      cleanup();
    };
  },
  renderMatchGrid() {
    const isEditor = StateManager.activeMemoryId !== null;
    const dataSource = isEditor
      ? StateManager.db.memories[StateManager.activeMemoryId].games[StateManager.activeGameIndex]
      : StateManager.homeQuery;

    const p1Input = document.getElementById("p1Input");
    if (p1Input) {
      p1Input.value = dataSource.p1 || "";
      setupCountryAutocomplete(p1Input, (val) => {
          val = Security.sanitizeInput(val);
          if (isEditor) {
              MemoryManager.updateGameField(StateManager.activeMemoryId, StateManager.activeGameIndex, "p1", val, true);
          } else {
              StateManager.homeQuery.p1 = val;
          }
      });
      p1Input.oninput = (e) => {
        const val = Security.sanitizeInput(e.target.value);
        if (isEditor) {
          MemoryManager.updateGameField(StateManager.activeMemoryId, StateManager.activeGameIndex, "p1", val, false);
        } else {
          StateManager.homeQuery.p1 = val;
        }
      };
    }

    const matchGridForm = document.getElementById("matchGridForm");
    if (matchGridForm) {
      if (matchGridForm.children.length === 0) {
        // Initialize DOM structure
        for (let i = 0; i < 7; i++) {
          const rowItem = document.createElement("div");
          rowItem.className = "match-row-item";

          rowItem.innerHTML = `
            <div class="match-num">B${i + 1}</div>
            <div class="team-input-wrap">
              <input type="text" placeholder="HOME" data-idx="${i}" class="match-home" />
              <div class="suggestions-box hidden"></div>
            </div>
            <div class="score-box-center">
              <input type="text" placeholder="X:X" data-idx="${i}" class="match-score" />
            </div>
            <div class="team-input-wrap">
              <input type="text" placeholder="AWAY" data-idx="${i}" class="match-away" />
              <div class="suggestions-box hidden"></div>
            </div>`;

          setupCountryAutocomplete(rowItem.querySelector(".match-home"), (val) => {
              val = Security.sanitizeInput(val);
              if (isEditor) {
                  MemoryManager.updateMatchField(StateManager.activeMemoryId, StateManager.activeGameIndex, i, "home", val, true);
              } else {
                  StateManager.homeQuery.matches[i].home = val;
              }
          });
          setupCountryAutocomplete(rowItem.querySelector(".match-away"), (val) => {
              val = Security.sanitizeInput(val);
              if (isEditor) {
                  MemoryManager.updateMatchField(StateManager.activeMemoryId, StateManager.activeGameIndex, i, "away", val, true);
              } else {
                  StateManager.homeQuery.matches[i].away = val;
              }
          });
          matchGridForm.appendChild(rowItem);
        }
      }

      // Update values
      const rows = matchGridForm.querySelectorAll(".match-row-item");
      for (let i = 0; i < 7; i++) {
        const matchData = dataSource.matches[i] || { home: "", score: "", away: "" };
        const rowItem = rows[i];
        if (rowItem) {
          rowItem.querySelector('.match-home').value = matchData.home;
          rowItem.querySelector('.match-score').value = matchData.score;
          rowItem.querySelector('.match-away').value = matchData.away;
        }
      }
    }

    const topGoalsForm = document.getElementById("topGoalsForm");
    if (topGoalsForm) {
      if (topGoalsForm.children.length === 0) {
        for (let i = 0; i < 7; i++) {
          const rowItem = document.createElement("div");
          rowItem.className = "top-goal-row-item";

          rowItem.innerHTML = `
            <div class="top-goal-num">G${i + 1}</div>
            <div class="team-input-wrap">
              <input type="text" placeholder="NEGARA" data-idx="${i}" class="goal-country" />
              <div class="suggestions-box hidden"></div>
            </div>
            <div class="team-input-wrap">
              <input type="text" placeholder="PEMAIN" data-idx="${i}" class="goal-player" />
            </div>
            <div class="team-input-wrap">
              <input type="number" placeholder="GOL" data-idx="${i}" class="goal-amount" />
            </div>`;

          setupCountryAutocomplete(rowItem.querySelector(".goal-country"), (val) => {
              val = Security.sanitizeInput(val);
              if (isEditor) {
                  MemoryManager.updateTopGoalField(StateManager.activeMemoryId, StateManager.activeGameIndex, i, "country", val, true);
              } else {
                  if(!StateManager.homeQuery.topGoals) StateManager.homeQuery.topGoals = Array.from({length:7}, ()=>({country:"", player:"", goals:""}));
                  StateManager.homeQuery.topGoals[i].country = val;
              }
          });
          topGoalsForm.appendChild(rowItem);
        }
      }

      // Update values
      const rows = topGoalsForm.querySelectorAll(".top-goal-row-item");
      for (let i = 0; i < 7; i++) {
        const goalData = dataSource.topGoals ? dataSource.topGoals[i] : { country: "", player: "", goals: "" };
        const rowItem = rows[i];
        if (rowItem) {
          rowItem.querySelector('.goal-country').value = goalData.country;
          rowItem.querySelector('.goal-player').value = goalData.player;
          rowItem.querySelector('.goal-amount').value = goalData.goals;
        }
      }
    }
  },

  renderDatabaseModal() {
    const dbModalList = document.getElementById("databaseModalList");
    if (!dbModalList) return;
    dbModalList.innerHTML = "";

    const maxSlot = StateManager.db.maxSlot || 7;

    for (let i = 1; i <= maxSlot; i++) {
      const mem = StateManager.db.memories[i];
      const isEmpty = !mem;
      const memName = mem && mem.memoryName ? mem.memoryName : `MEMORY ${i}`;

      dbModalList.innerHTML += `
        <div class="db-card">
          <div class="db-card-header">
            <span>${memName}</span>
            <span class="${isEmpty ? 'status-empty' : 'status-online'}">${isEmpty ? '[ EMPTY ]' : '[ ONLINE ]'}</span>
          </div>
          <div class="db-info-row">
            <span>Total Games: ${isEmpty ? 0 : mem.games.length}</span>
          </div>
          <div class="db-actions">
            ${isEmpty
              ? `<button class="btn btn-create-mem" data-id="${i}">CREATE</button>`
              : `<button class="btn btn-open-mem" data-id="${i}">OPEN EDITOR</button>
                 <button class="btn btn-export-mem" data-id="${i}">EXPORT DB</button>
                 <button class="btn btn-delete-mem" style="background-color: #550000; color: #ff5555; border-color: #ff0000;" data-id="${i}">DELETE</button>`}
            <button class="btn btn-import-mem" data-id="${i}">IMPORT JSON</button>
            <button class="btn btn-download-template" data-id="${i}">DOWNLOAD JSON</button>
          </div>
        </div>`;
    }

    dbModalList.innerHTML += `<button class="btn btn-primary btn-add-memory-slot" style="margin-top: 10px;">+ ADD MEMORY SLOT</button>`;
  }
};
