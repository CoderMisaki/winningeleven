import { countryAliases } from "../data/countryAliases.js";
import { teamsDB } from "../data/teams.js";

const normalize = (value) => value.toLowerCase().replace(/[^a-z\s]/g, "").trim();

export function findTeam(query) {
  const q = normalize(query);
  if (!q) return null;
  const code = q.toUpperCase();
  if (teamsDB[code]) return code;
  return Object.entries(teamsDB).find(([key, team]) => {
    const aliases = [key, team.name, ...(countryAliases[key] || [])].map(normalize);
    return aliases.some((alias) => alias === q || alias.startsWith(q) || q.startsWith(alias));
  })?.[0] || null;
}

export function searchTeams(query, limit = 6) {
  const q = normalize(query);
  if (!q) return [];
  return Object.entries(teamsDB)
    .map(([code, team]) => ({ code, team, aliases: [code, team.name, ...(countryAliases[code] || [])].map(normalize) }))
    .filter((item) => item.aliases.some((alias) => alias.startsWith(q) || alias.includes(q)))
    .slice(0, limit);
}
