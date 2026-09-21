import { getTeamPlayers, getPlayerDatabase, normalizePlayerName } from "../data/playerAttributes.js";
import { getTeamScoringProfile, scoringHashSeed, PLAYER_SCORING_CONFIG } from "./playerScoring.js";
import { teamsDB } from "../data/teams.js";
import { normalizeCountry } from "./similarity.js";
function scoringIndexLocal(player){
  if(!player) return 0;
  const role = PLAYER_SCORING_CONFIG.ROLE_WEIGHT[String(player.pos||"").toUpperCase()] ?? 0.30;
  const base = 0.45*(player.finishing??60)+0.30*(player.positioning??60)+0.15*(player.technique??60)+0.10*(player.shotPower??70);
  const v = base * (0.55 + 0.90*role);
  return Math.round(Math.max(1, Math.min(99, v)));
}

const STORAGE_KEY = "we10_draft_v1";

function loadDraftState(){
  try{ const raw=localStorage.getItem(STORAGE_KEY); if(!raw) return null; return JSON.parse(raw);}catch(_){return null;}
}
function saveDraftState(s){
  try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); }catch(_){}
}

function normPlayer(raw){ return normalizePlayerName(String(raw||"").trim()); }
function teamCodeFromName(raw){
  const c = normalizeCountry(String(raw||"").trim());
  if(c && teamsDB[c]) return c;
  return null;
}
function findPlayerTeam(playerName){
  const target = normPlayer(playerName);
  if(!target) return null;
  const db = getPlayerDatabase();
  // exact first
  for(const [code, players] of Object.entries(db)){
    for(const p of players){ if(normPlayer(p.name)===target) return code; }
  }
  // partial: unique substring (naka -> nakamura, taka -> takahara)
  const candidates=[];
  for(const [code, players] of Object.entries(db)){
    for(const p of players){
      const pn = normPlayer(p.name);
      if(pn.includes(target) || target.includes(pn)) candidates.push({code, pn});
    }
  }
  if(candidates.length===1) return candidates[0].code;
  // prefer prefix match if multiple but one prefix
  const prefix = candidates.filter(c=> c.pn.startsWith(target));
  if(prefix.length===1) return prefix[0].code;
  return null;
}
function resolvePlayerExactName(input){
  const target = normPlayer(input);
  const db = getPlayerDatabase();
  for(const [code, players] of Object.entries(db)){
    for(const p of players){ if(normPlayer(p.name)===target) return p.name; }
  }
  const cand=[];
  for(const [code, players] of Object.entries(db)){
    for(const p of players){
      const pn = normPlayer(p.name);
      if(pn.includes(target) || target.includes(pn)) cand.push(p.name);
    }
  }
  if(cand.length===1) return cand[0];
  const pref = cand.filter(n=> normPlayer(n).startsWith(target));
  if(pref.length===1) return pref[0];
  return null;
}

/**
 * Build pool dari B1-B8 : semua pemain dari tim yang ada di B1-B8
 * VALIDASI: jika B1-B8 kosong → pool kosong → draft TIDAK BISA diisi (bukan dummy fallback ke 57 tim)
 */
function buildPoolFromMatches(matches){
  const codes = new Set();
  for(const m of (matches||[]).slice(0,8)){
    const hc = teamCodeFromName(m?.home);
    const ac = teamCodeFromName(m?.away);
    if(hc) codes.add(hc);
    if(ac) codes.add(ac);
  }
  if(codes.size===0){
    return [];
  }
  const pool=[];
  for(const code of codes){
    const profile = getTeamScoringProfile(code, { formEnabled: true });
    // profile.players sudah ada selectionProbability, roleWeight etc.
    for(const entry of (profile.players||[])){
      if(String(entry.pos).toUpperCase()==="GK") continue;
      // exclude if role 0
      if((entry.roleWeight||0) <= 0) continue;
      pool.push({
        name: entry.name,
        pos: entry.pos,
        teamCode: code,
        teamName: teamsDB[code]?.name || code,
        flag: teamsDB[code]?.flag || "",
        finishing: entry.player?.finishing ?? 60,
        positioning: entry.player?.positioning ?? 60,
        technique: entry.player?.technique ?? 60,
        shotPower: entry.player?.shotPower ?? 70,
        selectionProbability: entry.selectionProbability || 0,
        roleWeight: entry.roleWeight || 0,
        formMultiplier: entry.formMultiplier || 1,
        overall: entry.player ? (entry.player.overall || 0) : 0,
        scoringIndex: scoringIndexLocal(entry.player)
      });
    }
  }
  return pool;
}

function rankPool(pool){
  return pool.sort((a,b)=>{
    const scoreA = a.selectionProbability*100 + a.scoringIndex*0.35 + (a.finishing-65)*0.04;
    const scoreB = b.selectionProbability*100 + b.scoringIndex*0.35 + (b.finishing-65)*0.04;
    return scoreB - scoreA;
  });
}
export function searchDraftPlayers(query, matches){
  const codes = DraftService.getB18Codes(matches);
  if(codes.size===0) return [];
  const q = String(query||"").toLowerCase().trim();
  if(!q) return [];
  const pool = buildPoolFromMatches(matches);
  // filter pool by query substring
  const filtered = pool.filter(p=>{
    const pn = normPlayer(p.name);
    return pn.includes(q) || q.includes(pn) || p.name.toLowerCase().includes(q);
  });
  // rank filtered
  return rankPool(filtered).slice(0,8);
}

export const DraftService = {
  STORAGE_KEY,
  MAX_BAN: 3,
  MAX_BANDAR: 1,
  MAX_YES: 1,
  load(){ return loadDraftState() || { bans: [], bandar: [], yes: [] }; },
  save(state){ saveDraftState(state); },
  normalizePlayerName: normPlayer,
  getB18Codes(matches){
    const codes=new Set();
    for(const m of (matches||[]).slice(0,8)){
      const hc=teamCodeFromName(m?.home); const ac=teamCodeFromName(m?.away);
      if(hc) codes.add(hc); if(ac) codes.add(ac);
    }
    return codes;
  },
  isB18Empty(matches){ return this.getB18Codes(matches).size===0; },
  isPlayerInB18(playerName, matches){
    const target=normPlayer(playerName);
    const codes=this.getB18Codes(matches);
    if(codes.size===0) return false;
    const db=getPlayerDatabase();
    for(const code of codes){
      const players=db[code]||[];
      if(players.some(p=> normPlayer(p.name)===target || normPlayer(p.name).includes(target))) return true;
    }
    return false;
  },

  /** Validate & add ban — substring allowed (naka blocks nakamura+nakazawa) — HANYA B1-B8 */
  addBan(list, playerName, matches=null){
    const raw = String(playerName||"").trim();
    const norm = normPlayer(raw);
    if(!norm) return { ok:false, msg:"Nama kosong" };
    if(matches && this.isB18Empty(matches)) return { ok:false, msg:"Isi B1-B8 dulu — draft hanya dari negara di B1-B8 (sekarang kosong)" };
    if(list.length >= this.MAX_BAN) return { ok:false, msg:`BAN (NO) maksimal ${this.MAX_BAN} pemain` };
    if(list.some(p=> normPlayer(p)===norm || normPlayer(p).includes(norm) || norm.includes(normPlayer(p)))) return { ok:false, msg:"Sudah di BAN" };
    if(matches && !this.isPlayerInB18(raw, matches)) return { ok:false, msg:`"${raw}" bukan dari negara B1-B8 — pilih hanya pemain dari B1-B8 (${[...this.getB18Codes(matches)].join(",")})` };
    const db = getPlayerDatabase();
    let exists=false;
    for(const players of Object.values(db)){
      if(players.some(p=> normPlayer(p.name).includes(norm))){ exists=true; break; }
    }
    if(!exists) return { ok:false, msg:`Pemain "${raw}" tidak ditemukan di roster 57 tim` };
    const exact = resolvePlayerExactName(raw) || raw;
    list.push(exact);
    return { ok:true, resolved: exact };
  },

  addBandar(list, playerName, matches=null){
    const raw = String(playerName||"").trim();
    const norm = normPlayer(raw);
    if(!norm) return { ok:false, msg:"Nama kosong" };
    if(matches && this.isB18Empty(matches)) return { ok:false, msg:"Isi B1-B8 dulu — draft hanya dari B1-B8" };
    if(list.length >= this.MAX_BANDAR) return { ok:false, msg:`Bandar maksimal ${this.MAX_BANDAR} pemain (cuma 1)` };
    if(matches && !this.isPlayerInB18(raw, matches)) return { ok:false, msg:`Bandar "${raw}" bukan dari B1-B8 — pilih hanya dari B1-B8 (${[...this.getB18Codes(matches)].join(",")})` };
    const db = getPlayerDatabase();
    let exists=false;
    for(const players of Object.values(db)){
      if(players.some(p=> normPlayer(p.name).includes(norm))){ exists=true; break; }
    }
    if(!exists) return { ok:false, msg:`Pemain "${raw}" tidak ditemukan` };
    const exact = resolvePlayerExactName(raw) || raw;
    list.length = 0;
    list.push(exact);
    return { ok:true, resolved: exact };
  },
  addYes(list, playerName, bans=[], bandar=[], matches=null){
    const raw = String(playerName||"").trim();
    const norm = normPlayer(raw);
    if(!norm) return { ok:false, msg:"Nama kosong" };
    if(matches && this.isB18Empty(matches)) return { ok:false, msg:"Isi B1-B8 dulu — draft hanya dari B1-B8" };
    if(matches && !this.isPlayerInB18(raw, matches)) return { ok:false, msg:`"${raw}" bukan dari negara B1-B8 — pilih hanya dari B1-B8 (${[...this.getB18Codes(matches)].join(",")})` };
    if(list.length >= this.MAX_YES) return { ok:false, msg:`YES maksimal ${this.MAX_YES} pemain (cuma 1 melawan bandar)` };
    if(bans.some(b=> { const bn=normPlayer(b); return bn===norm || bn.includes(norm) || norm.includes(bn); })) return { ok:false, msg:`Tidak boleh pick pemain di BAN (NO): ${raw}` };
    // check same country as bandar
    const db = getPlayerDatabase();
    let teamOfRaw = null;
    for(const [code, players] of Object.entries(db)){
      if(players.some(p=> normPlayer(p.name).includes(norm) || normPlayer(p.name)===norm)){ teamOfRaw = code; break; }
    }
    // also try exact
    if(!teamOfRaw) teamOfRaw = findPlayerTeam(raw);
    const bandarTeams = new Set();
    for(const b of bandar){
      const bn = normPlayer(b);
      for(const [code, players] of Object.entries(db)){
        if(players.some(p=> normPlayer(p.name).includes(bn))) bandarTeams.add(code);
      }
    }
    if(teamOfRaw && bandarTeams.has(teamOfRaw)) return { ok:false, msg:`Tidak boleh satu negara dengan BANDAR (${raw} negara ${teamOfRaw} sama dengan bandar ${[...bandarTeams].join(",")})` };
    const exact = resolvePlayerExactName(raw) || raw;
    list.length = 0;
    list.push(exact);
    return { ok:true, resolved: exact };
  },

  /** Rekomendasi adaptif 1-3 pemain */
  recommend({ matches, bans=[], bandar=[], yesExisting=[] }){
    const bannedNorm = bans.map(b=>normPlayer(b)).filter(Boolean);
    // bandarTeams: union of all teams that have a player whose name contains bandar substring
    const bandarTeams = new Set();
    const dbForBandar = getPlayerDatabase();
    for(const b of bandar){
      const bn = normPlayer(b);
      for(const [code, players] of Object.entries(dbForBandar)){
        if(players.some(p=> normPlayer(p.name).includes(bn))) bandarTeams.add(code);
      }
    }
    const yesNorm = yesExisting.map(y=>normPlayer(y)).filter(Boolean);

    let pool = buildPoolFromMatches(matches);
    // Filter banned — substring-aware (naka blocks nakamura)
    pool = pool.filter(p=>{
      const pn = normPlayer(p.name);
      for(const b of bannedNorm){ if(pn.includes(b) || b.includes(pn)) return false; }
      return true;
    });
    // Filter bandar same country
    pool = pool.filter(p=> !bandarTeams.has(p.teamCode));
    // Filter already yes (jangan rekom yang sudah di YES) — substring aware
    pool = pool.filter(p=>{
      const pn = normPlayer(p.name);
      for(const y of yesNorm){ if(pn===y || pn.includes(y) || y.includes(pn)) return false; }
      return true;
    });

    if(pool.length===0){
      const codes=[...new Set((matches||[]).flatMap(m=>[teamCodeFromName(m?.home), teamCodeFromName(m?.away)].filter(Boolean)))];
      if(codes.length===0) return { ok:false, msg:"B1-B8 kosong — isi B1-B8 dulu (draft hanya dari negara B1-B8, bukan 57 fallback dummy)", pool:[], recommended:[] };
      return { ok:false, msg:"Tidak ada pemain tersisa (semua ter-BAN atau satu negara bandar). Kurangi BAN atau ganti BANDAR.", pool:[], recommended:[] };
    }

    pool = rankPool(pool);

    // Adaptif melawan bandar: kalau bandar ada (1), rekom 1 lawan terbaik
    // Kalau tanpa bandar, adaptif 1-3 seperti biasa
    let count;
    if(bandar.length > 0){
      count = 1; // YES cuma 1 melawan bandar 1
    } else {
      count = 3;
      if(pool.length < 3) count = pool.length;
      else {
        const s1 = pool[0].selectionProbability*100 + pool[0].scoringIndex*0.35;
        const s2 = pool[1].selectionProbability*100 + pool[1].scoringIndex*0.35;
        const s3 = pool[2].selectionProbability*100 + pool[2].scoringIndex*0.35;
        const gap12 = s1 - s2;
        const gap23 = s2 - s3;
        if(gap12 > 12 && gap23 > 8) count = 1;
        else if(gap12 > 6 || pool.length < 6) count = 2;
        else count = 3;
      }
      count = Math.min(3, Math.max(1, count));
    }
    const recommended = pool.slice(0, count).map((p,i)=>{
      const why = [];
      why.push(`Posisi ${p.pos} (role ${p.roleWeight.toFixed(2)} paling tinggi CF/ST)`);
      why.push(`Finishing ${p.finishing} / positioning ${p.positioning} → shot pGoal tinggi vs rata-rata`);
      why.push(`Peluang dipilih ${ (p.selectionProbability*100).toFixed(1)}% tiap chance (involvement + stamina + form x${p.formMultiplier.toFixed(2)})`);
      if(bans.length) why.push(`Lolos filter BAN (NO): tidak ada di [${bans.join(", ")}]`);
      if(bandar.length) why.push(`Beda negara bandar [${bandar.join(", ")}] → ${p.teamName} aman (bandar ${[...bandarTeams].join(",")})`);
      why.push(`Hanya dari tim di B1-B8 (${p.teamCode} ada di Schedule)`);
      const proof = `Composite ${(p.selectionProbability*100 + p.scoringIndex*0.35).toFixed(1)} = pick${(p.selectionProbability*100).toFixed(1)}% + idx${p.scoringIndex}*0.35 + finishing bonus`;
      return { ...p, rank:i+1, why, proof };
    });
    return { ok:true, poolSize: pool.length, recommended, poolPreview: pool.slice(0,10) };
  }
};
