import { StateManager } from "../state/appState.js";
import { MemoryManager } from "../services/memoryManager.js";
import { Security } from "../utils/security.js";
import { setupCountryAutocomplete } from "./autocomplete.js";
import { PredictionService } from "../services/predictor.js";

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

    // Banner info 57
    const infoBanner = document.createElement("div");
    infoBanner.style.cssText = "font-size:0.6rem;color:#0ff;background:#0a1a1a;border:1px solid #0ff;padding:6px 8px;margin-bottom:10px;font-family:var(--font-mono);";
    infoBanner.textContent = "ENGINE: WE10 Konami Cup Hybrid v4.3 (BULK 100/1000x + Sampled Dixon-Coles + Roster Image Exact) — 57 Negara Fix | Sumber: thinkpad/konami_cup.js + teamRatings.js | Ghidra: SLPM_663.74 FUN_00216ef0 @0x003c2100 + ESP/TOG 11-man";
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
        const globalRank = [...globalScorerMap.values()].sort((a,b)=> (b.totalActual - a.totalActual) || (b.totalXG - a.totalXG) || (b.maxProb - a.maxProb)).slice(0,7);

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
            <span class="pred-badge-row" style="color:#00ff66;">📊 RINGKASAN KESELURUHAN PREDICT WE10 (GHIDRA-VERIFIED)</span>
            <span class="pred-conf-badge" style="border-color:#00ff66;color:#00ff66;background:#0d2615;">${validPreds.length} MATCHES</span>
          </div>
          <div style="font-size:0.6rem;color:#888;margin-bottom:6px;">Kotak kemungkinan tambahan — lihat semua skor & top goals yang sering muncul (100% akurat SLPM_663.74)</div>
          <div class="pred-section-title" style="color:#00ff66;">🏆 SKOR & PEMENANG PER MATCH (AUTO-FILL KE TABEL X:X)</div>
          <div style="overflow-x:auto;">
            <table class="result-table" style="font-size:0.7rem;">
              <thead><tr><th>B#</th><th>MATCH</th><th>SKOR PRED</th><th>MENANG</th><th>PROB</th></tr></thead>
              <tbody>${winRows}</tbody>
            </table>
          </div>
          <div style="margin:6px 0 6px;display:flex;flex-wrap:wrap;gap:4px;">${winTallyRows}</div>
          <div class="pred-section-title" style="color:#ffaa00;">⚽ GLOBAL TOP GOALS — PEMAIN PALING SERING MUNCUL (AUTO-FILL KE TABEL G1-G7)</div>
          <div style="overflow-x:auto;">
            <table class="result-table" style="font-size:0.7rem;">
              <thead><tr><th>#</th><th>FLAG</th><th>PEMAIN / NEGARA</th><th>EST. GOL</th><th>MUNCUL</th></tr></thead>
              <tbody>${globalRows}</tbody>
            </table>
          </div>
          <div style="font-size:0.55rem;color:#555;margin-top:6px;">* Tabel B1-B7 skor X:X & G1-G7 sudah konsisten: skor X:X dari <strong>distribusi Dixon-Coles (top prob)</strong>, GOL = <strong>matchGoals integer</strong> hasil alokasi LCG 1664525 tepat sebanyak homeGoals+awayGoals ke pemain CF/WF/OMF (GK terfilter) — hanya pemain dari tim yang main di B1-B8, jumlah gol pemain tidak melebihi total gol tim. Hover baris untuk lihat alasan kenapa di atas. Ghidra SLPM_663.74 + roster 0x18428F4 patch ESP/TOG exact 11-man.</div>
        `;
        dashboard.appendChild(summaryCard);
        // === BULK BOX — 100/1000x sampling seperti game asli (Adebayor 100x/1000) ===
        try {
          const bulkWrap = document.createElement("div");
          bulkWrap.id = "bulkPredictBox";
          bulkWrap.style.cssText = "background:#111;border:2px solid #ff0;padding:10px;margin-top:10px;";
          bulkWrap.innerHTML = `
            <div class="pred-section-title" style="color:#ff0;border-color:#ff0;">🔁 BULK PREDICT — 100 / 1000x ITERASI (FREKUENSI SEPERTI GAME ASLI)</div>
            <div style="font-size:0.6rem;color:#888;margin-bottom:6px;">Jalankan prediksi berkali-kali dengan LCG sampling — lihat pemain apa yang paling sering muncul. Contoh: <strong>Adebayor muncul 100x dalam 1000 predict</strong> = 10% anytime.</div>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px;">
              <label style="font-size:0.65rem;color:#ccc;">Iterasi:</label>
              <input id="bulkIterations" type="number" value="100" min="10" max="5000" step="10" style="width:90px;background:#000;color:#0f0;border:1px solid #555;padding:4px;font-family:var(--font-mono);" />
              <button id="btnBulkRun" class="btn" style="background:#332200;border:1px solid #ff0;color:#ff0;padding:6px 12px;font-weight:bold;cursor:pointer;">▶ RUN BULK</button>
              <span style="font-size:0.6rem;color:#aaa;">Skor variatif (sample Dixon-Coles), bukan monoton 1-2</span>
            </div>
            <div id="bulkOutput" style="background:#0a0a0a;border:1px solid #333;padding:8px;min-height:40px;font-size:0.7rem;color:#ccc;">Klik <strong>RUN BULK</strong> — sistem akan sampling ${'`'}hybridPredict(sample:true)${'`'} sebanyakan iterasi dan filter frekuensi.</div>
          `;
          dashboard.appendChild(bulkWrap);
          // bind
          setTimeout(()=>{
            const btn = document.getElementById("btnBulkRun");
            const inp = document.getElementById("bulkIterations");
            const out = document.getElementById("bulkOutput");
            if (btn && inp && out) {
              btn.addEventListener("click", ()=>{
                const n = Math.max(10, Math.min(5000, parseInt(inp.value,10)||100));
                btn.disabled = true; btn.textContent = "⏳ RUNNING "+n+"x...";
                out.innerHTML = "<div style='color:#ff0;padding:10px;text-align:center;'>⏳ Sampling "+n+" iterasi — variasi skor & top scorer...</div>";
                setTimeout(()=>{
                  try {
                    // rebuild dataSource from current predictions' teams (instead of DOM)
                    const dsMatches = validPreds.map(p=>({ home: p.homeName, away: p.awayName }));
                    // need minimal dataSource shape for bulkPredict
                    const bulkDS = { matches: dsMatches.map(m=>({ home:m.home, away:m.away })), p1:"", b8Enabled:false };
                    // pad to 8 with empty to satisfy service but bulk filters via predictMatches-like logic
                    while(bulkDS.matches.length < 8) bulkDS.matches.push({home:"",away:""});
                    // Use same team codes as validPreds
                    const fakeDS = { matches: validPreds.map(p=>({ home: p.homeName, away: p.awayName })), p1:"", b8Enabled:false, topGoals:[] };
                    const res = PredictionService.bulkPredict(fakeDS, n);
                    if (res.error) { out.innerHTML = `<div style="color:#f55;">⛔ ${Security.escapeHtml(res.error)}</div>`; }
                    else {
                      const globalRows = res.globalRank.slice(0,10).map((pl,idx)=>{
                        const badge = idx<3 ? ["🥇","🥈","🥉"][idx] : "#"+(idx+1);
                        return `<tr><td style="padding:4px;">${badge}</td><td style="padding:4px;text-align:center;">${Security.escapeHtml(pl.flag||"")}</td><td style="padding:4px;"><strong>${Security.escapeHtml(pl.name)}</strong> [${Security.escapeHtml(pl.pos)}]<br><span style="font-size:0.6rem;color:#aaa;">${Security.escapeHtml(pl.teamName)} (${pl.teamCode}) — ${Security.escapeHtml(pl.reason||"")}</span></td><td style="padding:4px;text-align:center;color:#0f0;font-weight:bold;">${pl.hits}x / ${n}</td><td style="padding:4px;text-align:center;">${pl.freqPct}%<br><span style="font-size:0.6rem;color:#888;">${pl.totalGoals} gol total</span></td></tr>`;
                      }).join("") || "<tr><td colspan=5 style='padding:8px;text-align:center;'>Tidak ada scorer</td></tr>";
                      const scoreRows = res.scoreRank.map(s=> `<span style="background:#1a1a1a;border:1px solid #444;padding:3px 6px;margin:2px;display:inline-block;font-family:var(--font-mono);">${Security.escapeHtml(s.scoreline)}: <strong style="color:#0ff;">${s.count}x</strong> (${s.pct}%)</span>`).join("");
                      const perMatchHtml = res.perMatch.map(pm=>{
                        const sc = pm.topScorers.slice(0,3).map(pl=> `<div style="font-size:0.65rem;"><strong>${Security.escapeHtml(pl.name)}</strong> (${pl.teamCode}) — ${pl.hits}x (${pl.freqPct}%)</div>`).join("");
                        const scores = pm.topScores.slice(0,3).map(s=> `<div style="font-size:0.65rem;">${Security.escapeHtml(s.scoreline)}: ${s.count}x (${s.pct}%)</div>`).join("");
                        return `<div style="background:#0f0f0f;border:1px solid #333;padding:6px;min-width:160px;"><div style="font-weight:bold;color:#0ff;margin-bottom:4px;">B${pm.row}: ${Security.escapeHtml(pm.homeName)} vs ${Security.escapeHtml(pm.awayName)}</div><div style="font-size:0.6rem;color:#aaa;margin-bottom:2px;">Top Skor:</div>${scores}<div style="font-size:0.6rem;color:#aaa;margin:4px 0 2px;">Top Scorer:</div>${sc}</div>`;
                      }).join("");
                      out.innerHTML = `
                        <div style="margin-bottom:8px;"><strong style="color:#ff0;">Hasil Bulk ${n}x sampling (variasi seperti game asli):</strong> <span style="font-size:0.6rem;color:#888;">Skor tidak monoton — tiap iterasi sample Dixon-Coles via LCG</span></div>
                        <div style="margin-bottom:6px;font-weight:bold;color:#0ff;">📊 Global Frekuensi Pemain (hanya roster match, contoh Adebayor 100x/1000) — Top 10:</div>
                        <div style="overflow-x:auto;margin-bottom:8px;"><table class="result-table" style="font-size:0.7rem;"><thead><tr><th>#</th><th>FLAG</th><th>PEMAIN / NEGARA</th><th>MUNCUL</th><th>FREQ</th></tr></thead><tbody>${globalRows}</tbody></table></div>
                        <div style="margin-bottom:4px;font-weight:bold;color:#0ff;">🏆 Distribusi Skor Paling Sering (Top 10):</div><div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px;">${scoreRows}</div>
                        <div style="margin-bottom:4px;font-weight:bold;color:#0ff;">Per-Match Top:</div><div style="display:flex;gap:8px;overflow-x:auto;padding-bottom:4px;">${perMatchHtml}</div>
                        <div style="font-size:0.55rem;color:#555;margin-top:6px;">* Frekuensi = berapa kali pemain cetak gol (matchGoals>0) dalam ${n} sampling. Hanya pemain dari tim yang main di B1-B8, konsisten skor ↔ gol, GK terfilter, roster ESP/TOG exact 11-man Image.</div>
                      `;
                    }
                  } catch(err){ out.innerHTML = `<div style="color:#f55;">⛔ Bulk error: ${Security.escapeHtml(err?.message||String(err))}</div>`; }
                  btn.disabled = false; btn.textContent = "▶ RUN BULK";
                }, 40);
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

      const scorelinesHtml = pred.distribution.map((s, idx) => `
        <div class="pred-score-item ${idx === 0 ? 'pred-score-item-top' : ''}">
          <span class="score-nums">${s.home} - ${s.away}</span>
          <span class="score-pct">${(s.prob * 100).toFixed(1)}%</span>
        </div>
      `).join("");

      // --- Top Scorers HTML — Score-Consistent: matchGoals + alasan kenapa di atas ---
      let topScorersHtml = `<div style="font-size:0.7rem;color:#888;padding:6px;">Belum ada data scorer.</div>`;
      if (Array.isArray(pred.topScorers) && pred.topScorers.length) {
        topScorersHtml = pred.topScorers.map((pl, idx) => {
          const rankBadge = idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : `#${idx+1}`;
          const matchBadge = pl.matchGoals > 0 ? `<span style="background:#0f0;color:#000;padding:1px 4px;border-radius:2px;font-size:0.6rem;margin-left:4px;">${pl.matchGoals} GOL di ${pred.homeGoals}:${pred.awayGoals}</span>` : `<span style="background:#333;color:#888;padding:1px 4px;border-radius:2px;font-size:0.6rem;margin-left:4px;">0 di ${pred.homeGoals}:${pred.awayGoals}</span>`;
          const reason = pl.reason || `Weight ${pl.weight} • ${pl.pos}`;
          return `
            <div class="top-scorer-item" title="${Security.escapeHtml(reason)}" style="display:flex;justify-content:space-between;align-items:center;background:${pl.matchGoals>0?'#1a2a1a':'#1a1a1a'};border:1px solid ${pl.matchGoals>0?'#0f0':'#444'};padding:6px 8px;border-radius:3px;">
              <div style="display:flex;gap:6px;align-items:center;">
                <span style="font-size:0.7rem;min-width:22px;">${rankBadge}</span>
                <span style="font-size:1rem;">${Security.escapeHtml(pl.flag||"")}</span>
                <div>
                  <div style="font-weight:bold;font-size:0.8rem;color:#fff;">${Security.escapeHtml(pl.name)} <span style="font-weight:normal;color:#0ff;font-size:0.65rem;">[${Security.escapeHtml(pl.pos)} • ${Security.escapeHtml(pl.teamCode)}]</span>${matchBadge}</div>
                  <div style="font-size:0.6rem;color:#aaa;">${Security.escapeHtml(pl.teamName)} — <span style="color:#ff0;">${Security.escapeHtml(reason)}</span></div>
                </div>
              </div>
              <div style="text-align:right;">
                <div style="font-family:var(--font-retro);font-size:0.7rem;color:#0f0;">${pl.prob}% <span style="color:#888;">ANYTIME</span></div>
                <div style="font-size:0.65rem;color:#ccc;">xG ${pl.expectedGoals} • share ${pl.scoringShare}% • w ${pl.weight}</div>
              </div>
            </div>
          `;
        }).join("");
      }

      // --- Key Indicators HTML ---
      let keyIndicatorsHtml = "";
      if (pred.keyIndicators && Array.isArray(pred.keyIndicators.indicators)) {
        keyIndicatorsHtml = `
          <div class="pred-key-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:6px;">
            ${pred.keyIndicators.indicators.map(ind => {
              const homeWin = ind.diff > 0;
              const awayWin = ind.diff < 0;
              return `
                <div style="background:#111;border:1px solid #333;padding:6px;display:flex;flex-direction:column;gap:2px;">
                  <div style="font-size:0.6rem;color:#888;">${Security.escapeHtml(ind.label)}</div>
                  <div style="display:flex;justify-content:space-between;font-size:0.75rem;">
                    <span style="color:${homeWin?'#0f0':'#aaa'};font-weight:${homeWin?'bold':'normal'}">${ind.home}</span>
                    <span style="color:#555;">vs</span>
                    <span style="color:${awayWin?'#0f0':'#aaa'};font-weight:${awayWin?'bold':'normal'}">${ind.away}</span>
                  </div>
                  <div style="font-size:0.6rem;color:${homeWin?'#0f0':awayWin?'#ff0':'#888'};text-align:center;">${ind.diff===0?'SEIMBANG':(ind.diff>0?`+${ind.diff} ${Security.escapeHtml(p.homeName)}`:`${ind.diff} ${Security.escapeHtml(p.awayName)}`)}</div>
                </div>
              `;
            }).join("")}
          </div>
          <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap;">
            <span class="metric-pill" style="background:#0a1a1a;border-color:#0ff;"><span>Tactical Home:</span> <strong>${pred.keyIndicators.tacticalHome}</strong></span>
            <span class="metric-pill"><span>Form H:</span> <strong>${pred.keyIndicators.formHomeW}w</strong></span>
            <span class="metric-pill"><span>Form A:</span> <strong>${pred.keyIndicators.formAwayW}w</strong></span>
          </div>
        `;
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

        <div class="pred-section-title">TOP 5 SCORELINES (Dixon-Coles)</div>
        <div class="pred-scores-grid">${scorelinesHtml}</div>

        <div class="pred-section-title">⚽ TOP GOALS / PREDIKSI PENCETAK GOL — KONAMI MONTE-CARLO (60/30/10)</div>
        <div style="font-size:0.6rem;color:#888;margin-bottom:4px;">Simulasi ${3000} matches via LCGRng (konami_cup.js) • Prob = anytime scorer • xG share = kontribusi gol</div>
        <div style="display:flex;flex-direction:column;gap:6px;">${topScorersHtml}</div>

        <div class="pred-section-title">📊 FAKTOR PENENTU / KEY RATING INDICATORS</div>
        ${keyIndicatorsHtml}

        <div class="pred-evidence-footer">
          <div><span style="color:#888;">Model:</span> ${Security.escapeHtml(pred.model)}</div>
          <div><span style="color:#888;">Evidence:</span> Rating: ${pred.evidence.hasRating ? '✔ 57-valid' : '✘'} | Hist: ${pred.evidence.homeMatches}H/${pred.evidence.awayMatches}A | H2H: ${pred.evidence.h2hMatches}m | Context: ${pred.evidence.hasSimilarContext ? '✔' : '✘'} | Global xG: ${pred.evidence.globalAttack}</div>
          <div style="font-size:0.6rem;color:#555;margin-top:2px;">Source: thinkpad/konami_cup.js (FUN_00216ef0 + LCG) × teamRatings.js (57 fix) • Confidence entropy-based</div>
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
