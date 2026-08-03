import { get, set } from 'idb-keyval';

const LOCAL_STORAGE_KEY = "we10_memory_research_v2_data";
const IDB_KEY = "we10_memory_research_v3_data"; // New key for IndexedDB

export const StorageService = {
  async loadData() {
    try {
      // First try to load from IndexedDB
      const data = await get(IDB_KEY);
      if (data) {
        return data;
      }

      // If not in IndexedDB, fallback to localStorage (Migration step)
      const serialized = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (serialized) {
        const parsed = JSON.parse(serialized);
        // Save to IndexedDB for next time
        await set(IDB_KEY, parsed);
        return parsed;
      }
    } catch (e) {
      console.error("Gagal memuat Data dari Storage", e);
    }
    return this.generateInitialStructure();
  },

  async saveData(data) {
    try {
      await set(IDB_KEY, data);

      // Optional: keep localStorage updated just in case for a while, or don't.
      // We will remove localStorage saving for better performance and to fix the quota issue.
      // localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(data));

    } catch (e) {
      console.error("Gagal menyimpan ke IndexedDB", e);
      if (typeof window !== 'undefined' && window.alert) {
          window.alert("Gagal menyimpan ke Database: " + e.message);
      }
      throw e;
    }
  },

  generateInitialStructure() {
    const defaultData = { memories: {} };
    for (let i = 1; i <= 7; i++) {
      defaultData.memories[i] = null; // null merepresentasikan status 'Empty'
    }
    return defaultData;
  }
};
