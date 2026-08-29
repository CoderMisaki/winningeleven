import { hybridPredict } from "./predictor.js";
import { createBulkRunner } from "./bulkRunner.js";

export async function runBenchmark(){
  const results={};
  // Single prediction benchmark
  const singleStart = performance.now();
  for(let i=0;i<100;i++){
    hybridPredict("ARG","WAL",null,null,{deterministic:true});
  }
  const singleEnd = performance.now();
  results.singleAvgMs = (singleEnd-singleStart)/100;
  results.singleTotal100 = singleEnd-singleStart;

  // Bulk benchmarks
  const fixtures10 = Array.from({length:10}, (_,i)=>({row:i+1, homeCode:"BRA", awayCode:"GER", homeName:"Brazil", awayName:"Germany", homeFlag:"", awayFlag:""}));
  const fixtures50 = Array.from({length:50}, (_,i)=>({row:i+1, homeCode: i%2===0?"BRA":"ARG", awayCode: i%2===0?"GER":"WAL", homeName:"A", awayName:"B", homeFlag:"", awayFlag:""}));
  const fixtures100 = Array.from({length:100}, (_,i)=>({row:i+1, homeCode:"BRA", awayCode:"GER", homeName:"Brazil", awayName:"Germany", homeFlag:"", awayFlag:""}));

  async function benchBulk(fixtures, iterations){
    const runner = createBulkRunner();
    const start = performance.now();
    const res = await runner.run(fixtures, iterations, ()=>{});
    const end = performance.now();
    return { totalMs: end-start, perFixtureMs: (end-start)/(fixtures.length*iterations), fixtures: fixtures.length, iterations, totalTasks: fixtures.length*iterations };
  }

  // Use small iterations for benchmark to avoid long time
  results.bulk10 = await benchBulk(fixtures10, 10);
  results.bulk50 = await benchBulk(fixtures50, 10);
  results.bulk100 = await benchBulk(fixtures100, 5);

  // Memory
  if(performance.memory){
    results.memory = performance.memory;
  }

  return results;
}
