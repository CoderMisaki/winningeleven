const LOCAL_STORAGE_KEY = "we10_memory_research_v2_data";

const IDB_DB_NAME = "we10_memory_research_db";
const IDB_STORE = "keyval";
const IDB_KEY = "we10_memory_research_v3_data";

function idbAvailable() {
  return typeof indexedDB !== "undefined";
}

function openDb() {
  return new Promise((resolve, reject) => {
    if (!idbAvailable()) {
      reject(new Error("IndexedDB unavailable"));
      return;
    }

    const req = indexedDB.open(IDB_DB_NAME, 1);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("IndexedDB open failed"));
  });
}

async function idbGet(key) {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const store = tx.objectStore(IDB_STORE);
    const req = store.get(key);

    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error || new Error("IndexedDB get failed"));
  });
}

async function idbSet(key, value) {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    const store = tx.objectStore(IDB_STORE);

    store.put(value, key);

    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error || new Error("IndexedDB set failed"));
  });
}

function loadFromLocalStorage() {
  try {
    const serialized = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!serialized) return null;
    return JSON.parse(serialized);
  } catch (e) {
    console.error("Gagal membaca localStorage fallback", e);
    return null;
  }
}

function saveToLocalStorage(data) {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch (e) {
    console.error("Gagal menyimpan ke localStorage fallback", e);
    return false;
  }
}

export const StorageService = {
  async loadData() {
    // 1. Coba IndexedDB dulu
    try {
      const data = await idbGet(IDB_KEY);
      if (data) return data;
    } catch (e) {
      console.warn("IndexedDB load gagal, coba localStorage", e);
    }

    // 2. Fallback / migrasi dari localStorage
    const localData = loadFromLocalStorage();
    if (localData) {
      try {
        await idbSet(IDB_KEY, localData);
      } catch (e) {
        console.warn("Gagal migrasi localStorage ke IndexedDB", e);
      }
      return localData;
    }

    return this.generateInitialStructure();
  },

  async saveData(data) {
    // 1. Coba IndexedDB
    try {
      await idbSet(IDB_KEY, data);
      return true;
    } catch (e) {
      console.error("Gagal menyimpan ke IndexedDB", e);
    }

    // 2. Fallback localStorage
    try {
      saveToLocalStorage(data);
      return true;
    } catch (e) {
      console.error("Gagal menyimpan fallback", e);
      return false;
    }
  },

  generateInitialStructure() {
    const defaultData = {
      maxSlot: 7,
      memories: {}
    };

    for (let i = 1; i <= 7; i++) {
      defaultData.memories[i] = null;
    }

    return defaultData;
  }
};
