import { SimilarityCalculator } from "../services/similarity.js";

self.onmessage = function(e) {
    const { query, memories } = e.data;

    if (!query || !memories) return;

    const results = [];
    const memoryKeys = Object.keys(memories);

    for (const memoryId of memoryKeys) {
      const currentMemory = memories[memoryId];
      if (!currentMemory || !currentMemory.games) continue;

      for (const game of currentMemory.games) {
        const simResult = SimilarityCalculator.calculate(query, game);

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

    const sortedResults = results.sort((a, b) => {
      if (b.similarity !== a.similarity) return b.similarity - a.similarity;
      if (a.gameNumber !== b.gameNumber) return a.gameNumber - b.gameNumber;
      return a.memoryId - b.memoryId;
    });

    self.postMessage({ results: sortedResults });
};
