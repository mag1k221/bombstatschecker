import catalog from "./catalog.generated.json";
import gearNames from "./items.generated.json";

export interface WeaponInfo {
  /** Full item type as seen in the data, e.g. "T6_2H_KNUCKLES_SET2@3" (used for the icon). */
  type: string;
  /** Base item ID without tier/enchantment, e.g. "2H_KNUCKLES_SET2". */
  base: string;
  name: string;
  line: string | null;
  tier: number | null;
  enchant: number;
}

const CATALOG = catalog as Record<string, { name: string; line: string }>;
const TYPE_RE = /^T([1-8])_([A-Z0-9_]+?)(?:@([0-4]))?$/;

export function isValidItemType(type: unknown): type is string {
  return typeof type === "string" && type.length <= 64 && TYPE_RE.test(type);
}

export function baseOf(type: string): string | null {
  return TYPE_RE.exec(type)?.[2] ?? null;
}

function humanize(base: string): string {
  return base
    .replace(/^(MAIN|2H|OFF)_/, "")
    .split("_")
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(" ");
}

export function weaponInfo(type: string): WeaponInfo | null {
  const m = TYPE_RE.exec(type);
  if (!m) return null;
  const base = m[2];
  const entry = CATALOG[base];
  return {
    type,
    base,
    name: entry?.name ?? humanize(base),
    line: entry?.line ?? null,
    tier: Number(m[1]),
    enchant: m[3] ? Number(m[3]) : 0,
  };
}

const GEAR = gearNames as Record<string, string>;

/** Display name for any gear item type (weapons, armor, capes, bags, mounts). */
export function itemName(type: string): string {
  const m = TYPE_RE.exec(type);
  if (!m) return type;
  const base = m[2];
  return GEAR[type] ?? GEAR[`T${m[1]}_${base}`] ?? CATALOG[base]?.name ?? GEAR[base] ?? humanize(base);
}
