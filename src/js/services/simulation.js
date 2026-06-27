export const SimulationEngine = {
  calculateScore(home, away) {
    const powerDiff = home.power - away.power;
    const absDiff = Math.abs(powerDiff);
    let hGoals = 0, aGoals = 0;
    if (absDiff === 0) { const drawGoals = Math.floor(Math.random() * 3); hGoals = drawGoals; aGoals = drawGoals; }
    else {
      let goalMargin = 1;
      if (absDiff === 2) goalMargin = Math.random() < 0.5 ? 1 : 2;
      else if (absDiff === 3) goalMargin = 2;
      else if (absDiff === 4) goalMargin = Math.random() < 0.5 ? 2 : 3;
      else if (absDiff === 5) goalMargin = 3;
      else if (absDiff >= 6) goalMargin = Math.floor(absDiff / 1.6) + (Math.random() > 0.5 ? 1 : 0);
      goalMargin = Math.max(1, Math.min(8, goalMargin));
      const r = Math.random();
      const losingGoals = absDiff < 4 ? (r < 0.5 ? 0 : r < 0.85 ? 1 : 2) : (r < 0.75 ? 0 : 1);
      if (powerDiff > 0) { aGoals = losingGoals; hGoals = aGoals + goalMargin; }
      else { hGoals = losingGoals; aGoals = hGoals + goalMargin; }
    }
    let wentToExtraTime = false, wentToPenalties = false, exH = 0, exA = 0, pkH = 0, pkA = 0;
    if (hGoals === aGoals) {
      wentToExtraTime = true;
      if (Math.random() < 0.5) Math.random() < 0.5 ? exH = 1 : exA = 1;
      else if (Math.random() < 0.4) { exH = 1; exA = 1; }
      if (hGoals + exH === aGoals + exA) {
        wentToPenalties = true; pkH = Math.floor(Math.random() * 3) + 3; pkA = Math.floor(Math.random() * 3) + 3;
        if (pkH === pkA) Math.random() < 0.5 ? pkH++ : pkA++;
      }
    }
    return { h: hGoals, a: aGoals, wentToExtraTime, wentToPenalties, exH, exA, pkH, pkA };
  },
};
