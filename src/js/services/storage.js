const LOCAL_STORAGE_KEY = "we10_memory_research_v2_data";

export const StorageService = {
  loadData() {
    try {
      const serialized = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (serialized) {
        return JSON.parse(serialized);
      }
    } catch (e) {
      console.error("Gagal memuat LocalStorage", e);
    }
    return this.generateInitialStructure();
  },

  saveData(data) {
    try {
      const dataStr = JSON.stringify(data);
      localStorage.setItem(LOCAL_STORAGE_KEY, dataStr);

      const saved = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (saved !== dataStr) {
        throw new Error("LocalStorage validation failed: Data saved differs from memory.");
      }
    } catch (e) {
      console.error("Gagal menyimpan ke LocalStorage", e);
      // We need to show an error message if saving fails.
      // Use standard alert for now, UIRenderer isn't imported here and we'll refactor alerts later
      // But we can trigger a custom event or just console error if we can't use alert
      // Using an event might be cleaner but let's just log and throw, the UI can catch or we'll inject UIRenderer later.
      // Wait, UIRenderer relies on StateManager which relies on StorageService.
      if (typeof window !== 'undefined' && window.alert) {
          window.alert("Gagal menyimpan ke LocalStorage: " + e.message);
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
