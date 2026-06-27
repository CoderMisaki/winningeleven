import { StateManager } from "../state/appState.js";

export const ImportExportService = {
  exportMemoryToJSON(memoryId) {
    const targetMemory = StateManager.db.memories[memoryId];
    if (!targetMemory) return alert("Tidak dapat mengekspor memori kosong!");

    const blob = new Blob([JSON.stringify(targetMemory, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `memo${memoryId}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  },


  downloadTemplate(memoryId) {
    const template = {
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
      try {
        const importedData = JSON.parse(event.target.result);
        
        if (!importedData.games || !Array.isArray(importedData.games)) {
          throw new Error("Struktur data Game paket didalam JSON tidak valid.");
        }

        if (importedData.games.length === 0) {
            throw new Error("Dataset Game kosong.");
        }

        // Konfirmasi Overwrite apabila data pada slot memori tujuan sudah terisi
        if (StateManager.db.memories[targetMemoryId]) {
          const overwriteConfirmed = confirm(`Peringatan: Slot Memory ${targetMemoryId} sudah berisi dataset. Timpa (Overwrite) seluruh data?`);
          if (!overwriteConfirmed) return;
        }

        // Terapkan paksa ID nomor memori mengikuti aturan nama file
        importedData.memoryNumber = targetMemoryId;
        StateManager.db.memories[targetMemoryId] = importedData;
        StateManager.save();
        
        alert(`Berhasil mengimpor berkas ke Memory ${targetMemoryId}!`);
        onComplete(targetMemoryId);
      } catch (err) {
        alert("Gagal membaca atau mem-parsing berkas JSON: " + err.message);
      }
    };

    reader.readAsText(file);
  }
};
