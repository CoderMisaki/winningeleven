export const SimilarityCalculator = {
  calculate(queryGame, targetGame) {
    let matchScore = 0;
    const totalMatchesCount = 7;
    
    // Setiap kecocokan Match dievaluasi dari 3 komponen: Home, Away, Score.
    // Total bobot ideal per match = 14 poin (4 Home, 4 Away, 6 Score). Max base = 98 poin.
    for (let i = 0; i < totalMatchesCount; i++) {
      const qMatch = queryGame.matches[i];
      const tMatch = targetGame.matches[i];

      if (!qMatch || !tMatch) continue;

      const qHome = (qMatch.home || "").trim().toUpperCase();
      const qAway = (qMatch.away || "").trim().toUpperCase();
      const qScore = (qMatch.score || "").trim();

      const tHome = (tMatch.home || "").trim().toUpperCase();
      const tAway = (tMatch.away || "").trim().toUpperCase();
      const tScore = (tMatch.score || "").trim();

      if (qHome && qHome === tHome) matchScore += 4;
      if (qAway && qAway === tAway) matchScore += 4;
      if (qScore && qScore === tScore) matchScore += 6;
    }


    // Evaluasi Top Goals: 7 goals
    // Total bobot tambahan (Misalnya 2 poin per bagian dari goal, Max 7 * 6 = 42 poin)
    for (let i = 0; i < 7; i++) {
      const qGoal = queryGame.topGoals ? queryGame.topGoals[i] : null;
      const tGoal = targetGame.topGoals ? targetGame.topGoals[i] : null;
      if (!qGoal || !tGoal) continue;

      const qCountry = (qGoal.country || "").trim().toUpperCase();
      const qPlayer = (qGoal.player || "").trim().toUpperCase();
      const qGoalsScore = (qGoal.goals || "").trim();

      const tCountry = (tGoal.country || "").trim().toUpperCase();
      const tPlayer = (tGoal.player || "").trim().toUpperCase();
      const tGoalsScore = (tGoal.goals || "").trim();

      if (qCountry && qCountry === tCountry) matchScore += 2;
      if (qPlayer && qPlayer === tPlayer) matchScore += 2;
      if (qGoalsScore && qGoalsScore === tGoalsScore) matchScore += 2;
    }

    // Penambahan bonus jika P1 dicantumkan dan sama persis (+2 poin)

    const hasQueryP1 = queryGame.p1 && queryGame.p1.trim();
    const hasTargetP1 = targetGame.p1 && targetGame.p1.trim();
    
    if (hasQueryP1 && hasTargetP1) {
      if (queryGame.p1.trim().toLowerCase() === targetGame.p1.trim().toLowerCase()) {
        matchScore += 2;
      }
    }

    // Batasi kalkulasi agar aman jika pembagi 0, lalu bulatkan presisi persen
    const maxPossiblePoints = hasQueryP1 ? 142 : 140;
    const calculatedPercentage = (matchScore / maxPossiblePoints) * 100;
    
    return Math.min(100, Math.round(calculatedPercentage));
  }
};
