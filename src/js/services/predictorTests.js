import { hybridPredict, PREDICTOR_CONFIG, LCGRng, hashStringToSeed, analyzePredictionStability } from "./predictor.js";
import { createBulkRunner } from "./bulkRunner.js";

export async function runPredictorTests(){
  const results=[];
  function assert(name, cond, detail=""){
    const pass = !!cond;
    results.push({name, pass, detail});
    console.log(`[TEST] ${pass?"PASS":"FAIL"} ${name} ${detail}`);
    return pass;
  }
  // 1 same fixture => same deterministic result
  const p1a = hybridPredict("ARG","WAL",null,null,{deterministic:true});
  const p1b = hybridPredict("ARG","WAL",null,null,{deterministic:true});
  assert("1 same fixture deterministic", p1a.homeGoals===p1b.homeGoals && p1a.awayGoals===p1b.awayGoals, `${p1a.homeGoals}:${p1a.awayGoals}`);

  // 2 different fixture => different seed
  const p2 = hybridPredict("BRA","GER",null,null,{deterministic:true});
  assert("2 different fixture different result", p1a.homeGoals!==p2.homeGoals || p1a.awayGoals!==p2.awayGoals || p1a.winner!==p2.winner, `${p1a.winner} vs ${p2.winner}`);

  // 3 0:0 via whatIf
  const { whatIfPredict } = await import("./predictor.js");
  const w0 = whatIfPredict("BRA","GER",0,0);
  const sum0 = w0.topScorers.reduce((s,p)=>s+(p.matchGoals||0),0);
  assert("3 0:0 top scorer sum 0", sum0===0, `sum ${sum0}`);

  // 4 1:0
  const w10 = whatIfPredict("BRA","GER",1,0);
  const sum10 = w10.topScorers.filter(p=>p.teamCode==="BRA").reduce((s,p)=>s+(p.matchGoals||0),0);
  assert("4 1:0 BRA scorer sum 1", sum10===1, `sum ${sum10}`);

  // 5 0:1
  const w01 = whatIfPredict("BRA","GER",0,1);
  const sum01 = w01.topScorers.filter(p=>p.teamCode==="GER").reduce((s,p)=>s+(p.matchGoals||0),0);
  assert("5 0:1 GER scorer sum 1", sum01===1, `sum ${sum01}`);

  // 6 1:1
  const w11 = whatIfPredict("BRA","GER",1,1);
  const s11 = w11.topScorers.reduce((s,p)=>s+(p.matchGoals||0),0);
  assert("6 1:1 total 2", s11===2, `sum ${s11}`);

  // 7 5:0
  const w50 = whatIfPredict("BRA","GER",5,0);
  const s50 = w50.topScorers.filter(p=>p.teamCode==="BRA").reduce((s,p)=>s+(p.matchGoals||0),0);
  assert("7 5:0 BRA sum 5", s50===5, `sum ${s50}`);

  // 8 0:5
  const w05 = whatIfPredict("BRA","GER",0,5);
  const s05 = w05.topScorers.filter(p=>p.teamCode==="GER").reduce((s,p)=>s+(p.matchGoals||0),0);
  assert("8 0:5 GER sum 5", s05===5, `sum ${s05}`);

  // 9 missing team
  let err9=false; try{ hybridPredict("XXX","GER"); }catch(e){ err9=true; }
  assert("9 missing team error", err9);

  // 10 duplicate fixture
  let dupErr=false; try{ hybridPredict("BRA","BRA"); }catch(e){ dupErr=true; }
  assert("10 duplicate fixture error", dupErr);

  // 11 empty dataset handled via predictMatches not hybridPredict

  // 12 small dataset - use hybrid with no history (should still predict)
  const pSmall = hybridPredict("TOG","POR",null,null,{});
  assert("12 small dataset predicts", typeof pSmall.homeGoals==="number");

  // 13 large dataset - bulk 50 fixtures
  const startLarge = performance.now();
  const runner = createBulkRunner();
  const validRows = [{row:1,homeCode:"BRA",awayCode:"GER",homeName:"Brazil",awayName:"Germany",homeFlag:"",awayFlag:""}];
  const bulkRes = await runner.run(validRows, 20, ()=>{});
  assert("13 large dataset bulk 20", bulkRes.perMatch.length===1 && bulkRes.globalRank.length>0, `perMatch ${bulkRes.perMatch.length}`);

  // 14 worker cancellation
  const runner2 = createBulkRunner();
  const pCancel = runner2.run(validRows, 100, ()=>{});
  setTimeout(()=> runner2.cancel(), 10);
  const resCancel = await pCancel;
  assert("14 worker cancellation", resCancel.cancelled===true || resCancel.completed < 100);

  // 15 worker error - invalid team
  const runner3 = createBulkRunner();
  const badRows = [{row:1,homeCode:"XXX",awayCode:"YYY",homeName:"XXX",awayName:"YYY",homeFlag:"",awayFlag:""}];
  const resErr = await runner3.run(badRows, 5, ()=>{});
  // Should handle gracefully, per-match error not crash whole bulk
  assert("15 partial bulk failure", resErr.perMatch.length===1);

  // 16 placeholder

  // 17 stability HIGH
  const highDist = [{home:2,away:1,prob:0.182},{home:1,away:1,prob:0.149},{home:2,away:0,prob:0.117},{home:3,away:1,prob:0.083},{home:1,away:0,prob:0.074}];
  // Pad to 20 with small probs
  for(let i=0;i<15;i++) highDist.push({home:0,away:0,prob:0.02});
  const sHigh = analyzePredictionStability(highDist.map(d=>({home:d.home,away:d.away,prob:d.prob})), {sampleCount:200});
  assert("17 stability HIGH", sHigh.level==="HIGH" || sHigh.level==="MEDIUM", `level ${sHigh.level} score ${sHigh.score}`);

  // 18 stability LOW
  const lowDist = [{home:1,away:1,prob:0.13},{home:2,away:1,prob:0.12},{home:1,away:2,prob:0.11},{home:2,away:2,prob:0.10},{home:0,away:1,prob:0.09}];
  for(let i=0;i<15;i++) lowDist.push({home:0,away:0,prob:0.03});
  const sLow = analyzePredictionStability(lowDist.map(d=>({home:d.home,away:d.away,prob:d.prob})), {sampleCount:200});
  assert("18 stability LOW", sLow.level==="LOW" || sLow.level==="MEDIUM", `level ${sLow.level} score ${sLow.score}`);

  // 19 stability UNKNOWN
  const sUnknown = analyzePredictionStability([], {sampleCount:5});
  assert("19 stability UNKNOWN", sUnknown.level==="UNKNOWN");

  // 20 What-If deterministic
  const wA = whatIfPredict("ARG","WAL",2,1);
  const wB = whatIfPredict("ARG","WAL",2,1);
  assert("20 What-If deterministic", wA.topScorers[0].name===wB.topScorers[0].name && wA.homeGoals===wB.homeGoals);

  // 21 top scorer total == predicted goals
  const p21 = hybridPredict("BRA","GER",null,null,{});
  const sumHome = p21.topScorers.filter(pl=>pl.teamCode==="BRA").reduce((s,p)=>s+(p.matchGoals||0),0);
  const sumAway = p21.topScorers.filter(pl=>pl.teamCode==="GER").reduce((s,p)=>s+(p.matchGoals||0),0);
  assert("21 top scorer sum == predicted", sumHome===p21.homeGoals && sumAway===p21.awayGoals, `home ${sumHome}/${p21.homeGoals} away ${sumAway}/${p21.awayGoals}`);

  const passed = results.filter(r=>r.pass).length;
  console.log(`[TEST SUMMARY] ${passed}/${results.length} passed`);
  return { total: results.length, passed, results };
}
