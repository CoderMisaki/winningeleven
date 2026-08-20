// src/js/services/agentPersistence.js

const DB_NAME = "GitHubAgentDB_v1";
const STORE_MEMORIES = "repo_memories";
const STORE_CHECKPOINTS = "task_checkpoints";

function openAgentDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_MEMORIES)) {
        db.createObjectStore(STORE_MEMORIES, { keyPath: "repoKey" });
      }
      if (!db.objectStoreNames.contains(STORE_CHECKPOINTS)) {
        db.createObjectStore(STORE_CHECKPOINTS, { keyPath: "taskId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const AgentPersistence = {
  async getRepoMemory(repoKey) {
    const db = await openAgentDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_MEMORIES, "readonly");
      const req = tx.objectStore(STORE_MEMORIES).get(repoKey);
      req.onsuccess = () => resolve(req.result?.memoryText || "");
      req.onerror = () => resolve("");
    });
  },

  async appendRepoMemory(repoKey, newInsight) {
    const currentMemory = await this.getRepoMemory(repoKey);
    const updatedMemory = `${currentMemory}\n\n[UPDATE ${new Date().toISOString().split("T")[0]}]: ${newInsight}`.trim();

    const db = await openAgentDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_MEMORIES, "readwrite");
      tx.objectStore(STORE_MEMORIES).put({ repoKey, memoryText: updatedMemory, lastUpdate: Date.now() });
      tx.oncomplete = () => resolve(updatedMemory);
      tx.onerror = () => reject(tx.error);
    });
  },

  async saveTaskCheckpoint(taskState) {
    const db = await openAgentDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_CHECKPOINTS, "readwrite");
      tx.objectStore(STORE_CHECKPOINTS).put({ ...taskState, updatedAt: Date.now() });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  },

  async getActiveCheckpoint(repoKey) {
    const db = await openAgentDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_CHECKPOINTS, "readonly");
      const store = tx.objectStore(STORE_CHECKPOINTS);
      const req = store.getAll();
      req.onsuccess = () => {
        const records = req.result || [];
        const active = records.find(r => r.repoKey === repoKey && r.status === "RUNNING");
        resolve(active || null);
      };
      req.onerror = () => resolve(null);
    });
  },

  async clearTaskCheckpoint(taskId) {
    const db = await openAgentDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_CHECKPOINTS, "readwrite");
      tx.objectStore(STORE_CHECKPOINTS).delete(taskId);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }
};
