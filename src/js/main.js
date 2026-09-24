import { StateManager } from "./state/appState.js";
import { NavigationManager } from "./ui/navigation.js";
import { PredictionService, PREDICTOR_CONFIG } from "./services/predictor.js";
import { runWalkForwardBacktest } from "./services/backtestEngine.js";
import { UIRenderer } from "./ui/uiRenderer.js";
import { MatchingEngine } from "./services/matchingEngine.js";
import { ImportExportService } from "./services/importExport.js";
import { Security } from "./utils/security.js";
import { MemoryManager } from "./services/memoryManager.js";
import { setupCountryAutocomplete } from "./ui/autocomplete.js";
import { parseImportLines } from "./utils/importParser.js";
import { teamsDB } from "./data/teams.js";
import { normalizeCountry } from "./services/similarity.js";

const LAST_GOALS_STORAGE_KEY = "we10_tiktok_last_goals";

document.addEventListener("DOMContentLoaded", async () => {
  window.UIRenderer = UIRenderer;
  await StateManager.init();

  const bindClick = (id, handler) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("click", handler);
  };

  // FIX BUG: StateManager.save() hanya menyimpan `db` (memories) ke IndexedDB.
  // Perubahan pada homeQuery (mode MATCHING CENTER) harus disimpan ke localStorage
  // lewat saveHomeQueryImmediate(), kalau tidak semua hasil APPLY hilang saat refresh.
  const persistState = (isEditor) => {
    try {
      if (isEditor) StateManager.save();
      else StateManager.saveHomeQueryImmediate();
      const source = isEditor
        ? StateManager.db.memories[StateManager.activeMemoryId]?.games?.[StateManager.activeGameIndex]
        : StateManager.homeQuery;
      localStorage.setItem(LAST_GOALS_STORAGE_KEY, JSON.stringify(source?.topGoals || []));
    } catch (e) {
      console.warn("[persistState] gagal menyimpan", e);
    }
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
        let res;
        try {
          res = runWalkForwardBacktest(id);
        } catch (e) {
          res = { error: `Backtest gagal: ${e?.message || e}` };
        }
        if (res.error) {
          UIRenderer.showAlert(res.error);
        } else {
          const cmp = res.modelComparison || {};
          const p = cmp.playerAttribute, l = cmp.legacyWeight, d = cmp.delta;
          const msg = `HASIL WALK-FORWARD BACKTEST (MEMORY ${id}) — NO LEAKAGE\n\n` +
            `Total Matches Evaluated: ${res.totalTested}\n\n` +
            `— MODEL PEMAIN (player-attribute v7) —\n` +
            `Exact Score Accuracy : ${res.exactScoreAccuracy.toFixed(1)}%\n` +
            `1X2 Accuracy         : ${res.result1X2Accuracy.toFixed(1)}%\n` +
            `Top-3 Scoreline Hit  : ${res.top3ScoreHitRate.toFixed(1)}%\n` +
            `Top-5 Scoreline Hit  : ${res.top5ScoreHitRate.toFixed(1)}%\n` +
            `MAE Goals            : ${res.maeHomeGoals.toFixed(2)} (H) / ${res.maeAwayGoals.toFixed(2)} (A)\n` +
            `Top Scorer Hit Rate  : ${res.topScorerHitRate.toFixed(1)}% (${res.topScorerSamples} match ada data topGoals)\n` +
            `Scorer Distribution  : ${res.scorerDistributionAccuracy.toFixed(1)}% akurat (TVD ${res.scorerDistributionTVD.toFixed(1)}%)\n` +
            `Brier / LogLoss      : ${res.meanBrierScore.toFixed(3)} / ${res.meanLogLoss.toFixed(3)}\n\n` +
            (p && l ? `— PEMBANDING MODEL LAMA (position weight, heuristik) —\n` +
              `Exact ${l.exactScoreAccuracy.toFixed(1)}% | 1X2 ${l.result1X2Accuracy.toFixed(1)}% | Top-3 ${l.top3ScoreHitRate.toFixed(1)}% | Top-5 ${l.top5ScoreHitRate.toFixed(1)}%\n` +
              `MAE ${l.maeHomeGoals.toFixed(2)}/${l.maeAwayGoals.toFixed(2)} | Top Scorer Hit ${l.topScorerHitRate.toFixed(1)}% | Distribusi ${l.scorerDistributionAccuracy.toFixed(1)}%\n` +
              `DELTA vs model baru: exact ${d.exactScoreAccuracy >= 0 ? "+" : ""}${d.exactScoreAccuracy.toFixed(1)} | 1X2 ${d.result1X2Accuracy >= 0 ? "+" : ""}${d.result1X2Accuracy.toFixed(1)} | top3 ${d.top3ScoreHitRate >= 0 ? "+" : ""}${d.top3ScoreHitRate.toFixed(1)} | topScorerHit ${d.topScorerHitRate >= 0 ? "+" : ""}${d.topScorerHitRate.toFixed(1)}\n\n` : "") +
            `Leakage: ${res.leakageAudit}`;
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

  // Toast global (dipakai banyak panel)
  const Toast = {
    container: null,
    ensureContainer() {
      if (this.container && document.body.contains(this.container)) return this.container;
      const el = document.createElement("div");
      el.id = "we10ToastContainer";
      el.style.cssText = "position:fixed;right:14px;bottom:14px;z-index:99999;display:flex;flex-direction:column;gap:8px;max-width:min(90vw,380px);pointer-events:none;";
      document.body.appendChild(el);
      this.container = el;
      return el;
    },
    show(message, type = "info") {
      console.log("[TOAST]", message);
      try {
        const host = this.ensureContainer();
        const colors = {
          info: { bg: "#001a33", border: "#0ff", fg: "#0ff" },
          success: { bg: "#002a00", border: "#0f0", fg: "#0f0" },
          error: { bg: "#330000", border: "#f55", fg: "#ffaaaa" }
        }[type] || { bg: "#001a33", border: "#0ff", fg: "#0ff" };
        const item = document.createElement("div");
        item.style.cssText = `background:${colors.bg};border:1px solid ${colors.border};color:${colors.fg};padding:8px 12px;font-family:var(--font-mono);font-size:0.7rem;box-shadow:0 4px 12px rgba(0,0,0,.6);opacity:0;transition:opacity .25s ease;`;
        item.textContent = String(message ?? "");
        host.appendChild(item);
        requestAnimationFrame(() => { item.style.opacity = "1"; });
        setTimeout(() => {
          item.style.opacity = "0";
          setTimeout(() => item.remove(), 300);
        }, 3200);
      } catch (_) { /* fallback diam-diam */ }
    }
  };
  window.Toast = Toast;

  bindClick("btnClearForm", () => {
    UIRenderer.showConfirm("Reset seluruh isi B1-B8, Top Goals G1-G16 & Draft Pick (BAN/YES ikut tereset)?", () => {
      StateManager.clearHomeQuery();
      UIRenderer.renderMatchGrid();
      document.getElementById("resultsPanel")?.classList.add("hidden");
      document.getElementById("predictPanel")?.classList.add("hidden");
      // FIX BUG: tag BAN (NO) & BANDAR/YES di draft pick harus ikut hilang saat reset form
      try { localStorage.removeItem("we10_draft_v1"); } catch (_) {}
      const draftBanList = document.getElementById("draftBanList");
      const draftBandarList = document.getElementById("draftBandarList");
      if (draftBanList) draftBanList.innerHTML = `<span style="font-size:0.6rem;color:#666;">Belum ada BAN — max 3</span>`;
      if (draftBandarList) draftBandarList.innerHTML = `<span style="font-size:0.6rem;color:#666;">Belum ada BANDAR — cuma 1</span>`;
      const banInputEl = document.getElementById("draftBanInput");
      const bandarInputEl = document.getElementById("draftBandarInput");
      if (banInputEl) banInputEl.value = "";
      if (bandarInputEl) bandarInputEl.value = "";
      const recommendOutEl = document.getElementById("draftRecommendOutput");
      if (recommendOutEl) recommendOutEl.innerHTML = `Isi <strong>B1-B8</strong> dulu → isi <strong>NO (atas)</strong> max 3 & <strong>BANDAR</strong> 1 → klik <strong>REKOMENDASI</strong> → system kasih 1 pemain terbaik untuk melawan bandar (dari B1-B8, bukan dummy, beda negara bandar, pick% tinggi, finishing tinggi, skor sadis ★5).`;
      try { document.dispatchEvent(new CustomEvent("we10:draftReset")); } catch (_) {}
      try { Toast.show("Form & Draft Pick (BAN/YES) direset.", "success"); } catch (_) {}
    });
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

           // FIX BUG (kritikal): dashboard single-predict TIDAK pernah dirender sebelumnya.
           // Akibatnya tabel "SKOR & PEMENANG PER MATCH" dan "GLOBAL TOP GOALS" (G1-G16)
           // tidak pernah muncul di panel PREDICT. Render dulu, baru tempel box 200x di bawahnya.
            predictOutput.innerHTML = "";
           UIRenderer.renderPredictionDashboard(predictions, predictOutput);

            // Preview skor & top goals langsung terlihat tanpa APPLY dulu,
            // tapi tetap kasih tombol APPLY untuk persist.
            try {
              const validForBagan = predictions.filter(p=> !p.error && p.prediction);
              if(validForBagan.length){
               const previewWrap = document.createElement("div");
               previewWrap.id = "predictBaganPreview";
               previewWrap.style.cssText = "background:#001a00;border:2px solid #0f0;padding:8px;margin:10px 0;";
               // Build schedule preview table with predicted scores
               const schedulePreviewRows = validForBagan.map(p=>{
                 const sc = `${p.prediction.homeGoals}:${p.prediction.awayGoals}`;
                 const scorers = (p.prediction.topScorers||[]).filter(s=>s.matchGoals>0).slice(0,2).map(s=> `${s.name}(${s.teamCode}) ${s.matchGoals}G`).join(", ") || "-";
                 return `<tr><td style="padding:3px;text-align:center;color:#0ff;">B${p.row}</td><td style="padding:3px;">${Security.escapeHtml(p.homeFlag||"")} ${Security.escapeHtml(p.homeName)} vs ${Security.escapeHtml(p.awayName)} ${Security.escapeHtml(p.awayFlag||"")}</td><td style="padding:3px;text-align:center;font-weight:bold;color:#0f0;">${sc}</td><td style="padding:3px;font-size:0.6rem;">${Security.escapeHtml(scorers)}</td></tr>`;
               }).join("");
               // Global top goals preview from predictions
               const globalMap = new Map();
               validForBagan.forEach(p=>{
                 (p.prediction.topScorers||[]).forEach(pl=>{
                   const actual = pl.matchGoals||0; if(actual<=0) return;
                   const key = `${pl.teamCode}:${pl.playerIndex ?? "?"}|${pl.name}`;
                   const ex=globalMap.get(key);
                   if(ex){ ex.totalActual+=actual; ex.totalXG+=pl.expectedGoals; }
                   else globalMap.set(key, {name:pl.name,teamCode:pl.teamCode,teamName:pl.teamName,flag:pl.flag,pos:pl.pos,totalActual:actual,totalXG:pl.expectedGoals});
                 });
               });
                const globalPreview = [...globalMap.values()].sort((a,b)=>(b.totalActual-b.totalActual)||(b.totalXG-a.totalXG)).slice(0,8).map((pl,i)=>{
                 const badge=i===0?"🥇":i===1?"🥈":i===2?"🥉":"#"+(i+1);
                  const gol = pl.totalActual;
                 return `<tr><td style="padding:3px;">${badge}</td><td style="padding:3px;text-align:center;">${Security.escapeHtml(pl.flag||"")}</td><td style="padding:3px;"><strong>${Security.escapeHtml(pl.name)}</strong> [${Security.escapeHtml(pl.pos)}]<br><span style="font-size:0.6rem;color:#aaa;">${Security.escapeHtml(pl.teamName)} (${pl.teamCode})</span></td><td style="padding:3px;text-align:center;color:#0f0;">${gol} GOL</td></tr>`;
               }).join("") || `<tr><td colspan="4" style="padding:6px;text-align:center;color:#888;">-</td></tr>`;
               previewWrap.innerHTML = `
                 <div style="font-family:var(--font-retro);font-size:0.6rem;color:#0f0;margin-bottom:6px;">📊 PREVIEW BAGAN PREDIKSI — skor negara & top goals langsung terlihat (otomatis setelah PREDICT)</div>
                 <div style="overflow-x:auto;background:#000;border:1px solid #333;margin-bottom:8px;">
                   <table class="result-table" style="font-size:0.65rem;width:100%;"><thead><tr><th>B#</th><th>MATCH (negara)</th><th>SKOR PRED</th><th>TOP SCORER PRED</th></tr></thead><tbody>${schedulePreviewRows}</tbody></table>
                 </div>
                 <div style="overflow-x:auto;background:#000;border:1px solid #333;">
                   <table class="result-table" style="font-size:0.65rem;width:100%;"><thead><tr><th>#</th><th>FLAG</th><th>PEMAIN / NEGARA</th><th>GOL</th></tr></thead><tbody>${globalPreview}</tbody></table>
                 </div>
                  <div style="font-size:0.55rem;color:#888;margin-top:6px;">Preview ini pakai skor & top scorer dari prediksi 1x (stabilitas lihat kotak biru 200x di bawah). Klik <strong>APPLY SCORES / TOP GOALS</strong> untuk isi B1-B8 & G1-G16 permanen.</div>
                `;
                // Insert preview as second child (after dashboard header)
                if(predictOutput.children.length >= 2) predictOutput.insertBefore(previewWrap, predictOutput.children[1]);
                else predictOutput.appendChild(previewWrap);
              }
            }catch(e){ console.warn("[predictBaganPreview] error", e); }

           // Tampilkan SINGLE sebagai preview tipis, tapi HASIL UTAMA adalah 200x rata-rata (stabil)
           // Hapus banner lama agar tidak dikira 1 data = final
           const singleNote = document.createElement("div");
           singleNote.style.cssText = "background:#332200;border:1px dashed #ff0;color:#ffcc66;padding:6px;margin-bottom:8px;font-size:0.6rem;text-align:center;";
           singleNote.innerHTML = `⚠️ Tabel di <strong>BAWAH</strong> ini adalah <strong>SAMPLE TUNGGAL 1x</strong> (contoh: 1:0 Sweden — Linderoth 10% kebetulan kepilih). <strong>HASIL STABIL ada di kotak biru 200x rata-rata di bagian paling bawah</strong> — stabil, tidak berpacu pada 1 data.`;
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
                  <span style="font-size:0.6rem;color:#888;">Skor stabil = <strong style="color:#0f0;">mode 200x</strong> (paling sering) + <strong style="color:#0ff;">rata-rata 200x</strong> (desimal) + <strong style="color:#ff0;">winrate H/D/A 200x</strong>. Top goals = pemain paling sering cetak 200x dari MATCH ENGINE level-pemain (posisi × atribut × form) — bukan undian weight, bukan dummy.</span>
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
                 const validRows = validPreds.map(p=>({ row:p.row, homeCode:p.homeCode, awayCode:p.awayCode, homeName:p.homeName, awayName:p.awayName, homeFlag:p.homeFlag, awayFlag:p.awayFlag, exclude: isEditor ? { memoryId: StateManager.activeMemoryId, gameNumber: dataSource.gameNumber } : null }));
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
                     const freqScore = pm.mostFrequent || pm.topScores[0]?.scoreline || "-";
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
                    return `<tr><td style="padding:4px;">${medal}</td><td style="padding:4px;text-align:center;">${pl.flag||""}</td><td style="padding:4px;"><strong>${pl.name}</strong> [${pl.pos}]<br><span style="font-size:0.6rem;color:#aaa;">${pl.teamName} (${pl.teamCode}) • posisi ${pl.pos}${pl.finishing!=null?` • finishing ${pl.finishing}`:""}${pl.pickProb!=null?` • dipilih ${pl.pickProb}%/chance`:""}</span><br><span style="font-size:0.55rem;color:#0ff;">${pl.proof}</span></td><td style="padding:4px;text-align:center;color:#0f0;font-weight:bold;">${pl.hits}x/200<br><span style="font-size:0.6rem;color:#888;">${pl.freqPct}% — ${pl.totalGoals} gol total</span></td></tr>`;
                  }).join("");
                  const scoreDistHtml = res.scoreRank.slice(0,6).map(s=>`<span style="background:#111;border:1px solid #444;padding:3px 6px;margin:2px;display:inline-block;font-size:0.65rem;">${s.scoreline}: <strong style="color:#0ff;">${s.count}x</strong> (${s.pct}%)</span>`).join("");
                  if(progressEl) progressEl.innerHTML = `<span style="color:#0f0;">✓ Selesai 200x (${res.completed}/${res.total}) — rata-rata winrate & skor dihitung tanpa hang (chunked yield).</span>`;
                  if(outEl) outEl.innerHTML = `
                    <div style="background:#0a1a0a;border:1px solid #0f0;padding:8px;">
                      <div style="font-weight:bold;color:#0ff;margin-bottom:6px;">📊 HASIL RATA-RATA 200x — SKOR & WINRATE KONSISTEN (PLAYER-LEVEL EVENT SIM)</div>
                      <div style="overflow-x:auto;"><table class="result-table" style="font-size:0.65rem;"><thead><tr><th>B#</th><th>MATCH</th><th>SKOR PALING SERING</th><th>RATA-RATA (200x)</th><th>KONSISTEN MENANG</th><th>TOP SCORER KONSISTEN (200x)</th></tr></thead><tbody>${rowsHtml}</tbody></table></div>
                      <div style="font-size:0.55rem;color:#888;margin-top:4px;">Skor paling sering = mode 200x (event-level: chance → pemain → shot → goal). Rata-rata = avg home:away 200x. Menang konsisten = winner dengan winrate tertinggi 200x. Kalibrasi skala dari data observasi, bukan angka manual.</div>
                    </div>
                    <div style="background:#111;border:1px solid #ff0;padding:8px;margin-top:8px;">
                      <div style="font-weight:bold;color:#ff0;margin-bottom:6px;">⚽ GLOBAL TOP GOALS KONSISTEN 200x — KENAPA PEMAIN INI NAIK? (MODEL PEMAIN, BUKAN DUMMY)</div>
                      <div style="overflow-x:auto;"><table class="result-table" style="font-size:0.65rem;"><thead><tr><th>#</th><th>FLAG</th><th>PEMAIN / NEGARA + ALASAN</th><th>KONSISTENSI 200x</th></tr></thead><tbody>${globalHtml}</tbody></table></div>
                      <div style="background:#001a00;border:1px solid #0f0;padding:6px;margin-top:6px;font-size:0.6rem;line-height:1.35;">
                        <strong style="color:#0f0;">Kenapa bisa masuk top goals?</strong> ${res.bulkRngProof.whyFrequent}<br>
                        <strong style="color:#0ff;">Kenapa naik?</strong> Role posisi (CF/ST tertinggi, OMF menengah, DF sangat rendah) × atribut (finishing/positioning/technique) × form historis (shrinkage) menentukan peluang tiap pemain dipilih pada setiap chance. Tidak ada daftar bintang manual dan tidak ada nama dummy.<br>
                        <strong style="color:#ff0;">Kenapa dapat skor segitu?</strong> Skor = hasil event: setiap chance dipilih pemainnya, lalu tembakannya diuji terhadap defense lawan. Jumlah gol adalah konsekuensi, bukan target yang dibagi-bagi ke nama.<br>
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
                      UIRenderer.renderMatchGrid(); persistState(StateManager.activeMemoryId !== null);
                      const b=document.getElementById("btnApplyAvgScores"); if(b){b.textContent="✓ APPLIED"; b.disabled=true;}
                    });
                    document.getElementById("btnApplyConsistentScorers")?.addEventListener("click", ()=>{
                      const isEditor = StateManager.activeMemoryId !== null;
                       const ds = isEditor ? StateManager.db.memories[StateManager.activeMemoryId]?.games?.[StateManager.activeGameIndex] : StateManager.homeQuery;
                       const targetGoals = isEditor ? ds?.topGoals : StateManager.homeQuery.topGoals;
                       if (Array.isArray(targetGoals)) {
                         for (let i = 0; i < 16; i++) {
                           if (!targetGoals[i]) targetGoals[i] = { country: "", player: "", goals: "" };
                           targetGoals[i].country = "";
                           targetGoals[i].player = "";
                           targetGoals[i].goals = "";
                         }
                       }
                       res.globalRank.slice(0,16).forEach((pl, gi)=>{
                         const observedAvg = pl.totalGoals / Math.max(1, pl.hits);
                         const actualGol = String(Math.round(observedAvg));
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
                      UIRenderer.renderMatchGrid(); persistState(StateManager.activeMemoryId !== null);
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
                persistState(isEditor);
                return filledScores;
              };
              const doFillGoals = () => {
                const targetGoals = isEditor
                  ? dataSource.topGoals
                  : StateManager.homeQuery.topGoals;
                if (Array.isArray(targetGoals)) {
                  for (let i = 0; i < 16; i++) {
                    if (!targetGoals[i]) targetGoals[i] = { country: "", player: "", goals: "" };
                    targetGoals[i].country = "";
                    targetGoals[i].player = "";
                    targetGoals[i].goals = "";
                  }
                }
                const globalMap = new Map();
                validPreds.forEach(p => {
                  (p.prediction.topScorers || []).forEach(pl => {
                    const actual = pl.matchGoals != null ? pl.matchGoals : 0;
                    if (actual <= 0) return;
                    const key = `${pl.teamCode}:${pl.playerIndex ?? "?"}|${pl.name}`;
                    const ex = globalMap.get(key);
                    if (ex) { ex.totalActual += actual; ex.totalXG += pl.expectedGoals; ex.appearances += 1; ex.maxProb = Math.max(ex.maxProb, pl.prob); ex.reason = pl.reason || ex.reason; }
                    else globalMap.set(key, { name: pl.name, teamCode: pl.teamCode, teamName: pl.teamName, flag: pl.flag, pos: pl.pos, totalActual: actual, totalXG: pl.expectedGoals, appearances: 1, maxProb: pl.prob, reason: pl.reason || "" });
                  });
                });
                 const globalRank = [...globalMap.values()].sort((a,b)=> (b.totalActual - a.totalActual) || (b.totalXG - a.totalXG) || (b.maxProb - a.maxProb)).slice(0,16);
                let filledGoals=0;
                globalRank.forEach((pl, gi) => {
                   const golInt = String(pl.totalActual);
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
                persistState(isEditor);
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

  // === DRAFT PICK — BAN (NO) / BANDAR / YES + REKOMENDASI ADAPTIF (1-3) ===
  try{
    const { DraftService } = await import("./services/draftRecommender.js");
    const { setupPlayerAutocomplete } = await import("./ui/autocomplete.js").catch(()=>({setupPlayerAutocomplete:null}));
    // try player autocomplete import alternative path
    let setupPlayerAC = null;
    try{ const mod = await import("./ui/autocomplete.js"); setupPlayerAC = mod.setupCountryAutocomplete ? null : null; }catch(_){}
    // actually player autocomplete is from playerAutocomplete.js
    let setupPlayerAutocompleteFn = null;
    try{ const m = await import("./ui/playerAutocomplete.js"); setupPlayerAutocompleteFn = m.setupPlayerAutocomplete; }catch(_){}

    const draftState = DraftService.load();
    const banInput = document.getElementById("draftBanInput");
    const bandarInput = document.getElementById("draftBandarInput");
    const banListEl = document.getElementById("draftBanList");
    const bandarListEl = document.getElementById("draftBandarList");
    const recommendOut = document.getElementById("draftRecommendOutput");

    function renderDraftLists(){
      const st = DraftService.load();
      if(banListEl){
        banListEl.innerHTML = st.bans.length ? st.bans.map((name,i)=> `<span style="background:#330000;border:1px solid #f55;color:#ffaaaa;padding:3px 6px;font-size:0.65rem;display:inline-flex;align-items:center;gap:4px;">🚫 ${Security.escapeHtml(name)} <button data-idx="${i}" class="btnDraftRmBan" style="background:#500;border:1px solid #f55;color:#fff;padding:0 4px;font-size:0.6rem;cursor:pointer;">x</button></span>`).join("") : `<span style="font-size:0.6rem;color:#666;">Belum ada BAN — max 3</span>`;
        banListEl.querySelectorAll(".btnDraftRmBan").forEach(btn=>{
          btn.addEventListener("click", ()=>{
            const idx = parseInt(btn.dataset.idx,10);
            const cur = DraftService.load();
            cur.bans.splice(idx,1);
            DraftService.save(cur);
            renderDraftLists();
          });
        });
      }
      if(bandarListEl){
        bandarListEl.innerHTML = st.bandar.length ? st.bandar.map((name,i)=> `<span style="background:#002a00;border:1px solid #0f0;color:#aff;padding:3px 6px;font-size:0.65rem;display:inline-flex;align-items:center;gap:4px;">🎯 ${Security.escapeHtml(name)} <button data-idx="${i}" class="btnDraftRmBandar" style="background:#040;border:1px solid #0f0;color:#fff;padding:0 4px;font-size:0.6rem;cursor:pointer;">x</button></span>`).join("") : `<span style="font-size:0.6rem;color:#666;">Belum ada BANDAR — cuma 1</span>`;
        bandarListEl.querySelectorAll(".btnDraftRmBandar").forEach(btn=>{
          btn.addEventListener("click", ()=>{
            const idx = parseInt(btn.dataset.idx,10);
            const cur = DraftService.load();
            cur.bandar.splice(idx,1);
            DraftService.save(cur);
            renderDraftLists();
          });
        });
      }
    }
    renderDraftLists();
    // Reset form global → tag BAN/YES harus ikut hilang (re-render dari storage kosong)
    document.addEventListener("we10:draftReset", ()=>{ renderDraftLists(); });

    function getActiveMatchesForDraft(){
      const isEd = StateManager.activeMemoryId !== null;
      const mem = isEd ? StateManager.db.memories[StateManager.activeMemoryId] : null;
      const ds = isEd && mem?.games?.[StateManager.activeGameIndex] ? mem.games[StateManager.activeGameIndex] : StateManager.homeQuery;
      return (ds?.matches || []).slice(0,8);
    }
    // Autocomplete draft HANYA dari B1-B8 pool (bukan 57 dummy) — searchDraftPlayers — MOBILE FIX
    async function attachDraftAutocomplete(){
      const { searchDraftPlayers } = await import("./services/draftRecommender.js");
      const attach = (inputEl, btnId)=>{
        if(!inputEl) return;
        const wrap = inputEl.parentElement;
        const box = wrap?.querySelector(".suggestions-box");
        if(!box) return;
        let isBoxClicked = false;
        // Prevent blur-hidden when tapping suggestion on mobile (touchstart/mousedown)
        box.addEventListener("mousedown", (e)=>{ isBoxClicked = true; e.preventDefault(); });
        box.addEventListener("touchstart", (e)=>{ isBoxClicked = true; /* don't preventDefault to allow tap */ }, {passive: true});
        const show = ()=>{
          const q = (inputEl.value||"").trim();
          const matches = getActiveMatchesForDraft();
          if(DraftService.isB18Empty(matches)){
            box.innerHTML = `<div style="padding:10px;color:#ff0;font-size:0.68rem;">Isi B1-B8 dulu — pool kosong</div>`;
            box.classList.remove("hidden");
            return;
          }
          if(!q){ box.classList.add("hidden"); box.innerHTML=""; return; }
          const results = searchDraftPlayers(q, matches);
          if(!results.length){ box.innerHTML=`<div style="padding:10px;color:#888;font-size:0.68rem;">Tidak ada dari B1-B8 untuk "${Security.escapeHtml(q)}"</div>`; box.classList.remove("hidden"); return; }
          box.innerHTML="";
          results.forEach(p=>{
            const div=document.createElement("div");
            div.className="suggestion-line";
            // larger tap target for mobile
            div.style.cssText = "padding:12px 10px;min-height:44px;display:flex;align-items:center;";
            div.textContent=`${p.flag} ${p.name} [${p.pos}] • ${p.teamName}`;
            const pick = ()=>{
              inputEl.value=p.name;
              box.classList.add("hidden");
              box.innerHTML="";
              // focus back to input then trigger add
              try{ inputEl.focus(); }catch(_){}
              document.getElementById(btnId)?.click();
            };
            div.addEventListener("click", (e)=>{ e.stopPropagation(); pick(); });
            div.addEventListener("touchend", (e)=>{ e.stopPropagation(); e.preventDefault(); pick(); }, {passive:false});
            box.appendChild(div);
          });
          box.classList.remove("hidden");
        };
        const hideSoon=()=> setTimeout(()=>{
          if(isBoxClicked){ isBoxClicked = false; return; }
          box.classList.add("hidden");
        },220);
        // Make input truly focusable on mobile: ensure touch doesn't steal focus
        inputEl.setAttribute("inputmode","search");
        inputEl.style.fontSize = "16px";
        inputEl.addEventListener("input", show);
        inputEl.addEventListener("focus", show);
        // Click/touch on input also shows
        inputEl.addEventListener("click", show);
        inputEl.addEventListener("touchstart", ()=>{ setTimeout(show, 50); }, {passive:true});
        inputEl.addEventListener("blur", hideSoon);
        inputEl.addEventListener("keydown", (e)=>{
          if(e.key==="Enter"){ e.preventDefault(); document.getElementById(btnId)?.click(); box.classList.add("hidden");}
          if(e.key==="Escape"){ box.classList.add("hidden"); }
        });
        // Click outside to hide
        document.addEventListener("click", (e)=>{
          if(!wrap.contains(e.target) && !box.contains(e.target)) box.classList.add("hidden");
        });
      };
      attach(banInput, "btnDraftAddBan");
      attach(bandarInput, "btnDraftAddBandar");
    }
    attachDraftAutocomplete().catch(()=>{});

    document.getElementById("btnDraftAddBan")?.addEventListener("click", ()=>{
      const v = (banInput?.value || "").trim();
      if(!v) return;
      const cur = DraftService.load();
      const matches = getActiveMatchesForDraft();
      const r = DraftService.addBan(cur.bans, v, matches);
      if(!r.ok){ if(recommendOut) recommendOut.innerHTML = `<div style="color:#f55;">⛔ ${Security.escapeHtml(r.msg)}</div>`; return; }
      DraftService.save(cur);
      if(banInput) banInput.value = "";
      renderDraftLists();
      if(recommendOut) recommendOut.innerHTML = `<div style="color:#0f0;">✓ BAN: ${Security.escapeHtml(r.resolved)} (dari B1-B8)</div>`;
    });
    document.getElementById("btnDraftAddBandar")?.addEventListener("click", ()=>{
      const v = (bandarInput?.value || "").trim();
      if(!v) return;
      const cur = DraftService.load();
      const matches = getActiveMatchesForDraft();
      const r = DraftService.addBandar(cur.bandar, v, matches);
      if(!r.ok){ if(recommendOut) recommendOut.innerHTML = `<div style="color:#f55;">⛔ ${Security.escapeHtml(r.msg)}</div>`; return; }
      DraftService.save(cur);
      if(bandarInput) bandarInput.value = "";
      renderDraftLists();
      if(recommendOut) recommendOut.innerHTML = `<div style="color:#0f0;">✓ BANDAR: ${Security.escapeHtml(r.resolved)}</div>`;
    });
    document.getElementById("btnDraftRecommend")?.addEventListener("click", ()=>{
      const cur = DraftService.load();
      const matches = getActiveMatchesForDraft();
      const filled = matches.filter(m=> (m?.home||"").trim() || (m?.away||"").trim());
      if(filled.length===0){
        if(recommendOut) recommendOut.innerHTML = `<div style="color:#ff0;">⚠ Isi B1-B8 dulu — pool rekomendasi diambil dari negara di B1-B8 (${matches.length} baris kosong)</div>`;
        return;
      }
      const res = DraftService.recommend({ matches, bans: cur.bans, bandar: cur.bandar, yesExisting: Array.isArray(cur.yes) ? cur.yes : [] });
      if(!res.ok){
        if(recommendOut) recommendOut.innerHTML = `<div style="color:#f55;">⛔ ${Security.escapeHtml(res.msg)}</div>`;
        return;
      }
      const recHtml = res.recommended.map(p=> `
        <div style="background:#002a00;border:1px solid #0f0;padding:6px;display:flex;justify-content:space-between;align-items:center;">
          <div>
            <div style="font-weight:bold;color:#fff;">${p.flag||""} ${Security.escapeHtml(p.name)} <span style="color:#0ff;font-size:0.6rem;">[${Security.escapeHtml(p.pos)}]</span> <span style="background:#0f0;color:#000;padding:1px 4px;font-size:0.6rem;margin-left:4px;">REKOM #${p.rank}</span></div>
            <div style="font-size:0.6rem;color:#aaa;">${Security.escapeHtml(p.teamName)} (${p.teamCode}) • finishing ${p.finishing} • pick ${(p.selectionProbability*100).toFixed(1)}%</div>
            <div style="font-size:0.6rem;color:#ff0;margin-top:2px;">${Security.escapeHtml(p.why.join(" → "))}</div>
            <div style="font-size:0.55rem;color:#0ff;font-family:var(--font-mono);">📐 ${Security.escapeHtml(p.proof)}</div>
          </div>
          <span style="background:#002a00;border:1px solid #0f0;color:#0f0;padding:4px 8px;font-size:0.65rem;white-space:nowrap;">LAWAN BANDAR</span>
        </div>
      `).join("");
      const bandarInfo = cur.bandar.length ? `Bandar/YES: ${Security.escapeHtml(cur.bandar.join(", "))} → blok negara ${Security.escapeHtml((res.threat?.team ? [res.threat.team] : []).join(", ") || "-")} ` : "Tanpa bandar";
      const banInfo = cur.bans.length ? `BAN (NO): ${Security.escapeHtml(cur.bans.join(", "))}` : "Tanpa BAN";
      const duelInfo = res.threat
        ? `<div style="font-size:0.6rem;color:#0ff;margin-bottom:4px;">⚔️ DUEL: lawan ${Security.escapeHtml(res.threat.name)} (${Security.escapeHtml(res.threat.team||"?")}) — finishing ${res.threat.finishing} • index ${res.threat.scoringIndex} • ranking diurutkan dari yang MENGGULANGI statistik tersebut, bukan top generik.</div>`
        : "";
      const warnInfo = res.warning ? `<div style="font-size:0.6rem;color:#ff0;margin-bottom:4px;">⚠ ${Security.escapeHtml(res.warning)}</div>` : "";
      if(recommendOut) recommendOut.innerHTML = `
        <div style="font-weight:bold;color:#0f0;margin-bottom:6px;">🤖 REKOMENDASI ADAPTIF ${res.recommended.length} PEMAIN — dari pool ${res.poolSize} pemain (B1-B8 ${filled.length} match)</div>
        ${duelInfo}
        ${warnInfo}
        <div style="font-size:0.6rem;color:#888;margin-bottom:6px;">${banInfo} | ${bandarInfo} | Pool hanya dari tim di B1-B8, bukan dummy. Adaptif: gap besar → 1, kompetitif → 2-3 (max 3).</div>
        <div style="display:flex;flex-direction:column;gap:6px;">${recHtml}</div>
        <div style="font-size:0.55rem;color:#555;margin-top:6px;">Pilih langsung di tempat (tidak perlu input KAMU di web). Rekomendasi ini beda negara bandar & lolos filter BAN — validasi otomatis.</div>
      `;
    });

    document.getElementById("btnDraftClear")?.addEventListener("click", ()=>{
      const cur = { bans:[], bandar:[], yes:[] };
      DraftService.save(cur);
      renderDraftLists();
      if(recommendOut) recommendOut.innerHTML = `Isi <strong>B1-B8</strong> dulu (B1-B8 = pool), tambah <strong>BAN (NO)</strong> & <strong>BANDAR</strong>, lalu klik <strong>REKOMENDASIKAN</strong> — system akan kasih 1-3 nama adaptif beserta alasan.`;
    });

    // Enter key support
    [banInput, bandarInput].forEach(el=>{
      if(!el) return;
      el.addEventListener("keydown", (e)=>{ if(e.key==="Enter"){ e.preventDefault(); const id = el.id==="draftBanInput"?"btnDraftAddBan":"btnDraftAddBandar"; document.getElementById(id)?.click(); }});
    });
  }catch(e){ console.warn("[draft] init error", e); }

  // === IMPORT MATCHES (Phase 6) ===
  const importTextarea = document.getElementById("importMatchesTextarea");
  const importErrorsEl = document.getElementById("importMatchesErrors");
  const importReplaceAll = document.getElementById("importReplaceAll");
  const btnImportMatches = document.getElementById("btnImportMatches");
  const btnClearImport = document.getElementById("btnClearImport");
  function canonicalCountry(name) {
    if (!name) return "";
    const code = normalizeCountry(String(name));
    return teamsDB[code]?.name || "";
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
    if (importErrorsEl && errors.length===0) importErrorsEl.innerHTML += `<br><span style="color:#0ff;">✓ B1-B${results.length} terisi — refresh aman (persistent).</span>`;
  });
  btnClearImport?.addEventListener("click", ()=>{
    if (importTextarea) importTextarea.value="";
    if (importErrorsEl) importErrorsEl.innerHTML="";
  });


});
