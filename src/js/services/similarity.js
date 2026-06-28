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

function reverseScore(score) {
  if (!score || typeof score !== 'string') return score;
  const parts = score.split(':');
  if (parts.length === 2) {
    return `${parts[1].trim()}:${parts[0].trim()}`;
  }
  return score;
}

function calculateScorePoints(qScore, tScore) {
  if (!qScore || !tScore) return 0;
  if (qScore === tScore) return 6; // exact match

  // Partial match: e.g. 3:2 vs 3:1 (1 goal diff)
  const qParts = qScore.split(':').map(s => s.trim());
  const tParts = tScore.split(':').map(s => s.trim());
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

      let localScoreNormal = 0;
      let homeMatchNormal = false;
      let awayMatchNormal = false;
      let scoreMatchPtsNormal = 0;

      if (qHome && normalizeCountry(qHome) === normalizeCountry(tHome)) {
        localScoreNormal += 4;
        homeMatchNormal = true;
      }
      if (qAway && normalizeCountry(qAway) === normalizeCountry(tAway)) {
        localScoreNormal += 4;
        awayMatchNormal = true;
      }
      scoreMatchPtsNormal = calculateScorePoints(qScore, tScore);
      localScoreNormal += scoreMatchPtsNormal;

      let localScoreReverse = 0;
      let homeMatchReverse = false;
      let awayMatchReverse = false;
      let scoreMatchPtsReverse = 0;

      if (qHome && normalizeCountry(qHome) === normalizeCountry(tAway)) {
        localScoreReverse += 4;
        homeMatchReverse = true;
      }
      if (qAway && normalizeCountry(qAway) === normalizeCountry(tHome)) {
        localScoreReverse += 4;
        awayMatchReverse = true;
      }
      scoreMatchPtsReverse = calculateScorePoints(qScore, reverseScore(tScore));
      localScoreReverse += scoreMatchPtsReverse;

      const isReverse = localScoreReverse > localScoreNormal;
      const localScore = isReverse ? localScoreReverse : localScoreNormal;
      const homeMatch = isReverse ? homeMatchReverse : homeMatchNormal;
      const awayMatch = isReverse ? awayMatchReverse : awayMatchNormal;
      const scoreMatchPts = isReverse ? scoreMatchPtsReverse : scoreMatchPtsNormal;

      const weightedScore = (localScore / 14) * MATCH_WEIGHTS[i];
      matchScore += weightedScore;

      // Explanations for match
      if (qHome || qAway || qScore) {
         if (localScore === 14) {
             if (isReverse) {
                 explanations.push(`✔ Match ${i+1} Perfect Reverse Match (+${weightedScore.toFixed(1)} pts)`);
             } else {
                 explanations.push(`✔ Match ${i+1} sama persis (+${weightedScore.toFixed(1)} pts)`);
             }
         } else if (localScore > 0) {
             let details = [];
             if (homeMatch) details.push(isReverse ? 'Home -> Away sama' : 'Home sama');
             if (awayMatch) details.push(isReverse ? 'Away -> Home sama' : 'Away sama');
             if (scoreMatchPts === 6) details.push(isReverse ? 'Score Reverse sama' : 'Score sama');
             else if (scoreMatchPts > 0) details.push(isReverse ? 'Score Reverse mirip' : 'Score mirip');

             if (isReverse) {
                 explanations.push(`⚠️ Match ${i+1} parsial Reverse Match (${details.join(', ')}) (+${weightedScore.toFixed(1)} pts)`);
             } else {
                 explanations.push(`⚠️ Match ${i+1} parsial (${details.join(', ')}) (+${weightedScore.toFixed(1)} pts)`);
             }
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
        matchScore += 20;
        explanations.push(`✔ P1 sama (+20 pts)`);
      } else {
        explanations.push(`❌ P1 beda`);
      }
    }

    const totalMatchWeights = MATCH_WEIGHTS.reduce((a, b) => a + b, 0); // 100
    const maxPossiblePoints = totalMatchWeights + GOALS_MAX_SCORE + (hasQueryP1 ? 20 : 0);
    const calculatedPercentage = (matchScore / maxPossiblePoints) * 100;
    
    return {
       percentage: Math.min(100, Math.round(calculatedPercentage)),
       explanations
    };
  }
};
