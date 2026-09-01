/**
 * Predict Worker — SPEC E: async non-blocking bulk Monte Carlo
 * v6.0: fallback defaults SELARAS dengan pure sim produksi (chances 6+rng(3), shot 18%)
 * RNG: Numerical Recipes LCG 1664525 (implementasi sendiri — BUKAN replika RNG WE10,
 * konstanta RNG asli tidak ditemukan di SLPM_663.74; lihat predictor.js GHIDRA_PROOF)
 * NOTE: path ini saat ini tidak dipakai (bulkRunner fallback ke chunked hybridPredict)
 *       — default di sini dijaga tetap selaras agar tidak drift diam-diam bila diaktifkan.
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
      // v6.0 aligned with production pure sim: CHANCES_BASE 6 + rng(3), BASE_SHOT_PROB 18%
      const homeChances = job.homeChances ?? (6 + rng.range(3));
      const awayChances = job.awayChances ?? (6 + rng.range(3));
      for(let i=0;i<homeChances;i++){ if(rng.range(100) < (job.homeShotProb ?? 18)) homeGoals++; }
      for(let i=0;i<awayChances;i++){ if(rng.range(100) < (job.awayShotProb ?? 18)) awayGoals++; }
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
