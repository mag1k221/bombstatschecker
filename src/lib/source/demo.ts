/**
 * DEMO DATA — entirely fictional. Used only when the user explicitly chooses demo mode.
 * Never used as a fallback for failed live retrieval.
 */
import type { BattleDataset, KillEvent } from "@/lib/types";

export const DEMO_ROSTER = ["Ashwick", "brannoc", "CINDERFALL", "Dovrel", "Emberly", "Fennick", "ashwick", "Gloamrider"];
export const DEMO_BATTLE_ID = 1000000001;

const p = (name: string, guild = "Demo Boomsquad") => ({ id: null, name, guildName: guild, allianceName: "DEMO" });

const DEMO_GEAR: KillEvent["victimGear"] = [
  { slot: "MainHand", type: "T8_2H_HOLYSTAFF_HELL@1", quality: 2 },
  { slot: "Head", type: "T8_HEAD_CLOTH_SET2@1", quality: 2 },
  { slot: "Armor", type: "T8_ARMOR_CLOTH_SET2@1", quality: 3 },
  { slot: "Shoes", type: "T8_SHOES_CLOTH_SET2@1", quality: 2 },
  { slot: "Cape", type: "T8_CAPEITEM_FW_THETFORD@1", quality: 1 },
  { slot: "Mount", type: "T5_MOUNT_ARMORED_HORSE", quality: 1 },
];

function ev(id: number, minute: number, killer: string, victim: string, kg?: string, vg?: string, participants: string[] = []): KillEvent {
  return {
    victimGear: DEMO_GEAR,
    victimDeathFame: 150000,
    id,
    battleId: DEMO_BATTLE_ID,
    timestamp: new Date(Date.UTC(2026, 0, 1, 20, minute, 0)).toISOString(),
    killer: p(killer, kg),
    victim: p(victim, vg),
    participants: [killer, ...participants],
  };
}

export function demoDataset(): BattleDataset {
  const R = "Rival Guild";
  const events: KillEvent[] = [
    ev(1, 1, "Ashwick", "Vexmor", undefined, R, ["Brannoc"]),
    ev(2, 2, "Ashwick", "Quillon", undefined, R),
    ev(3, 3, "Vexmor", "Brannoc", R),
    ev(4, 4, "Cinderfall", "Halvard", undefined, R, ["Ashwick", "Dovrel"]),
    ev(5, 5, "Halvard", "Dovrel", R),
    ev(6, 6, "Ashwick", "Morrow", undefined, R),
    ev(7, 7, "Brannoc", "Cinderfall"), // friendly fire (e.g. a faction flag mishap)
    ev(8, 8, "Cinderfall", "Ysolde", undefined, R),
    ev(8, 8, "Cinderfall", "Ysolde", undefined, R), // duplicate record → counted once
    ev(9, 9, "Morrow", "Emberly", R),
  ];
  return {
    battles: [
      {
        id: DEMO_BATTLE_ID,
        startTime: "2026-01-01T20:00:00.000Z",
        endTime: "2026-01-01T20:10:00.000Z",
        reportedKills: 9,
        retrievedEvents: 9,
        playerCount: 11,
        pagesFetched: 1,
        pagesFailed: 0,
        status: "complete",
      },
    ],
    events,
    playerCombat: {
      Ashwick: { damage: 48210, healing: 0, ipSum: 1612 * 4, ipCount: 4, killFame: 1400000 },
      Brannoc: { damage: 9120, healing: 0, ipSum: 1540 * 3, ipCount: 3, killFame: 300000 },
      Cinderfall: { damage: 36500, healing: 0, ipSum: 1580 * 3, ipCount: 3, killFame: 820000 },
      Dovrel: { damage: 0, healing: 102300, ipSum: 1495 * 2, ipCount: 2, killFame: 210000 },
      Emberly: { damage: 2100, healing: 0, ipSum: 1470, ipCount: 1, killFame: 90000 },
      Fennick: { damage: 0, healing: 0, ipSum: 0, ipCount: 0, killFame: 0 },
    },
    playerWeapons: {
      Ashwick: [{ type: "T8_2H_DUALSCIMITAR_UNDEAD@1", count: 4, lastSeen: "2026-01-01T20:06:00.000Z" }],
      Brannoc: [{ type: "T8_MAIN_MACE@2", count: 3, lastSeen: "2026-01-01T20:07:00.000Z" }],
      Cinderfall: [
        { type: "T7_2H_ICECRYSTAL_UNDEAD@2", count: 3, lastSeen: "2026-01-01T20:08:00.000Z" },
        { type: "T7_2H_FIRESTAFF_HELL@1", count: 1, lastSeen: "2026-01-01T20:02:00.000Z" },
      ],
      Dovrel: [{ type: "T8_2H_HOLYSTAFF_HELL@1", count: 2, lastSeen: "2026-01-01T20:05:00.000Z" }],
      Emberly: [{ type: "T7_2H_ENIGMATICSTAFF@2", count: 1, lastSeen: "2026-01-01T20:09:00.000Z" }],
    },
    playersSeen: ["Ashwick", "Brannoc", "Cinderfall", "Dovrel", "Emberly", "Fennick", "Vexmor", "Quillon", "Halvard", "Morrow", "Ysolde"],
    issues: [],
  };
}
