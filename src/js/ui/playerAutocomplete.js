import { WE10_FULL_ROSTER } from '../data/we10FullRoster.js';
import { teamsDB } from '../data/teams.js';

// Build flat list of players with teamCode
const allPlayers = [];
const teamCodeMap = new Map(); // lower name -> code
Object.keys(teamsDB).forEach(code => {
  teamCodeMap.set(teamsDB[code].name.toLowerCase(), code);
});

Object.keys(WE10_FULL_ROSTER).forEach(code => {
  const list = WE10_FULL_ROSTER[code];
  const teamName = teamsDB[code]?.name || code;
  const flag = teamsDB[code]?.flag || '';
  list.forEach(p => {
    allPlayers.push({
      name: p.name,
      pos: p.pos,
      weight: p.weight,
      teamCode: code,
      teamName,
      flag,
      lower: p.name.toLowerCase()
    });
  });
});

function findPlayerMatches(query, preferredTeamCode = null) {
  if (!query) return [];
  const q = query.toLowerCase().trim();
  if (!q) return [];
  let results = [];
  const seen = new Set();
  const add = (p, score) => {
    const key = p.name + '|' + p.teamCode;
    if (seen.has(key)) return;
    seen.add(key);
    // boost if preferred team
    let finalScore = score;
    if (preferredTeamCode && p.teamCode === preferredTeamCode) finalScore += 20;
    results.push({ data: p, score: finalScore });
  };
  // 1. exact
  for (const p of allPlayers) {
    if (p.lower === q) add(p, 100);
  }
  // 2. prefix
  for (const p of allPlayers) {
    if (p.lower.startsWith(q)) add(p, 50);
  }
  // 3. substring
  for (const p of allPlayers) {
    if (seen.has(p.name + '|' + p.teamCode)) continue;
    if (p.lower.includes(q)) add(p, 10);
  }
  // 4. fuzzy simple: split query into tokens
  // If no results, try token prefix
  if (results.length === 0) {
    const tokens = q.split(/\s+/);
    for (const p of allPlayers) {
      for (const t of tokens) {
        if (p.lower.includes(t)) { add(p, 5); break; }
      }
    }
  }
  results.sort((a, b) => b.score - a.score || a.data.name.localeCompare(b.data.name));
  return results.slice(0, 8).map(r => r.data);
}

// Global click close already handled in autocomplete.js, but ensure player boxes also close
document.addEventListener('click', (e) => {
  document.querySelectorAll('.suggestions-box').forEach(box => {
    const wrap = box.parentElement;
    if (wrap) {
      const input = wrap.querySelector('input');
      if (e.target !== input && e.target !== box && !box.contains(e.target)) {
        box.classList.add('hidden');
        box.innerHTML = '';
      }
    }
  });
});

export function setupPlayerAutocomplete(inputElement, getCountryCode, onSelect) {
  if (!inputElement) return;
  if (inputElement.dataset.playerAcAttached) {
    inputElement._playerAcOnSelect = onSelect;
    inputElement._playerAcGetCountry = getCountryCode;
    return;
  }
  inputElement.dataset.playerAcAttached = 'true';
  inputElement._playerAcOnSelect = onSelect;
  inputElement._playerAcGetCountry = getCountryCode;

  let suggestionsBox = inputElement.parentElement?.querySelector('.suggestions-box');
  if (!suggestionsBox) {
    // player input may not have box in template, create one
    suggestionsBox = document.createElement('div');
    suggestionsBox.className = 'suggestions-box hidden';
    inputElement.parentElement?.appendChild(suggestionsBox);
  }
  let activeIndex = -1;
  let currentMatches = [];
  let ignoreInput = false;

  const close = () => {
    suggestionsBox.classList.add('hidden');
    suggestionsBox.innerHTML = '';
    activeIndex = -1;
  };
  const render = (matches) => {
    suggestionsBox.innerHTML = '';
    if (!matches.length) { close(); return; }
    matches.forEach((m, idx) => {
      const div = document.createElement('div');
      div.className = 'suggestion-line';
      div.textContent = `${m.flag} ${m.name} [${m.pos}] • ${m.teamName}`;
      if (idx === activeIndex) { div.style.background = 'var(--text-light)'; div.style.color = 'var(--bg-dark)'; }
      div.addEventListener('click', e => {
        e.stopPropagation();
        select(m.name);
      });
      suggestionsBox.appendChild(div);
    });
    suggestionsBox.classList.remove('hidden');
  };
  const select = (name) => {
    ignoreInput = true;
    inputElement.value = name;
    close();
    const cb = inputElement._playerAcOnSelect;
    if (cb) cb(name);
    else {
      const ev = new Event('input', { bubbles: true });
      inputElement.dispatchEvent(ev);
    }
    setTimeout(() => ignoreInput = false, 10);
  };
  const getPreferredCode = () => {
    const fn = inputElement._playerAcGetCountry;
    if (typeof fn === 'function') {
      const code = fn();
      if (code && teamsDB[code]) return code;
      // try resolve by name
      const name = typeof code === 'string' ? code.trim() : '';
      if (name) {
        const lower = name.toLowerCase();
        for (const [k, v] of Object.entries(teamsDB)) {
          if (v.name.toLowerCase() === lower) return k;
        }
      }
    }
    return null;
  };

  inputElement.addEventListener('input', e => {
    if (ignoreInput) return;
    const q = e.target.value;
    const pref = getPreferredCode();
    currentMatches = findPlayerMatches(q, pref);
    activeIndex = currentMatches.length ? 0 : -1;
    render(currentMatches);
  });
  inputElement.addEventListener('focus', e => {
    const q = e.target.value;
    if (!q) return;
    const pref = getPreferredCode();
    currentMatches = findPlayerMatches(q, pref);
    if (currentMatches.length) { activeIndex = 0; render(currentMatches); }
  });
  inputElement.addEventListener('keydown', e => {
    if (suggestionsBox.classList.contains('hidden') || !currentMatches.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); activeIndex = (activeIndex+1)%currentMatches.length; render(currentMatches); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); activeIndex = (activeIndex-1+currentMatches.length)%currentMatches.length; render(currentMatches); }
    else if (e.key === 'Enter') { e.preventDefault(); if (activeIndex>=0) select(currentMatches[activeIndex].name); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
  });
}

export function resolveTeamCodeByName(name) {
  if (!name) return null;
  const lower = name.trim().toLowerCase();
  for (const [code, info] of Object.entries(teamsDB)) {
    if (info.name.toLowerCase() === lower) return code;
  }
  return null;
}

export function lookupPlayerExact(name) {
  if (!name) return null;
  const q = name.trim().toLowerCase();
  // exact first
  for (const p of allPlayers) {
    if (p.lower === q) return p;
  }
  // try without trailing digits
  const base = q.replace(/\s*\d+$/, '').trim();
  if (base !== q) {
    for (const p of allPlayers) {
      if (p.lower === base) return p;
    }
  }
  return null;
}

export function splitPlayerAndGoals(text) {
  if (!text || typeof text !== 'string') return null;
  const trimmed = text.trim();
  // Match trailing digits 1-2 chars (0-20) after optional space
  const m = trimmed.match(/^(.*?)\s*(\d{1,2})\s*$/);
  if (!m) return null;
  const namePart = m[1].trim();
  const goalsPart = m[2].trim();
  if (!namePart) return null;
  const goalsNum = parseInt(goalsPart, 10);
  if (isNaN(goalsNum) || goalsNum < 0 || goalsNum > 20) return null;
  // Verify namePart is at least 2 chars and not just digits
  if (namePart.length < 2) return null;
  // Check if namePart looks like a player (or at least not empty)
  return { name: namePart, goals: String(goalsNum) };
}
