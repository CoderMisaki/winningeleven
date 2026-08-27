import { StateManager } from "../state/appState.js";

// Keep a reference to the worker
let worker = null;

export const MatchingEngine = {
  executeSearch(query) {
    return new Promise((resolve, reject) => {
      // Initialize the worker if it doesn't exist
      if (!worker) {
          worker = new Worker(new URL('../workers/matchingWorker.js', import.meta.url), { type: 'module' });
      }

      worker.onmessage = (e) => {
          if (e.data.error) {
              reject(new Error(e.data.error));
          } else {
              resolve(e.data.results);
          }
      };

      worker.onerror = (error) => {
          reject(error);
      };

      // Send the query and the memory database to the worker
      worker.postMessage({
          query: query,
          memories: StateManager.db.memories
      });
    });
  }
};
