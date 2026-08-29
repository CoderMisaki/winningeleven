/**
 * Predict Worker — SPEC E: async non-blocking bulk Monte Carlo
 * ROM/Ghidra VERIFIED: LCG replica 1664525 (FUN_0016e8d8 div/mflo), no Math.random
 * Hypothesis: team ability via ROM dump, pure attack sim (chances 9±mid*4, shot 22+(att-def)*0.45)
 * Model statistik buatan: Poisson/Dixon for markets only
 */
class LCGRng{ constructor(seed){ this.state=seed>>>0; } next(){ this.state=(Math.imul(this.state,1664525)+1013904223)>>>0; return this.state; } range(n){ return n<=0?0:this.next()%n; } nextFloat(){ return this.next()/0x100000000; } }

// Note: Worker cannot import StateManager (DOM). Jobs are pre-validated homeCode/awayCode.
// Each job: {row, homeCode, awayCode, xgHome, xgAway, seed}
// Config: {modelVersion}
self.onmessage = function(e){
  const data = e.data;
  if(!data || data.type !== "PREDICT_BULK") return;
  const jobs = data.jobs || [];
  const total = jobs.length;
  let completed = 0;
  const results = [];
  try{
    for(let idx=0; idx<jobs.length; idx++){
      const job = jobs[idx];
      // Check cancellation flag via shared message
      if(data.cancelled) break;
      // Pure simulation per job (same as hybridPredict pure branch, simplified)
      // For worker, we approximate xG already passed, or compute via LCG
      // Here we just do scoreline sampling via LCG range on distribution if provided
      // Fallback: if job has xg, generate distribution quickly is heavy, so we do pure attack sim directly
      // Simplified: use job.seed to pick scoreline via LCG
      const rng = new LCGRng(job.seed >>>0);
      // Simulate pure attack sim stats passed via job
      // job contains homeCode/awayCode, homeChances, awayChances, attack/defense already
      let homeGoals = 0, awayGoals = 0;
      // If job has precomputed chances, use them, else fallback to 9±
      const homeChances = job.homeChances ?? (9 + rng.range(7));
      const awayChances = job.awayChances ?? (9 + rng.range(7));
      for(let i=0;i<homeChances;i++){ if(rng.range(100) < (job.homeShotProb ?? 22)) homeGoals++; }
      for(let i=0;i<awayChances;i++){ if(rng.range(100) < (job.awayShotProb ?? 22)) awayGoals++; }
      homeGoals = Math.min(10, homeGoals);
      awayGoals = Math.min(10, awayGoals);
      results.push({ row: job.row, homeCode: job.homeCode, awayCode: job.awayCode, homeGoals, awayGoals, seed: job.seed });
      completed++;
      if(completed % (data.progressInterval || 16) === 0 || completed===total){
        self.postMessage({ type:"PROGRESS", completed, total, elapsed: 0 });
      }
    }
    self.postMessage({ type:"DONE", results, completed, total });
  }catch(err){
    self.postMessage({ type:"ERROR", error: err.message || String(err) });
  }
};
