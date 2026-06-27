import { StateManager } from "../state/appState.js";
import { SimilarityCalculator } from "./similarity.js";

export const MatchingEngine = {
  executeSearch(query) {
    const results = [];

    // Iterasi membandingkan 1 Paket Game Input dengan seluruh Game di 7 Memory Slots
    for (let memoryId = 1; memoryId <= 7; memoryId++) {
      const currentMemory = StateManager.db.memories[memoryId];
      if (!currentMemory || !currentMemory.games) continue;

      currentMemory.games.forEach((game) => {
        const simPercentage = SimilarityCalculator.calculate(query, game);
        
        if (simPercentage > 0) {
          results.push({
            memoryId: memoryId,
            memoryName: currentMemory.name || `Memory ${memoryId}`,
            gameNumber: game.gameNumber,
            similarity: simPercentage
          });
        }
      });
    }

    // Pengurutan menurun berdasarkan persentase kemiripan tertinggi
    return results.sort((a, b) => b.similarity - a.similarity);
  }
};
