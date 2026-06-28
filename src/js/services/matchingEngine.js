import { StateManager } from "../state/appState.js";
import { SimilarityCalculator } from "./similarity.js";

export const MatchingEngine = {
  executeSearch(query) {
    const results = [];

    // Iterasi membandingkan 1 Paket Game Input dengan seluruh Game di semua Memory Slots
    const memoryKeys = Object.keys(StateManager.db.memories);

    for (const memoryId of memoryKeys) {
      const currentMemory = StateManager.db.memories[memoryId];
      if (!currentMemory || !currentMemory.games) continue;

      currentMemory.games.forEach((game) => {
        // Pre-filter berdasarkan P1 dan Home 1 (index sederhana)
        // Jika dataset sudah puluhan ribu, ini akan sangat mempercepat
        const queryP1 = (query.p1 || "").trim().toLowerCase();
        const queryHome1 = (query.matches && query.matches[0] ? query.matches[0].home || "" : "").trim().toLowerCase();

        const targetP1 = (game.p1 || "").trim().toLowerCase();
        const targetHome1 = (game.matches && game.matches[0] ? game.matches[0].home || "" : "").trim().toLowerCase();

        // Jika query memiliki P1 tapi target tidak punya atau berbeda total (hanya pre-filter kasar)
        if (queryP1 && targetP1 && queryP1 !== targetP1 && !queryP1.includes(targetP1) && !targetP1.includes(queryP1)) {
          // Boleh diskip jika ingin strict, tapi karena Fuzzy kita biarkan lanjut
        }

        const simPercentage = SimilarityCalculator.calculate(query, game);
        
        if (simPercentage > 0) {
          results.push({
            memoryId: parseInt(memoryId, 10),
            memoryName: currentMemory.name || `Memory ${memoryId}`,
            gameNumber: game.gameNumber,
            similarity: simPercentage
          });
        }
      });
    }

    // Pengurutan menurun berdasarkan persentase kemiripan tertinggi (Similarity DESC, Game Number ASC, Memory ASC)
    return results.sort((a, b) => {
      if (b.similarity !== a.similarity) return b.similarity - a.similarity;
      if (a.gameNumber !== b.gameNumber) return a.gameNumber - b.gameNumber;
      return a.memoryId - b.memoryId;
    });
  }
};
