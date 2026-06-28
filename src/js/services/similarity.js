import { countryAliases } from "../data/countryAliases.js";

export function normalizeCountry(countryInput) {
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
  return s1 === s2 || s1.startsWith(s2) || s2.startsWith(s1);
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
export const MATCH_WEIGHTS = [25, 20, 18, 15, 10, 7, 5];
const GOALS_MAX_SCORE = 7 * 10; // 70

export const SimilarityCalculator = {
  calculate(queryGame, targetGame) {
    let matchScore = 0;
    const explanations = [];
    
    // Evaluate Matches
    for (let i = 0; i < 7; i++) {
      const qMatch = queryGame.matches[i];
      const tMatch = targetGame.matches[i];

      if (!qMatch || !tMatch) continue;

      const qHome = (qMatch.home || "").trim().toUpperCase();
      const qAway = (qMatch.away || "").trim().toUpperCase();
      const qScore = (qMatch.score || "").trim();

      const tHome = (tMatch.home || "").trim().toUpperCase();
      const tAway = (tMatch.away || "").trim().toUpperCase();
      const tScore = (tMatch.score || "").trim();

      let localScore = 0;
      let homeMatch = false;
      let awayMatch = false;
      let scoreMatchPts = 0;

      if (qHome && normalizeCountry(qHome) === normalizeCountry(tHome)) {
        localScore += 4;
        homeMatch = true;
      }
      if (qAway && normalizeCountry(qAway) === normalizeCountry(tAway)) {
        localScore += 4;
        awayMatch = true;
      }
      scoreMatchPts = calculateScorePoints(qScore, tScore);
      localScore += scoreMatchPts;

      const weightedScore = (localScore / 14) * MATCH_WEIGHTS[i];
      matchScore += weightedScore;

      // Explanations for match
      if (qHome || qAway || qScore) {
         if (localScore === 14) {
             explanations.push(`✔ Match ${i+1} sama persis (+${weightedScore.toFixed(1)} pts)`);
         } else if (localScore > 0) {
             let details = [];
             if (homeMatch) details.push('Home sama');
             if (awayMatch) details.push('Away sama');
             if (scoreMatchPts === 6) details.push('Score sama');
             else if (scoreMatchPts > 0) details.push('Score mirip');
             explanations.push(`⚠️ Match ${i+1} parsial (${details.join(', ')}) (+${weightedScore.toFixed(1)} pts)`);
         } else {
             explanations.push(`❌ Match ${i+1} sama sekali beda`);
         }
      }
    }

    // Evaluate Top Goals: 7 goals (Max 70 points)
    for (let i = 0; i < 7; i++) {
      const qGoal = queryGame.topGoals ? queryGame.topGoals[i] : null;
      const tGoal = targetGame.topGoals ? targetGame.topGoals[i] : null;
      if (!qGoal || !tGoal) continue;

      let goalPts = 0;
      let details = [];
      if (qGoal.country && normalizeCountry(qGoal.country) === normalizeCountry(tGoal.country)) {
         goalPts += 3;
         details.push('Negara');
      }
      if (qGoal.player && fuzzyMatchString(qGoal.player, tGoal.player)) {
         goalPts += 2;
         details.push('Pemain');
      }
      if (qGoal.goals && qGoal.goals.trim() === (tGoal.goals || "").trim()) {
         goalPts += 5;
         details.push('Jumlah Goal');
      }

      matchScore += goalPts;

      if (qGoal.country || qGoal.player || qGoal.goals) {
         if (goalPts === 10) {
             explanations.push(`✔ Top Goal #${i+1} sama persis (+10 pts)`);
         } else if (goalPts > 0) {
             explanations.push(`⚠️ Top Goal #${i+1} parsial (${details.join(', ')}) (+${goalPts} pts)`);
         } else {
             explanations.push(`❌ Top Goal #${i+1} beda`);
         }
      }
    }

    // P1 Bonus
    const hasQueryP1 = queryGame.p1 && queryGame.p1.trim();
    const hasTargetP1 = targetGame.p1 && targetGame.p1.trim();
    
    if (hasQueryP1 && hasTargetP1) {
      if (normalizeCountry(queryGame.p1) === normalizeCountry(targetGame.p1)) {
        matchScore += 2;
        explanations.push(`✔ P1 sama (+2 pts)`);
      } else {
        explanations.push(`❌ P1 beda`);
      }
    }

    const totalMatchWeights = MATCH_WEIGHTS.reduce((a, b) => a + b, 0); // 100
    const maxPossiblePoints = totalMatchWeights + GOALS_MAX_SCORE + (hasQueryP1 ? 2 : 0);
    const calculatedPercentage = (matchScore / maxPossiblePoints) * 100;
    
    return {
       percentage: Math.min(100, Math.round(calculatedPercentage)),
       explanations
    };
  }
};
