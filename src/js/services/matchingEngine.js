import { StateManager } from "../state/appState.js";
import { SimilarityCalculator } from "./similarity.js";

// FIX AUDIT: worker sebelumnya di-cache global dan `onmessage` di-overwrite setiap
// pencarian. Akibatnya:
//   - dua pencarian berurutan → promise pertama resolve dengan hasil pencarian kedua
//     (atau tidak pernah resolve sama sekali),
//   - kalau worker crash sekali, semua pencarian berikutnya ikut gagal selamanya,
//   - tidak ada timeout → UI menggantung tanpa batas.
// Sekarang: satu worker segar per pencarian + timeout + fallback sinkron di main thread.
const SEARCH_TIMEOUT_MS = 15000;

function runInWorker(query, memories) {
  return new Promise((resolve, reject) => {
    let worker = null;
    let settled = false;
    let timer = null;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      if (worker) {
        worker.onmessage = null;
        worker.onerror = null;
        try { worker.terminate(); } catch (_) { /* noop */ }
      }
      worker = null;
    };
    const done = (fn, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn(value);
    };

    try {
      worker = new Worker(new URL('../workers/matchingWorker.js', import.meta.url), { type: 'module' });
    } catch (err) {
      reject(new Error(`Gagal membuat worker: ${err?.message || err}`));
      return;
    }

    timer = setTimeout(() => {
      done(reject, new Error("Pencarian similarity timeout (15s)."));
    }, SEARCH_TIMEOUT_MS);

    worker.onmessage = (e) => {
      const data = e.data;
      if (!data) { done(reject, new Error("Worker mengembalikan payload kosong.")); return; }
      if (data.error) { done(reject, new Error(data.error)); return; }
      done(resolve, Array.isArray(data.results) ? data.results : []);
    };

    worker.onerror = (error) => {
      done(reject, new Error(`Worker error: ${error?.message || "unknown"}`));
    };

    try {
      worker.postMessage({ query, memories });
    } catch (err) {
      done(reject, new Error(`Gagal mengirim data ke worker: ${err?.message || err}`));
    }
  });
}

// Fallback sinkron: dipakai kalau Worker tidak tersedia (file:// , CSP ketat, dll)
function runOnMainThread(query, memories) {
  const results = [];
  for (const [memoryId, memory] of Object.entries(memories || {})) {
    if (!memory || !Array.isArray(memory.games)) continue;
    for (const game of memory.games) {
      if (!game || typeof game !== "object") continue;
      try {
        const sim = SimilarityCalculator.calculate(query, game);
        if (sim.percentage > 0) {
          results.push({
            memoryId: parseInt(memoryId, 10),
            memoryName: memory.memoryName || `Memory ${memoryId}`,
            gameNumber: game.gameNumber,
            similarity: sim.percentage,
            explanations: sim.explanations
          });
        }
      } catch (_) { /* skip game rusak */ }
    }
  }
  return results.sort((a, b) => {
    if (b.similarity !== a.similarity) return b.similarity - a.similarity;
    if (a.gameNumber !== b.gameNumber) return a.gameNumber - b.gameNumber;
    return a.memoryId - b.memoryId;
  });
}

export const MatchingEngine = {
  async executeSearch(query) {
    const memories = StateManager.db?.memories || {};
    if (typeof Worker === "undefined") {
      return runOnMainThread(query, memories);
    }
    try {
      return await runInWorker(query, memories);
    } catch (err) {
      console.warn("[MatchingEngine] worker gagal, fallback ke main thread:", err?.message || err);
      return runOnMainThread(query, memories);
    }
  }
};
