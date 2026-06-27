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
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.error("Gagal menyimpan ke LocalStorage", e);
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
