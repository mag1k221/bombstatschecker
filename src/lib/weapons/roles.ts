/**
 * Role is NOT provided by the game or the API — it is inferred from the main-hand weapon,
 * using common ZvZ conventions (similar to AlbionBB's composition groups).
 * Adjust LINE_ROLES / WEAPON_ROLE_OVERRIDES to match your guild's comp.
 */
export type Role = "tank" | "healer" | "support" | "ranged" | "melee" | "unknown";

export const ROLE_ORDER: Role[] = ["tank", "healer", "support", "melee", "ranged", "unknown"];

export const ROLE_LABELS: Record<Role, string> = {
  tank: "Tank",
  healer: "Healer",
  support: "Support",
  melee: "Melee DPS",
  ranged: "Ranged DPS",
  unknown: "Unknown",
};

/** Default role per weapon line (the game's shop sub-category). */
export const LINE_ROLES: Record<string, Role> = {
  mace: "tank",
  hammer: "tank",
  quarterstaff: "tank",
  holystaff: "healer",
  naturestaff: "healer",
  arcanestaff: "support",
  axe: "melee",
  sword: "melee",
  dagger: "melee",
  spear: "melee",
  knuckles: "melee",
  bow: "ranged",
  crossbow: "ranged",
  firestaff: "ranged",
  froststaff: "ranged",
  cursestaff: "ranged",
  shapeshifterstaff: "melee",
};

/** Per-weapon exceptions for lines that mix roles. Keys are base item IDs (no tier/enchant). */
export const WEAPON_ROLE_OVERRIDES: Record<string, Role> = {
  // Quarterstaffs: bladed/scythe staves are damage dealers, Black Monk is a support pick.
  "2H_DOUBLEBLADEDSTAFF": "melee",
  "2H_DOUBLEBLADEDSTAFF_CRYSTAL": "melee",
  "2H_TWINSCYTHE_HELL": "melee",
  "2H_COMBATSTAFF_MORGANA": "support",
  // Shapeshifter staffs (by transformation).
  "2H_SHAPESHIFTER_SET2": "support", // Rootbound (Ent)
  "2H_SHAPESHIFTER_SET3": "tank", // Primal (Bear)
  "2H_SHAPESHIFTER_KEEPER": "tank", // Earthrune (Rock Elemental)
  "2H_SHAPESHIFTER_HELL": "ranged", // Hellspawn (Imp)
  "2H_SHAPESHIFTER_AVALON": "ranged", // Lightcaller (Eagle)
};

export function roleForWeapon(base: string | null, line: string | null): Role {
  if (!base) return "unknown";
  return WEAPON_ROLE_OVERRIDES[base] ?? (line ? LINE_ROLES[line] : undefined) ?? "unknown";
}
