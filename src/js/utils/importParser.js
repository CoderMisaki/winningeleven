/**
 * Fast import parser for match results
 * Supports:
 * - Spain 3:2 England
 * - Spain3:2England
 * - Spain 3 - 2 England
 * - Multiple lines
 */

export function parseImportLines(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  const results = [];
  const errors = [];

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    const parsed = parseSingleLine(line);
    if (parsed.error) {
      errors.push({ line: idx + 1, text: line, error: parsed.error });
    } else {
      results.push(parsed);
    }
  }
  return { results, errors };
}

function parseSingleLine(line) {
  // Find score pattern: number separator number
  // Separator can be : or - (with optional spaces)
  // We use regex to find first occurrence
  const scoreRegex = /(\d+)\s*[:\-]\s*(\d+)/;
  const match = line.match(scoreRegex);
  if (!match) {
    return { error: 'score harus dalam format H:A, contoh 3:2 atau 3-2' };
  }
  const homeScore = parseInt(match[1], 10);
  const awayScore = parseInt(match[2], 10);
  if (isNaN(homeScore) || isNaN(awayScore) || homeScore < 0 || awayScore < 0) {
    return { error: 'score tidak valid (harus angka >=0)' };
  }
  if (homeScore > 20 || awayScore > 20) {
    return { error: 'score melebihi range WE10 (0-20)' };
  }
  const scoreIndex = match.index;
  const homePart = line.slice(0, scoreIndex).trim();
  const awayPart = line.slice(scoreIndex + match[0].length).trim();

  if (!homePart) return { error: 'home country tidak boleh kosong' };
  if (!awayPart) return { error: 'away country tidak boleh kosong' };

  // Validate that home/away don't contain stray numbers that look like score fragments?
  // Allow numbers in country? No country has numbers, so we can ignore.

  // Clean up home/away: remove extra symbols like leading/trailing - or : leftovers
  const cleanHome = homePart.replace(/^[\-\:\s]+|[\-\:\s]+$/g, '').trim();
  const cleanAway = awayPart.replace(/^[\-\:\s]+|[\-\:\s]+$/g, '').trim();

  if (!cleanHome || !cleanAway) return { error: 'format home/away tidak valid' };

  return {
    home: cleanHome,
    homeScore: String(homeScore),
    awayScore: String(awayScore),
    score: `${homeScore}:${awayScore}`,
    away: cleanAway
  };
}

// For testing
export function formatForB1B8(parsed) {
  // Returns array suitable for matches[0..7]
  return parsed.map(p => ({
    home: p.home,
    score: p.score,
    away: p.away
  }));
}
