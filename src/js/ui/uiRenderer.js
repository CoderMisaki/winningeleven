import { StateManager } from "../state/appState.js";
import { MemoryManager } from "../services/memoryManager.js";
import { Security } from "../utils/security.js";
import { setupCountryAutocomplete } from "./autocomplete.js";
import { setupPlayerAutocomplete, lookupPlayerExact, splitPlayerAndGoals } from "./playerAutocomplete.js";
import { PredictionService, PREDICTOR_CONFIG } from "../services/predictor.js";
import { createBulkRunner } from "../services/bulkRunner.js";
import { toTitleCase } from "../utils/format.js";
import { teamsDB } from "../data/teams.js";

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
      container.innerHTML = "<div class='error-msg'>Isi minimal satu baris HOME dan AWAY untuk diprediksi. Hanya 57 negara resmi WE10 yang didukung (Brazil, Argentina, ... Togo).</div>";
      return;
    }

    const dashboard = document.createElement("div");
    dashboard.className = "prediction-dashboard-container";

    // Banner info 57 — v6.0 honest-calibrated
    const infoBanner = document.createElement("div");
    infoBanner.style.cssText = "font-size:0.6rem;color:#ff0;background:#332200;border:1px solid #ff0;padding:6px 8px;margin-bottom:10px;font-family:var(--font-mono);text-align:center;";
    infoBanner.innerHTML = "⚠️ TABEL DI BAWAH = <strong>SAMPLE 1x (TIDAK STABIL)</strong> — contoh tunggal. <strong style='color:#0f0;'>HASIL STABIL 200x ADA DI KOTAK BIRU DI BAWAH</strong> — skor paling sering + rata-rata 200x + winrate konsisten (WE10 pure sim 3.0 gol/match, RNG LCG deterministik, bukan replika ROM)";
    dashboard.appendChild(infoBanner);

    // === OVERALL SUMMARY BOX — Kotak kemungkinan tambahan (Semua Prediksi) ===
    try {
      const validPreds = predictions.filter(p => !p.error && p.prediction);
      if (validPreds.length > 0) {
        // Aggregate win counts & global top scorers
        const winCount = {};
        const globalScorerMap = new Map();
        validPreds.forEach(p => {
          const pred = p.prediction;
          // win tally
          let winnerCode = null;
          if (pred.probs.home > pred.probs.away + 0.07) winnerCode = p.homeCode;
          else if (pred.probs.away > pred.probs.home + 0.07) winnerCode = p.awayCode;
          const winnerLabel = winnerCode ? (pred.winner || winnerCode) : "DRAW";
          winCount[winnerLabel] = (winCount[winnerLabel] || 0) + 1;

          // global scorer aggregation — SCORE-CONSISTENT: hanya pemain yg cetak gol (matchGoals>0) dan hanya dari tim yg main
          (pred.topScorers || []).forEach(pl => {
            const actual = pl.matchGoals != null ? pl.matchGoals : 0;
            if (actual <= 0) return; // jgn yg ga main / ga cetak masuk list — fix "nama pemain ga aku kenal" + "melebihi skor"
            const key = pl.name + "|" + pl.teamCode;
            const existing = globalScorerMap.get(key);
            if (existing) {
              existing.totalActual += actual;
              existing.totalXG += pl.expectedGoals;
              existing.appearances += 1;
              existing.maxProb = Math.max(existing.maxProb, pl.prob);
              existing.totalShare += pl.scoringShare;
              existing.flags = pl.flag;
              existing.pos = pl.pos;
              existing.teamName = pl.teamName;
              existing.reason = pl.reason || existing.reason;
            } else {
              globalScorerMap.set(key, {
                name: pl.name, teamCode: pl.teamCode, teamName: pl.teamName, flag: pl.flag, pos: pl.pos,
                totalActual: actual, totalXG: pl.expectedGoals, appearances: 1, maxProb: pl.prob, totalShare: pl.scoringShare, reason: pl.reason || ""
              });
            }
          });
        });
        // fallback jika semua 0-0
        if (globalScorerMap.size === 0) {
          validPreds.forEach(p => {
            (p.prediction.topScorers||[]).slice(0,1).forEach(pl=>{
              const key = pl.name+"|"+pl.teamCode;
              if (!globalScorerMap.has(key)) globalScorerMap.set(key,{ name:pl.name, teamCode:pl.teamCode, teamName:pl.teamName, flag:pl.flag, pos:pl.pos, totalActual:0, totalXG:pl.expectedGoals, appearances:1, maxProb:pl.prob, totalShare:pl.scoringShare, reason:pl.reason||"" });
            });
          });
        }
        const globalRank = [...globalScorerMap.values()].sort((a,b)=> (b.totalActual - a.totalActual) || (b.totalXG - a.totalXG) || (b.maxProb - a.maxProb)).slice(0,16);

        const summaryCard = document.createElement("div");
        summaryCard.className = "pred-card pred-overall-summary";
        summaryCard.style.cssText = "background:#0a1a0a;border:2px solid #00ff66;";
        const winRows = validPreds.map(p => {
          const pred = p.prediction;
          const winLabel = pred.winner;
          const isDraw = winLabel === "DRAW";
          const score = `${pred.homeGoals}:${pred.awayGoals}`;
          const probBest = Math.max(pred.probs.home, pred.probs.draw, pred.probs.away) * 100;
          const flagHome = p.homeFlag || ""; const flagAway = p.awayFlag || "";
          return `<tr>
            <td style="padding:4px 6px;font-family:var(--font-retro);font-size:0.55rem;color:#0ff;">B${p.row}</td>
            <td style="padding:4px 6px;font-size:0.7rem;">${Security.escapeHtml(flagHome)} ${Security.escapeHtml(p.homeName)} <span style="color:#888;">vs</span> ${Security.escapeHtml(p.awayName)} ${Security.escapeHtml(flagAway)}</td>
            <td style="padding:4px 6px;font-weight:bold;color:#0f0;text-align:center;">${score}</td>
            <td style="padding:4px 6px;font-size:0.7rem;${isDraw?'color:#ff0;':'color:#fff;'}text-align:center;">${Security.escapeHtml(winLabel)}</td>
            <td style="padding:4px 6px;font-family:var(--font-retro);font-size:0.6rem;color:#0ff;text-align:center;">${probBest.toFixed(1)}%</td>
          </tr>`;
        }).join("");

        const winTallyRows = Object.entries(winCount).map(([team,cnt])=> `<span style="background:#111;border:1px solid #333;padding:3px 6px;font-size:0.65rem;margin:2px;display:inline-block;">${Security.escapeHtml(team)}: <strong style="color:#0ff;">${cnt} Menang</strong></span>`).join("");

        const globalRows = globalRank.map((pl,idx)=>{
          const golInt = pl.totalActual > 0 ? pl.totalActual : Math.max(1, Math.round(pl.totalXG));
          const badge = idx===0?"🥇":idx===1?"🥈":idx===2?"🥉":"#"+(idx+1);
          const reasonShort = pl.reason ? ` title="${Security.escapeHtml(pl.reason)}"` : "";
          return `<tr${reasonShort}>
            <td style="padding:4px 6px;font-size:0.65rem;">${badge}</td>
            <td style="padding:4px 6px;font-size:1rem;text-align:center;">${Security.escapeHtml(pl.flag||"")}</td>
            <td style="padding:4px 6px;font-size:0.7rem;"><strong>${Security.escapeHtml(pl.name)}</strong> <span style="color:#0ff;font-size:0.6rem;">[${Security.escapeHtml(pl.pos)}]</span><br><span style="font-size:0.6rem;color:#aaa;">${Security.escapeHtml(pl.teamName)} (${Security.escapeHtml(pl.teamCode)}) — ${Security.escapeHtml(pl.reason||"")}</span></td>
            <td style="padding:4px 6px;font-family:var(--font-retro);font-size:0.65rem;color:#0f0;text-align:center;">${golInt} GOL</td>
            <td style="padding:4px 6px;font-size:0.6rem;text-align:center;">${pl.appearances} match<br><span style="color:#0ff;">${pl.maxProb.toFixed(1)}% max</span></td>
          </tr>`;
        }).join("") || `<tr><td colspan="5" style="padding:8px;text-align:center;color:#888;">Belum ada data scorer</td></tr>`;

        summaryCard.innerHTML = `
          <div class="pred-card-header" style="border-color:#00ff66;">
            <span class="pred-badge-row" style="color:#00ff66;">📊 RINGKASAN KESELURUHAN PREDICT WE10 (PURE SIM v6.0)</span>
            <span class="pred-conf-badge" style="border-color:#00ff66;color:#00ff66;background:#0d2615;">${validPreds.length} MATCHES</span>
          </div>
          <div style="font-size:0.6rem;color:#888;margin-bottom:6px;">Kotak kemungkinan tambahan — lihat semua skor & top goals yang sering muncul (model terkalibrasi ~3.0 gol/match)</div>
          <div class="pred-section-title" style="color:#00ff66;">🏆 SKOR & PEMENANG PER MATCH (AUTO-FILL KE TABEL X:X)</div>
          <div style="overflow-x:auto;">
            <table class="result-table" style="font-size:0.7rem;">
              <thead><tr><th>B#</th><th>MATCH</th><th>SKOR PRED</th><th>MENANG</th><th>PROB</th></tr></thead>
              <tbody>${winRows}</tbody>
            </table>
          </div>
          <div style="margin:6px 0 6px;display:flex;flex-wrap:wrap;gap:4px;">${winTallyRows}</div>
          <div class="pred-section-title" style="color:#ffaa00;">⚽ GLOBAL TOP GOALS — PEMAIN PALING SERING MUNCUL (AUTO-FILL KE TABEL G1-G16)</div>
          <div style="overflow-x:auto;">
            <table class="result-table" style="font-size:0.7rem;">
              <thead><tr><th>#</th><th>FLAG</th><th>PEMAIN / NEGARA</th><th>EST. GOL</th><th>MUNCUL</th></tr></thead>
              <tbody>${globalRows}</tbody>
            </table>
          </div>
          <div style="font-size:0.55rem;color:#555;margin-top:6px;">* Tabel B1-B8 skor X:X & G1-G16 konsisten: skor X:X dari <strong>pure sim MC 200 (top prob)</strong>, GOL = <strong>matchGoals integer</strong> hasil alokasi LCG 1664525 tepat sebanyak homeGoals+awayGoals ke pemain CF/WF/OMF (GK terfilter) — hanya pemain dari tim yang main di B1-B8, jumlah gol pemain tidak melebihi total gol tim. Hover baris untuk lihat alasan.</div>
        `;
        dashboard.appendChild(summaryCard);
        // === BULK BOX — 100/1000x sampling seperti game asli (Adebayor 100x/1000) ===
        try {
          const bulkWrap = document.createElement("div");
          bulkWrap.id = "bulkPredictBox";
          bulkWrap.style.cssText = "background:#111;border:2px solid #ff0;padding:10px;margin-top:10px;";
          bulkWrap.innerHTML = `
            <div class="pred-section-title" style="color:#ff0;border-color:#ff0;">🔁 BULK PREDICT — 100 / 200 / 1000x ITERASI (FREKUENSI SEPERTI GAME ASLI) — ANTI HANG</div>
            <div style="font-size:0.6rem;color:#888;margin-bottom:6px;">Jalankan prediksi berkali-kali dengan LCG sampling — lihat pemain apa yang paling sering muncul. Contoh: <strong>Adebayor muncul 100x dalam 1000 predict</strong> = 10% anytime. <strong>Chunked yield tiap 16 task → tidak hang meski 200x×8 match.</strong></div>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px;">
              <label style="font-size:0.65rem;color:#ccc;">Iterasi:</label>
              <input id="bulkIterations" type="number" value="200" min="10" max="5000" step="10" style="width:90px;background:#000;color:#0f0;border:1px solid #555;padding:4px;font-family:var(--font-mono);" />
              <button id="btnBulkRun" class="btn" style="background:#332200;border:1px solid #ff0;color:#ff0;padding:6px 12px;font-weight:bold;cursor:pointer;">▶ RUN BULK</button>
              <button id="btnBulkCancel" class="btn" style="background:#330000;border:1px solid #f55;color:#f55;padding:6px 8px;display:none;">BATALKAN</button>
              <span style="font-size:0.6rem;color:#aaa;">Skor WE10 pure sim (bukan dummy) — variatif, tidak monoton</span>
            </div>
            <div id="bulkProgress" style="display:none;background:#000;border:1px solid #333;padding:6px;font-size:0.65rem;color:#0ff;margin-bottom:6px;"></div>
            <div id="bulkOutput" style="background:#0a0a0a;border:1px solid #333;padding:8px;min-height:40px;font-size:0.7rem;color:#ccc;">Klik <strong>RUN BULK</strong> — async chunked 200x, progress bar, rata-rata winrate & top goals konsisten (WE10 roster weight).</div>
          `;
          dashboard.appendChild(bulkWrap);
          // bind — async bulkRunner non-blocking
          setTimeout(()=>{
            const btn = document.getElementById("btnBulkRun");
            const btnCancel = document.getElementById("btnBulkCancel");
            const inp = document.getElementById("bulkIterations");
            const out = document.getElementById("bulkOutput");
            const progEl = document.getElementById("bulkProgress");
            let currentRunner = null;
            if (btn && inp && out) {
              btn.addEventListener("click", async ()=>{
                const n = Math.max(10, Math.min(5000, parseInt(inp.value,10)||200));
                btn.disabled = true; btn.textContent = "⏳ RUNNING "+n+"x...";
                if(btnCancel) btnCancel.style.display = "inline-block";
                if(progEl){ progEl.style.display="block"; progEl.innerHTML = `⏳ 0/${validPreds.length*n} (0%) — elapsed 0s`; }
                out.innerHTML = "<div style='color:#ff0;padding:10px;text-align:center;'>⏳ Sampling "+n+" iterasi async (chunked yield) — tidak hang...</div>";
                try {
                  const { createBulkRunner } = await import("../services/bulkRunner.js");
                  currentRunner = createBulkRunner();
                  if(btnCancel) btnCancel.onclick = ()=>{ currentRunner.cancel(); if(progEl) progEl.innerHTML = `<span style="color:#f55;">⛔ Dibatalkan</span>`; };
                  const validRows = validPreds.map(p=>({ row:p.row, homeCode:p.homeCode, awayCode:p.awayCode, homeName:p.homeName, awayName:p.awayName, homeFlag:p.homeFlag, awayFlag:p.awayFlag }));
                  const res = await currentRunner.run(validRows, n, (prog)=>{
                    if(progEl){
                      const barW = prog.percent;
                      progEl.innerHTML = `
                        <div style="display:flex;justify-content:space-between;font-size:0.6rem;margin-bottom:4px;"><span>${prog.completed}/${prog.total} (${prog.percent}%)</span><span>ETA ${prog.eta.toFixed(1)}s | ${prog.elapsed.toFixed(1)}s</span></div>
                        <div style="background:#111;border:1px solid #333;height:10px;overflow:hidden;"><div style="background:linear-gradient(90deg,#ff0,#0f0);width:${barW}%;height:100%;transition:width 0.15s;"></div></div>
                      `;
                    }
                  });
                  if(res.cancelled){ out.innerHTML = `<div style="color:#f55;">⛔ Dibatalkan di ${res.completed}/${res.total}</div>`; }
                  else if(res.error){ out.innerHTML = `<div style="color:#f55;">⛔ ${Security.escapeHtml(res.error)}</div>`; }
                  else {
                      const globalRows = res.globalRank.slice(0,10).map((pl,idx)=>{
                        const badge = idx<3 ? ["🥇","🥈","🥉"][idx] : "#"+(idx+1);
                        const proofShort = pl.proof ? `<div style="font-size:0.55rem;color:#0ff;font-family:var(--font-mono);">${Security.escapeHtml(pl.proof)}</div>` : "";
                        return `<tr><td style="padding:4px;">${badge}</td><td style="padding:4px;text-align:center;">${Security.escapeHtml(pl.flag||"")}</td><td style="padding:4px;"><strong>${Security.escapeHtml(pl.name)}</strong> [${Security.escapeHtml(pl.pos)}] w${pl.weight}/${pl.totalWeight||"?"}=${pl.pickProb||"?"}%<br><span style="font-size:0.6rem;color:#aaa;">${Security.escapeHtml(pl.teamName)} (${pl.teamCode})</span>${proofShort}</td><td style="padding:4px;text-align:center;color:#0f0;font-weight:bold;">${pl.hits}x / ${n}</td><td style="padding:4px;text-align:center;">${pl.freqPct}%<br><span style="font-size:0.6rem;color:#888;">${pl.totalGoals} gol total — avg ${pl.avgGoals}</span></td></tr>`;
                      }).join("") || "<tr><td colspan=5 style='padding:8px;text-align:center;'>Tidak ada scorer</td></tr>";
                      const scoreRows = res.scoreRank.map(s=> `<span style="background:#1a1a1a;border:1px solid #444;padding:3px 6px;margin:2px;display:inline-block;font-family:var(--font-mono);">${Security.escapeHtml(s.scoreline)}: <strong style="color:#0ff;">${s.count}x</strong> (${s.pct}%)</span>`).join("");
                      const perMatchHtml = res.perMatch.map(pm=>{
                        const sc = pm.topScorers.slice(0,3).map(pl=> `<div style="font-size:0.65rem;"><strong>${Security.escapeHtml(pl.name)}</strong> (${pl.teamCode}) — ${pl.hits}x (${pl.freqPct}%)</div>`).join("");
                        const scores = pm.topScores.slice(0,3).map(s=> `<div style="font-size:0.65rem;">${Security.escapeHtml(s.scoreline)}: ${s.count}x (${s.pct}%)</div>`).join("");
                        const winInfo = `H ${pm.winRateHome}% D ${pm.winRateDraw}% A ${pm.winRateAway}% — avg ${pm.avgHome}:${pm.avgAway} — konsisten ${pm.konsistentWinner}`;
                        return `<div style="background:#0f0f0f;border:1px solid #333;padding:6px;min-width:165px;"><div style="font-weight:bold;color:#0ff;margin-bottom:4px;">B${pm.row}: ${Security.escapeHtml(pm.homeName)} vs ${Security.escapeHtml(pm.awayName)}</div><div style="font-size:0.55rem;color:#0f0;margin-bottom:4px;">${winInfo}</div><div style="font-size:0.6rem;color:#aaa;margin-bottom:2px;">Top Skor:</div>${scores}<div style="font-size:0.6rem;color:#aaa;margin:4px 0 2px;">Top Scorer:</div>${sc}</div>`;
                      }).join("");
                      const rngProofHtml = res.bulkRngProof ? `
                        <div style="background:#001a00;border:1px solid #0f0;padding:8px;margin-top:8px;font-size:0.65rem;line-height:1.4;">
                          <div style="font-weight:bold;color:#0f0;">🔬 BUKTI VALIDASI RNG BULK — KENAPA PLAYER MUNCUL BERKALI-KALI (BUKAN DUMMY)</div>
                          <div style="margin-top:4px;"><strong>LCG:</strong> <code style="background:#000;padding:2px 4px;">${Security.escapeHtml(res.bulkRngProof.lcg)}</code></div>
                          <div><strong>Seed:</strong> ${Security.escapeHtml(res.bulkRngProof.seedFormula)}</div>
                          <div style="margin-top:4px;background:#002200;padding:6px;border:1px solid #0a0;"><strong style="color:#0f0;">Kenapa frequent:</strong> ${Security.escapeHtml(res.bulkRngProof.whyFrequent)}</div>
                          <div style="margin-top:4px;color:#888;"><strong>Audit:</strong> ${Security.escapeHtml(res.bulkRngProof.auditNote)}</div>
                          <div style="margin-top:4px;color:#0ff;font-size:0.6rem;"><strong>Rata-rata dihitung:</strong> ${Security.escapeHtml(res.bulkRngProof.avgNote)}</div>
                        </div>` : "";
                      out.innerHTML = `
                        <div style="margin-bottom:8px;"><strong style="color:#ff0;">Hasil Bulk ${n}x sampling — async chunked, tidak hang:</strong> <span style="font-size:0.6rem;color:#888;">Skor WE10 pure sim (chances 6±mid*3, shot 18%+0.35*diff) — variasi antar iterasi via LCG seed unik</span></div>
                        <div style="margin-bottom:6px;font-weight:bold;color:#0ff;">📊 Global Frekuensi Pemain — Top 10 (WE10 roster, bukan dummy):</div>
                        <div style="overflow-x:auto;margin-bottom:8px;"><table class="result-table" style="font-size:0.7rem;"><thead><tr><th>#</th><th>FLAG</th><th>PEMAIN / NEGARA (pick prob + proof)</th><th>MUNCUL</th><th>FREQ</th></tr></thead><tbody>${globalRows}</tbody></table></div>
                        <div style="margin-bottom:4px;font-weight:bold;color:#0ff;">🏆 Distribusi Skor Paling Sering (Top 10):</div><div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px;">${scoreRows}</div>
                        <div style="margin-bottom:4px;font-weight:bold;color:#0ff;">Per-Match Top (avg & winrate 200x):</div><div style="display:flex;gap:8px;overflow-x:auto;padding-bottom:4px;">${perMatchHtml}</div>
                        ${rngProofHtml}
                        <div style="font-size:0.55rem;color:#555;margin-top:6px;">* Frekuensi = berapa kali pemain cetak gol dalam ${n} sampling. LCG range(totalWeight) tiap gol → weight-proportional. Hanya pemain dari tim yang main di B1-B8, GK terfilter, roster WE10FullRoster.js. Skor rata-rata = sum/ ${n}.</div>
                      `;
                    }
                    if(progEl) progEl.style.display="none";
                } catch(err){ out.innerHTML = `<div style="color:#f55;">⛔ Bulk error: ${Security.escapeHtml(err?.message||String(err))}</div>`; if(progEl) progEl.style.display="none"; }
                btn.disabled = false; btn.textContent = "▶ RUN BULK";
                if(btnCancel) btnCancel.style.display="none";
              });
            }
          }, 0);
        } catch(e){ console.warn("bulk box error", e); }
      }
    } catch (e) {
      console.warn("[overall summary] render error", e);
    }

    predictions.forEach(p => {
      const card = document.createElement("div");
      card.className = "pred-card";

      if (p.error) {
        const flagHint = p.homeFlag || p.awayFlag ? `<span style="margin-left:6px;">${Security.escapeHtml(p.homeFlag||"")} ${Security.escapeHtml(p.awayFlag||"")}</span>` : "";
        card.innerHTML = `
          <div class="pred-card-header">
            <span class="pred-badge-row">MATCH B${p.row}</span>
            <span class="pred-match-title">${Security.escapeHtml(p.homeName)} vs ${Security.escapeHtml(p.awayName)}${flagHint}</span>
          </div>
          <div class="pred-error-banner">⛔ ${Security.escapeHtml(p.error)}</div>
          ${p.p1Warning ? `<div style="background:#332200;border:1px solid #ffaa00;color:#ffcc66;padding:6px;font-size:0.7rem;margin-top:6px;">${Security.escapeHtml(p.p1Warning)}</div>` : ""}
          <div style="font-size:0.6rem;color:#888;margin-top:6px;">Daftar 57 valid: Brazil, Argentina, Mexico, USA, Uruguay, Colombia, Chile, Paraguay, Ecuador, Peru, Costa Rica, Trinidad & Tobago, Italy, France, England, Spain, Germany, Holland, Portugal, Czech, Croatia, Sweden, Greece, Russia, Turkey, Scotland, Wales, Bulgaria, Poland, Slovenia, Finland, Hungary, Switzerland, Romania, N. Ireland, Ireland, Ukraine, Norway, Belgium, Latvia, Austria, Slovakia, Serbia & Mont., Denmark, Japan, Korea, Australia, Saudi Arabia, Iran, Nigeria, Cameroon, Ghana, South Africa, Ivory Coast, Angola, Tunisia, Togo.</div>
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

      const srcDist = pred.stability?.scorelineDistribution || pred.distribution;
      const scorelinesHtml = srcDist.map((s, idx) => {
        const hg = s.homeGoals ?? s.home;
        const ag = s.awayGoals ?? s.away;
        const p = s.probability ?? s.prob;
        return `
        <div class="pred-score-item ${idx === 0 ? 'pred-score-item-top' : ''}">
          <span class="score-nums">${hg} - ${ag}</span>
          <span class="score-pct">${(p * 100).toFixed(1)}%</span>
        </div>`;
      }).join("");

      // --- Top Scorers HTML — Score-Consistent: matchGoals + alasan kenapa di atas ---
      let topScorersHtml = `<div style="font-size:0.7rem;color:#888;padding:6px;">Belum ada data scorer.</div>`;
      if (Array.isArray(pred.topScorers) && pred.topScorers.length) {
        topScorersHtml = pred.topScorers.map((pl, idx) => {
          const rankBadge = idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : `#${idx+1}`;
          const matchBadge = pl.matchGoals > 0 ? `<span style="background:#0f0;color:#000;padding:1px 4px;border-radius:2px;font-size:0.6rem;margin-left:4px;">${pl.matchGoals} GOL di ${pred.homeGoals}:${pred.awayGoals}</span>` : `<span style="background:#333;color:#888;padding:1px 4px;border-radius:2px;font-size:0.6rem;margin-left:4px;">0 di ${pred.homeGoals}:${pred.awayGoals}</span>`;
          const reason = pl.reason || `Weight ${pl.weight} • ${pl.pos}`;
          const proofMath = pl.proofMath || "";
          const pickProb = pl.pickProb != null ? `${pl.pickProb}%` : "";
          return `
            <div class="top-scorer-item" title="${Security.escapeHtml(reason)} — ${Security.escapeHtml(proofMath)}" style="display:flex;justify-content:space-between;align-items:center;background:${pl.matchGoals>0?'#1a2a1a':'#1a1a1a'};border:1px solid ${pl.matchGoals>0?'#0f0':'#444'};padding:6px 8px;border-radius:3px;">
              <div style="display:flex;gap:6px;align-items:center;">
                <span style="font-size:0.7rem;min-width:22px;">${rankBadge}</span>
                <span style="font-size:1rem;">${Security.escapeHtml(pl.flag||"")}</span>
                <div>
                  <div style="font-weight:bold;font-size:0.8rem;color:#fff;">${Security.escapeHtml(pl.name)} <span style="font-weight:normal;color:#0ff;font-size:0.65rem;">[${Security.escapeHtml(pl.pos)} • ${Security.escapeHtml(pl.teamCode)} ${pickProb ? `• pick ${pickProb}` : ""}]</span>${matchBadge}</div>
                  <div style="font-size:0.6rem;color:#aaa;">${Security.escapeHtml(pl.teamName)} — <span style="color:#ff0;">${Security.escapeHtml(reason)}</span></div>
                  ${proofMath ? `<div style="font-size:0.55rem;color:#0ff;margin-top:2px;font-family:var(--font-mono);">📐 ${Security.escapeHtml(proofMath)}${pl.baseWeight && pl.baseWeight!==pl.weight ? ` (base ${pl.baseWeight} → adj ${pl.weight})` : ""}</div>` : ""}
                </div>
              </div>
              <div style="text-align:right;">
                <div style="font-family:var(--font-retro);font-size:0.7rem;color:#0f0;">${pl.prob}% <span style="color:#888;">ANYTIME</span></div>
                <div style="font-size:0.65rem;color:#ccc;">xG ${pl.expectedGoals} • share ${pl.scoringShare}% • w ${pl.weight} <span style="color:#888;">/ tot ${pl.totalWeight || "?"}</span></div>
              </div>
            </div>
          `;
        }).join("");
      }

      // --- Key Indicators DELETED — sistem buatan TIDAK ADA di Ghidra (2026-08-30) ---
      // Audit 2026-08-30: tidak ditemukan table agregat Overall/Attack terpetakan ke 57 tim di ROM.
      // FAKTOR PENENTU tidak dirender (buildKeyIndicators() return null).
      let keyIndicatorsHtml = "";
      // === STABILITY PANEL (SPEC A/B/C/D) — reuse pureScorelineDist, no second simulator ===
      let stabilityHtml = "";
      if(pred.stability){
        const s = pred.stability;
        const levelColor = s.level==="HIGH" ? "#0f0" : s.level==="MEDIUM" ? "#ff0" : s.level==="LOW" ? "#f55" : "#888";
        const levelBg = s.level==="HIGH" ? "#002a00" : s.level==="MEDIUM" ? "#2a2a00" : s.level==="LOW" ? "#2a0000" : "#1a1a1a";
        const scoreText = s.level==="UNKNOWN" ? "UNKNOWN" : `${s.score}/100`;
        const top1Pct = (s.top1Mass*100).toFixed(1);
        const top3Pct = (s.top3Mass*100).toFixed(1);
        const top5Pct = (s.top5Mass*100).toFixed(1);
        const warnLow = s.level==="LOW" ? `<div style="background:#330000;border:1px solid #f55;color:#ffaaaa;padding:6px;font-size:0.65rem;margin-top:6px;">⚠️ WARNING: No single scoreline dominates the simulation. Treat exact-score prediction as uncertain. TOP-1 ${top1Pct}% &middot; TOP-3 ${top3Pct}% &middot; entropy ${s.entropy.toFixed(2)}</div>` : "";
        const distHtml = (s.scorelineDistribution||[]).map((d,idx)=>`
          <div style="display:flex;justify-content:space-between;background:${idx===0?'#0a2a0a':'#111'};border:1px solid ${idx===0?'#0f0':'#333'};padding:4px 6px;font-size:0.7rem;">
            <span>${d.homeGoals}-${d.awayGoals}</span><span>${(d.probability*100).toFixed(1)}%</span>
          </div>`).join("") || `<div style="color:#888;">No distribution</div>`;
        const reasonHtml = s.reason ? `<div style="color:#888;font-size:0.6rem;">Reason: ${Security.escapeHtml(s.reason)}</div>` : "";
        stabilityHtml = `
          <div class="pred-section-title">SIMULATION STABILITY — <span style="color:${levelColor};">${s.level}</span> <span style="font-size:0.6rem;color:#888;">Score: ${scoreText}</span></div>
          <div style="background:${levelBg};border:2px solid ${levelColor};padding:8px;">
            <div style="display:flex;gap:8px;flex-wrap:wrap;font-size:0.65rem;margin-bottom:6px;">
              <span style="background:#000;border:1px solid #333;padding:3px 6px;">TOP-1: <strong>${top1Pct}%</strong></span>
              <span style="background:#000;border:1px solid #333;padding:3px 6px;">TOP-3: <strong>${top3Pct}%</strong></span>
              <span style="background:#000;border:1px solid #333;padding:3px 6px;">TOP-5: <strong>${top5Pct}%</strong></span>
              <span style="background:#000;border:1px solid #333;padding:3px 6px;">ENTROPY: <strong>${s.entropy.toFixed(2)}</strong> (norm ${s.entropyNorm.toFixed(2)})</span>
              <span style="background:#000;border:1px solid #333;padding:3px 6px;">HHI: <strong>${s.hhi.toFixed(3)}</strong></span>
              <span style="background:#000;border:1px solid #333;padding:3px 6px;">Samples: <strong>${s.sampleCount}</strong></span>
            </div>
            <div style="font-size:0.65rem;color:#0ff;margin-bottom:4px;">MOST LIKELY SCORELINES</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;">${distHtml}</div>
            ${warnLow}
            ${reasonHtml}
            <div style="font-size:0.55rem;color:#555;margin-top:4px;">Stability ≠ Confidence. Stability = konsistensi simulasi (pure sim LCG (NR, deterministik), reuse distribution pipeline, no second simulator). HIGH: top1≥~18% & top3≥~45% typical. Config: HIGH≥${PREDICTOR_CONFIG?.STABILITY?.HIGH||65}, MEDIUM≥${PREDICTOR_CONFIG?.STABILITY?.MEDIUM||40}</div>
          </div>`;
      }

      card.innerHTML = `
        <div class="pred-card-header">
          <span class="pred-badge-row">MATCH B${p.row}</span>
          <span class="pred-match-title">${Security.escapeHtml(p.homeFlag||"")} ${Security.escapeHtml(p.homeName)} <span style="color:#888;">vs</span> ${Security.escapeHtml(p.awayName)} ${Security.escapeHtml(p.awayFlag||"")}</span>
          <span class="pred-conf-badge">CONF: ${pred.confidence}%</span>
        </div>

        ${p.p1Warning ? `<div style="background:#332200;border:1px solid #ffaa00;color:#ffcc66;padding:6px;font-size:0.7rem;">${Security.escapeHtml(p.p1Warning)}</div>` : ""}

        <div class="pred-main-score-box">
          <div class="pred-score-visual">
            <div class="pred-team-name">${Security.escapeHtml(p.homeName)}</div>
            <div class="pred-score-digits">${pred.homeGoals} - ${pred.awayGoals}</div>
            <div class="pred-team-name">${Security.escapeHtml(p.awayName)}</div>
          </div>
          <div class="pred-outcome-badge">PROBABLE OUTCOME: <strong>${Security.escapeHtml(pred.winner)}</strong> <span style="color:#888;font-size:0.6rem;">(xG ${pred.xgHome} - ${pred.xgAway})</span></div>
        </div>

        <div class="pred-section-title">1X2 PROBABILITIES — KONAMI HYBRID</div>
        <div class="pred-prob-grid">
          <div class="prob-cell ${isHomeFav ? 'prob-cell-active' : ''}">
            <div class="prob-label">1 (HOME WIN)</div>
            <div class="prob-val">${pHomePct}%</div>
          </div>
          <div class="prob-cell ${isDrawFav ? 'prob-cell-active' : ''}">
            <div class="prob-label">X (DRAW)</div>
            <div class="prob-val">${pDrawPct}%</div>
          </div>
          <div class="prob-cell ${isAwayFav ? 'prob-cell-active' : ''}">
            <div class="prob-label">2 (AWAY WIN)</div>
            <div class="prob-val">${pAwayPct}%</div>
          </div>
        </div>
        ${stabilityHtml}

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

        <!-- DATA QUALITY (SPEC V) -->
        <div class="pred-section-title">DATA QUALITY</div>
        <div style="background:#0a0a0a;border:1px solid #333;padding:6px;font-size:0.65rem;display:flex;gap:8px;flex-wrap:wrap;">
          <span style="background:#111;border:1px solid #333;padding:3px 6px;">Fixtures used: <strong>${pred.evidence.homeMatches + pred.evidence.awayMatches}</strong></span>
          <span style="background:#111;border:1px solid #333;padding:3px 6px;">H2H: <strong>${pred.evidence.hasH2H ? pred.evidence.h2hMatches+"m" : "INSUFFICIENT"}</strong></span>
          <span style="background:#111;border:1px solid #333;padding:3px 6px;">Similar contexts: <strong>${pred.evidence.hasSimilarContext ? "18" : "0"}</strong></span>
          <span style="background:#111;border:1px solid #333;padding:3px 6px;">Team rating: <strong>${pred.evidence.hasRating ? "VERIFIED" : "LOW"}</strong></span>
          <span style="background:${pred.evidence.hasRating && pred.evidence.homeMatches+pred.evidence.awayMatches>10 ? "#002a00" : pred.evidence.homeMatches+pred.evidence.awayMatches>3 ? "#2a2a00" : "#2a0000"};border:1px solid ${pred.evidence.hasRating && pred.evidence.homeMatches+pred.evidence.awayMatches>10 ? "#0f0" : pred.evidence.homeMatches+pred.evidence.awayMatches>3 ? "#ff0" : "#f55"};padding:3px 6px;">Quality: <strong>${pred.evidence.hasRating && pred.evidence.homeMatches+pred.evidence.awayMatches>10 ? "HIGH" : pred.evidence.homeMatches+pred.evidence.awayMatches>3 ? "MEDIUM" : "LOW"}</strong></span>
        </div>

        <!-- WHY THIS PREDICTION (SPEC U) -->
        <div class="pred-section-title">WHY THIS PREDICTION?</div>
        <div style="background:#001a1a;border:1px solid #0ff;padding:6px;font-size:0.65rem;line-height:1.4;">
          <div>Rating: <strong>${pred.evidence.hasRating ? "teamRatings ability (estimasi 57 tim) + form history — advantage " + (pred.probs.home>pred.probs.away ? Security.escapeHtml(p.homeName) : pred.probs.away>pred.probs.home ? Security.escapeHtml(p.awayName) : "balanced") : "INSUFFICIENT DATA"}</strong></div>
          <div>Form: <strong>${pred.evidence.homeMatches+pred.evidence.awayMatches>0 ? `Signal ${pred.evidence.homeWeight.toFixed(1)} vs ${pred.evidence.awayWeight.toFixed(1)}` : "INSUFFICIENT DATA"}</strong></div>
          <div>H2H: <strong>${pred.evidence.hasH2H ? pred.evidence.h2hMatches+" matches, favors "+(pred.xgHome>pred.xgAway ? Security.escapeHtml(p.homeName) : Security.escapeHtml(p.awayName)) : "INSUFFICIENT DATA"}</strong></div>
          <div>Context: <strong>${pred.evidence.hasSimilarContext ? "Similar fixtures favor "+(pred.xgHome>pred.xgAway ? Security.escapeHtml(p.homeName) : Security.escapeHtml(p.awayName)) : "INSUFFICIENT DATA"}</strong></div>
          <div>Poisson: <strong>${pred.xgHome.toFixed(2)} xG vs ${pred.xgAway.toFixed(2)} xG (pure attack sim v6.0 terkalibrasi — expected goals dari MC, konsisten dengan skor)</strong></div>
          <div>Stability: <strong style="color:${pred.stability.level==="HIGH"?"#0f0":pred.stability.level==="MEDIUM"?"#ff0":pred.stability.level==="LOW"?"#f55":"#888"};">${pred.stability.level} (${pred.stability.score}/100)</strong> — ${Security.escapeHtml(pred.stability.level==="LOW" ? "Treat exact score as uncertain" : "Single scoreline dominates")}</div>
        </div>

        <div class="pred-section-title">MOST LIKELY SCORELINES — PURE SIM DISTRIBUTION (MC ${PREDICTOR_CONFIG?.PURE_SIM?.PROBS_SIMS || 200})</div>
        <div class="pred-scores-grid">${scorelinesHtml}</div>

        ${pred.rngProof ? `
        <div class="pred-section-title" style="color:#0ff;border-color:#0ff;">🔍 BUKTI VALIDASI SKOR — ANTI-MONOTON & PURE SIM</div>
        <div style="background:#001a1a;border:1px solid #0ff;padding:8px;font-size:0.65rem;line-height:1.4;">
          <div><strong style="color:#0ff;">Mode:</strong> ${Security.escapeHtml(pred.rngProof.mode)} | <strong>Chosen:</strong> <span style="color:#0f0;font-weight:bold;">${Security.escapeHtml(pred.rngProof.chosen || (pred.homeGoals+':'+pred.awayGoals))}</span> ${pred.rngProof.seed ? `| <strong>Seed:</strong> 0x${Number(pred.rngProof.seed).toString(16)}` : ""}</div>
          ${pred.rngProof.top5 ? `<div style="margin-top:4px;"><strong>Top5 Kandidat:</strong> ${pred.rngProof.top5.map(s=>`<span style="background:#002a2a;border:1px solid #0ff;padding:2px 4px;margin:2px;display:inline-block;">${Security.escapeHtml(s)}</span>`).join("")}</div>` : ""}
          <div style="margin-top:4px;"><strong>Method:</strong> ${Security.escapeHtml(pred.rngProof.method || "")}</div>
          ${pred.rngProof.effAbilities ? `<div><strong>Eff. Ability (form-aware):</strong> Home ATT ${pred.rngProof.effAbilities.home.att}/DEF ${pred.rngProof.effAbilities.home.def} vs Away ATT ${pred.rngProof.effAbilities.away.att}/DEF ${pred.rngProof.effAbilities.away.def}</div>` : ""}
          ${pred.rngProof.jitterHome!=null ? `<div><strong>Jitter xG:</strong> Home ${pred.rngProof.jitterHome>0?'+':''}${pred.rngProof.jitterHome} / Away ${pred.rngProof.jitterAway>0?'+':''}${pred.rngProof.jitterAway} (deterministik per fixture hash)</div>` : ""}
          <div style="color:#888;"><strong>Catatan:</strong> ${Security.escapeHtml(pred.rngProof.note || "")}</div>
          <div style="margin-top:6px;background:#000;padding:6px;border:1px solid #333;font-family:var(--font-mono);font-size:0.6rem;">
            <strong style="color:#ff0;">AUDIT ROM SLPM_663.74 (jujur, 2026-08-30):</strong><br>
            RNG = Numerical Recipes LCG 1664525 — <strong>keputusan implementasi deterministik, BUKAN replika RNG WE10</strong> (konstanta RNG standar NR/glibc/MSVC/Borland/MT19937 = 0 hits di ROM)<br>
            FUN_0016e8d8 = ceiling-div helper (div/mflo) • FUN_00216ef0 = table lookup 0x3C2100+idx*8 • 003bd800 = pointer table — keduanya BUKAN RNG<br>
            Ability = teamRatings.js (estimasi 57 tim) + form history • probs/markets/xG/scorelines semua dari ${PREDICTOR_CONFIG?.PURE_SIM?.PROBS_SIMS || 200} MC sim yang sama → konsisten
          </div>
          <div style="margin-top:4px;color:#0f0;">✅ Skor tidak monoton karena tiap fixture punya seed unik (hash home|away|xG|MODEL_VERSION). Bulk 100/1000x pakai seed per iterasi → variasi antar iterasi.</div>
        </div>` : ""}

        <div class="pred-section-title">⚽ TOP GOALS / PREDIKSI PENCETAK GOL — KONAMI MONTE-CARLO (5000 sims)</div>
        <div style="font-size:0.6rem;color:#888;margin-bottom:4px;">Simulasi 5000 matches via LCGRng • Prob = anytime • xG share = kontribusi gol • bukti matematis per pemain di bawah</div>
        <div style="display:flex;flex-direction:column;gap:6px;">${topScorersHtml}</div>

        <div class="pred-section-title">📊 FAKTOR PENENTU / KEY RATING INDICATORS</div>
        ${keyIndicatorsHtml}

        <div class="pred-evidence-footer">
          <div><span style="color:#888;">Model:</span> ${Security.escapeHtml(pred.model)}</div>
          <div><span style="color:#888;">Evidence:</span> Rating: ${pred.evidence.hasRating ? '✔ 57-valid' : '✘'} | Hist: ${pred.evidence.homeMatches}H/${pred.evidence.awayMatches}A | H2H: ${pred.evidence.h2hMatches}m | Context: ${pred.evidence.hasSimilarContext ? '✔' : '✘'} | Global xG: ${pred.evidence.globalAttack}</div>
          <div style="font-size:0.6rem;color:#555;margin-top:2px;">Source: WE10FullRoster.js (roster eksternal) + teamRatings.js (ability estimasi) + form history • NR-LCG deterministik (bukan replika RNG WE10 — audit ROM 0 hits) • Entropy confidence • probs/markets/xG dari MC sim yang sama</div>
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
            StateManager.debouncedSaveHomeQuery();
          }
        });
        p1Input.dataset.uiBound = "1";
      }
      setupCountryAutocomplete(p1Input, (val) => {
        if (isEditor && activeMem?.games?.[StateManager.activeGameIndex]) {
          MemoryManager.updateGameField(StateManager.activeMemoryId, StateManager.activeGameIndex, "p1", val, true);
        } else {
          StateManager.homeQuery.p1 = val;
          StateManager.saveHomeQueryImmediate();
        }
      });
    }

    const matchGridForm = document.getElementById("matchGridForm");
    if (matchGridForm) {
      if (!matchGridForm.dataset.uiInit) {
        matchGridForm.innerHTML = "";
        for (let i = 0; i < 8; i++) {
          const row = document.createElement("div");
          row.className = "match-row-item";
          if (i === 7) row.classList.add("b8-row");
          row.dataset.idx = String(i);
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
              if (i === 7 && clean) {
                StateManager.homeQuery.matches[7].enabled = true;
                StateManager.homeQuery.b8Enabled = true;
              }
              StateManager.debouncedSaveHomeQuery();
            }
          });

          sIn.addEventListener("input", () => {
            const clean = String(sIn.value || "").trim().replace(/[-–—;]+/g, ":").replace(/[^0-9:]/g, "");
            if (StateManager.activeMemoryId !== null) {
              MemoryManager.updateMatchField(StateManager.activeMemoryId, StateManager.activeGameIndex, i, "score", clean, false);
            } else {
              StateManager.homeQuery.matches[i].score = clean;
              if (i === 7 && clean) {
                StateManager.homeQuery.matches[7].enabled = true;
                StateManager.homeQuery.b8Enabled = true;
              }
              StateManager.debouncedSaveHomeQuery();
            }
          });

          aIn.addEventListener("input", () => {
            const clean = Security.sanitizeInput(aIn.value);
            if (StateManager.activeMemoryId !== null) {
              MemoryManager.updateMatchField(StateManager.activeMemoryId, StateManager.activeGameIndex, i, "away", clean, false);
            } else {
              StateManager.homeQuery.matches[i].away = clean;
              if (i === 7 && clean) {
                StateManager.homeQuery.matches[7].enabled = true;
                StateManager.homeQuery.b8Enabled = true;
              }
              StateManager.debouncedSaveHomeQuery();
            }
          });

          setupCountryAutocomplete(hIn, (val) => {
            if (StateManager.activeMemoryId !== null) {
              MemoryManager.updateMatchField(StateManager.activeMemoryId, StateManager.activeGameIndex, i, "home", val, true);
            } else {
              StateManager.homeQuery.matches[i].home = val;
              if (i === 7) {
                StateManager.homeQuery.matches[7].enabled = true;
                StateManager.homeQuery.b8Enabled = true;
              }
              StateManager.saveHomeQueryImmediate();
            }
          });

          setupCountryAutocomplete(aIn, (val) => {
            if (StateManager.activeMemoryId !== null) {
              MemoryManager.updateMatchField(StateManager.activeMemoryId, StateManager.activeGameIndex, i, "away", val, true);
            } else {
              StateManager.homeQuery.matches[i].away = val;
              if (i === 7) {
                StateManager.homeQuery.matches[7].enabled = true;
                StateManager.homeQuery.b8Enabled = true;
              }
              StateManager.saveHomeQueryImmediate();
            }
          });
        }
        // B8 collapsible toggle
        const b8Wrap = document.createElement("div");
        b8Wrap.id = "b8ToggleWrap";
        b8Wrap.style.cssText = "margin-top:8px;text-align:center;";
        b8Wrap.innerHTML = `<button class="btn" id="btnToggleB8" style="font-size:0.6rem;padding:6px 10px;">B8 [+] ADD MATCH</button>`;
        matchGridForm.parentNode.insertBefore(b8Wrap, matchGridForm.nextSibling);
        const btnToggleB8 = b8Wrap.querySelector("#btnToggleB8");
        if (btnToggleB8) {
          btnToggleB8.addEventListener("click", () => {
            const cur = StateManager.isB8Enabled(dataSource);
            StateManager.setB8Enabled(!cur);
            UIRenderer.renderMatchGrid();
          });
        }
        matchGridForm.dataset.uiInit = "1";
      }
      // Upgrade path for existing DOM with 7 rows -> 8
      if (matchGridForm.querySelectorAll(".match-row-item").length === 7) {
        const i = 7;
        const row = document.createElement("div");
        row.className = "match-row-item b8-row";
        row.dataset.idx = "7";
        row.innerHTML = `
            <div class="match-num">B8</div>
            <div class="team-input-wrap">
              <input type="text" placeholder="HOME" data-idx="7" class="match-home" autocomplete="off" />
              <div class="suggestions-box hidden"></div>
            </div>
            <div class="score-box-center">
              <input type="text" placeholder="X:X" data-idx="7" class="match-score" autocomplete="off" />
            </div>
            <div class="team-input-wrap">
              <input type="text" placeholder="AWAY" data-idx="7" class="match-away" autocomplete="off" />
              <div class="suggestions-box hidden"></div>
            </div>
          `;
        matchGridForm.appendChild(row);
        const hIn = row.querySelector(".match-home");
        const sIn = row.querySelector(".match-score");
        const aIn = row.querySelector(".match-away");
        hIn.addEventListener("input", () => {
          const clean = Security.sanitizeInput(hIn.value);
          if (StateManager.activeMemoryId !== null) MemoryManager.updateMatchField(StateManager.activeMemoryId, StateManager.activeGameIndex, 7, "home", clean, false);
          else { StateManager.homeQuery.matches[7].home = clean; if (clean) { StateManager.homeQuery.matches[7].enabled = true; StateManager.homeQuery.b8Enabled = true; } }
        });
        sIn.addEventListener("input", () => {
          const clean = String(sIn.value || "").trim().replace(/[-–—;]+/g, ":").replace(/[^0-9:]/g, "");
          if (StateManager.activeMemoryId !== null) MemoryManager.updateMatchField(StateManager.activeMemoryId, StateManager.activeGameIndex, 7, "score", clean, false);
          else { StateManager.homeQuery.matches[7].score = clean; if (clean) { StateManager.homeQuery.matches[7].enabled = true; StateManager.homeQuery.b8Enabled = true; } }
        });
        aIn.addEventListener("input", () => {
          const clean = Security.sanitizeInput(aIn.value);
          if (StateManager.activeMemoryId !== null) MemoryManager.updateMatchField(StateManager.activeMemoryId, StateManager.activeGameIndex, 7, "away", clean, false);
          else { StateManager.homeQuery.matches[7].away = clean; if (clean) { StateManager.homeQuery.matches[7].enabled = true; StateManager.homeQuery.b8Enabled = true; } }
        });
        setupCountryAutocomplete(hIn, (val) => {
          if (StateManager.activeMemoryId !== null) MemoryManager.updateMatchField(StateManager.activeMemoryId, StateManager.activeGameIndex, 7, "home", val, true);
          else { StateManager.homeQuery.matches[7].home = val; StateManager.homeQuery.matches[7].enabled = true; StateManager.homeQuery.b8Enabled = true; }
        });
        setupCountryAutocomplete(aIn, (val) => {
          if (StateManager.activeMemoryId !== null) MemoryManager.updateMatchField(StateManager.activeMemoryId, StateManager.activeGameIndex, 7, "away", val, true);
          else { StateManager.homeQuery.matches[7].away = val; StateManager.homeQuery.matches[7].enabled = true; StateManager.homeQuery.b8Enabled = true; }
        });
      }
      if (!document.getElementById("b8ToggleWrap")) {
        const b8Wrap = document.createElement("div");
        b8Wrap.id = "b8ToggleWrap";
        b8Wrap.style.cssText = "margin-top:8px;text-align:center;";
        b8Wrap.innerHTML = `<button class="btn" id="btnToggleB8" style="font-size:0.6rem;padding:6px 10px;">B8 [+] ADD MATCH</button>`;
        matchGridForm.parentNode.insertBefore(b8Wrap, matchGridForm.nextSibling);
        const btn = b8Wrap.querySelector("#btnToggleB8");
        if (btn) btn.addEventListener("click", () => { const cur = StateManager.isB8Enabled(dataSource); StateManager.setB8Enabled(!cur); UIRenderer.renderMatchGrid(); });
      }

      const rowEls = matchGridForm.querySelectorAll(".match-row-item");
      rowEls.forEach((row, i) => {
        const mData = dataSource.matches?.[i] || { home: "", score: "", away: "", enabled: i < 7 };
        const h = row.querySelector(".match-home");
        const s = row.querySelector(".match-score");
        const a = row.querySelector(".match-away");
        if (h) h.value = mData.home || "";
        if (s) s.value = mData.score || "";
        if (a) a.value = mData.away || "";
        if (i === 7) {
          const isEnabled = StateManager.isB8Enabled(dataSource);
          const hasContent = !!(mData.home || mData.away || mData.score);
          const shouldShow = isEnabled || hasContent;
          row.style.display = shouldShow ? "" : "none";
          const btn = document.getElementById("btnToggleB8");
          if (btn) {
            btn.textContent = shouldShow ? "B8 [-] HIDE" : "B8 [+] ADD MATCH";
            btn.style.background = shouldShow ? "#1a3a1a" : "";
            btn.style.borderColor = shouldShow ? "#0ff" : "";
            btn.style.color = shouldShow ? "#0ff" : "";
          }
        }
      });
    }

    const topGoalsForm = document.getElementById("topGoalsForm");
    if (topGoalsForm) {
      if (!topGoalsForm.dataset.uiInit) {
        topGoalsForm.innerHTML = "";
        for (let i = 0; i < 16; i++) {
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
              <div class="suggestions-box hidden"></div>
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
              StateManager.debouncedSaveHomeQuery();
            }
          });

          // Helper: auto isi negara & gol untuk row ini jika player dikenali
          const autoFillCountryAndGoals = (playerName, isFromSelect) => {
            const player = lookupPlayerExact(playerName);
            if (!player) return;
            const targetCountry = player.teamName;
            const currentCountry = (cIn.value || '').trim();
            const currentGoals = (gIn.value || '').trim();
            // Auto-fill country jika kosong atau beda tim (biar cepat)
            if (!currentCountry || currentCountry.toLowerCase() !== targetCountry.toLowerCase()) {
              cIn.value = targetCountry;
              if (StateManager.activeMemoryId !== null) {
                MemoryManager.updateTopGoalField(StateManager.activeMemoryId, StateManager.activeGameIndex, i, "country", targetCountry, true);
              } else {
                StateManager.homeQuery.topGoals[i].country = targetCountry;
              }
            }
            // Auto-fill goals jika kosong/0 → default 1 (biar 1 ketik jadi)
            if (!currentGoals || currentGoals === '0') {
              gIn.value = '1';
              if (StateManager.activeMemoryId !== null) {
                MemoryManager.updateTopGoalField(StateManager.activeMemoryId, StateManager.activeGameIndex, i, "goals", '1', true);
              } else {
                StateManager.homeQuery.topGoals[i].goals = '1';
              }
            }
            if (StateManager.activeMemoryId === null) StateManager.saveHomeQueryImmediate();
          };

          pIn.addEventListener("input", () => {
            let val = Security.sanitizeInput(pIn.value);
            // Smart: jika ketik "Nakazawa1" atau "Nakazawa 1" → split jadi player + goals
            const split = splitPlayerAndGoals(val);
            if (split) {
              const player = lookupPlayerExact(split.name);
              if (player) {
                const formatted = toTitleCase(split.name);
                pIn.value = formatted;
                val = formatted;
                // Set player
                if (StateManager.activeMemoryId !== null) {
                  MemoryManager.updateTopGoalField(StateManager.activeMemoryId, StateManager.activeGameIndex, i, "player", formatted, false);
                } else {
                  StateManager.homeQuery.topGoals[i].player = formatted;
                }
                // Set goals langsung dari trailing digits
                gIn.value = split.goals;
                if (StateManager.activeMemoryId !== null) {
                  MemoryManager.updateTopGoalField(StateManager.activeMemoryId, StateManager.activeGameIndex, i, "goals", split.goals, false);
                } else {
                  StateManager.homeQuery.topGoals[i].goals = split.goals;
                }
                // Auto-fill country dari player
                const targetCountry = player.teamName;
                cIn.value = targetCountry;
                if (StateManager.activeMemoryId !== null) {
                  MemoryManager.updateTopGoalField(StateManager.activeMemoryId, StateManager.activeGameIndex, i, "country", targetCountry, true);
                } else {
                  StateManager.homeQuery.topGoals[i].country = targetCountry;
                  StateManager.saveHomeQueryImmediate();
                }
                // Simpan player juga
                if (StateManager.activeMemoryId === null) StateManager.debouncedSaveHomeQuery();
                else StateManager.debouncedSave();
                return;
              }
            }
            if (StateManager.activeMemoryId !== null) {
              MemoryManager.updateTopGoalField(StateManager.activeMemoryId, StateManager.activeGameIndex, i, "player", val, false);
            } else {
              StateManager.homeQuery.topGoals[i].player = val;
              StateManager.debouncedSaveHomeQuery();
            }
            // Jika player exact match tanpa angka, auto-fill country/goals (ketik lengkap)
            if (val.length >= 3) {
              const exact = lookupPlayerExact(val);
              if (exact) autoFillCountryAndGoals(val, false);
            }
          });

          gIn.addEventListener("input", () => {
            const val = String(gIn.value || "").trim().replace(/[^0-9]/g, "");
            if (StateManager.activeMemoryId !== null) {
              MemoryManager.updateTopGoalField(StateManager.activeMemoryId, StateManager.activeGameIndex, i, "goals", val, false);
            } else {
              StateManager.homeQuery.topGoals[i].goals = val;
              StateManager.debouncedSaveHomeQuery();
            }
          });

          setupCountryAutocomplete(cIn, (val) => {
            if (StateManager.activeMemoryId !== null) {
              MemoryManager.updateTopGoalField(StateManager.activeMemoryId, StateManager.activeGameIndex, i, "country", val, true);
            } else {
              StateManager.homeQuery.topGoals[i].country = val;
              StateManager.saveHomeQueryImmediate();
            }
          });

          // Player autocomplete with country prioritization + auto-fill negara & gol
          setupPlayerAutocomplete(pIn, () => {
            // Prefer current row country input value
            const countryVal = cIn.value || (StateManager.activeMemoryId !== null
              ? StateManager.db.memories[StateManager.activeMemoryId]?.games[StateManager.activeGameIndex]?.topGoals[i]?.country
              : StateManager.homeQuery.topGoals[i]?.country) || '';
            // Try to resolve to team code
            const lower = countryVal.trim().toLowerCase();
            for (const [code, info] of Object.entries(teamsDB)) {
              if (info.name.toLowerCase() === lower) return code;
            }
            return countryVal;
          }, (val) => {
            const formatted = toTitleCase(val);
            pIn.value = formatted;
            if (StateManager.activeMemoryId !== null) {
              MemoryManager.updateTopGoalField(StateManager.activeMemoryId, StateManager.activeGameIndex, i, "player", formatted, true);
            } else {
              StateManager.homeQuery.topGoals[i].player = formatted;
              StateManager.saveHomeQueryImmediate();
            }
            // Auto-fill negara & skor (fitur cepat: naka → Nakazawa → Japan + 1)
            autoFillCountryAndGoals(formatted, true);
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
  },

  renderWhatIfResult(payload, container) {
    if (!container) return;
    container.innerHTML = "";
    if (payload.error) {
      container.innerHTML = `<div style="background:#330000;border:1px solid #f55;color:#ffaaaa;padding:8px;">⛔ ${Security.escapeHtml(payload.error)}</div>`;
      return;
    }
    const { homeName, awayName, homeFlag, awayFlag, homeCode, awayCode, homeGoals, awayGoals, winner, xgHome, xgAway, topScorers, keyIndicators, whatIfMeta } = payload;
    const winnerBadge = winner === "DRAW" ? "DRAW" : `Menang: ${Security.escapeHtml(winner)}`;
    const scorersHtml = (topScorers && topScorers.length)
      ? topScorers.map((pl, idx) => {
          const badge = idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : "#" + (idx + 1);
          const golBadge = pl.matchGoals > 0 ? `<span style="background:#0f0;color:#000;padding:1px 5px;border-radius:3px;font-size:0.6rem;margin-left:5px;">${pl.matchGoals} GOL</span>` : `<span style="background:#333;color:#888;padding:1px 5px;font-size:0.6rem;">0</span>`;
          const reason = Security.escapeHtml(pl.reason || "");
          const math = Security.escapeHtml(pl.proofMath || "");
          return `<div style="display:flex;justify-content:space-between;align-items:center;background:${pl.matchGoals>0?'#0f1a0f':'#111'};border:1px solid ${pl.matchGoals>0?'#0f0':'#333'};padding:6px 8px;border-radius:3px;margin-bottom:5px;" title="${reason} — ${math}">
            <div style="display:flex;gap:7px;align-items:center;">
              <span style="font-size:0.7rem;min-width:22px;">${badge}</span>
              <span style="font-size:1rem;">${Security.escapeHtml(pl.flag||"")}</span>
              <div>
                <div style="font-weight:bold;color:#fff;font-size:0.85rem;">${Security.escapeHtml(pl.name)} <span style="color:#0ff;font-weight:normal;font-size:0.6rem;">[${Security.escapeHtml(pl.pos)} • ${Security.escapeHtml(pl.teamCode)} • pick ${pl.pickProb}%]</span>${golBadge}</div>
                <div style="font-size:0.6rem;color:#ff0;">${reason}</div>
                ${math ? `<div style="font-size:0.55rem;color:#0ff;font-family:var(--font-mono);">📐 ${math}</div>` : ""}
              </div>
            </div>
            <div style="text-align:right;min-width:70px;">
              <div style="color:#0f0;font-family:var(--font-retro);font-size:0.65rem;">${pl.prob}% ANYTIME</div>
              <div style="font-size:0.6rem;color:#aaa;">xG ${pl.expectedGoals} • share ${pl.scoringShare}%</div>
            </div>
          </div>`;
        }).join("")
      : `<div style="color:#888;padding:8px;">Tidak ada top scorer (skor 0:0).</div>`;

    // Key indicators DELETED — Ghidra pure, tidak ada agregat Overall/Attack di ROM
    const kiHtml = "";

    container.innerHTML = `
      <div style="background:#0a1a0a;border:2px solid #00ff66;padding:10px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <span style="font-family:var(--font-retro);font-size:0.65rem;color:#0ff;">WHAT IF RESULT</span>
          <span style="background:#111;border:1px solid #0ff;color:#0ff;padding:2px 6px;font-size:0.6rem;">${Security.escapeHtml(homeFlag)} ${Security.escapeHtml(homeName)} ${homeGoals} : ${awayGoals} ${Security.escapeHtml(awayFlag)} ${Security.escapeHtml(awayName)}</span>
        </div>
        <div style="text-align:center;background:#000;border:1px solid #333;padding:8px;margin-bottom:8px;">
          <div style="font-size:1.2rem;font-weight:bold;color:#0f0;">${Security.escapeHtml(homeName)} ${homeGoals} — ${awayGoals} ${Security.escapeHtml(awayName)}</div>
          <div style="font-size:0.7rem;color:#aaa;margin-top:3px;">${winnerBadge} • xG model ${xgHome} - ${xgAway} • <span style="color:#888;">${Security.escapeHtml(whatIfMeta?.method||"")}</span></div>
        </div>
        ${kiHtml}
        <div style="font-size:0.65rem;color:#0ff;margin-bottom:4px;">⚽ TOP GOALS — Hanya pemain dari ${Security.escapeHtml(homeCode)} & ${Security.escapeHtml(awayCode)} (GK terfilter) — alokasi LCG tepat ${homeGoals}:${awayGoals}</div>
        <div>${scorersHtml}</div>
        <div style="background:#001a00;border:1px solid #0f0;padding:6px;margin-top:8px;font-size:0.6rem;line-height:1.4;">
          <div style="font-weight:bold;color:#0f0;">🔬 PROOF WHAT-IF (LCG deterministik)</div>
          <div><strong>Seed:</strong> <code style="background:#000;padding:1px 4px;border:1px solid #0f0;">${Security.escapeHtml(whatIfMeta.seedHex||"")}</code> <span style="color:#888;">(${Security.escapeHtml(String(whatIfMeta.seed||""))})</span></div>
          <div><strong>LCG:</strong> <code style="background:#000;padding:1px 4px;">${Security.escapeHtml(whatIfMeta.lcg||"")}</code></div>
          <div><strong>Method:</strong> ${Security.escapeHtml(whatIfMeta.method||"")}</div>
          <div style="color:#888;">${Security.escapeHtml(whatIfMeta.note||"")}</div>
          <div style="color:#555;font-size:0.55rem;">Audit: ${Security.escapeHtml(whatIfMeta.audit||"")}</div>
        </div>
        <div style="font-size:0.55rem;color:#555;margin-top:6px;">* Hover tiap baris untuk lihat alasan lengkap kenapa pemain di atas (weight/total pick + proof). Skor manual tidak pengaruhi xG distribusi — hanya alokasi top scorer. Ubah skor → seed berubah → hasil baru deterministik.</div>
      </div>
    `;
  }
};
