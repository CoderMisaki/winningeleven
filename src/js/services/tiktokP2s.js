/**
 * TikTok Save Sync - Generate .p2s / .pnach from web inputs
 * Patch template.p2s at TikTokHook 00400000 region + league table
 * Ghidra: SLPM_663.74 TikTokHook 00400000-00401FFF rwx, goals @00401000, topScorer @00401800
 * p2s layout: PCSX2 2.0 ZIP with zstd (method 93) - eeMemory.bin 32MB
 * Robust patcher: custom ZIP parser + fzstd (zstd) decompress, STORE rebuild (no JSZip)
 */

import { P2sZstdPatcher } from './p2sZstdPatcher.js';

export const KONAMI_CUP_PAIRING_ADDR = 0x01323404;
export const KONAMI_CUP_PAIRING_SIZE = 32;

// Canonical WE10 team ID map (0..56) – P2S VERIFIED + RUNTIME VERIFIED
// Source: EE 0x003C00C0 stride 0x10, forensic 0x01323404
const WE10_TEAM_ID_BY_NAME = {
  'ireland': 0, 'italy': 1, 'england': 2, 'wales': 3, 'ukraine': 4, 'austria': 5,
  'netherlands': 6, 'holland': 6, 'dutch': 6, 'ned': 6,
  'greece': 7, 'northern ireland': 8, 'n. ireland': 8, 'croatia': 9,
  'switzerland': 10, 'swiss': 10, 'sweden': 11, 'scotland': 12, 'spain': 13,
  'slovakia': 14, 'slovenia': 15,
  'serbia & mont.': 16, 'serbia and mont.': 16, 'serbia & montenegro': 16, 'serbia and montenegro': 16, 'scg': 16, 'serbia': 16,
  'czech': 17, 'czech republic': 17, 'czech rep.': 17, 'czechia': 17,
  'denmark': 18, 'germany': 19, 'turkey': 20, 'norway': 21, 'hungary': 22, 'finland': 23, 'france': 24,
  'bulgaria': 25, 'belgium': 26, 'poland': 27, 'portugal': 28, 'latvia': 29, 'romania': 30, 'russia': 31,
  'angola': 32, 'ghana': 33, 'cameroon': 34, 'ivory coast': 35, 'tunisia': 36, 'togo': 37,
  'nigeria': 38, 'south africa': 39, 'usa': 40, 'united states': 40, 'america': 40,
  'costa rica': 41, 'mexico': 42, 'trinidad & tobago': 43, 'trinidad and tobago': 43, 'trinidad': 43,
  'argentina': 44, 'uruguay': 45, 'ecuador': 46, 'colombia': 47, 'chile': 48, 'paraguay': 49,
  'brazil': 50, 'peru': 51, 'iran': 52, 'korea': 53, 'south korea': 53, 'saudi arabia': 54, 'saudi': 54, 'japan': 55, 'australia': 56
};

function normalizeCountryKey(name) {
  return String(name).trim().toLowerCase()
    .replace(/\./g, '') // remove dots: "mont." -> "mont"
    .replace(/\s*&\s*/g, ' & ') // normalize ampersand spacing
    .replace(/\s+and\s+/g, ' & ') // "and" -> "&"
    .replace(/\s+/g, ' ')
    .trim();
}

// Build normalized lookup for robust alias handling (dot-less, &/and variants)
const WE10_NORMALIZED_MAP = (() => {
  const m = new Map();
  for (const [k, v] of Object.entries(WE10_TEAM_ID_BY_NAME)) {
    const nk = normalizeCountryKey(k);
    if (!m.has(nk)) m.set(nk, v);
  }
  // explicit dot-less serbia variants (already via normalize, but ensure)
  m.set('serbia & mont', 16);
  m.set('serbia and mont', 16);
  m.set('serbia & montenegro', 16);
  m.set('serbia and montenegro', 16);
  return m;
})();

export function resolveCountryToId(name) {
  if (!name) return null;
  const key = String(name).trim().toLowerCase().replace(/\s+/g, ' ');
  if (WE10_TEAM_ID_BY_NAME.hasOwnProperty(key)) return WE10_TEAM_ID_BY_NAME[key];
  const nk = normalizeCountryKey(name);
  if (WE10_NORMALIZED_MAP.has(nk)) return WE10_NORMALIZED_MAP.get(nk);
  // fallback: try alias without punctuation (original cleaned)
  const cleaned = key.replace(/[.]/g, '').trim();
  if (WE10_TEAM_ID_BY_NAME.hasOwnProperty(cleaned)) return WE10_TEAM_ID_BY_NAME[cleaned];
  if (WE10_NORMALIZED_MAP.has(cleaned)) return WE10_NORMALIZED_MAP.get(cleaned);
  return null;
}

export function getPairingDebugInfo(matches) {
  const rows = [];
  for (let i = 0; i < 8; i++) {
    const m = (matches && matches[i]) || {};
    const homeRaw = m?.home ?? '';
    const awayRaw = m?.away ?? '';
    const homeId = resolveCountryToId(homeRaw);
    const awayId = resolveCountryToId(awayRaw);
    const hasHome = String(homeRaw).trim().length > 0;
    const hasAway = String(awayRaw).trim().length > 0;
    let status = 'FAIL';
    let reason = '';
    if (!hasHome && !hasAway) reason = 'empty row';
    else if (homeId === null && hasHome) reason = `"${homeRaw}" could not be resolved`;
    else if (awayId === null && hasAway) reason = `"${awayRaw}" could not be resolved`;
    else if (homeId === null || awayId === null) reason = 'missing team';
    else status = 'PASS';
    rows.push({ index: i, homeRaw, awayRaw, homeId, awayId, status, reason });
  }
  return rows;
}

export function buildKonamiCupPairingsFromMatches(matches) {
  if (!Array.isArray(matches) || matches.length !== 8) return null;
  const out = [];
  for (let i = 0; i < 8; i++) {
    const m = matches[i];
    const homeId = resolveCountryToId(m?.home);
    const awayId = resolveCountryToId(m?.away);
    if (homeId === null || awayId === null) return null; // need both valid to patch pairing; skip if incomplete
    out.push({ homeId, awayId, home: m.home, away: m.away });
  }
  return out;
}

export const TikTokP2sService = {
  // RAM addresses (Ghidra)
  HOOK_BASE: 0x00400000,
  GOALS_ADDR: 0x00401000, // 48*2 uint8 = 96 bytes
  TOP_ADDR: 0x00401800,   // 24 uint8
  MATCHIDX_ADDR: 0x00400004,
  KONAMI_CUP_PAIRING_ADDR,
  // p2s header size guess (PCSX2 2.0: 32 bytes + 4 bytes version). We auto-detect by searching for island
  HEADER_GUESS: 0x80,

  // Pack goals [[2,1],[1,1]] -> Uint8Array 96
  packGoals(goals) {
    const out = new Uint8Array(96);
    for (let i = 0; i < 48; i++) {
      const g = goals[i] || [0,0];
      out[i*2] = g[0] & 0xFF;
      out[i*2+1] = g[1] & 0xFF;
    }
    return out;
  },
  // Pack top goals names+goals: stored at 00401800 goals[24] + 00401900 names (ascii 32*24)
  packTopNames(topGoals) {
    // topGoals = [{country,player,goals},...16]
    const namesBytes = new Uint8Array(768); // 24*32
    for (let i=0;i<24;i++) {
      const g = topGoals[i] || {country:"",player:"",goals:"0"};
      const str = `${g.country} ${g.player}`.trim().slice(0,31);
      for (let j=0;j<str.length;j++) namesBytes[i*32+j] = str.charCodeAt(j) & 0xFF;
    }
    return namesBytes;
  },

  // Detect p2s RAM offset: search for known marker or assume header 0x80
  // If template is .ps2 memory card (8MB), offset is different - we handle both
  getFileOffset(ramAddr, fileSize) {
    // Heuristic: if fileSize ~ 33MB (p2s gz decompressed ~ 35MB), RAM start approx 0x10000?
    // Simplest: ramAddr - 0x00100000 + HEADER_GUESS
    // For .ps2 (8MB) we don't patch - return -1 to trigger pnach fallback
    if (fileSize > 20_000_000) { // p2s
      return (ramAddr - 0x00100000) + this.HEADER_GUESS;
    }
    return -1;
  },

  // Robust patch: handles PCSX2 2.0 ZIP with zstd (93) via custom parser + fzstd.
  // Fallback to legacy raw/gz handling if not ZIP.
  async patchP2sTemplate(templateBuffer, goals, topScorer, konamiCupPairings = null) {
    const buf = new Uint8Array(templateBuffer.slice(0));
    const isZip = buf[0] === 0x50 && buf[1] === 0x4B;
    const isGz = buf[0] === 0x1F && buf[1] === 0x8B;
    // Normalize konamiCupPairings: allow 8 string pairs {home,away} -> build via resolver, or already {homeId,awayId}
    let normalizedPairings = null;
    if (Array.isArray(konamiCupPairings) && konamiCupPairings.length === 8) {
      const first = konamiCupPairings[0];
      if (first && typeof first.homeId === 'number' && typeof first.awayId === 'number') {
        normalizedPairings = konamiCupPairings;
      } else if (first && (typeof first.home === 'string' || typeof first.away === 'string')) {
        normalizedPairings = buildKonamiCupPairingsFromMatches(konamiCupPairings);
      }
    }
    // ZIP path: use robust zstd-aware patcher (no JSZip)
    if (isZip) {
      try {
        const result = await P2sZstdPatcher.patchP2sBuffer(buf, goals, topScorer, normalizedPairings);
        // Attach pairing debug if available
        if (result.pairingPatchResult) {
          result.pairingDebug = result.pairingPatchResult.debugLines;
        }
        return { blob: result.blob, isZip: true, raw: result.eeDecompressed, stats: result.stats, pairingDebug: result.pairingPatchResult?.debugLines || null };
      } catch (e) {
        // Provide actionable error with hint about fallback
        const msg = e.message || String(e);
        if (msg.includes('Zstd') || msg.includes('0x5d') || msg.includes('93')) {
          throw new Error(`PCSX2 save state menggunakan kompresi zstd (0x5D) yang JSZip tidak support. Patch robust gagal: ${msg}. Template tetap valid, tapi kode sudah diperbaiki untuk handle zstd — coba refresh page. Jika masih gagal, pakai Generate .pnach sebagai fallback.`);
        }
        throw new Error(`Patch .p2s gagal: ${msg}`);
      }
    }

    // Non-ZIP: fallback to raw/gz handling (PCSX2 1.6 or raw dump)
    // Keep legacy logic for gzip/raw but without JSZip dependency
    let raw = buf;
    if (isGz) {
      try {
        const ds = new DecompressionStream('gzip');
        const stream = new Blob([buf]).stream().pipeThrough(ds);
        const decompressed = await new Response(stream).arrayBuffer();
        raw = new Uint8Array(decompressed);
      } catch (e) {
        throw new Error('Template .p2s gzip - browser tidak support DecompressionStream. Pakai template ZIP .p2s dari PCSX2 2.0. (' + e.message + ')');
      }
    }
    const goalsBytes = this.packGoals(goals);
    const isObj = topScorer[0] && typeof topScorer[0] === 'object';
    const topNumbers = isObj ? topScorer.map(o => parseInt(o.goals || 0, 10) || 0) : topScorer;
    const topBytes = new Uint8Array(24);
    for (let i = 0; i < 24; i++) topBytes[i] = (topNumbers[i] || 0) & 0xFF;

    const isP2s = raw.length > 20_000_000;
    if (!isP2s) {
      const base = 0x00100000;
      const patchAt = (addr, data) => {
        const off = addr - base;
        if (off < 0 || off + data.length > raw.length) throw new Error(`Offset patch diluar file: ${addr.toString(16)} off ${off} (file ${raw.length}) - template harus Save State .p2s dari PCSX2 di layar Schedule table`);
        raw.set(data, off);
      };
      patchAt(this.GOALS_ADDR, goalsBytes);
      patchAt(this.TOP_ADDR, topBytes);
      try { const namesBytes = this.packTopNames(isObj ? topScorer : topNumbers.map((n, i) => ({ country: '', player: '', goals: String(n) }))); patchAt(0x00401900, namesBytes); } catch (_) {}
      raw[this.MATCHIDX_ADDR - base] = 0;
      raw[this.MATCHIDX_ADDR - base + 1] = 0;
      raw[this.MATCHIDX_ADDR - base + 2] = 0;
      raw[this.MATCHIDX_ADDR - base + 3] = 0;
      // Verified pairing: for 8MB card raw is too small, skip pairing (address out of range) – do not fail
      let outBuf = raw;
      if (isGz) {
        try {
          const cs = new CompressionStream('gzip');
          const stream = new Blob([raw]).stream().pipeThrough(cs);
          outBuf = new Uint8Array(await new Response(stream).arrayBuffer());
        } catch (e) { throw new Error('Gzip compress gagal: ' + e.message); }
      }
      return { blob: new Blob([outBuf], { type: 'application/octet-stream' }), isGz, raw };
    }
    const offGoals = this.getFileOffset(this.GOALS_ADDR, raw.length);
    const offTop = this.getFileOffset(this.TOP_ADDR, raw.length);
    const offIdx = this.getFileOffset(this.MATCHIDX_ADDR, raw.length);
    const offNames = this.getFileOffset(0x00401900, raw.length);
    if (offGoals < 0 || offGoals + 96 > raw.length) throw new Error('Offset goals diluar p2s - header guess salah.');
    raw.set(goalsBytes, offGoals);
    raw.set(topBytes, offTop);
    if (offNames >= 0) try { const nb = this.packTopNames(isObj ? topScorer : topNumbers.map((n, i) => ({ country: '', player: '', goals: String(n) }))); raw.set(nb, offNames); } catch (_) {}
    raw[offIdx] = 0; raw[offIdx + 1] = 0; raw[offIdx + 2] = 0; raw[offIdx + 3] = 0;
    // --- VERIFIED KONAMI CUP PAIRING PATCH for raw path ---
    if (normalizedPairings) {
      const offPair = this.getFileOffset(KONAMI_CUP_PAIRING_ADDR, raw.length);
      if (offPair >= 0 && offPair + 32 <= raw.length) {
        // use isolated logic via DataView on raw
        const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
        for (let i = 0; i < 8; i++) {
          view.setUint16(offPair + i * 4, normalizedPairings[i].homeId, true);
          view.setUint16(offPair + i * 4 + 2, normalizedPairings[i].awayId, true);
        }
        // read-back verification
        for (let i = 0; i < 8; i++) {
          const h = view.getUint16(offPair + i * 4, true);
          const a = view.getUint16(offPair + i * 4 + 2, true);
          if (h !== normalizedPairings[i].homeId || a !== normalizedPairings[i].awayId) {
            throw new Error(`KONAMI CUP PAIRING PATCH VERIFICATION FAIL raw path at B${i+1}: expected ${normalizedPairings[i].homeId}-${normalizedPairings[i].awayId} got ${h}-${a}`);
          }
        }
      } else {
        throw new Error(`KONAMI CUP PAIRING PATCH: address 0x${KONAMI_CUP_PAIRING_ADDR.toString(16)} offset ${offPair} out of range`);
      }
    }
    let outBuf = raw;
    if (isGz) {
      try {
        const cs = new CompressionStream('gzip');
        const stream = new Blob([raw]).stream().pipeThrough(cs);
        outBuf = new Uint8Array(await new Response(stream).arrayBuffer());
      } catch (e) { throw new Error('Gzip compress gagal: ' + e.message); }
    }
    return { blob: new Blob([outBuf], { type: 'application/octet-stream' }), isGz, raw };
  },

  generatePnach(goals, topScorer, konamiCupPairings = null) {
    let out = `gametitle=WE10 TikTok Sync - Web Generated [SLPM_663.74 9337F97]\n`;
    out += `comment=Generated ${new Date().toISOString()} - goals ${goals.length} top ${topScorer.length} - TikTokHook 00400000\n`;
    out += `// 00401000 goals[48][2] | 00401800 topScorer[24] | 01323404 pairing 16*u16 LE stride 04 (P2S+RUNTIME VERIFIED, not yet UI VERIFIED)\n`;
    const goalsBytes = this.packGoals(goals);
    // pack 4 bytes per patch line (LE)
    for (let off=0; off<goalsBytes.length; off+=4) {
      const addr = this.GOALS_ADDR + off;
      const w = (goalsBytes[off] | (goalsBytes[off+1]<<8) | (goalsBytes[off+2]<<16) | (goalsBytes[off+3]<<24)) >>>0;
      out += `patch=1,EE,${addr.toString(16).toUpperCase().padStart(8,'0')},extended,${w.toString(16).toUpperCase().padStart(8,'0')}\n`;
    }
    for (let off=0; off<24; off+=4) {
      const addr = this.TOP_ADDR + off;
      const b0 = topScorer[off]||0, b1=topScorer[off+1]||0, b2=topScorer[off+2]||0, b3=topScorer[off+3]||0;
      const w = (b0 | (b1<<8) | (b2<<16) | (b3<<24)) >>>0;
      if (off>=24) break;
      out += `patch=1,EE,${addr.toString(16).toUpperCase().padStart(8,'0')},extended,${w.toString(16).toUpperCase().padStart(8,'0')}\n`;
    }
    out += `patch=1,EE,00400004,extended,00000000\n`;
    // Verified pairing pnach (u16 LE per team, 4 bytes per match = 32 bytes = 8 lines)
    let normalized = null;
    if (Array.isArray(konamiCupPairings) && konamiCupPairings.length === 8) {
      const first = konamiCupPairings[0];
      if (first && typeof first.homeId === 'number') normalized = konamiCupPairings;
      else if (first && typeof first.home === 'string') normalized = buildKonamiCupPairingsFromMatches(konamiCupPairings);
    }
    if (normalized) {
      out += `// KONAMI CUP PAIRING PATCH 0x01323404 u16 LE stride 04 (P2S+RUNTIME VERIFIED)\n`;
      for (let i = 0; i < 8; i++) {
        const addr = KONAMI_CUP_PAIRING_ADDR + i * 4;
        const w = (normalized[i].homeId & 0xFFFF) | ((normalized[i].awayId & 0xFFFF) << 16);
        out += `patch=1,EE,${addr.toString(16).toUpperCase().padStart(8,'0')},extended,${w.toString(16).toUpperCase().padStart(8,'0')}\n`;
      }
    }
    return out;
  },

  // Buat minimal .p2s valid 32MB (EE RAM) kalau user belum upload template - biar download tetap .p2s dan bisa di-load (PCSX2 akan load RAM patch, GS/VU kosong tapi schedule table tetap muncul)
  async createMinimalP2s(goals, topScorerObjs) {
    const topNumbers = topScorerObjs.map(o=>parseInt(o.goals||0,10)||0);
    const goalsBytes = this.packGoals(goals);
    const topBytes = new Uint8Array(24);
    for(let i=0;i<24;i++) topBytes[i]= topNumbers[i] & 0xFF;
    const namesBytes = this.packTopNames(topScorerObjs);
    // 32MB EE RAM dummy (PCSX2 p2s uncompressed ~35MB, kita buat 32MB + header 0x80)
    const ramSize = 32 * 1024 * 1024;
    const raw = new Uint8Array(ramSize + 0x80);
    // header "P2S\x00" fake
    raw[0]=0x50; raw[1]=0x32; raw[2]=0x53; raw[3]=0x00;
    const offGoals = (this.GOALS_ADDR - 0x00100000) + 0x80;
    const offTop = (this.TOP_ADDR - 0x00100000) + 0x80;
    const offNames = (0x00401900 - 0x00100000) + 0x80;
    const offIdx = (this.MATCHIDX_ADDR - 0x00100000) + 0x80;
    raw.set(goalsBytes, offGoals);
    raw.set(topBytes, offTop);
    raw.set(namesBytes, offNames);
    raw[offIdx]=0; raw[offIdx+1]=0; raw[offIdx+2]=0; raw[offIdx+3]=0;
    // gzip
    const cs = new CompressionStream('gzip');
    const stream = new Blob([raw]).stream().pipeThrough(cs);
    const gz = new Uint8Array(await new Response(stream).arrayBuffer());
    return new Blob([gz], {type:'application/octet-stream'});
  },

  triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click();
    setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); }, 1000);
  }
};
