/**
 * Daftar resmi 57 negara (derivasi dari teams.js) — dipisah ke modul kecil
 * supaya modul data/service bisa memvalidasi kode tanpa circular import.
 */
import { teamsDB } from "./teams.js";

export const ALLOWED_CODES = Object.freeze(Object.keys(teamsDB).map((c) => c.toUpperCase()));
export const ALLOWED_CODE_SET = new Set(ALLOWED_CODES);
export const ALLOWED_NAMES = Object.freeze(ALLOWED_CODES.map((c) => teamsDB[c].name));
export const ALLOWED_NAMES_SET = new Set(ALLOWED_NAMES.map((n) => n.toLowerCase()));
