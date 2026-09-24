import { simulateMatch, scorersFromEvents } from "../services/playerScoring.js";

self.onmessage = (event) => {
  const data = event.data;
  if (!data || data.type !== "PREDICT_BULK") return;
  const jobs = Array.isArray(data.jobs) ? data.jobs : [];
  const results = [];
  try {
    for (const job of jobs) {
      if (data.cancelled) break;
      if (!job || typeof job.homeCode !== "string" || typeof job.awayCode !== "string") {
        throw new Error("Job bulk prediksi tidak memiliki HOME/AWAY yang valid.");
      }
      const sim = simulateMatch(job.homeCode, job.awayCode, { seed: job.seed >>> 0 });
      results.push({
        row: job.row,
        homeCode: job.homeCode,
        awayCode: job.awayCode,
        homeGoals: sim.homeGoals,
        awayGoals: sim.awayGoals,
        events: sim.events,
        topScorers: scorersFromEvents(sim.events)
      });
    }
    self.postMessage({ type: "DONE", results, completed: results.length, total: jobs.length });
  } catch (error) {
    self.postMessage({ type: "ERROR", error: error?.message || String(error) });
  }
};
