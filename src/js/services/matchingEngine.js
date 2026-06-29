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

      for (const game of currentMemory.games) {
        // Pre-filters removed intentionally to prevent early rejection of potentially high-scoring but partially mismatched candidates

        const simResult = SimilarityCalculator.calculate(query, game);
        // simResult is now an object { percentage, explanations }
        
        if (simResult.percentage > 0) {
          results.push({
            memoryId: parseInt(memoryId, 10),
            memoryName: currentMemory.memoryName || `Memory ${memoryId}`,
            gameNumber: game.gameNumber,
            similarity: simResult.percentage,
            explanations: simResult.explanations
          });
        }
      }
    }

    // Pengurutan menurun berdasarkan persentase kemiripan tertinggi (Similarity DESC, Game Number ASC, Memory ASC)
    return results.sort((a, b) => {
      if (b.similarity !== a.similarity) return b.similarity - a.similarity;
      if (a.gameNumber !== b.gameNumber) return a.gameNumber - b.gameNumber;
      return a.memoryId - b.memoryId;
    });
  }
};
