import { StateManager } from "../state/appState.js";
import { MemoryManager } from "../services/memoryManager.js";
import { Security } from "../utils/security.js";

export const UIRenderer = {
  renderMatchGrid() {
    const isEditor = StateManager.activeMemoryId !== null;
    const dataSource = isEditor
      ? StateManager.db.memories[StateManager.activeMemoryId].games[StateManager.activeGameIndex]
      : StateManager.homeQuery;

    const p1Input = document.getElementById("p1Input");
    if (p1Input) {
      p1Input.value = dataSource.p1 || "";
      p1Input.oninput = (e) => {
        const val = Security.sanitizeInput(e.target.value);
        if (isEditor) {
          MemoryManager.updateGameField(StateManager.activeMemoryId, StateManager.activeGameIndex, "p1", val);
        } else {
          StateManager.homeQuery.p1 = val;
        }
      };
    }

    const matchGridForm = document.getElementById("matchGridForm");
    if (matchGridForm) {
      matchGridForm.innerHTML = "";
      for (let i = 0; i < 7; i++) {
        const matchData = dataSource.matches[i] || { home: "", score: "", away: "" };
        matchGridForm.innerHTML += `
          <div class="match-row-item">
            <div class="match-num">B${i + 1}</div>
            <div class="team-input-wrap">
              <input type="text" placeholder="HOME" value="${matchData.home}" data-idx="${i}" class="match-home" />
            </div>
            <div class="score-box-center">
              <input type="text" placeholder="X:X" value="${matchData.score}" data-idx="${i}" class="match-score" />
            </div>
            <div class="team-input-wrap">
              <input type="text" placeholder="AWAY" value="${matchData.away}" data-idx="${i}" class="match-away" />
            </div>
          </div>`;
      }
      this.attachMatchEvents(isEditor);
    }

    const topGoalsForm = document.getElementById("topGoalsForm");
    if (topGoalsForm) {
      topGoalsForm.innerHTML = "";
      for (let i = 0; i < 7; i++) {
        const goalData = dataSource.topGoals ? dataSource.topGoals[i] : { country: "", player: "", goals: "" };
        topGoalsForm.innerHTML += `
          <div class="top-goal-row-item">
            <div class="top-goal-num">G${i + 1}</div>
            <div class="team-input-wrap">
              <input type="text" placeholder="NEGARA" value="${goalData.country}" data-idx="${i}" class="goal-country" />
            </div>
            <div class="team-input-wrap">
              <input type="text" placeholder="PEMAIN" value="${goalData.player}" data-idx="${i}" class="goal-player" />
            </div>
            <div class="team-input-wrap">
              <input type="number" placeholder="GOL" value="${goalData.goals}" data-idx="${i}" class="goal-amount" />
            </div>
          </div>`;
      }
      this.attachGoalEvents(isEditor);
    }
  },

  attachMatchEvents(isEditor) {
    document.querySelectorAll(".match-home, .match-score, .match-away").forEach(input => {
      input.addEventListener("input", (e) => {
        const idx = e.target.dataset.idx;
        const val = Security.sanitizeInput(e.target.value);
        const field = e.target.className.split("-")[1];

        if (isEditor) {
          MemoryManager.updateMatchField(StateManager.activeMemoryId, StateManager.activeGameIndex, idx, field, val);
        } else {
          StateManager.homeQuery.matches[idx][field] = val;
        }
      });
    });
  },

  attachGoalEvents(isEditor) {
    document.querySelectorAll(".goal-country, .goal-player, .goal-amount").forEach(input => {
      input.addEventListener("input", (e) => {
        const idx = e.target.dataset.idx;
        const val = Security.sanitizeInput(e.target.value);

        let field = "goals";
        if(e.target.classList.contains("goal-country")) field = "country";
        if(e.target.classList.contains("goal-player")) field = "player";

        if (isEditor) {
          MemoryManager.updateTopGoalField(StateManager.activeMemoryId, StateManager.activeGameIndex, idx, field, val);
        } else {
          StateManager.homeQuery.topGoals[idx][field] = val;
        }
      });
    });
  },

  renderDatabaseModal() {
    const dbModalList = document.getElementById("databaseModalList");
    if (!dbModalList) return;
    dbModalList.innerHTML = "";

    const maxSlot = StateManager.db.maxSlot || 7;

    for (let i = 1; i <= maxSlot; i++) {
      const mem = StateManager.db.memories[i];
      const isEmpty = !mem;

      dbModalList.innerHTML += `
        <div class="db-card">
          <div class="db-card-header">
            <span>MEMORY ${i}</span>
            <span class="${isEmpty ? 'status-empty' : 'status-online'}">${isEmpty ? '[ EMPTY ]' : '[ ONLINE ]'}</span>
          </div>
          <div class="db-info-row">
            <span>Total Games: ${isEmpty ? 0 : mem.games.length}</span>
          </div>
          <div class="db-actions">
            ${isEmpty
              ? `<button class="btn btn-create-mem" data-id="${i}">CREATE</button>`
              : `<button class="btn btn-open-mem" data-id="${i}">OPEN EDITOR</button>
                 <button class="btn btn-export-mem" data-id="${i}">EXPORT DB</button>`}
            <button class="btn btn-import-mem" onclick="document.getElementById('jsonImportField').dataset.targetId = ${i}; document.getElementById('jsonImportField').click();">IMPORT JSON</button>
            <button class="btn btn-download-template" data-id="${i}">DOWNLOAD JSON</button>
          </div>
        </div>`;
    }

    dbModalList.innerHTML += `<button class="btn btn-primary btn-add-memory-slot" style="margin-top: 10px;">+ ADD MEMORY SLOT</button>`;
  }
};
