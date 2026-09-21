import { P2sZstdPatcher, KONAMI_CUP_PAIRING_ADDR, patchKonamiCupPairings } from '../src/js/services/p2sZstdPatcher.js';
import { TikTokP2sService, resolveCountryToId, buildKonamiCupPairingsFromMatches } from '../src/js/services/tiktokP2s.js';
import fs from 'fs';
import path from 'path';

function assert(cond, msg) { if (!cond) throw new Error(msg); }

async function testBaseline() {
  console.log('Test 1: Argentina/Costa Rica baseline');
  const mem = new Uint8Array(33554432);
  const matches = [
    {homeId:44, awayId:41},{homeId:56, awayId:10},{homeId:28, awayId:11},{homeId:2, awayId:25},
    {homeId:3, awayId:53},{homeId:12, awayId:26},{homeId:54, awayId:9},{homeId:20, awayId:7}
  ];
  const res = patchKonamiCupPairings(mem, matches);
  assert(res.decoded.length===16,'decoded 16');
  assert(res.decoded[0]===44 && res.decoded[1]===41,'B1');
  assert(res.decoded[14]===20 && res.decoded[15]===7,'B8');
  // little endian check
  const view = new DataView(mem.buffer);
  assert(mem[KONAMI_CUP_PAIRING_ADDR]===0x2c && mem[KONAMI_CUP_PAIRING_ADDR+1]===0x00,'LE byte 44');
  assert(mem[KONAMI_CUP_PAIRING_ADDR+1]===0,'high byte');
  console.log('  PASS raw hex', Array.from(res.bytesWritten).map(b=>b.toString(16).padStart(2,'0')).join(' '));
}

async function testHungaryRomania() {
  console.log('Test 2: Hungary/Romania example');
  const mem = new Uint8Array(33554432);
  const matches = [
    {homeId:22, awayId:30},{homeId:26, awayId:0},{homeId:36, awayId:55},{homeId:16, awayId:41},
    {homeId:31, awayId:1},{homeId:6, awayId:47},{homeId:23, awayId:51},{homeId:42, awayId:13}
  ];
  const res = patchKonamiCupPairings(mem, matches);
  assert(res.decoded[0]===22 && res.decoded[1]===30,'B1');
  assert(res.decoded[2]===26 && res.decoded[3]===0,'B2');
  console.log('  PASS', res.decoded);
}

async function testAllMatches() {
  console.log('Test 3: All 8 matches count');
  const mem = new Uint8Array(33554432);
  const matches = Array.from({length:8},(_,i)=>({homeId:i, awayId:56-i}));
  const res = patchKonamiCupPairings(mem, matches);
  assert(res.decoded.length===16,'16 values');
  console.log('  PASS');
}

async function testLE() {
  console.log('Test 4: Little-endian byte verification');
  const mem = new Uint8Array(33554432);
  const matches = [{homeId:0x1234, awayId:0xABCD},{homeId:1,awayId:2},{homeId:3,awayId:4},{homeId:5,awayId:6},{homeId:7,awayId:8},{homeId:9,awayId:10},{homeId:11,awayId:12},{homeId:13,awayId:14}];
  // 0x1234=4660, 0xABCD=43981 but 43981>56 will fail validation – use small
  const m2 = [{homeId:1,awayId:2},{homeId:3,awayId:4},{homeId:5,awayId:6},{homeId:7,awayId:8},{homeId:9,awayId:10},{homeId:11,awayId:12},{homeId:13,awayId:14},{homeId:15,awayId:16}];
  const res = patchKonamiCupPairings(mem, m2);
  const off = KONAMI_CUP_PAIRING_ADDR;
  assert(mem[off]===1 && mem[off+1]===0,'home 1 LE');
  assert(mem[off+2]===2 && mem[off+3]===0,'away 2 LE');
  assert(mem[off+4]===3,'next home');
  console.log('  PASS LE verified');
}

async function testOutOfRange() {
  console.log('Test 5: Out-of-range rejection');
  const mem = new Uint8Array(33554432);
  let threw=false;
  try { patchKonamiCupPairings(mem, [{homeId:57,awayId:0},{homeId:0,awayId:0},{homeId:0,awayId:0},{homeId:0,awayId:0},{homeId:0,awayId:0},{homeId:0,awayId:0},{homeId:0,awayId:0},{homeId:0,awayId:0}]); } catch(e){ threw=true; console.log('  PASS threw:', e.message.slice(0,60)); }
  assert(threw,'should throw 57');
  threw=false;
  try { patchKonamiCupPairings(mem, [{homeId:-1,awayId:0},{homeId:0,awayId:0},{homeId:0,awayId:0},{homeId:0,awayId:0},{homeId:0,awayId:0},{homeId:0,awayId:0},{homeId:0,awayId:0},{homeId:0,awayId:0}]); } catch(e){ threw=true; }
  assert(threw,'negative');
}

async function testExactly8() {
  console.log('Test 6: Exactly-8 validation');
  const mem = new Uint8Array(33554432);
  let threw=false;
  try { patchKonamiCupPairings(mem, [{homeId:0,awayId:0}]); } catch(e){ threw=true; }
  assert(threw,'should throw not 8');
  threw=false;
  try { patchKonamiCupPairings(mem, Array.from({length:7},()=>({homeId:0,awayId:0}))); } catch(e){ threw=true; }
  assert(threw,'7 fails');
  console.log('  PASS');
}

async function testZstdParsing() {
  console.log('Test 7: Existing ZSTD P2S parsing');
  const p = 'forensic-fixtures/schedule_A.p2s';
  const buf = fs.readFileSync(p);
  const u8 = new Uint8Array(buf);
  const entries = P2sZstdPatcher.parseZipEntries(u8);
  assert(entries.length>0,'entries');
  const ee = entries.find(e=>e.name.toLowerCase()==='eememory.bin');
  assert(ee,'ee found');
  assert(ee.method===93,'zstd 93');
  const dec = P2sZstdPatcher.decompressEntry(ee);
  assert(dec.length===33554432,'33M');
  console.log('  PASS entries', entries.length, 'ee method', ee.method);
}

async function testZipRebuild() {
  console.log('Test 8: ZIP rebuild');
  const p = 'forensic-fixtures/schedule_A.p2s';
  const buf = fs.readFileSync(p);
  const goals = Array.from({length:48},()=>[0,0]);
  const top = Array.from({length:24},()=>({country:'',player:'',goals:'0'}));
  const result = await P2sZstdPatcher.patchP2sBuffer(buf, goals, top, null);
  assert(result.blob,'blob');
  assert(result.stats.eeMethod===8 || result.stats.eeMethod===0,'method deflate/store');
  console.log('  PASS rebuilt', result.stats.rebuiltSize);
}

async function testCRC() {
  console.log('Test 9: CRC verification');
  const data = new Uint8Array([1,2,3,4]);
  const crc = P2sZstdPatcher.crc32(data);
  assert(typeof crc==='number','crc number');
  // known: crc32 of [1,2,3,4] should be consistent
  const crc2 = P2sZstdPatcher.crc32(new Uint8Array([1,2,3,4]));
  assert(crc===crc2,'deterministic');
  console.log('  PASS crc', crc.toString(16));
}

async function testGoalsTopIntact() {
  console.log('Test 10: Goals/top patch intact with pairing');
  const p = 'forensic-fixtures/schedule_A.p2s';
  const buf = fs.readFileSync(p);
  const goals = Array.from({length:48},(_,i)=>[i%4, (i+1)%3]);
  const top = Array.from({length:24},(_,i)=>({country:'Test'+i, player:'Player'+i, goals:String(i%5)}));
  const pairings = [
    {homeId:44,awayId:41},{homeId:56,awayId:10},{homeId:28,awayId:11},{homeId:2,awayId:25},
    {homeId:3,awayId:53},{homeId:12,awayId:26},{homeId:54,awayId:9},{homeId:20,awayId:7}
  ];
  const result = await P2sZstdPatcher.patchP2sBuffer(buf, goals, top, pairings);
  const mem = result.eeDecompressed;
  // check goals
  assert(mem[0x00401000]===goals[0][0],'goals B1H');
  assert(mem[0x00401000+1]===goals[0][1],'goals B1A');
  // check pairing
  const view = new DataView(mem.buffer, mem.byteOffset);
  assert(view.getUint16(KONAMI_CUP_PAIRING_ADDR,true)===44,'pairing B1H');
  assert(view.getUint16(KONAMI_CUP_PAIRING_ADDR+2,true)===41,'pairing B1A');
  // check top
  assert(mem[0x00401800]===0,'top 0');
  console.log('  PASS goals/top/pairing intact');
  // verify second readback via rebuild
  const verifyEntries = P2sZstdPatcher.parseZipEntries(new Uint8Array(await result.blob.arrayBuffer()));
  const ve = verifyEntries.find(e=>e.name.toLowerCase()==='eememory.bin');
  const dec = P2sZstdPatcher.decompressEntry(ve);
  const v2 = new DataView(dec.buffer);
  assert(v2.getUint16(KONAMI_CUP_PAIRING_ADDR,true)===44,'rebuild pairing');
  console.log('  PASS rebuild pairing verified');
}

async function testPersistence() {
  console.log('Test 11: Persistence intact (code check)');
  const main = fs.readFileSync('src/js/main.js','utf8');
  assert(main.includes('localStorage'),'localStorage present');
  assert(main.includes('we10_tiktok_last_goals'),'persistence key');
  console.log('  PASS');
}

async function testImportParser() {
  console.log('Test 12: Import parser intact');
  const { parseImportLines } = await import('../src/js/utils/importParser.js');
  const { results, errors } = parseImportLines('Hungary 2:3 Romania\nBelgium 1:2 Ireland');
  assert(results.length===2,'2 parsed');
  assert(results[0].home==='Hungary' && results[0].away==='Romania','Hungary');
  console.log('  PASS', results);
}

async function testCountryResolver() {
  console.log('Test 13: Country resolver');
  assert(resolveCountryToId('Hungary')===22,'Hungary 22');
  assert(resolveCountryToId('Romania')===30,'Romania 30');
  assert(resolveCountryToId('Holland')===6,'Holland');
  assert(resolveCountryToId('Serbia & Mont.')===16,'SCG');
  assert(resolveCountryToId('Saudi Arabia')===54,'KSA');
  assert(resolveCountryToId('InvalidCountry')===null,'invalid null');
  const built = buildKonamiCupPairingsFromMatches([{home:'Hungary',away:'Romania', score:'2:3'},{home:'Belgium',away:'Ireland',score:'1:2'},{home:'Tunisia',away:'Japan',score:'2:3'},{home:'Serbia & Mont.',away:'Costa Rica',score:'3:2'},{home:'Russia',away:'Italy',score:'1:5'},{home:'Holland',away:'Colombia',score:'5:3'},{home:'Finland',away:'Peru',score:'2:0'},{home:'Mexico',away:'Spain',score:'3:2'}]);
  assert(built.length===8,'8 built');
  assert(built[0].homeId===22 && built[0].awayId===30,'B1');
  assert(built[7].homeId===42 && built[7].awayId===13,'B8');
  console.log('  PASS resolver', built.map(b=>`${b.homeId}-${b.awayId}`).join(','));
}

async function runAll(){
  try{
    await testBaseline();
    await testHungaryRomania();
    await testAllMatches();
    await testLE();
    await testOutOfRange();
    await testExactly8();
    await testZstdParsing();
    await testZipRebuild();
    await testCRC();
    await testGoalsTopIntact();
    await testPersistence();
    await testImportParser();
    await testCountryResolver();
    console.log('\nALL TESTS PASSED');
  }catch(e){
    console.error('TEST FAIL', e);
    process.exit(1);
  }
}
runAll();
