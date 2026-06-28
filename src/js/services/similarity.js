import { countryAliases } from "../data/countryAliases.js";

function normalizeCountry(countryInput) {
  if (!countryInput) return "";
  const query = countryInput.trim().toLowerCase();
  for (const [code, aliases] of Object.entries(countryAliases)) {
    if (code.toLowerCase() === query || aliases.includes(query)) {
      return code.toUpperCase();
    }
  }
  return query.toUpperCase();
}

function fuzzyMatchString(str1, str2) {
  if (!str1 || !str2) return false;
  const s1 = str1.trim().toLowerCase();
  const s2 = str2.trim().toLowerCase();
  return s1 === s2 || s1.includes(s2) || s2.includes(s1);
}

function calculateScorePoints(qScore, tScore) {
  if (!qScore || !tScore) return 0;
  if (qScore === tScore) return 6; // exact match

  // Partial match: e.g. 3:2 vs 3:1 (1 goal diff)
  const qParts = qScore.split(':');
  const tParts = tScore.split(':');
  if (qParts.length === 2 && tParts.length === 2) {
    const q1 = parseInt(qParts[0], 10);
    const q2 = parseInt(qParts[1], 10);
    const t1 = parseInt(tParts[0], 10);
    const t2 = parseInt(tParts[1], 10);

    if (!isNaN(q1) && !isNaN(q2) && !isNaN(t1) && !isNaN(t2)) {
      const diff1 = Math.abs(q1 - t1);
      const diff2 = Math.abs(q2 - t2);
      const totalDiff = diff1 + diff2;

      if (totalDiff === 1) return 3; // 1 goal diff -> partial points
      if (totalDiff === 2) return 1; // 2 goal diff -> small partial points
    }
  }
  return 0;
}
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

      if (qHome && normalizeCountry(qHome) === normalizeCountry(tHome)) matchScore += 4;
      if (qAway && normalizeCountry(qAway) === normalizeCountry(tAway)) matchScore += 4;
      matchScore += calculateScorePoints(qScore, tScore);
    }

    // Evaluasi Top Goals: 7 goals
    // Bobot: Goals=5, Country=3, Player=2. Max 7 * 10 = 70 poin.
    for (let i = 0; i < 7; i++) {
      const qGoal = queryGame.topGoals ? queryGame.topGoals[i] : null;
      const tGoal = targetGame.topGoals ? targetGame.topGoals[i] : null;
      if (!qGoal || !tGoal) continue;

      if (qGoal.country && normalizeCountry(qGoal.country) === normalizeCountry(tGoal.country)) matchScore += 3;
      if (qGoal.player && fuzzyMatchString(qGoal.player, tGoal.player)) matchScore += 2;
      if (qGoal.goals && qGoal.goals.trim() === (tGoal.goals || "").trim()) matchScore += 5;
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
    // Base Matches: 7 * 14 = 98 points
    // Base Top Goals: 7 * 10 = 70 points
    // Max = 168 + 2 (P1) = 170
    const maxPossiblePoints = hasQueryP1 ? 170 : 168;
    const calculatedPercentage = (matchScore / maxPossiblePoints) * 100;
    
    return Math.min(100, Math.round(calculatedPercentage));
  }
};
