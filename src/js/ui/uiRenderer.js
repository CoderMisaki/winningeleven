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

    if (!modal || !msgEl || !btnYes) {
      alert(message);
      return;
    }
    if (btnNo) btnNo.style.display = "none";
    btnYes.textContent = "OK";
    msgEl.textContent = message;
    modal.classList.remove("hidden");

    btnYes.onclick = () => {
      modal.classList.add("hidden");
      btnYes.onclick = null;
      if (btnNo) btnNo.style.display = "inline-block";
      btnYes.textContent = "Yes";
    };
  },

  showConfirm(message, onYes) {
    const modal = document.getElementById("confirmModal");
    const msgEl = document.getElementById("confirmMessage");
    const btnYes = document.getElementById("btnConfirmYes");
    const btnNo = document.getElementById("btnConfirmNo");

    if (!modal || !msgEl || !btnYes || !btnNo) {
      if (confirm(message)) onYes();
      return;
    }
    btnNo.style.display = "inline-block";
    btnYes.textContent = "Yes";
    msgEl.textContent = message;
    modal.classList.remove("hidden");

    btnYes.onclick = () => {
      modal.classList.add("hidden");
      btnYes.onclick = null;
      btnNo.onclick = null;
      onYes();
    };
    btnNo.onclick = () => {
      modal.classList.add("hidden");
      btnYes.onclick = null;
      btnNo.onclick = null;
    };
  },

  renderPredictionDashboard(predictions, container) {
    if (!container) return;
    container.innerHTML = "";

    if (!Array.isArray(predictions) || !predictions.length) {
      container.innerHTML = "<div class='error-msg'>Isi minimal satu baris HOME dan AWAY untuk diprediksi.</div>";
      return;
    }

    const dashboard = document.createElement("div");
    dashboard.className = "prediction-dashboard-container";

    predictions.forEach(p => {
      const card = document.createElement("div");
      card.className = "pred-card";

      if (p.error) {
        card.innerHTML = `
          <div class="pred-card-header">
            <span class="pred-badge-row">MATCH B${p.row}</span>
            <span class="pred-match-title">${Security.escapeHtml(p.homeName)} vs ${Security.escapeHtml(p.awayName)}</span>
          </div>
          <div class="pred-error-banner">${Security.escapeHtml(p.error)}</div>
        `;
        dashboard.appendChild(card);
        return;
      }

      const pred = p.prediction;
      const pHomePct = (pred.probs.home * 100).toFixed(1);
      const pDrawPct = (pred.probs.draw * 100).toFixed(1);
      const pAwayPct = (pred.probs.away * 100).toFixed(1);

      const isHomeFav = pred.probs.home >= Math.max(pred.probs.draw, pred.probs.away);
      const isAwayFav = pred.probs.away > Math.max(pred.probs.home, pred.probs.draw);
      const isDrawFav = pred.probs.draw > Math.max(pred.probs.home, pred.probs.away);

      const scorelinesHtml = pred.distribution.map((s, idx) => `
        <div class="pred-score-item ${idx === 0 ? 'pred-score-item-top' : ''}">
          <span class="score-nums">${s.home} - ${s.away}</span>
          <span class="score-pct">${(s.prob * 100).toFixed(1)}%</span>
        </div>
      `).join("");

      card.innerHTML = `
        <div class="pred-card-header">
          <span class="pred-badge-row">MATCH B${p.row}</span>
          <span class="pred-match-title">${Security.escapeHtml(p.homeName)} <span style="color:#888;">vs</span> ${Security.escapeHtml(p.awayName)}</span>
          <span class="pred-conf-badge">CONF: ${pred.confidence}%</span>
        </div>

        <div class="pred-main-score-box">
          <div class="pred-score-visual">
            <div class="pred-team-name">${Security.escapeHtml(p.homeName)}</div>
            <div class="pred-score-digits">${pred.homeGoals} - ${pred.awayGoals}</div>
            <div class="pred-team-name">${Security.escapeHtml(p.awayName)}</div>
          </div>
          <div class="pred-outcome-badge">PROBABLE OUTCOME: <strong>${Security.escapeHtml(pred.winner)}</strong></div>
        </div>

        <div class="pred-section-title">1X2 PROBABILITIES</div>
        <div class="pred-prob-grid">
          <div class="prob-cell ${isHomeFav ? 'prob-cell-active' : ''}">
            <div class="prob-label">1 (HOME)</div>
            <div class="prob-val">${pHomePct}%</div>
          </div>
          <div class="prob-cell ${isDrawFav ? 'prob-cell-active' : ''}">
            <div class="prob-label">X (DRAW)</div>
            <div class="prob-val">${pDrawPct}%</div>
          </div>
          <div class="prob-cell ${isAwayFav ? 'prob-cell-active' : ''}">
            <div class="prob-label">2 (AWAY)</div>
            <div class="prob-val">${pAwayPct}%</div>
          </div>
        </div>

        <div class="pred-metric-row">
          <div class="metric-pill">
            <span>HOME xG:</span> <strong>${pred.xgHome}</strong>
          </div>
          <div class="metric-pill">
            <span>AWAY xG:</span> <strong>${pred.xgAway}</strong>
          </div>
          <div class="metric-pill">
            <span>OVER 2.5:</span> <strong>${(pred.markets.over25 * 100).toFixed(1)}%</strong>
          </div>
          <div class="metric-pill">
            <span>BTTS:</span> <strong>${(pred.markets.btts * 100).toFixed(1)}%</strong>
          </div>
        </div>

        <div class="pred-section-title">TOP 5 SCORELINES</div>
        <div class="pred-scores-grid">${scorelinesHtml}</div>

        <div class="pred-evidence-footer">
          <div><span style="color:#888;">Model:</span> ${Security.escapeHtml(pred.model)}</div>
          <div><span style="color:#888;">Evidence:</span> Rating: ${pred.evidence.hasRating ? '✔' : '✘'} | Hist: ${pred.evidence.homeMatches}H/${pred.evidence.awayMatches}A | H2H: ${pred.evidence.h2hMatches}m | Context: ${pred.evidence.hasSimilarContext ? '✔' : '✘'}</div>
        </div>
      `;
      dashboard.appendChild(card);
    });

    container.appendChild(dashboard);
  },

  renderMatchGrid() {
    const isEditor = StateManager.activeMemoryId !== null;
    const activeMem = isEditor ? StateManager.db.memories[StateManager.activeMemoryId] : null;
    const dataSource = isEditor && activeMem?.games?.[StateManager.activeGameIndex]
      ? activeMem.games[StateManager.activeGameIndex]
      : StateManager.homeQuery;

    const p1Input = document.getElementById("p1Input");
    if (p1Input) {
      p1Input.value = dataSource.p1 || "";
      if (!p1Input.dataset.uiBound) {
        p1Input.addEventListener("input", () => {
          const clean = Security.sanitizeInput(p1Input.value);
          if (isEditor && activeMem?.games?.[StateManager.activeGameIndex]) {
            MemoryManager.updateGameField(StateManager.activeMemoryId, StateManager.activeGameIndex, "p1", clean, false);
          } else {
            StateManager.homeQuery.p1 = clean;
          }
        });
        p1Input.dataset.uiBound = "1";
      }
      setupCountryAutocomplete(p1Input, (val) => {
        if (isEditor && activeMem?.games?.[StateManager.activeGameIndex]) {
          MemoryManager.updateGameField(StateManager.activeMemoryId, StateManager.activeGameIndex, "p1", val, true);
        } else {
          StateManager.homeQuery.p1 = val;
        }
      });
    }

    const matchGridForm = document.getElementById("matchGridForm");
    if (matchGridForm) {
      if (!matchGridForm.dataset.uiInit) {
        matchGridForm.innerHTML = "";
        for (let i = 0; i < 7; i++) {
          const row = document.createElement("div");
          row.className = "match-row-item";
          row.innerHTML = `
            <div class="match-num">B${i + 1}</div>
            <div class="team-input-wrap">
              <input type="text" placeholder="HOME" data-idx="${i}" class="match-home" autocomplete="off" />
              <div class="suggestions-box hidden"></div>
            </div>
            <div class="score-box-center">
              <input type="text" placeholder="X:X" data-idx="${i}" class="match-score" autocomplete="off" />
            </div>
            <div class="team-input-wrap">
              <input type="text" placeholder="AWAY" data-idx="${i}" class="match-away" autocomplete="off" />
              <div class="suggestions-box hidden"></div>
            </div>
          `;
          matchGridForm.appendChild(row);

          const hIn = row.querySelector(".match-home");
          const sIn = row.querySelector(".match-score");
          const aIn = row.querySelector(".match-away");

          hIn.addEventListener("input", () => {
            const clean = Security.sanitizeInput(hIn.value);
            if (StateManager.activeMemoryId !== null) {
              MemoryManager.updateMatchField(StateManager.activeMemoryId, StateManager.activeGameIndex, i, "home", clean, false);
            } else {
              StateManager.homeQuery.matches[i].home = clean;
            }
          });

          sIn.addEventListener("input", () => {
            const clean = String(sIn.value || "").trim().replace(/[-–—;]+/g, ":").replace(/[^0-9:]/g, "");
            if (StateManager.activeMemoryId !== null) {
              MemoryManager.updateMatchField(StateManager.activeMemoryId, StateManager.activeGameIndex, i, "score", clean, false);
            } else {
              StateManager.homeQuery.matches[i].score = clean;
            }
          });

          aIn.addEventListener("input", () => {
            const clean = Security.sanitizeInput(aIn.value);
            if (StateManager.activeMemoryId !== null) {
              MemoryManager.updateMatchField(StateManager.activeMemoryId, StateManager.activeGameIndex, i, "away", clean, false);
            } else {
              StateManager.homeQuery.matches[i].away = clean;
            }
          });

          setupCountryAutocomplete(hIn, (val) => {
            if (StateManager.activeMemoryId !== null) {
              MemoryManager.updateMatchField(StateManager.activeMemoryId, StateManager.activeGameIndex, i, "home", val, true);
            } else {
              StateManager.homeQuery.matches[i].home = val;
            }
          });

          setupCountryAutocomplete(aIn, (val) => {
            if (StateManager.activeMemoryId !== null) {
              MemoryManager.updateMatchField(StateManager.activeMemoryId, StateManager.activeGameIndex, i, "away", val, true);
            } else {
              StateManager.homeQuery.matches[i].away = val;
            }
          });
        }
        matchGridForm.dataset.uiInit = "1";
      }

      const rowEls = matchGridForm.querySelectorAll(".match-row-item");
      rowEls.forEach((row, i) => {
        const mData = dataSource.matches?.[i] || { home: "", score: "", away: "" };
        const h = row.querySelector(".match-home");
        const s = row.querySelector(".match-score");
        const a = row.querySelector(".match-away");
        if (h) h.value = mData.home || "";
        if (s) s.value = mData.score || "";
        if (a) a.value = mData.away || "";
      });
    }

    const topGoalsForm = document.getElementById("topGoalsForm");
    if (topGoalsForm) {
      if (!topGoalsForm.dataset.uiInit) {
        topGoalsForm.innerHTML = "";
        for (let i = 0; i < 7; i++) {
          const row = document.createElement("div");
          row.className = "top-goal-row-item";
          row.innerHTML = `
            <div class="top-goal-num">G${i + 1}</div>
            <div class="team-input-wrap">
              <input type="text" placeholder="NEGARA" data-idx="${i}" class="goal-country" autocomplete="off" />
              <div class="suggestions-box hidden"></div>
            </div>
            <div class="team-input-wrap">
              <input type="text" placeholder="PEMAIN" data-idx="${i}" class="goal-player" autocomplete="off" />
            </div>
            <div class="team-input-wrap">
              <input type="number" placeholder="GOL" min="0" data-idx="${i}" class="goal-amount" autocomplete="off" />
            </div>
          `;
          topGoalsForm.appendChild(row);

          const cIn = row.querySelector(".goal-country");
          const pIn = row.querySelector(".goal-player");
          const gIn = row.querySelector(".goal-amount");

          cIn.addEventListener("input", () => {
            const val = Security.sanitizeInput(cIn.value);
            if (StateManager.activeMemoryId !== null) {
              MemoryManager.updateTopGoalField(StateManager.activeMemoryId, StateManager.activeGameIndex, i, "country", val, false);
            } else {
              StateManager.homeQuery.topGoals[i].country = val;
            }
          });

          pIn.addEventListener("input", () => {
            const val = Security.sanitizeInput(pIn.value);
            if (StateManager.activeMemoryId !== null) {
              MemoryManager.updateTopGoalField(StateManager.activeMemoryId, StateManager.activeGameIndex, i, "player", val, false);
            } else {
              StateManager.homeQuery.topGoals[i].player = val;
            }
          });

          gIn.addEventListener("input", () => {
            const val = String(gIn.value || "").trim().replace(/[^0-9]/g, "");
            if (StateManager.activeMemoryId !== null) {
              MemoryManager.updateTopGoalField(StateManager.activeMemoryId, StateManager.activeGameIndex, i, "goals", val, false);
            } else {
              StateManager.homeQuery.topGoals[i].goals = val;
            }
          });

          setupCountryAutocomplete(cIn, (val) => {
            if (StateManager.activeMemoryId !== null) {
              MemoryManager.updateTopGoalField(StateManager.activeMemoryId, StateManager.activeGameIndex, i, "country", val, true);
            } else {
              StateManager.homeQuery.topGoals[i].country = val;
            }
          });
        }
        topGoalsForm.dataset.uiInit = "1";
      }

      const goalEls = topGoalsForm.querySelectorAll(".top-goal-row-item");
      goalEls.forEach((row, i) => {
        const gData = dataSource.topGoals?.[i] || { country: "", player: "", goals: "" };
        const c = row.querySelector(".goal-country");
        const p = row.querySelector(".goal-player");
        const g = row.querySelector(".goal-amount");
        if (c) c.value = gData.country || "";
        if (p) p.value = gData.player || "";
        if (g) g.value = gData.goals || "";
      });
    }
  },

  renderSearchResults(results, container) {
    if (!container) return;
    container.innerHTML = "";
    if (!Array.isArray(results) || !results.length) {
      container.innerHTML = `<div class="error-msg">Tidak ada kecocokan similarity ditemukan.</div>`;
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
          <th>DETAIL EXPLANATION</th>
        </tr>
      </thead>
    `;
    const tbody = document.createElement("tbody");
    results.forEach(r => {
      const tr = document.createElement("tr");
      const simClass = r.similarity >= 90 ? "sim-perfect" : "sim-normal";
      const details = (r.explanations || []).map(x => `<div>${Security.escapeHtml(x)}</div>`).join("");
      tr.innerHTML = `
        <td>${Security.escapeHtml(r.memoryName || "")}</td>
        <td>#${Security.escapeHtml(String(r.gameNumber ?? ""))}</td>
        <td class="${simClass}">${Number(r.similarity || 0)}%</td>
        <td style="font-size:0.75rem;">${details || "-"}</td>
      `;
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    container.appendChild(table);
  },

  renderDatabaseModal() {
    const list = document.getElementById("databaseModalList");
    if (!list) return;
    list.innerHTML = "";

    const maxSlot = StateManager.db.maxSlot || 7;
    for (let i = 1; i <= maxSlot; i++) {
      const mem = StateManager.db.memories[i];
      const isEmpty = !mem;
      const name = mem && mem.memoryName ? Security.escapeHtml(mem.memoryName) : `MEMORY ${i}`;

      const card = document.createElement("div");
      card.className = "db-card";
      card.innerHTML = `
        <div class="db-card-header">
          <span>${name}</span>
          <span class="${isEmpty ? 'status-empty' : 'status-online'}">${isEmpty ? '[ EMPTY ]' : '[ ONLINE ]'}</span>
        </div>
        <div class="db-info-row">
          <span>Total Games: ${isEmpty ? 0 : mem.games.length}</span>
          <span>Last Update: ${isEmpty ? '-' : new Date(mem.lastUpdate).toLocaleDateString()}</span>
        </div>
        <div class="db-actions">
          ${isEmpty
            ? `<button class="btn btn-create-mem" data-id="${i}">CREATE</button>`
            : `<button class="btn btn-open-mem" data-id="${i}">OPEN EDITOR</button>
               <button class="btn btn-export-mem" data-id="${i}">EXPORT DB</button>
               <button class="btn btn-backtest-mem" style="background-color:#1a3a3a; color:#0ff; border-color:#0ff;" data-id="${i}">BACKTEST</button>
               <button class="btn btn-delete-mem" style="background-color:#550000; color:#ff5555; border-color:#ff0000;" data-id="${i}">DELETE</button>`}
          <button class="btn btn-import-mem" data-id="${i}">IMPORT JSON</button>
          <button class="btn btn-download-template" data-id="${i}">DOWNLOAD TEMPLATE</button>
        </div>
      `;
      list.appendChild(card);
    }

    const addSlotBtn = document.createElement("button");
    addSlotBtn.className = "btn btn-primary btn-add-memory-slot";
    addSlotBtn.style.marginTop = "10px";
    addSlotBtn.textContent = "+ ADD MEMORY SLOT";
    list.appendChild(addSlotBtn);
  }
};
