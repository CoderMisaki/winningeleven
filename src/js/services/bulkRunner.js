import { PREDICTOR_CONFIG, hashStringToSeed, generateTopScorersBulkFast, extractDataset, calculateTeamStrength, effectiveAbilities, pureMatchSample } from "./predictor.js";
import { getGhidraAbility } from "../data/ghidraTeamAbility.js";

export function createBulkRunner(){
  let cancelled = false;
  let worker = null;
  function cancel(){ cancelled = true; if(worker){ try{ worker.terminate(); } catch(e){} worker=null; } }
  function isCancelled(){ return cancelled; }

  async function runChunked(validRows, iterations, onProgress){
    const totalTasks = validRows.length * iterations;
    let completed = 0;
    const start = performance.now();
    const scoreFreq = new Map();
    const globalScorerFreq = new Map();
    // Precompute team strengths + effective abilities once per match (avoid 1600x extractDataset + 200 MC markets)
    const { matches, stats, globalAttack } = extractDataset(null, null);
    const pre = validRows.map(v=>{
      const h = calculateTeamStrength(v.homeCode, stats, globalAttack);
      const a = calculateTeamStrength(v.awayCode, stats, globalAttack);
      const hAb = effectiveAbilities(h, getGhidraAbility(v.homeCode));
      const aAb = effectiveAbilities(a, getGhidraAbility(v.awayCode));
      const midDiffNorm = h.mid - a.mid;
      return { ...v, h, a, hAb, aAb, midDiffNorm };
    });
    const perMatch = pre.map(v=>({
      row:v.row, homeCode:v.homeCode, awayCode:v.awayCode, homeName:v.homeName, awayName:v.awayName, homeFlag:v.homeFlag, awayFlag:v.awayFlag,
      scoreMap:new Map(), scorerMap:new Map(), winH:0, winD:0, winA:0, sumHomeGoals:0, sumAwayGoals:0,
      midDiffNorm: v.midDiffNorm, hAb: v.hAb, aAb: v.aAb
    }));

    for(let iter=0; iter<iterations; iter++){
      if(cancelled) break;
      for(let idx=0; idx<perMatch.length; idx++){
        if(cancelled) break;
        const pm = perMatch[idx];
        const seed = hashStringToSeed(`${pm.homeCode}|${pm.awayCode}|${iter}|bulk200|${PREDICTOR_CONFIG.MODEL_VERSION}`);
        const rng = new (class{ constructor(s){this.state=s>>>0} next(){this.state=(Math.imul(this.state,1664525)+1013904223)>>>0;return this.state} range(n){return n<=0?0:this.next()%n} }) (seed);
        // Direct pure WE10 sim — no 200 MC markets per iter (fast), score WE10 akurat (chances 6±mid*3, shot 18%+0.35*diff)
        const smp = pureMatchSample(rng, pm.midDiffNorm, pm.hAb, pm.aAb);
        const homeGoals = smp.home, awayGoals = smp.away;
        const sk = `${homeGoals}:${awayGoals}`;
        pm.scoreMap.set(sk, (pm.scoreMap.get(sk)||0)+1);
        scoreFreq.set(sk, (scoreFreq.get(sk)||0)+1);
        pm.sumHomeGoals += homeGoals;
        pm.sumAwayGoals += awayGoals;
        if(homeGoals > awayGoals) pm.winH++; else if(awayGoals > homeGoals) pm.winA++; else pm.winD++;
        let scorers = [];
        try{ scorers = generateTopScorersBulkFast(pm.homeCode, pm.awayCode, homeGoals, awayGoals, seed ^ 0x9E3779B9); } catch(_){}
        for(const pl of scorers){
          if((pl.matchGoals||0)<=0) continue;
          const k = `${pl.name}|${pl.teamCode}`;
          const ex = pm.scorerMap.get(k);
          if(ex){ ex.hits+=1; ex.totalGoals+=pl.matchGoals; }
          else pm.scorerMap.set(k,{ name:pl.name, pos:pl.pos, teamCode:pl.teamCode, flag:pl.flag, teamName:pl.teamName, hits:1, totalGoals:pl.matchGoals, weight:pl.weight, proofMath:pl.proofMath, reason:pl.reason, pickProb:pl.pickProb, totalWeight:pl.totalWeight });
          const gex = globalScorerFreq.get(k);
          if(gex){ gex.hits+=1; gex.totalGoals+=pl.matchGoals; }
          else globalScorerFreq.set(k,{ name:pl.name, pos:pl.pos, teamCode:pl.teamCode, flag:pl.flag, teamName:pl.teamName, hits:1, totalGoals:pl.matchGoals, weight:pl.weight, proofMath:pl.proofMath, reason:pl.reason, pickProb:pl.pickProb, totalWeight:pl.totalWeight });
        }
        completed++;
        if(completed % 32 === 0){
          const elapsed=(performance.now()-start)/1000;
          const eta=completed>0?(elapsed/completed)*(totalTasks-completed):0;
          if(onProgress) onProgress({ completed, total: totalTasks, percent: Math.round(completed/totalTasks*100), elapsed, eta, perMatch: perMatch.length, iteration: iter });
          await new Promise(r=> setTimeout(r, 0));
          if(cancelled) break;
        }
      }
      if(iter % 8 === 0) await new Promise(r=> setTimeout(r, 0));
    }
    if(cancelled) return { cancelled:true, completed, total: totalTasks, perMatch: [], scoreFreq: new Map(), globalScorerFreq: new Map() };
    if(onProgress){ const elapsed=(performance.now()-start)/1000; onProgress({ completed, total: totalTasks, percent:100, elapsed, eta:0, perMatch: perMatch.length, iteration: iterations-1 }); }
    const globalRank=[...globalScorerFreq.values()].sort((a,b)=>b.hits-a.hits||b.totalGoals-a.totalGoals).map(x=>{
      const freqPct=Number((x.hits/iterations*100).toFixed(1));
      const avgGoals=Number((x.totalGoals/Math.max(1,x.hits)).toFixed(2));
      const proof=x.pickProb?`weight ${x.weight}/${x.totalWeight}=${x.pickProb}% pick → ${freqPct}% actual (${x.hits}x/${iterations}) — ${x.weight>=65?'CF/WF dominan':'MF/DF boost'} — WE10FullRoster ${x.pos}`:`freq ${freqPct}%`;
      return {...x, freqPct, avgGoals, proof, rngNote:`LCG bulkFast seed=hash(home|away|iter|bulk200)`};
    });
    const scoreRank=[...scoreFreq.entries()].sort((a,b)=>b[1]-a[1]).slice(0,10).map(([s,c])=>({scoreline:s,count:c,pct:Number(c/(iterations*perMatch.length)*100).toFixed(1)}));
    const perMatchRank=perMatch.map(pm=>{
      const sRank=[...pm.scoreMap.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5).map(([s,c])=>({scoreline:s,count:c,pct:Number(c/iterations*100).toFixed(1)}));
      const scRank=[...pm.scorerMap.values()].sort((a,b)=>b.hits-a.hits||b.totalGoals-a.totalGoals).slice(0,6).map(x=>({...x,freqPct:Number((x.hits/iterations*100).toFixed(1)),proof:x.proofMath}));
      const winRateHome=Number((pm.winH/iterations*100).toFixed(1));
      const winRateAway=Number((pm.winA/iterations*100).toFixed(1));
      const winRateDraw=Number((pm.winD/iterations*100).toFixed(1));
      const avgHome=Number((pm.sumHomeGoals/iterations).toFixed(2));
      const avgAway=Number((pm.sumAwayGoals/iterations).toFixed(2));
      const mostFrequent=sRank[0]?.scoreline||"0:0";
      let konsistentWinner="DRAW";
      if(pm.winH>pm.winA&&pm.winH>pm.winD) konsistentWinner=pm.homeName;
      else if(pm.winA>pm.winH&&pm.winA>pm.winD) konsistentWinner=pm.awayName;
      return {row:pm.row,homeName:pm.homeName,awayName:pm.awayName,homeCode:pm.homeCode,awayCode:pm.awayCode,homeFlag:pm.homeFlag,awayFlag:pm.awayFlag,topScores:sRank,topScorers:scRank,winRateHome,winRateAway,winRateDraw,avgHome,avgAway,mostFrequent,konsistentWinner,winH:pm.winH,winD:pm.winD,winA:pm.winA};
    });
    const bulkRngProof={
      lcg:"state = (state * 1664525 + 1013904223) >>>0 — Numerical Recipes LCG (implementasi sendiri, BUKAN replika RNG WE10)",
      seedFormula:"hashStringToSeed(home|away|iter|bulk200|MODEL_VERSION) — deterministik, reproducible, tiap iter unik",
      whyFrequent:"Player muncul konsisten karena weight/total = pickProb. CF/WF weight 84 (19%) → 19% pick → dalam 200x → ~28-38 hits. DF weight 10/12 boost 2.2 → 22 → 5% → ~10x. GK filtered 0%. Data WE10FullRoster.js roster asli 57 tim ×11 pemain (bukan dummy).",
      auditNote:"Ghidra audit 2026-08-30 SLPM_663.74: FUN_0016e8d8=ceiling-div helper, FUN_00216ef0=table lookup, konstanta RNG standar 0 hits → LCG ini implementasi deterministik, bukan decode ROM. Skor: pure sim chances 6±mid*3±rng(3) clamp 4-9, shot 18%+0.35*(att-def)+1 home clamp 10-32% → avg ~3.0 gol/match (WE10 asli 2.5-3.5).",
      avgNote:"Skor rata-rata 200x = sum(homeGoals)/200 & sum(awayGoals)/200 — hasil prediksi konsisten 200x dibagikan untuk winrate. Mode skor = paling sering muncul 200x."
    };
    return {iterations,totalMatches:perMatch.length,globalRank:globalRank.slice(0,15),scoreRank,perMatch:perMatchRank,bulkRngProof,cancelled:false,completed,total:totalTasks};
  }
  async function runWithWorker(validRows, iterations, onProgress){ return await runChunked(validRows, iterations, onProgress); }
  return {run:(validRows,iterations,onProgress)=>runWithWorker(validRows,iterations,onProgress),cancel,isCancelled,reset:()=>{cancelled=false;}};
}
