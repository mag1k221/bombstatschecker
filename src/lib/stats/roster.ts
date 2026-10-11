/** Roster parsing & validation. Pure functions — safe to run in the browser and on the server. */

export const MAX_ROSTER_SIZE = 500;
export const MAX_NAME_LENGTH = 32;
export const MAX_FILE_BYTES = 256 * 1024;
export const MAX_TEXT_CHARS = 64 * 1024;

export interface RosterMember {
  /** Normalized match key: trimmed, NFC, lower-cased. */
  key: string;
  /** Name as the user typed it (first occurrence). */
  input: string;
}

export interface RosterResult {
  members: RosterMember[];
  /** Entries dropped because an equivalent nickname (case-insensitive) appeared earlier. */
  duplicates: string[];
  invalid: { name: string; reason: string }[];
  /** Entries dropped because the roster exceeded MAX_ROSTER_SIZE. */
  overflow: number;
}

export function normalizeName(name: string): string {
  return name.trim().normalize("NFC").toLowerCase();
}

// Albion character names are letters and digits; allow a few separators so unusual entries are
// reported clearly as "not found" instead of being rejected outright.
const NAME_RE = /^[\p{L}\p{N}_.\-' ]+$/u;

export function validateName(name: string): string | null {
  if (name.length > MAX_NAME_LENGTH) return `Longer than ${MAX_NAME_LENGTH} characters`;
  if (!NAME_RE.test(name)) return "Contains unsupported characters";
  return null;
}

export function buildRoster(rawNames: readonly unknown[]): RosterResult {
  const members: RosterMember[] = [];
  const duplicates: string[] = [];
  const invalid: { name: string; reason: string }[] = [];
  const keys = new Set<string>();
  let overflow = 0;

  for (const raw of rawNames) {
    if (typeof raw !== "string") continue;
    const name = raw.trim();
    if (!name || name.startsWith("#")) continue;
    const reason = validateName(name);
    if (reason) {
      invalid.push({ name: name.slice(0, 64), reason });
      continue;
    }
    const key = normalizeName(name);
    if (keys.has(key)) {
      duplicates.push(name);
      continue;
    }
    if (members.length >= MAX_ROSTER_SIZE) {
      overflow++;
      continue;
    }
    keys.add(key);
    members.push({ key, input: name });
  }
  return { members, duplicates, invalid, overflow };
}

/** Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF). Data only — nothing is evaluated. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const delimiter = detectDelimiter(text);
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field === "") quoted = true;
    else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const counts = [",", ";", "\t"].map((d) => [d, firstLine.split(d).length - 1] as const);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ",";
}

const HEADER_RE = /^(name|names|nick|nickname|nicknames|player|players|player ?name|member|members|character|ign)$/i;

/** Extracts nicknames from TXT (one per line) or CSV (header-detected or first column) content. */
export function extractNames(text: string, format: "txt" | "csv"): string[] {
  const clean = text.replace(/^\uFEFF/, "");
  if (format === "txt") return clean.split(/\r?\n/);
  const rows = parseCsv(clean);
  if (rows.length === 0) return [];
  const headerIdx = rows[0].findIndex((c) => HEADER_RE.test(c.trim()));
  if (headerIdx >= 0) return rows.slice(1).map((r) => r[headerIdx] ?? "");
  return rows.map((r) => r[0] ?? "");
}

export function formatFromFileName(name: string): "txt" | "csv" | null {
  const lower = name.toLowerCase();
  if (lower.endsWith(".csv")) return "csv";
  if (lower.endsWith(".txt")) return "txt";
  return null;
}

/** Heuristic for binary content (NUL bytes or many replacement chars). */
export function looksBinary(text: string): boolean {
  if (text.includes("\u0000")) return true;
  const bad = (text.match(/\uFFFD/g) ?? []).length;
  return text.length > 0 && bad / text.length > 0.05;
}
