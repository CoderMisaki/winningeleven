import { StorageService } from "../services/storage.js";

export const StateManager = {
  db: { memories: {} },
  
  // Data input temporer pencarian halaman utama
  homeQuery: {
    p1: "",
    matches: Array.from({ length: 7 }, () => ({ home: "", score: "", away: "" }))
  },

  // State navigasi aktif
  activeMemoryId: null, // Jika null, user berada di halaman Matching Center (Home)
  activeGameIndex: 0,   // Indeks game yang aktif saat membuka editor memory

  init() {
    this.db = StorageService.loadData();
  },

  save() {
    StorageService.saveData(this.db);
  },

  clearHomeQuery() {
    this.homeQuery = {
      p1: "",
      matches: Array.from({ length: 7 }, () => ({ home: "", score: "", away: "" }))
    };
  }
};
