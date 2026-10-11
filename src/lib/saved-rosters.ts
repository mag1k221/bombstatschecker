/** Saved rosters persisted in the browser's localStorage only (never sent anywhere). */
export const SAVED_ROSTERS_KEY = "boomsquad.rosters.v1";
export const MAX_SAVED_ROSTERS = 40;
export const MAX_ROSTER_NAME = 40;
const MAX_TEXT = 64 * 1024;

export interface SavedRoster {
  name: string;
  text: string;
  count: number;
  savedAt: string;
}

export function parseSavedRosters(raw: string | null): SavedRoster[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v
      .filter(
        (r): r is SavedRoster =>
          r && typeof r.name === "string" && r.name.trim() && typeof r.text === "string" && r.text.length <= MAX_TEXT,
      )
      .map((r) => ({
        name: r.name.slice(0, MAX_ROSTER_NAME),
        text: r.text,
        count: Number.isFinite(r.count) ? r.count : 0,
        savedAt: typeof r.savedAt === "string" ? r.savedAt : "",
      }))
      .slice(0, MAX_SAVED_ROSTERS);
  } catch {
    return [];
  }
}

/** Adds or replaces (case-insensitive name match) a roster; newest first; capped. */
export function upsertRoster(list: readonly SavedRoster[], entry: Omit<SavedRoster, "savedAt">, now = new Date()): SavedRoster[] {
  const name = entry.name.trim().slice(0, MAX_ROSTER_NAME);
  if (!name) return [...list];
  const rest = list.filter((r) => r.name.toLowerCase() !== name.toLowerCase());
  return [{ ...entry, name, text: entry.text.slice(0, MAX_TEXT), savedAt: now.toISOString() }, ...rest].slice(0, MAX_SAVED_ROSTERS);
}

export function removeRoster(list: readonly SavedRoster[], name: string): SavedRoster[] {
  return list.filter((r) => r.name !== name);
}
