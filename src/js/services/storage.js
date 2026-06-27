const STORAGE_KEY = "winningeleven.memory.v1";

export function createEmptyGame(index) {
  return {
    id: globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${index}`,
    label: `Game ${index}`,
    matches: [],
    topGoals: [],
    updatedAt: new Date().toISOString(),
  };
}

export function createEmptyMemory(slot = 1) {
  return {
    activeSlot: slot,
    memories: {
      [slot]: {
        name: `Memory ${slot}`,
        activeGameIndex: 0,
        games: [createEmptyGame(1)],
      },
    },
  };
}

export function loadMemoryStore() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (parsed?.memories) return parsed;
  } catch (_) {}
  return createEmptyMemory(1);
}

export function saveMemoryStore(store) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}
