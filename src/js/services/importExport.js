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

  processImportFile(file, onComplete) {
    const fileName = file.name.toLowerCase();
    const matchesPattern = fileName.match(/^memo([1-7])\.json$/);

    if (!matchesPattern) {
      alert("Format berkas ditolak! Nama berkas wajib berformat murni: memo1.json hingga memo7.json");
      return;
    }

    const targetMemoryId = parseInt(matchesPattern[1], 10);
    const reader = new FileReader();

    reader.onload = (event) => {
      try {
        const importedData = JSON.parse(event.target.result);
        
        if (!importedData.games || !Array.isArray(importedData.games)) {
          throw new Error("Struktur data Game paket didalam JSON tidak valid.");
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
