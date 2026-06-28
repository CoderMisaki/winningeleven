import { StateManager } from "../state/appState.js";
import { Security } from "../utils/security.js";
import { teamsDB } from "../data/teams.js";
import { normalizeCountry } from "./similarity.js";

function canonicalStringify(obj) {
  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalStringify).join(',') + ']';
  }
  if (obj !== null && typeof obj === 'object') {
    const sortedKeys = Object.keys(obj).sort();
    return '{' + sortedKeys.map(k => '"' + k + '":' + canonicalStringify(obj[k])).join(',') + '}';
  }
  return JSON.stringify(obj);
}

function isMemoryIdentical(importedGames) {
  const importedHash = canonicalStringify(importedGames);
  for (const [memId, memory] of Object.entries(StateManager.db.memories)) {
    if (memory && memory.games) {
      const existingHash = canonicalStringify(memory.games);
      if (importedHash === existingHash) {
        return memId;
      }
    }
  }
  return null;
}

export const ImportExportService = {
  exportMemoryToJSON(memoryId) {
    const targetMemory = StateManager.db.memories[memoryId];
    if (!targetMemory) return alert("Tidak dapat mengekspor memori kosong!");

    const exportData = { ...targetMemory, version: 2 };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `memo${memoryId}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  },

  downloadTemplate(memoryId) {
    const template = {
      version: 2,
      memoryNumber: parseInt(memoryId, 10),
      games: [],
      lastUpdate: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(template, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `memo${memoryId}_template.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  },

  processImportFile(file, targetMemoryId, onComplete) {
    if (!file.name.toLowerCase().endsWith('.json')) {
      alert("Format berkas ditolak! Harap unggah file .json");
      return;
    }

    const reader = new FileReader();

    reader.onload = (event) => {
      let originalMemoryData = null;
      if (StateManager.db.memories[targetMemoryId]) {
        originalMemoryData = JSON.parse(JSON.stringify(StateManager.db.memories[targetMemoryId]));
      }

      try {
        let importedData = JSON.parse(event.target.result);
        importedData = Security.sanitizeObject(importedData);
        
        if (!importedData.games || !Array.isArray(importedData.games)) {
          throw new Error("Struktur data Game paket didalam JSON tidak valid.");
        }

        if (importedData.games.length === 0) {
            throw new Error("Dataset Game kosong.");
        }

        // Validasi JSON Ekstensif
        const gameNumbers = new Set();
        importedData.games.forEach((game, index) => {
          if (gameNumbers.has(game.gameNumber)) {
            throw new Error(`Duplikasi gameNumber terdeteksi: ${game.gameNumber}`);
          }
          gameNumbers.add(game.gameNumber);

          if (!game.matches || game.matches.length !== 7) {
            throw new Error(`Game ${game.gameNumber} harus memiliki tepat 7 matches.`);
          }
          game.matches.forEach(m => {
            if (m.score && !/^\d+:\d+$/.test(m.score) && m.score.trim() !== "") {
              throw new Error(`Format score tidak valid pada Game ${game.gameNumber}: ${m.score}. Harus berformat x:y`);
            }
            if (m.home && m.home.trim() !== "") {
              const normHome = normalizeCountry(m.home);
              if (!teamsDB[normHome]) throw new Error(`Negara Home tidak dikenal pada Game ${game.gameNumber}: ${m.home}`);
            }
            if (m.away && m.away.trim() !== "") {
              const normAway = normalizeCountry(m.away);
              if (!teamsDB[normAway]) throw new Error(`Negara Away tidak dikenal pada Game ${game.gameNumber}: ${m.away}`);
            }
          });

          if (!game.topGoals || game.topGoals.length !== 7) {
            throw new Error(`Game ${game.gameNumber} harus memiliki tepat 7 topGoals.`);
          }
          game.topGoals.forEach(g => {
            if (g.goals && isNaN(parseInt(g.goals, 10))) {
              throw new Error(`Goals harus berupa angka pada Game ${game.gameNumber}`);
            }
            if (g.country && g.country.trim() !== "") {
              const normCountry = normalizeCountry(g.country);
              if (!teamsDB[normCountry]) throw new Error(`Negara pencetak gol tidak dikenal pada Game ${game.gameNumber}: ${g.country}`);
            }
          });
        });

        // Duplicate Memory Detection
        const identicalMemId = isMemoryIdentical(importedData.games);
        if (identicalMemId && identicalMemId !== String(targetMemoryId)) {
          const proceed = confirm(`Memory ini identik dengan Memory ${identicalMemId}. Tetap import?`);
          if (!proceed) return;
        }

        // Konfirmasi Overwrite apabila data pada slot memori tujuan sudah terisi
        if (StateManager.db.memories[targetMemoryId]) {
          const overwriteConfirmed = confirm(`Peringatan: Slot Memory ${targetMemoryId} sudah berisi dataset. Timpa (Overwrite) seluruh data?`);
          if (!overwriteConfirmed) return;
        }

        // Terapkan paksa ID nomor memori mengikuti aturan nama file
        importedData.memoryNumber = targetMemoryId;
        // Pastikan version diupdate
        importedData.version = importedData.version || 2;

        StateManager.db.memories[targetMemoryId] = importedData;
        StateManager.save();
        
        alert(`Berhasil mengimpor berkas ke Memory ${targetMemoryId}!`);
        onComplete(targetMemoryId);
      } catch (err) {
        // Rollback / Restore on fail
        if (originalMemoryData) {
          StateManager.db.memories[targetMemoryId] = originalMemoryData;
        } else {
          StateManager.db.memories[targetMemoryId] = null;
        }
        alert("Gagal membaca atau mem-parsing berkas JSON: " + err.message);
      }
    };

    reader.readAsText(file);
  }
};
