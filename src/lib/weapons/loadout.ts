import type { WeaponUse } from "@/lib/types";
import { baseOf, weaponInfo, type WeaponInfo } from "./catalog";
import { roleForWeapon, type Role } from "./roles";

export interface Loadout {
  primary: WeaponInfo | null;
  role: Role;
  /** Other weapon names seen for the same player in this battle (weapon swaps), most used first. */
  others: string[];
  /** How many events the primary weapon was observed in. */
  sightings: number;
}

/**
 * Picks the weapon a player used most in the battle (by number of events they appear in with it,
 * grouped by base weapon so tiers/enchants of the same weapon count together). Ties → most recently seen.
 */
export function resolveLoadout(uses: readonly WeaponUse[] | undefined): Loadout {
  const byBase = new Map<string, { count: number; lastSeen: string; best: WeaponUse }>();
  for (const u of uses ?? []) {
    const base = baseOf(u.type);
    if (!base) continue;
    const cur = byBase.get(base);
    const last = u.lastSeen ?? "";
    if (!cur) byBase.set(base, { count: u.count, lastSeen: last, best: u });
    else {
      cur.count += u.count;
      if (last > cur.lastSeen) cur.lastSeen = last;
      if (u.count > cur.best.count || (u.count === cur.best.count && last > (cur.best.lastSeen ?? ""))) cur.best = u;
    }
  }
  const ranked = [...byBase.entries()].sort((a, b) => b[1].count - a[1].count || b[1].lastSeen.localeCompare(a[1].lastSeen));
  if (ranked.length === 0) return { primary: null, role: "unknown", others: [], sightings: 0 };
  const primary = weaponInfo(ranked[0][1].best.type);
  return {
    primary,
    role: roleForWeapon(primary?.base ?? null, primary?.line ?? null),
    others: ranked.slice(1).map(([, v]) => weaponInfo(v.best.type)?.name ?? v.best.type),
    sightings: ranked[0][1].count,
  };
}
