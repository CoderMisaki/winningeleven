import { getAllMemories } from "./storage.js";

export function findMatches(inputGames, inputP1 = "") {
  const allMemories = getAllMemories();
  const results = [];

  // Clean input
  const validInputs = inputGames.filter(g => g.home && g.away);
  if (validInputs.length === 0) return [];

  const searchP1 = inputP1.trim().toLowerCase();

  for (let i = 0; i < allMemories.length; i++) {
    const memory = allMemories[i];
    if (!memory || !memory.games || memory.games.length === 0) continue;

    const slotNumber = i + 1;
    const games = memory.games;
    const inputLen = validInputs.length;

    // Sliding window
    for (let w = 0; w <= games.length - inputLen; w++) {
      let matchScore = 0;
      let maxPossibleScore = 0;

      for (let j = 0; j < inputLen; j++) {
        const inGame = validInputs[j];
        const memGame = games[w + j];

        // P1 check
        let p1Bonus = 0;
        let p1Max = 0;
        if (searchP1) {
          p1Max = 1;
          if (memGame.p1 && memGame.p1.toLowerCase().trim() === searchP1) {
            p1Bonus = 1;
          }
        }

        // Match comparison points (3 per game: home, away, score)
        let gameScore = 0;
        if (inGame.home && memGame.home && inGame.home.toLowerCase() === memGame.home.toLowerCase()) gameScore++;
        if (inGame.away && memGame.away && inGame.away.toLowerCase() === memGame.away.toLowerCase()) gameScore++;
        if (inGame.score && memGame.score && inGame.score === memGame.score) gameScore++;

        // If they left score empty, don't count it towards max Possible
        let gameMax = 2; // home, away
        if (inGame.score) gameMax++;

        matchScore += (gameScore + p1Bonus);
        maxPossibleScore += (gameMax + p1Max);
      }

      if (maxPossibleScore > 0) {
        const similarity = Math.round((matchScore / maxPossibleScore) * 100);
        if (similarity > 0) {
           results.push({
             slot: slotNumber,
             memoryName: memory.name,
             startIndex: w, // 0-based
             startIdxNumber: games[w].gameNumber,
             similarity: similarity
           });
        }
      }
    }
  }

  // Sort descending by similarity
  results.sort((a, b) => b.similarity - a.similarity);
  return results;
}
