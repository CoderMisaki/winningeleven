/**
 * Formatting helpers for display names vs canonical IDs
 */

export function toTitleCase(str) {
  if (!str || typeof str !== 'string') return '';
  // Normalize: trim, lower case, then title case each word
  // Handle special cases: & , - , ' etc. Keep canonical via teamsDB if available
  return str
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map(word => {
      if (!word) return '';
      // Handle words with apostrophe or hyphen: e.g. "trinidad & tobago" -> "Trinidad & Tobago"
      // For simplicity, handle hyphen and apostrophe inside word
      // Split by - or '
      if (word.includes('-')) {
        return word.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('-');
      }
      if (word.includes("'")) {
        // e.g. o' shea -> O' Shea (keep space? original "O' Shea" has space)
        return word.split("'").map((part, idx) => idx === 0 ? part.charAt(0).toUpperCase() + part.slice(1) : part.charAt(0).toUpperCase() + part.slice(1)).join("'");
      }
      if (word === '&') return '&';
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

// For player names: "alex santos" -> "Alex Santos", "ALEX SANTOS" -> "Alex Santos"
// But keep special casing for names like "McBride"? For now Title Case is fine.
export function formatPlayerName(str) {
  return toTitleCase(str);
}

export function formatCountryName(str, canonicalMap) {
  // If canonical found, use canonical (already Title Case) to preserve exact spelling
  // canonicalMap: Map lower -> canonical
  if (!str) return '';
  const lower = str.trim().toLowerCase();
  if (canonicalMap && canonicalMap.has(lower)) {
    return canonicalMap.get(lower);
  }
  return toTitleCase(str);
}
