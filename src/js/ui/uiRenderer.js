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
    const getActiveSource = () => {
      const isEditor = StateManager.activeMemoryId !== null;
      const activeMem = isEditor
        ? StateManager.db.memories[StateManager.activeMemoryId]
        : null;

      const source =
        isEditor && activeMem?.games?.[StateManager.activeGameIndex]
          ? activeMem.games[StateManager.activeGameIndex]
          : StateManager.homeQuery;

      return { isEditor, activeMem, source };
    };

    const cleanScoreInput = (v) =>
      String(v || "")
        .trim()
        .replace(/[–—;-]/g, ":")
        .replace(/[^0-9:]/g, "");

    const cleanGoalInput = (v) =>
      String(v || "")
        .trim()
        .replace(/[^0-9]/g, "");

    const updateP1 = (value) => {
      const clean = Security.sanitizeInput(value);
      const { isEditor, activeMem } = getActiveSource();

      if (isEditor && activeMem?.games?.[StateManager.activeGameIndex]) {
        MemoryManager.updateGameField(
          StateManager.activeMemoryId,
          StateManager.activeGameIndex,
          "p1",
          clean,
          true
        );
      } else {
        StateManager.homeQuery.p1 = clean;
      }
    };

    const updateMatch = (i, field, value) => {
      const clean =
        field === "score"
          ? cleanScoreInput(value)
          : Security.sanitizeInput(value);

      const { isEditor, activeMem } = getActiveSource();

      if (isEditor && activeMem?.games?.[StateManager.activeGameIndex]) {
        MemoryManager.updateMatchField(
          StateManager.activeMemoryId,
          StateManager.activeGameIndex,
          i,
          field,
          clean,
          true
        );
      } else {
        if (!StateManager.homeQuery.matches[i]) {
          StateManager.homeQuery.matches[i] = { home: "", score: "", away: "" };
        }
        StateManager.homeQuery.matches[i][field] = clean;
      }
    };

    const updateGoal = (i, field, value) => {
      const clean =
        field === "goals"
          ? cleanGoalInput(value)
          : Security.sanitizeInput(value);

      const { isEditor, activeMem } = getActiveSource();

      if (isEditor && activeMem?.games?.[StateManager.activeGameIndex]) {
        MemoryManager.updateTopGoalField(
          StateManager.activeMemoryId,
          StateManager.activeGameIndex,
          i,
          field,
          clean,
          true
        );
      } else {
        if (!StateManager.homeQuery.topGoals[i]) {
          StateManager.homeQuery.topGoals[i] = {
            country: "",
            player: "",
            goals: ""
          };
        }
        StateManager.homeQuery.topGoals[i][field] = clean;
      }
    };

    const { source: dataSource } = getActiveSource();

    const p1Input = document.getElementById("p1Input");
    if (p1Input) {
      p1Input.value = dataSource.p1 || "";

      if (!p1Input.dataset.uiBound) {
        p1Input.addEventListener("input", () => updateP1(p1Input.value));
        p1Input.dataset.uiBound = "1";
      }

      setupCountryAutocomplete(p1Input, (val) => updateP1(val));
    }

    const matchGridForm = document.getElementById("matchGridForm");
    if (matchGridForm) {
      if (!matchGridForm.dataset.uiInit) {
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
            </div>
          `;
          matchGridForm.appendChild(rowItem);

          const homeInput = rowItem.querySelector(".match-home");
          const scoreInput = rowItem.querySelector(".match-score");
          const awayInput = rowItem.querySelector(".match-away");

          homeInput.addEventListener("input", () =>
            updateMatch(i, "home", homeInput.value)
          );

          scoreInput.addEventListener("input", () =>
            updateMatch(i, "score", scoreInput.value)
          );

          awayInput.addEventListener("input", () =>
            updateMatch(i, "away", awayInput.value)
          );
        }

        matchGridForm.dataset.uiInit = "1";
      }

      const rows = matchGridForm.querySelectorAll(".match-row-item");
      rows.forEach((rowItem, i) => {
        const matchData = dataSource.matches?.[i] || {
          home: "",
          score: "",
          away: ""
        };

        const homeInput = rowItem.querySelector(".match-home");
        const scoreInput = rowItem.querySelector(".match-score");
        const awayInput = rowItem.querySelector(".match-away");

        if (homeInput) {
          homeInput.value = matchData.home || "";
          setupCountryAutocomplete(homeInput, (val) =>
            updateMatch(i, "home", val)
          );
        }

        if (scoreInput) scoreInput.value = matchData.score || "";

        if (awayInput) {
          awayInput.value = matchData.away || "";
          setupCountryAutocomplete(awayInput, (val) =>
            updateMatch(i, "away", val)
          );
        }
      });
    }

    const topGoalsForm = document.getElementById("topGoalsForm");
    if (topGoalsForm) {
      if (!topGoalsForm.dataset.uiInit) {
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
            </div>
          `;
          topGoalsForm.appendChild(rowItem);

          const countryInput = rowItem.querySelector(".goal-country");
          const playerInput = rowItem.querySelector(".goal-player");
          const amountInput = rowItem.querySelector(".goal-amount");

          countryInput.addEventListener("input", () =>
            updateGoal(i, "country", countryInput.value)
          );

          playerInput.addEventListener("input", () =>
            updateGoal(i, "player", playerInput.value)
          );

          amountInput.addEventListener("input", () =>
            updateGoal(i, "goals", amountInput.value)
          );
        }

        topGoalsForm.dataset.uiInit = "1";
      }

      const rows = topGoalsForm.querySelectorAll(".top-goal-row-item");
      rows.forEach((rowItem, i) => {
        const goalData = dataSource.topGoals?.[i] || {
          country: "",
          player: "",
          goals: ""
        };

        const countryInput = rowItem.querySelector(".goal-country");
        const playerInput = rowItem.querySelector(".goal-player");
        const amountInput = rowItem.querySelector(".goal-amount");

        if (countryInput) {
          countryInput.value = goalData.country || "";
          setupCountryAutocomplete(countryInput, (val) =>
            updateGoal(i, "country", val)
          );
        }

        if (playerInput) playerInput.value = goalData.player || "";
        if (amountInput) amountInput.value = goalData.goals || "";
      });
    }
  },

  renderSearchResults(results, container) {
    if (!container) return;

    container.innerHTML = "";

    if (!Array.isArray(results) || results.length === 0) {
      container.innerHTML = `<div class="error-msg">Tidak ada kecocokan.</div>`;
      return;
    }

    const table = document.createElement("table");
    table.className = "result-table";

    table.innerHTML = `
      <thead>
        <tr>
          <th>MEMORY</th>
          <th>GAME</th>
          <th>SIMILARITY</th>
          <th>DETAIL</th>
        </tr>
      </thead>
    `;

    const tbody = document.createElement("tbody");

    results.forEach((r) => {
      const tr = document.createElement("tr");

      const simClass = r.similarity >= 90 ? "sim-perfect" : "sim-normal";
      const details = (r.explanations || [])
        .map(x => `<div>${Security.escapeHtml(x)}</div>`)
        .join("");

      tr.innerHTML = `
        <td>${Security.escapeHtml(r.memoryName || "")}</td>
        <td>${Security.escapeHtml(String(r.gameNumber ?? ""))}</td>
        <td class="${simClass}">${Number(r.similarity || 0)}%</td>
        <td>${details || "-"}</td>
      `;

      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    container.appendChild(table);
  },

  renderDatabaseModal() {
    const dbModalList = document.getElementById("databaseModalList");
    if (!dbModalList) return;
    dbModalList.innerHTML = "";

    const maxSlot = StateManager.db.maxSlot || 7;

    for (let i = 1; i <= maxSlot; i++) {
      const mem = StateManager.db.memories[i];
      const isEmpty = !mem;
      const memName = mem && mem.memoryName
        ? Security.escapeHtml(mem.memoryName)
        : `MEMORY ${i}`;

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
