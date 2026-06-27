import { getMemory, saveMemory } from "./storage.js";

export function exportMemory(slot) {
  const memory = getMemory(slot);
  if (!memory) return;
  const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(memory, null, 2));
  const el = document.createElement("a");
  el.setAttribute("href", dataStr);
  el.setAttribute("download", `memo${slot}.json`);
  document.body.appendChild(el);
  el.click();
  el.remove();
}

export function importMemory(file, slot, onSuccess) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      if (data && data.games) {
        saveMemory(slot, data);
        if (onSuccess) onSuccess();
      } else {
        alert("File JSON tidak valid untuk Memory WE10.");
      }
    } catch (err) {
      alert("Gagal membaca file JSON.");
    }
  };
  reader.readAsText(file);
}
