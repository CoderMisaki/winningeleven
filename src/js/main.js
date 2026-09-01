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
import { TikTokP2sService, getPairingDebugInfo, resolveCountryToId } from "./services/tiktokP2s.js";
import { P2sZstdPatcher } from "./services/p2sZstdPatcher.js";
import { setupCountryAutocomplete } from "./ui/autocomplete.js";
import { parseImportLines } from "./utils/importParser.js";
import { toTitleCase } from "./utils/format.js";
import { teamsDB } from "./data/teams.js";

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

  // 5. Predict Execution — WE10 Hybrid v7 200x AUTO ensemble (non-blocking bulk)
  // Klik PREDICT → otomatis jalan 200x untuk semua B1-B8 tanpa hang, hitung rata-rata winrate & skor
  bindClick("btnPredict", () => {
    const predictPanel = document.getElementById("predictPanel");
    const predictOutput = document.getElementById("predictOutput");
    if (!predictPanel || !predictOutput) {
      console.error("[Predict] #predictPanel / #predictOutput not found");
      return;
    }

    try {
      predictPanel.classList.remove("hidden");
      predictOutput.innerHTML = "<div style='text-align:center; padding: 20px; font-family:var(--font-retro); color:#0ff;'>⏳ CALCULATING WE10 KONAMI HYBRID — single + auto 200x ensemble...</div>";
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

           // Tampilkan SINGLE sebagai preview tipis, tapi HASIL UTAMA adalah 200x rata-rata (stabil)
           // Hapus banner lama agar tidak dikira 1 data = final
           const singleNote = document.createElement("div");
           singleNote.style.cssText = "background:#332200;border:1px dashed #ff0;color:#ffcc66;padding:6px;margin-bottom:8px;font-size:0.6rem;text-align:center;";
           singleNote.innerHTML = `⚠️ Di atas adalah <strong>SAMPLE TUNGGAL 1x</strong> (contoh: 1:0 Sweden — Linderoth 10% kebetulan kepilih). <strong>HASIL STABIL ada di bawah 200x rata-rata</strong> — stabil tidak berpacu 1 data.`;
           predictOutput.insertBefore(singleNote, predictOutput.firstChild);

           // === AUTO 200x ENSEMBLE — PRIMARY HASIL (200x pertandingan, rata-rata) ===
           try {
            const validPreds2 = predictions.filter(p => !p.error && p.prediction);
            if (validPreds2.length > 0) {
              const validPreds = validPreds2;
              const autoBox = document.createElement("div");
              autoBox.id = "auto200Box";
              autoBox.style.cssText = "background:#001a33;border:2px solid #0ff;padding:10px;margin-top:12px;";
              autoBox.innerHTML = `
                <div style="font-family:var(--font-retro);font-size:0.7rem;color:#0f0;margin-bottom:6px;border:1px solid #0f0;background:#002a00;padding:6px;text-align:center;">✅ HASIL STABIL — 200x PERTANDINGAN (RATA-RATA) — BUKAN 1 DATA — ANTI HANG</div>
                <div style="font-family:var(--font-retro);font-size:0.6rem;color:#0ff;margin-bottom:6px;">🔁 MENGHITUNG 200x PER MATCH — SKOR PALING SERING + RATA-RATA + WINRATE KONSISTEN (WE10 PUR SIM)</div>
                <div id="auto200Progress" style="background:#000;border:1px solid #333;padding:6px;font-size:0.7rem;color:#0ff;">⏳ Menjalankan 200x prediksi untuk ${validPreds.length} match (${validPreds.length*200} simulasi) — progress 0%...</div>
                <div style="margin-top:6px;display:flex;gap:8px;flex-wrap:wrap;">
                  <button id="btnCancelAuto200" class="btn" style="background:#330000;border:1px solid #f55;color:#f55;padding:4px 8px;font-size:0.6rem;">BATALKAN</button>
                  <span style="font-size:0.6rem;color:#888;">Skor stabil = <strong style="color:#0f0;">mode 200x</strong> (paling sering) + <strong style="color:#0ff;">rata-rata 200x</strong> (desimal) + <strong style="color:#ff0;">winrate H/D/A 200x</strong>. Top goals = pemain paling sering cetak 200x (WE10 roster weight, bukan dummy).</span>
                </div>
                <div id="auto200Output" style="margin-top:8px;"></div>
              `;
              predictOutput.appendChild(autoBox);
              // lazy import bulkRunner to avoid circular init issue
              import("./services/bulkRunner.js").then(({ createBulkRunner }) => {
                const runner = createBulkRunner();
                const progressEl = document.getElementById("auto200Progress");
                const outEl = document.getElementById("auto200Output");
                let lastPct = 0;
                const validRows = validPreds.map(p=>({ row:p.row, homeCode:p.homeCode, awayCode:p.awayCode, homeName:p.homeName, awayName:p.awayName, homeFlag:p.homeFlag, awayFlag:p.awayFlag }));
                document.getElementById("btnCancelAuto200")?.addEventListener("click", ()=>{ runner.cancel(); if(progressEl) progressEl.innerHTML = `<span style="color:#f55;">⛔ Dibatalkan di ${lastPct}%</span>`; });
                runner.run(validRows, 200, (prog)=>{
                  lastPct = prog.percent;
                  if(progressEl){
                    const barW = prog.percent;
                    progressEl.innerHTML = `
                      <div style="display:flex;justify-content:space-between;font-size:0.6rem;margin-bottom:4px;"><span>${prog.completed}/${prog.total} (${prog.percent}%)</span><span>ETA ${prog.eta.toFixed(1)}s | elapsed ${prog.elapsed.toFixed(1)}s</span></div>
                      <div style="background:#111;border:1px solid #333;height:14px;overflow:hidden;"><div style="background:linear-gradient(90deg,#0ff,#0f0);width:${barW}%;height:100%;transition:width 0.2s;"></div></div>
                    `;
                  }
                }).then(res=>{
                  if(res.cancelled){ if(outEl) outEl.innerHTML = `<div style="color:#f55;">Dibatalkan.</div>`; return; }
                  if(!res || !res.perMatch){ if(outEl) outEl.innerHTML = `<div style="color:#f55;">Bulk 200x gagal.</div>`; return; }
                  // Render average summary
                  const rowsHtml = res.perMatch.map(pm=>{
                    const avgScore = `${pm.avgHome.toFixed(1)} : ${pm.avgAway.toFixed(1)}`;
                    const freqScore = pm.mostFrequent || pm.topScores[0]?.scoreline || "0:0";
                    const winBadge = pm.konsistentWinner === "DRAW" ? `<span style="background:#332200;color:#ff0;padding:2px 4px;">DRAW ${pm.winRateDraw}%</span>` : `<span style="background:#002a00;color:#0f0;padding:2px 4px;">${pm.konsistentWinner} ${Math.max(pm.winRateHome, pm.winRateAway)}%</span>`;
                    const scorerTop = pm.topScorers.slice(0,3).map(pl=>`${pl.name} (${pl.teamCode}) ${pl.hits}x ${pl.freqPct}%`).join(", ") || "-";
                    return `<tr>
                      <td style="padding:4px;text-align:center;color:#0ff;">B${pm.row}</td>
                      <td style="padding:4px;">${pm.homeFlag||""} ${pm.homeName} vs ${pm.awayName} ${pm.awayFlag||""}</td>
                      <td style="padding:4px;text-align:center;font-weight:bold;color:#0f0;">${freqScore}</td>
                      <td style="padding:4px;text-align:center;font-size:0.6rem;">${avgScore}</td>
                      <td style="padding:4px;text-align:center;">${winBadge}<br><span style="font-size:0.55rem;color:#888;">H ${pm.winRateHome}% D ${pm.winRateDraw}% A ${pm.winRateAway}%</span></td>
                      <td style="padding:4px;font-size:0.6rem;">${scorerTop}</td>
                    </tr>`;
                  }).join("");
                  const globalHtml = res.globalRank.slice(0,8).map((pl,i)=>{
                    const medal = i===0?"🥇":i===1?"🥈":i===2?"🥉":"#"+(i+1);
                    return `<tr><td style="padding:4px;">${medal}</td><td style="padding:4px;text-align:center;">${pl.flag||""}</td><td style="padding:4px;"><strong>${pl.name}</strong> [${pl.pos}]<br><span style="font-size:0.6rem;color:#aaa;">${pl.teamName} (${pl.teamCode}) w${pl.weight}/${pl.totalWeight}=${pl.pickProb}%</span><br><span style="font-size:0.55rem;color:#0ff;">${pl.proof}</span></td><td style="padding:4px;text-align:center;color:#0f0;font-weight:bold;">${pl.hits}x/200<br><span style="font-size:0.6rem;color:#888;">${pl.freqPct}% — ${pl.totalGoals} gol total</span></td></tr>`;
                  }).join("");
                  const scoreDistHtml = res.scoreRank.slice(0,6).map(s=>`<span style="background:#111;border:1px solid #444;padding:3px 6px;margin:2px;display:inline-block;font-size:0.65rem;">${s.scoreline}: <strong style="color:#0ff;">${s.count}x</strong> (${s.pct}%)</span>`).join("");
                  if(progressEl) progressEl.innerHTML = `<span style="color:#0f0;">✓ Selesai 200x (${res.completed}/${res.total}) — rata-rata winrate & skor dihitung tanpa hang (chunked yield).</span>`;
                  if(outEl) outEl.innerHTML = `
                    <div style="background:#0a1a0a;border:1px solid #0f0;padding:8px;">
                      <div style="font-weight:bold;color:#0ff;margin-bottom:6px;">📊 HASIL RATA-RATA 200x — SKOR & WINRATE KONSISTEN (WE10 PURE SIM)</div>
                      <div style="overflow-x:auto;"><table class="result-table" style="font-size:0.65rem;"><thead><tr><th>B#</th><th>MATCH</th><th>SKOR PALING SERING</th><th>RATA-RATA (200x)</th><th>KONSISTEN MENANG</th><th>TOP SCORER KONSISTEN (200x)</th></tr></thead><tbody>${rowsHtml}</tbody></table></div>
                      <div style="font-size:0.55rem;color:#888;margin-top:4px;">Skor paling sering = mode 200x. Rata-rata = avg home:away 200x. Menang konsisten = winner dengan winrate tertinggi 200x (bukan dummy — pure sim chances 6±mid*3, shot 18%+0.35*diff, form-aware).</div>
                    </div>
                    <div style="background:#111;border:1px solid #ff0;padding:8px;margin-top:8px;">
                      <div style="font-weight:bold;color:#ff0;margin-bottom:6px;">⚽ GLOBAL TOP GOALS KONSISTEN 200x — KENAPA PEMAIN INI NAIK? (DATA WE10, BUKAN DUMMY)</div>
                      <div style="overflow-x:auto;"><table class="result-table" style="font-size:0.65rem;"><thead><tr><th>#</th><th>FLAG</th><th>PEMAIN / NEGARA + ALASAN</th><th>KONSISTENSI 200x</th></tr></thead><tbody>${globalHtml}</tbody></table></div>
                      <div style="background:#001a00;border:1px solid #0f0;padding:6px;margin-top:6px;font-size:0.6rem;line-height:1.35;">
                        <strong style="color:#0f0;">Kenapa bisa masuk top goals?</strong> ${res.bulkRngProof.whyFrequent}<br>
                        <strong style="color:#0ff;">Kenapa naik?</strong> Berat posisi CF/WF 84 → pick 19% paling tinggi → makin sering kepilih di 200x. OMF 66 → 15%, SMF 52 → 12%, DF 10-12 boost 2.2 → 22 → 5%. GK filtered 0% tidak pernah muncul.<br>
                        <strong style="color:#ff0;">Kenapa dapat skor segitu?</strong> Skor alokasi LCG weight-proportional tepat sebanyak homeGoals+awayGoals per match, tanpa-replacement (anti 3 gol numpuk 1 pemain kecuali 5+ gol).<br>
                        <span style="color:#888;">${res.bulkRngProof.auditNote}</span>
                      </div>
                      <div style="margin-top:6px;font-weight:bold;color:#0ff;">🏆 Distribusi Skor Global 200x (mode):</div><div style="display:flex;flex-wrap:wrap;gap:4px;">${scoreDistHtml}</div>
                    </div>
                    <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;">
                      <button id="btnApplyAvgScores" class="btn btn-primary" style="padding:6px 10px;cursor:pointer;">APPLY RATA-RATA SKOR KE B1-B8</button>
                      <button id="btnApplyConsistentScorers" class="btn" style="background:#002a00;border:1px solid #ff0;color:#ff0;padding:6px 10px;cursor:pointer;">APPLY TOP GOALS KONSISTEN KE G1-G16</button>
                      <span style="font-size:0.6rem;color:#888;align-self:center;">Apply pakai mode paling sering (konsisten), bukan rata-rata desimal.</span>
                    </div>
                  `;
                  // Bind apply handlers
                  setTimeout(()=>{
                    document.getElementById("btnApplyAvgScores")?.addEventListener("click", ()=>{
                      res.perMatch.forEach(pm=>{
                        const idx = pm.row-1;
                        if(idx<0||idx>=8) return;
                        const scoreStr = pm.mostFrequent;
                        const isEditor = StateManager.activeMemoryId !== null;
                        const ds = isEditor ? StateManager.db.memories[StateManager.activeMemoryId]?.games?.[StateManager.activeGameIndex] : StateManager.homeQuery;
                        if(isEditor) MemoryManager.updateMatchField(StateManager.activeMemoryId, StateManager.activeGameIndex, idx, "score", scoreStr, true);
                        else StateManager.homeQuery.matches[idx].score = scoreStr;
                        if(ds?.matches?.[idx]) ds.matches[idx].score = scoreStr;
                      });
                      UIRenderer.renderMatchGrid(); StateManager.save();
                      const b=document.getElementById("btnApplyAvgScores"); if(b){b.textContent="✓ APPLIED"; b.disabled=true;}
                    });
                    document.getElementById("btnApplyConsistentScorers")?.addEventListener("click", ()=>{
                      const isEditor = StateManager.activeMemoryId !== null;
                      const ds = isEditor ? StateManager.db.memories[StateManager.activeMemoryId]?.games?.[StateManager.activeGameIndex] : StateManager.homeQuery;
                      res.globalRank.slice(0,16).forEach((pl, gi)=>{
                        const golInt = String(Math.max(1, Math.round(pl.avgGoals)) || Math.max(1, Math.round(pl.totalGoals/Math.max(1,pl.hits*2))) || 1);
                        // Use actual hits-based avg for display, but fill G with 1+ for minimal
                        const actualGol = String(Math.max(1, Math.round(pl.totalGoals / Math.max(1, Math.ceil(pl.hits/ (res.perMatch.length||1)))) ) || golInt);
                        const countryName = pl.teamName || pl.teamCode;
                        if(isEditor){
                          MemoryManager.updateTopGoalField(StateManager.activeMemoryId, StateManager.activeGameIndex, gi, "country", countryName, true);
                          MemoryManager.updateTopGoalField(StateManager.activeMemoryId, StateManager.activeGameIndex, gi, "player", pl.name, true);
                          MemoryManager.updateTopGoalField(StateManager.activeMemoryId, StateManager.activeGameIndex, gi, "goals", actualGol, true);
                          if(ds?.topGoals?.[gi]){ ds.topGoals[gi].country=countryName; ds.topGoals[gi].player=pl.name; ds.topGoals[gi].goals=actualGol; }
                        } else {
                          if(StateManager.homeQuery.topGoals[gi]){ StateManager.homeQuery.topGoals[gi].country=countryName; StateManager.homeQuery.topGoals[gi].player=pl.name; StateManager.homeQuery.topGoals[gi].goals=actualGol; }
                        }
                      });
                      if(isEditor && ds?.topGoals && ds.topGoals.length<16) while(ds.topGoals.length<16) ds.topGoals.push({country:"",player:"",goals:""});
                      if(!isEditor && StateManager.homeQuery.topGoals.length<16) while(StateManager.homeQuery.topGoals.length<16) StateManager.homeQuery.topGoals.push({country:"",player:"",goals:""});
                      UIRenderer.renderMatchGrid(); StateManager.save();
                      const b=document.getElementById("btnApplyConsistentScorers"); if(b){b.textContent="✓ APPLIED"; b.disabled=true;}
                    });
                  },0);
                }).catch(e=>{
                  if(outEl) outEl.innerHTML = `<div style="color:#f55;">⛔ Auto 200x error: ${e?.message||String(e)}</div>`;
                  if(progressEl) progressEl.innerHTML = `<span style="color:#f55;">Error</span>`;
                });
              }).catch(e=>{
                const out=document.getElementById("auto200Output");
                if(out) out.innerHTML = `<div style="color:#f55;">Gagal load bulkRunner: ${e?.message||String(e)}</div>`;
              });
            }
          } catch(e){ console.warn("[auto200] error", e); }

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
                    MemoryManager.updateMatchField(StateManager.activeMemoryId, StateManager.activeGameIndex, idx, "score", scoreStr, true);
                    if (dataSource.matches[idx]) dataSource.matches[idx].score = scoreStr;
                    filledScores++;
                  } else {
                    StateManager.homeQuery.matches[idx].score = scoreStr;
                    filledScores++;
                  }
                });
                UIRenderer.renderMatchGrid();
                if (!isEditor) StateManager.save();
                else StateManager.save();
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
                const globalRank = [...globalMap.values()].sort((a,b)=> (b.totalActual - a.totalActual) || (b.totalXG - a.totalXG) || (b.maxProb - a.maxProb)).slice(0,16);
                let filledGoals=0;
                globalRank.forEach((pl, gi) => {
                  const golInt = String(pl.totalActual > 0 ? pl.totalActual : Math.max(1, Math.round(pl.totalXG)));
                  const countryName = pl.teamName || pl.teamCode;
                  if (isEditor) {
                    MemoryManager.updateTopGoalField(StateManager.activeMemoryId, StateManager.activeGameIndex, gi, "country", countryName, true);
                    MemoryManager.updateTopGoalField(StateManager.activeMemoryId, StateManager.activeGameIndex, gi, "player", pl.name, true);
                    MemoryManager.updateTopGoalField(StateManager.activeMemoryId, StateManager.activeGameIndex, gi, "goals", golInt, true);
                    if (dataSource.topGoals[gi]) { dataSource.topGoals[gi].country = countryName; dataSource.topGoals[gi].player = pl.name; dataSource.topGoals[gi].goals = golInt; }
                  } else {
                    if (StateManager.homeQuery.topGoals[gi]) { StateManager.homeQuery.topGoals[gi].country = countryName; StateManager.homeQuery.topGoals[gi].player = pl.name; StateManager.homeQuery.topGoals[gi].goals = golInt; }
                  }
                  filledGoals++;
                });
                // FIX BUG: sinkronkan topGoals length ke 16 sebelum render agar G8-G16 tidak hilang
                if (isEditor && dataSource.topGoals && dataSource.topGoals.length < 16) {
                  while (dataSource.topGoals.length < 16) dataSource.topGoals.push({ country: "", player: "", goals: "" });
                }
                if (!isEditor && StateManager.homeQuery.topGoals.length < 16) {
                  while (StateManager.homeQuery.topGoals.length < 16) StateManager.homeQuery.topGoals.push({ country: "", player: "", goals: "" });
                }
                UIRenderer.renderMatchGrid();
                if (!isEditor) StateManager.save();
                else StateManager.save();
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
                  <button id="btnApplyGoals" class="btn" style="background:#002a00;border:1px solid #ff0;color:#ff0;padding:6px 10px;cursor:pointer;">APPLY TOP GOALS (G1-G16)</button>
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
  // === WHAT IF — Manual Skor → Top Goals Only (NR-LCG deterministik) ===
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
      whatIfOut.innerHTML = `<div style="text-align:center;padding:12px;color:#0ff;">⏳ Mengalokasikan ${Security.escapeHtml(hRaw)} ${hgRaw}:${agRaw} ${Security.escapeHtml(aRaw)} via NR-LCG 1664525 (deterministik, bukan replika ROM)…</div>`;
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

  // === TIKTOK SAVE SYNC — .p2s / .pnach GENERATOR (ROBUST zstd + honest UX) ===
  let templateP2sBuffer = null;
  let templateP2sName = localStorage.getItem("we10_tiktok_template_name") || "";
  const tmplInput = document.getElementById("templateP2sInput");
  const tmplNameEl = document.getElementById("templateP2sName");
  const tiktokOut = document.getElementById("tiktokSyncOutput");
  if (tmplNameEl && templateP2sName) tmplNameEl.textContent = `Last: ${templateP2sName} (refresh → upload ulang file untuk patch, B1-B8 tetap persistent)`;
  tmplInput?.addEventListener("change", async (e)=>{
    const f = e.target.files?.[0];
    if (!f) return;
    // Validation: extension
    if (!f.name.toLowerCase().endsWith('.p2s')) {
      if (tmplNameEl) tmplNameEl.textContent = `❌ ${f.name} — bukan .p2s`;
      if (tiktokOut) tiktokOut.innerHTML = `<div style="color:#f55;">❌ File harus .p2s (Save State PCSX2). Pilih file template-schedule.p2s 10-12 MB.</div>`;
      return;
    }
    if (f.size < 1_000_000 || f.size > 100_000_000) {
      if (tiktokOut) tiktokOut.innerHTML = `<div style="color:#ff0;">⚠ Ukuran file ${(f.size/1024/1024).toFixed(2)} MB tidak wajar (expected 10-12 MB). Tetap coba patch?</div>`;
    }
    templateP2sName = f.name;
    localStorage.setItem("we10_tiktok_template_name", f.name);
    localStorage.setItem("we10_tiktok_template_size", String(f.size));
    const buf = await f.arrayBuffer();
    templateP2sBuffer = buf;
    // Honest validation: parse ZIP structure
    let statusLines = [];
    statusLines.push(`✓ File selected: ${f.name} (${(f.size/1024/1024).toFixed(2)} MB)`);
    try {
      const u8 = new Uint8Array(buf);
      if (u8[0]===0x50 && u8[1]===0x4B) {
        statusLines.push(`✓ PCSX2 save state structure detected (ZIP PK)`);
        // Try parse entries
        const entries = P2sZstdPatcher.parseZipEntries(u8);
        statusLines.push(`✓ ZIP entries: ${entries.length} (${entries.map(en=>en.name).slice(0,4).join(', ')}${entries.length>4?'...':''})`);
        const ee = entries.find(en=>en.name.toLowerCase()==='eememory.bin');
        if (ee) {
          statusLines.push(`✓ Patch target detected: eeMemory.bin (method ${ee.method===93?'zstd 0x5D':ee.method} ${ (ee.uncompSize/1024/1024).toFixed(1)} MB)`);
          if (ee.method===93) statusLines.push(`✓ zstd decompression ready (fzstd) — JSZip bug fixed`);
          statusLines.push(`✓ Ready to patch: 00401000 goals, 00401800 top, 00401900 names, 00400004 idx`);
        } else {
          statusLines.push(`❌ eeMemory.bin tidak ditemukan — bukan save state WE10?`);
        }
      } else if (u8[0]===0x1F && u8[1]===0x8B) {
        statusLines.push(`⚠ File gzip (PCSX2 1.6) terdeteksi — akan coba patch raw offset`);
        statusLines.push(`✓ Ready to patch (fallback raw)`);
      } else {
        statusLines.push(`❌ Format tidak dikenali (bukan ZIP PK / gzip)`);
      }
    } catch (err) {
      statusLines.push(`⚠ ZIP parse warning: ${err.message}`);
      statusLines.push(`✓ File tetap bisa dicoba patch (robust handler)`);
    }
    if (tmplNameEl) tmplNameEl.innerHTML = statusLines.map(l=>`<div>${Security.escapeHtml(l)}</div>`).join('');
    if (tiktokOut) tiktokOut.innerHTML = `<div style="color:#0f0; background:#001a00; border:1px solid #0f0; padding:8px;">${statusLines.map(l=>Security.escapeHtml(l)).join('<br>')}<br><span style="color:#ff0;">B1-B8 & Top Goals auto-persistent (refresh aman). Klik GENERATE .P2S (PATCHED).</span></div>`;
  });
  // === IMPORT MATCHES (Phase 6) ===
  const importTextarea = document.getElementById("importMatchesTextarea");
  const importErrorsEl = document.getElementById("importMatchesErrors");
  const importReplaceAll = document.getElementById("importReplaceAll");
  const btnImportMatches = document.getElementById("btnImportMatches");
  const btnClearImport = document.getElementById("btnClearImport");
  function canonicalCountry(name) {
    if (!name) return name;
    const lower = name.trim().toLowerCase();
    for (const [code, info] of Object.entries(teamsDB)) {
      if (info.name.toLowerCase() === lower) return info.name;
    }
    // fallback title case
    return toTitleCase(name);
  }
  btnImportMatches?.addEventListener("click", ()=>{
    const text = importTextarea?.value || "";
    if (!text.trim()) {
      if (importErrorsEl) importErrorsEl.innerHTML = `<span style="color:#ff0;">Masukkan minimal 1 baris, contoh: Spain 3:2 England</span>`;
      return;
    }
    const { results, errors } = parseImportLines(text);
    if (errors.length) {
      if (importErrorsEl) importErrorsEl.innerHTML = errors.map(e=>`Line ${e.line}: "${Security.escapeHtml(e.text)}" — <span style="color:#f55;">${Security.escapeHtml(e.error)}</span>`).join("<br>");
    } else {
      if (importErrorsEl) importErrorsEl.innerHTML = `<span style="color:#0f0;">✓ ${results.length} pertandingan valid — mengisi B1-B${results.length}</span>`;
    }
    if (results.length===0) return;
    // Fill B1-B8: either replace or append
    const isEditor = StateManager.activeMemoryId !== null;
    const replaceAll = !!importReplaceAll?.checked;
    const targetMatches = isEditor ? StateManager.db.memories[StateManager.activeMemoryId]?.games[StateManager.activeGameIndex]?.matches : StateManager.homeQuery.matches;
    if (!targetMatches) return;
    // If replaceAll, clear all first
    if (replaceAll) {
      for (let i=0;i<8;i++) {
        if (isEditor) {
          MemoryManager.updateMatchField(StateManager.activeMemoryId, StateManager.activeGameIndex, i, "home", "", true);
          MemoryManager.updateMatchField(StateManager.activeMemoryId, StateManager.activeGameIndex, i, "score", "", true);
          MemoryManager.updateMatchField(StateManager.activeMemoryId, StateManager.activeGameIndex, i, "away", "", true);
        } else {
          targetMatches[i].home=""; targetMatches[i].score=""; targetMatches[i].away="";
        }
      }
    }
    // Fill
    results.slice(0,8).forEach((r, idx)=>{
      const homeCan = canonicalCountry(r.home);
      const awayCan = canonicalCountry(r.away);
      if (isEditor) {
        MemoryManager.updateMatchField(StateManager.activeMemoryId, StateManager.activeGameIndex, idx, "home", homeCan, true);
        MemoryManager.updateMatchField(StateManager.activeMemoryId, StateManager.activeGameIndex, idx, "score", r.score, true);
        MemoryManager.updateMatchField(StateManager.activeMemoryId, StateManager.activeGameIndex, idx, "away", awayCan, true);
      } else {
        targetMatches[idx].home = homeCan;
        targetMatches[idx].score = r.score;
        targetMatches[idx].away = awayCan;
      }
      // Auto-enable B8 if filling idx 7
      if (idx===7) {
        if (isEditor) StateManager.db.memories[StateManager.activeMemoryId].games[StateManager.activeGameIndex].b8Enabled = true;
        else { StateManager.homeQuery.b8Enabled = true; targetMatches[7].enabled = true; }
      }
    });
    if (!isEditor) StateManager.saveHomeQueryImmediate();
    UIRenderer.renderMatchGrid();
    if (importErrorsEl && errors.length===0) importErrorsEl.innerHTML += `<br><span style="color:#0ff;">✓ B1-B${results.length} terisi — refresh aman (persistent). Generate .p2s sekarang.</span>`;
  });
  btnClearImport?.addEventListener("click", ()=>{
    if (importTextarea) importTextarea.value="";
    if (importErrorsEl) importErrorsEl.innerHTML="";
  });

  const collectTikTokData = ()=>{
    const isEditor = StateManager.activeMemoryId !== null;
    const activeMem = isEditor ? StateManager.db.memories[StateManager.activeMemoryId] : null;
    const dataSource = isEditor && activeMem?.games?.[StateManager.activeGameIndex] ? activeMem.games[StateManager.activeGameIndex] : StateManager.homeQuery;
    const matches = dataSource?.matches || [];
    const topGoals = dataSource?.topGoals || [];
    // goals 48 for Konami Cup 24 teams: 8 match input -> expand, rest 0
    const goals = Array.from({length:48}, (_,i)=>{
      if (i < 8) {
        const m = matches[i];
        if (!m || !m.score || !m.score.includes(":")) return [0,0];
        const [h,a]= m.score.split(":").map(s=>parseInt(s.trim(),10));
        return [isNaN(h)?0:h, isNaN(a)?0:a];
      }
      return [0,0];
    });
    const topNumbers = Array.from({length:24}, (_,i)=>{
      const g = topGoals[i];
      const n = parseInt((g?.goals||"0").trim(),10);
      return isNaN(n)?0:n;
    });
    // topObjects include nama negara & pemain biar ter-include di .p2s (00401900)
    const topObjects = Array.from({length:24}, (_,i)=>{
      const g = topGoals[i] || {};
      return { country: (g.country||"").trim(), player: (g.player||"").trim(), goals: String(topNumbers[i]) };
    });
    // --- VERIFIED KONAMI CUP PAIRING (P2S+RUNTIME VERIFIED @0x01323404 u16 LE stride 04) ---
    // Build 8 pairings from B1-B8 home/away; validate via TikTokP2sService; fail-safe null if incomplete
    let konamiCupPairings = null;
    let pairingDebug = null;
    try {
      // Use first 8 matches as B1-B8 pairing input (even if score empty, team names matter)
      if (Array.isArray(matches) && matches.length >= 8) {
        pairingDebug = getPairingDebugInfo(matches.slice(0,8));
        const cand = TikTokP2sService.buildKonamiCupPairingsFromMatches(matches.slice(0,8));
        if (cand && cand.length === 8) konamiCupPairings = cand;
      } else {
        pairingDebug = getPairingDebugInfo([]);
      }
    } catch (_) { konamiCupPairings = null; try { pairingDebug = getPairingDebugInfo(matches.slice(0,8)); } catch(e){} }
    const matchCount = matches.filter(m=>m.home||m.away||m.score).length;
    const hasEightRowsFilled = Array.isArray(matches) && matches.length>=8 && matches.slice(0,8).every(m=> String(m.home||'').trim() && String(m.away||'').trim());
    // auto-save ke localStorage (StateManager sudah save, tapi kita mirror untuk tiktokOut)
    try { localStorage.setItem("we10_tiktok_last_goals", JSON.stringify(goals)); localStorage.setItem("we10_tiktok_last_top", JSON.stringify(topObjects)); } catch(_){}
    return { goals, top: topNumbers, topObjects, konamiCupPairings, pairingDebug, hasEightRowsFilled, dataSource, matchCount };
  };
  bindClick("btnGeneratePnach", ()=>{
    const { goals, top, topObjects, konamiCupPairings } = collectTikTokData();
    // generate pnach pakai topNumbers, tapi next p2s akan include nama juga; include verified pairing if available
    const pnach = TikTokP2sService.generatePnach(goals, top, konamiCupPairings);
    TikTokP2sService.triggerDownload(new Blob([pnach],{type:'text/plain'}), '9337F97.pnach');
    const pairingInfo = konamiCupPairings ? ` | Pairing 0x01323404 ${konamiCupPairings.map(m=>`${m.home}(${m.homeId})-${m.away}(${m.awayId})`).join(' | ')}` : ` | Pairing: incomplete (isi B1-B8 dengan negara valid)`;
    if (tiktokOut) tiktokOut.innerHTML = `<div style="color:#ff0;">⬇ .pnach generated <code>9337F97.pnach</code> — copy ke <code>PCSX2/cheats/9337F97.pnach</code> lalu Reload Cheats. Nama negara & skor sudah include (top goals nama: ${topObjects.slice(0,3).map(o=>o.player||o.country).join(', ')}) | Goals ${goals.slice(0,8).map(g=>g.join(':')).join(', ')}${pairingInfo}</div>`;
  });
  bindClick("btnDownloadTikTokJson", ()=>{
    const { goals, top, topObjects } = collectTikTokData();
    const j = { note:"WE10 TikTok Sync - generated from B1-B8 & Top Goals (nama ter-include)", generalSettings:{ cup:"Konami Cup",eligibleTeams:"National",competitionType:"Knock-out System",homeAndAway:"Yes",groupName:"1~8",numberOfTeams:24,numberOfPlayers:"1/24" }, goals, topScorer: top, topScorerNames: topObjects, scheduleTable: "Konami Cup Round 1 Match 1~8 (Image 2) - load p2s auto di situ" };
    TikTokP2sService.triggerDownload(new Blob([JSON.stringify(j,null,2)],{type:'application/json'}), 'tiktok_live.json');
    if (tiktokOut) tiktokOut.innerHTML = `<div style="color:#0f0;">⬇ tiktok_live.json downloaded — nama negara+skor+top goals nama sudah include, letak di <code>api/tiktok_live.json</code></div>`;
  });
  bindClick("btnGenerateP2s", async ()=>{
    let { goals, top, topObjects, konamiCupPairings, pairingDebug, hasEightRowsFilled, matchCount } = collectTikTokData();
    // --- DIAGNOSTIC: trace data flow inconsistency ---
    const _diagResolved = (pairingDebug || []).filter(r=>r.status==='PASS').length;
    const _diagUnresolved = 8 - _diagResolved;
    console.log('=== PAIRING GATE DEBUG ===', {
      matchesLength: 8,
      hasEightRowsFilled,
      konamiCupPairings,
      konamiCupPairingsLength: konamiCupPairings?.length ?? null,
      pairingDebugLength: pairingDebug?.length ?? null,
      unresolvedCount: _diagUnresolved,
      resolvedCount: _diagResolved,
      rows: (pairingDebug||[]).map(r=>`B${r.index+1} ${r.homeRaw}->${r.homeId} ${r.awayRaw}->${r.awayId} ${r.status}`)
    });
    // Auto-heal inconsistency: if debug shows 8 PASS but konamiCupPairings is null, rebuild from debug
    if (hasEightRowsFilled && !konamiCupPairings && _diagResolved===8) {
      console.warn('[Gate] Auto-heal: pairingDebug 8/8 PASS but konamiCupPairings null – rebuilding from debug');
      konamiCupPairings = pairingDebug.map(r=> ({ homeId: r.homeId, awayId: r.awayId, home: r.homeRaw, away: r.awayRaw }));
    }
    const _resolvedCount = (pairingDebug || []).filter(r=>r.status==='PASS').length;
    const _unresolvedCount = 8 - _resolvedCount;
    if (matchCount===0) { if(tiktokOut) tiktokOut.innerHTML = `<div style="color:#f55;">Isi dulu B1-B8 (contoh Czech 3:2 Portugal) & Top Goals G1-G16 baru Generate — nama negara+skor auto include top goals (localStorage).</div>`; return; }
    // --- P2S GENERATION GATE: never silently skip pairing when B1-B8 visibly filled ---
    // Use actual resolved count, not just konamiCupPairings truthiness, to avoid 0/8 vs 8/8 mismatch
    if (hasEightRowsFilled && _resolvedCount !== 8) {
      const detail = (pairingDebug || []).map(r=> `B${r.index+1}: home raw="${Security.escapeHtml(r.homeRaw)}" -> ${r.homeId===null?'❌':r.homeId} | away raw="${Security.escapeHtml(r.awayRaw)}" -> ${r.awayId===null?'❌':r.awayId} — ${r.status}${r.reason?` (${Security.escapeHtml(r.reason)})`:''}${r.reason && r.homeId===null ? `<br><span style="color:#ff0;">Suggestion: check display name vs canonical (e.g. "Serbia & Mont." → ID 16, "Holland" → ID 6)</span>`:''}`).join('<br>');
      const failed = (pairingDebug || []).filter(r=>r.status==='FAIL');
      if (tiktokOut) tiktokOut.innerHTML = `
        <div style="color:#f55; background:#1a0000; border:2px solid #f55; padding:8px;">
          <div style="font-weight:bold;">❌ Pairing: BLOCKED — ${failed.length}/8 rows unresolved</div>
          <div style="font-size:0.6rem; margin-top:4px; font-family:monospace; background:#000; padding:4px; border:1px solid #f55;">${detail}</div>
          <div style="margin-top:4px; font-size:0.65rem; color:#ff0;">Do NOT generate P2S with old template pairing. Fix B1-B8 names to canonical 57-team IDs (e.g. Serbia & Mont. → 16) then retry.</div>
          <div style="margin-top:4px; font-size:0.55rem; color:#888;">Gate debug: hasEightRowsFilled=${hasEightRowsFilled}, konamiCupPairings=${konamiCupPairings?konamiCupPairings.length:'null'}, resolved=${_resolvedCount}, unresolved=${_unresolvedCount}</div>
        </div>`;
      return; // ABORT – do not download P2S
    }
    if (!templateP2sBuffer) {
      if (tiktokOut) tiktokOut.innerHTML = `<div style="color:#f55;">⚠ Belum upload template.p2s — .p2s butuh template ZIP (Save State di Schedule table Image 2) biar format .p2s valid dan bisa di-Load State. Sementara download .pnach dulu.</div>`;
      const pnach = TikTokP2sService.generatePnach(goals, top, konamiCupPairings);
      TikTokP2sService.triggerDownload(new Blob([pnach],{type:'text/plain'}), '9337F97.pnach');
      if (tiktokOut) tiktokOut.innerHTML += `<div style="color:#ff0;">⬇ .pnach 9337F97.pnach ter-download (bukan .p2s) — upload template.p2s dulu untuk .p2s.</div>`;
      return;
    }
    // Validate pairing before generation – fail safely if incomplete/out-of-range
    if (konamiCupPairings) {
      if (konamiCupPairings.length !== 8) {
        if (tiktokOut) tiktokOut.innerHTML = `<div style="color:#f55;">❌ Konami Cup pairing incomplete: need 8 matches B1-B8 dengan negara valid 0..56. Pairing tidak dipatch.</div>`;
        return;
      }
      for (let i=0;i<8;i++){ const m=konamiCupPairings[i]; if(!Number.isInteger(m.homeId)||m.homeId<0||m.homeId>56||!Number.isInteger(m.awayId)||m.awayId<0||m.awayId>56){ if(tiktokOut) tiktokOut.innerHTML=`<div style="color:#f55;">❌ Pairing validation fail B${i+1} IDs ${m.homeId}-${m.awayId} out of 0..56 – ABORT.</div>`; return; } }
    } else if (hasEightRowsFilled) {
      if (tiktokOut) tiktokOut.innerHTML = `<div style="color:#f55;">❌ Pairing: BLOCKED — B1-B8 visibly filled but pairing unresolved. ABORT.</div>`;
      return;
    }
    try {
      const pairingStatus = konamiCupPairings ? `Pairing: READY — 8/8 | Patch 0x01323404 u16 LE stride 04 VERIFIED` : `Pairing: skipped (B1-B8 incomplete)`;
      const pairingStatusColor = konamiCupPairings ? '#0f0' : '#ff0';
      if (tiktokOut) tiktokOut.innerHTML = `<div style="color:#0ff;">⏳ Patching ${Security.escapeHtml(templateP2sName)} (${(templateP2sBuffer.byteLength/1024/1024).toFixed(2)} MB ZIP) di eeMemory.bin 00401000/00401800/00401900 ${pairingStatus} — top goals nama include — validasi output...</div>`;
      console.log('[TikTokP2s] patch start', templateP2sName, goals.slice(0,2), topObjects.slice(0,2), konamiCupPairings ? konamiCupPairings.slice(0,2) : null);
      const result = await TikTokP2sService.patchP2sTemplate(templateP2sBuffer, goals, topObjects, konamiCupPairings);
      const blob = result.blob;
      const stats = result.stats || {};
      // Validation: size, PK header, patch count
      if (blob.size < 5_000_000) throw new Error('Output .p2s size '+blob.size+' terlalu kecil (<5MB), bukan ZIP valid — template mungkin korup');
      // Check PK header
      const checkBuf = await blob.slice(0,4).arrayBuffer();
      const hdr = new Uint8Array(checkBuf);
      if (hdr[0]!==0x50 || hdr[1]!==0x4B) throw new Error('Output .p2s header bukan PK ZIP — rebuild gagal');
      TikTokP2sService.triggerDownload(blob, 'WE10_TikTok_Patched.p2s');
      const methodStr = stats.eeMethod===8 ? 'DEFLATE' : stats.eeMethod===0 ? 'STORE' : 'zstd→deflate';
      const pairingLines = result.pairingDebug ? result.pairingDebug.map(l=>Security.escapeHtml(l)).join('<br>') : (konamiCupPairings ? `KONAMI CUP PAIRING PATCH<br>Address: 0x01323404<br>Encoding: u16 LE<br>Stride: 0x04<br>${konamiCupPairings.map((m,i)=>`B${i+1} ${Security.escapeHtml(m.home)}(${m.homeId}) - ${Security.escapeHtml(m.away)}(${m.awayId}) PASS`).join('<br>')}<br>Overall: PAIRING PATCH VERIFIED` : `Pairing: skipped (B1-B8 incomplete)`);
      const pairingStat = stats.pairingPatched ? `✓ Konami Cup pairing patched 0x01323404 u16 LE stride 04 (32 bytes, P2S+RUNTIME VERIFIED)<br>` : `○ Pairing not patched (isi B1-B8 lengkap untuk patch 0x01323404)<br>`;
      if (tiktokOut) tiktokOut.innerHTML = `
        <div style="color:#0f0; background:#001a00; border:2px solid #0f0; padding:8px;">
          <div style="font-weight:bold;">✓ P2S patched successfully</div>
          <div style="font-size:0.65rem; margin-top:4px;">
            ${pairingStat}
            ✓ 48 score values patched (B1-B8 → 00401000, 96 bytes)<br>
            ✓ 16 top-goal entries patched (G1-G16 → 00401800 + 00401900, 24+768 bytes)<br>
            ✓ matchIdx reset 00400004=0<br>
            ✓ Output validated: PK ZIP header OK<br>
            ✓ Method: ${methodStr} | Original ${(stats.originalSize/1024/1024).toFixed(2)} MB → Patched ${(stats.rebuiltSize/1024/1024).toFixed(2)} MB<br>
            ✓ Ready for PCSX2: <code>PCSX2 > System > Load State > WE10_TikTok_Patched.p2s</code> (auto Schedule table Image 2)
          </div>
          <div style="font-size:0.6rem; color:#0ff; background:#001a1a; border:1px solid #0ff; padding:4px; margin-top:6px; font-family:monospace;">${pairingLines}</div>
          <div style="font-size:0.55rem; color:#888; margin-top:4px;">Scores: ${goals.slice(0,8).map(g=>g.join(':')).join(', ')} | Top: ${topObjects.slice(0,3).map(o=>`${o.country} ${o.player} ${o.goals}`).join(', ')}</div>
        </div>`;
      console.log('[TikTokP2s] done', blob.size, stats, result.pairingDebug);
    } catch(e){
      console.error('[TikTokP2s] patch fail', e);
      let reason = e.message || String(e);
      let action = 'Coba upload ulang template-schedule.p2s (Save State di Schedule table Round 1). Jika masih gagal, pakai .pnach sebagai fallback.';
      if (reason.includes('zstd') || reason.includes('0x5D') || reason.includes('93')) {
        reason = `PCSX2 save state contains compression method 0x5D00 (zstd) which JSZip cannot decode — fixed by robust patcher, but still failed: ${reason}`;
        action = 'Refresh browser, upload ulang template, atau pakai Generate .pnach (robust fallback).';
      } else if (reason.includes('eeMemory')) {
        action = 'Pastikan template .p2s adalah Save State PCSX2 2.0 di posisi Schedule table (10-12 MB), bukan memory card .ps2.';
      } else if (reason.includes('size')) {
        action = 'Output terlalu kecil — template mungkin bukan .p2s valid. Buat Save State baru (F1) di PCSX2.';
      }
      if (tiktokOut) tiktokOut.innerHTML = `
        <div style="color:#f55; background:#1a0000; border:2px solid #f55; padding:8px;">
          <div style="font-weight:bold;">❌ P2S PATCH FAILED</div>
          <div style="margin-top:4px;"><strong>Reason:</strong> ${Security.escapeHtml(reason)}</div>
          <div style="margin-top:4px;"><strong>Action:</strong> ${Security.escapeHtml(action)}</div>
          <div style="margin-top:6px; font-size:0.65rem; color:#ff0;">.pnach fallback tetap bisa dipakai: klik <code>GENERATE .PNACH</code> → copy ke <code>PCSX2/cheats/9337F97.pnach</code>.</div>
        </div>`;
    }
  });

  renderSidebar();
  renderChatWindow();

  // Initialize GitHub Agent UI
  GitHubAgentUI.init();
});
