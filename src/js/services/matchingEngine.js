import { StateManager } from "../state/appState.js";
import { SimilarityCalculator, normalizeCountry } from "./similarity.js";

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
        const queryP1 = normalizeCountry(query.p1 || "");
        const queryHome1 = normalizeCountry(query.matches && query.matches[0] ? query.matches[0].home || "" : "");

        const targetP1 = normalizeCountry(game.p1 || "");
        const targetHome1 = normalizeCountry(game.matches && game.matches[0] ? game.matches[0].home || "" : "");

        // Jika query memiliki P1 tapi target tidak punya atau berbeda total
        if (queryP1 && targetP1 && queryP1 !== targetP1) {
           return;
        }

        // Jika query memiliki Home1 tapi target tidak punya atau berbeda total
        if (queryHome1 && targetHome1 && queryHome1 !== targetHome1) {
           return;
        }

        const simResult = SimilarityCalculator.calculate(query, game);
        // simResult is now an object { percentage, explanations }
        
        if (simResult.percentage > 0) {
          results.push({
            memoryId: parseInt(memoryId, 10),
            memoryName: currentMemory.name || `Memory ${memoryId}`,
            gameNumber: game.gameNumber,
            similarity: simResult.percentage,
            explanations: simResult.explanations
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
