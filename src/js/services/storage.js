export const MEMORY_PREFIX = "memory_";
export const META_KEY = "winningeleven.meta";

export function createEmptyGame(index) {
  return {
    id: globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${index}`,
    gameNumber: index,
    p1: "",
    home: "",
    away: "",
    score: "",
  };
}

export function createEmptyMemory(slot) {
  return {
    name: `Memory ${slot}`,
    lastUpdate: new Date().toISOString(),
    games: [createEmptyGame(1)],
    topGoals: []
  };
}

export function getMemory(slot) {
  try {
    const raw = localStorage.getItem(`${MEMORY_PREFIX}${slot}`);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return null;
}

export function saveMemory(slot, data) {
  data.lastUpdate = new Date().toISOString();
  localStorage.setItem(`${MEMORY_PREFIX}${slot}`, JSON.stringify(data));
}

export function deleteMemory(slot) {
  localStorage.removeItem(`${MEMORY_PREFIX}${slot}`);
}

export function getAllMemories() {
  const memories = [];
  for (let i = 1; i <= 7; i++) {
    const mem = getMemory(i);
    memories.push(mem || null);
  }
  return memories;
}

export function loadMeta() {
  try {
    const raw = localStorage.getItem(META_KEY);
    if (raw) return JSON.parse(raw);
  } catch (_) {}
  return { activeSlot: 1, activeGameIndex: 0 };
}

export function saveMeta(meta) {
  localStorage.setItem(META_KEY, JSON.stringify(meta));
}

export function migrateV1() {
  const oldKey = "winningeleven.memory.v1";
  const raw = localStorage.getItem(oldKey);
  if (!raw) return;
  try {
    const oldData = JSON.parse(raw);
    if (oldData && oldData.memories) {
      let activeSlot = oldData.activeSlot || 1;
      let activeGameIndex = 0;

      for (const slotStr in oldData.memories) {
        const slot = parseInt(slotStr, 10);
        if (isNaN(slot) || slot < 1 || slot > 7) continue;

        const oldMem = oldData.memories[slotStr];
        const newMem = createEmptyMemory(slot);
        newMem.name = oldMem.name || `Memory ${slot}`;

        if (slot === activeSlot) {
            activeGameIndex = oldMem.activeGameIndex || 0;
        }

        const flatGames = [];
        let index = 1;

        if (oldMem.games && oldMem.games.length > 0) {
            // Find the most recent topGoals across all old nested games
            let topGoals = [];
            for (let i = oldMem.games.length - 1; i >= 0; i--) {
                if (oldMem.games[i].topGoals && oldMem.games[i].topGoals.length > 0) {
                    topGoals = oldMem.games[i].topGoals;
                    break;
                }
            }
            newMem.topGoals = topGoals;

            for (const g of oldMem.games) {
               if (g.matches && g.matches.length > 0) {
                   for (const m of g.matches) {
                       flatGames.push({
                           id: globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${index}`,
                           gameNumber: index,
                           p1: "", // p1 didn't exist explicitly in old matches
                           home: m.home || "",
                           away: m.away || "",
                           score: m.score || ""
                       });
                       index++;
                   }
               }
            }
        }

        if (flatGames.length > 0) {
            newMem.games = flatGames;
        }

        saveMemory(slot, newMem);
      }

      saveMeta({ activeSlot, activeGameIndex: 0 }); // reset game index because games are flat now
      localStorage.removeItem(oldKey);
    }
  } catch (e) {
    console.error("Migration failed:", e);
  }
}
