import { StorageService } from "../services/storage.js";
import { Security } from "../utils/security.js";

function makeEmptyQuery() {
  return {
    p1: "",
    matches: Array.from({ length: 8 }, (_, i) => ({
      home: "",
      score: "",
      away: "",
      enabled: i < 7 // B1-B7 enabled, B8 disabled collapsed by default
    })),
    topGoals: Array.from({ length: 7 }, () => ({
      country: "",
      player: "",
      goals: ""
    })),
    b8Enabled: false
  };
}
function isB8Enabled(query) {
  if (!query || !Array.isArray(query.matches) || query.matches.length < 8) return false;
  // Prefer explicit flag, fallback to enabled field
  if (typeof query.b8Enabled === "boolean") return query.b8Enabled;
  return !!query.matches[7]?.enabled;
}

function cleanText(value) {
  if (typeof value !== "string") return "";

  let out = Security.decodeHtml(value);
  out = out.replace(/\s+/g, " ").trim();

  return out;
}

function cleanScore(value) {
  if (typeof value !== "string") return "";

  let out = cleanText(value);

  if (!out) return "";

  // Normalisasi:
  // 8-0 -> 8:0
  // 3;3 -> 3:3
  // 1 : 2 -> 1:2
  out = out
    .replace(/[-–—;]+/g, ":")
    .replace(/\s+/g, "");

  return out;
}

export const StateManager = {
  db: {
    maxSlot: 7,
    memories: {}
  },

  homeQuery: makeEmptyQuery(),

  activeMemoryId: null,
  activeGameIndex: 0,

  saveTimer: null,

  async init() {
    try {
      this.db = await StorageService.loadData();
    } catch (e) {
      console.error("Gagal load storage utama", e);
      this.db = StorageService.generateInitialStructure();
    }

    if (!this.db || typeof this.db !== "object") {
      this.db = StorageService.generateInitialStructure();
    }

    if (!this.db.memories || typeof this.db.memories !== "object") {
      this.db.memories = StorageService.generateInitialStructure().memories;
    }

    // Pastikan maxSlot valid
    let highestKey = 7;

    for (const key of Object.keys(this.db.memories)) {
      const num = parseInt(key, 10);
      if (!isNaN(num) && num > highestKey) {
        highestKey = num;
      }
    }

    if (typeof this.db.maxSlot !== "number" || this.db.maxSlot < highestKey) {
      this.db.maxSlot = highestKey;
    }

    let modified = false;

    for (const key of Object.keys(this.db.memories)) {
      const memory = this.db.memories[key];

      if (!memory || typeof memory !== "object") {
        this.db.memories[key] = null;
        modified = true;
        continue;
      }

      if (!Array.isArray(memory.games)) {
        memory.games = [];
        modified = true;
      }

      if (!memory.version || memory.version < 4) {
        memory.version = 4;
        modified = true;
      } else if (memory.version === 3) {
        memory.version = 4;
        modified = true;
      }

      if (!memory.memoryName) {
        memory.memoryName = "Memory " + key;
        modified = true;
      }

      if (!memory.createdAt) {
        memory.createdAt = new Date().toISOString();
        modified = true;
      }

      if (!memory.lastUpdate) {
        memory.lastUpdate = new Date().toISOString();
        modified = true;
      }

      const seenGames = new Set();
      const uniqueGames = [];

      for (const game of memory.games) {
        if (!game || typeof game !== "object") {
          modified = true;
          continue;
        }

        // Bersihkan P1
        game.p1 = cleanText(game.p1 || "");

        // Bersihkan matches — MIGRATION B8 (7 -> 8, collapsible)
        const oldMatches = Array.isArray(game.matches) ? game.matches : [];
        const oldB8Enabled = game.b8Enabled;
        const needsB8Migration = oldMatches.length === 7 || typeof oldB8Enabled !== "boolean" || game.matches?.length !== 8;
        game.matches = Array.from({ length: 8 }, (_, i) => {
          const m = oldMatches[i] || {};
          const hasContent = !!(cleanText(m.home || "") || cleanText(m.away || "") || cleanScore(m.score || ""));
          return {
            home: cleanText(m.home || ""),
            score: cleanScore(m.score || ""),
            away: cleanText(m.away || ""),
            enabled: i < 7 ? true : (typeof m.enabled === "boolean" ? m.enabled : (hasContent || !!oldB8Enabled))
          };
        });
        const b8HasContent = !!(game.matches[7].home || game.matches[7].away || game.matches[7].score);
        const newB8Enabled = typeof oldB8Enabled === "boolean" ? oldB8Enabled : (game.matches[7].enabled || b8HasContent);
        if (game.b8Enabled !== newB8Enabled) modified = true;
        game.b8Enabled = newB8Enabled;
        if (needsB8Migration) modified = true;
        // Bump version for B8
        if (!game.b8Migrated) {
          game.b8Migrated = true;
          modified = true;
        }

        // Bersihkan top goals
        const oldGoals = Array.isArray(game.topGoals) ? game.topGoals : [];
        game.topGoals = Array.from({ length: 7 }, (_, i) => {
          const g = oldGoals[i] || {};

          return {
            country: cleanText(g.country || ""),
            player: cleanText(g.player || ""),
            goals: cleanText(g.goals || "")
          };
        });

        // Duplicate game detection berdasarkan isi, bukan metadata
        const hash = JSON.stringify({
          p1: game.p1,
          matches: game.matches,
          topGoals: game.topGoals
        });

        if (!seenGames.has(hash)) {
          seenGames.add(hash);
          uniqueGames.push(game);
        } else {
          modified = true;
        }
      }

      memory.games = uniqueGames;

      // Rapikan nomor game
      memory.games.forEach((game, idx) => {
        if (game.gameNumber !== idx + 1) {
          game.gameNumber = idx + 1;
          modified = true;
        }

        if (!game.lastUpdate) {
          game.lastUpdate = new Date().toISOString();
          modified = true;
        }
      });

      memory.totalGames = memory.games.length;
    }

    // Ensure homeQuery B8 (fresh or after clear)
    if (!this.homeQuery.matches || this.homeQuery.matches.length !== 8) {
      const oldHQ = Array.isArray(this.homeQuery.matches) ? this.homeQuery.matches : [];
      this.homeQuery.matches = Array.from({ length: 8 }, (_, i) => oldHQ[i] || { home: "", score: "", away: "", enabled: i < 7 });
      if (typeof this.homeQuery.b8Enabled !== "boolean") this.homeQuery.b8Enabled = !!this.homeQuery.matches[7]?.enabled;
      modified = true;
    }
    // Ensure homeQuery b8Enabled flag exists
    if (typeof this.homeQuery.b8Enabled !== "boolean") {
      this.homeQuery.b8Enabled = !!this.homeQuery.matches[7]?.enabled;
    }

    if (modified) {
      this.save();
    }
  },

  save() {
    Promise.resolve(StorageService.saveData(this.db)).catch(e => {
      console.error("StateManager save gagal", e);
    });
  },

  debouncedSave() {
    if (this.saveTimer) clearTimeout(this.saveTimer);

    this.saveTimer = setTimeout(() => {
      this.save();
    }, 300);
  },

  clearHomeQuery() {
    this.homeQuery = makeEmptyQuery();
  },

  isB8Enabled(query = null) {
    const q = query || (this.activeMemoryId !== null ? this.db.memories[this.activeMemoryId]?.games[this.activeGameIndex] : this.homeQuery);
    if (!q || !Array.isArray(q.matches) || q.matches.length < 8) return false;
    if (typeof q.b8Enabled === "boolean") return q.b8Enabled;
    return !!q.matches[7]?.enabled;
  },

  setB8Enabled(enabled) {
    const isEditor = this.activeMemoryId !== null;
    const target = isEditor ? this.db.memories[this.activeMemoryId]?.games[this.activeGameIndex] : this.homeQuery;
    if (!target) return;
    target.b8Enabled = !!enabled;
    if (Array.isArray(target.matches) && target.matches[7]) target.matches[7].enabled = !!enabled;
    if (isEditor) {
      target.lastUpdate = new Date().toISOString();
      this.db.memories[this.activeMemoryId].lastUpdate = new Date().toISOString();
    }
    this.debouncedSave();
  },

  toggleB8() {
    const cur = this.isB8Enabled();
    this.setB8Enabled(!cur);
    return !cur;
  }
};

export function isB8EnabledQuery(query) {
  return isB8Enabled(query);
}
