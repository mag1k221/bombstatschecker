/** Pure regear cost math: prices lost gear from squad deaths. */
import type { PriceQuote } from "@/lib/api-types";
import type { SquadDeath } from "./compute";

export const QUALITY_NAMES = ["Normal", "Good", "Outstanding", "Excellent", "Masterpiece"] as const;

export function qualityName(q: number): string {
  return QUALITY_NAMES[q - 1] ?? `Q${q}`;
}

export function priceKey(type: string, quality: number): string {
  return `${type}#${quality}`;
}

export interface PricedItem {
  slot: string;
  type: string;
  quality: number;
  name: string;
  quote: PriceQuote | null;
  /** Price found for a different quality. */
  approx: boolean;
}

export interface DeathCost {
  death: SquadDeath;
  items: PricedItem[];
  total: number;
  missing: number;
  approx: number;
}

export interface MemberCost {
  memberKey: string;
  name: string;
  deaths: number;
  total: number;
  missing: number;
}

export interface RegearTotals {
  deaths: DeathCost[];
  members: MemberCost[];
  total: number;
  missing: number;
  approx: number;
  itemCount: number;
}

/** Unique (type, quality) pairs to look up. */
export function itemsToPrice(deaths: readonly SquadDeath[]): { type: string; quality: number }[] {
  const seen = new Map<string, { type: string; quality: number }>();
  for (const d of deaths) for (const it of d.items) seen.set(priceKey(it.type, it.quality), { type: it.type, quality: it.quality });
  return [...seen.values()];
}

export function computeRegear(
  deaths: readonly SquadDeath[],
  quotes: Readonly<Record<string, PriceQuote>>,
  opts: { excludeSlots?: ReadonlySet<string> } = {},
): RegearTotals {
  const exclude = opts.excludeSlots ?? new Set<string>();
  const byMember = new Map<string, MemberCost>();
  let total = 0;
  let missing = 0;
  let approx = 0;
  let itemCount = 0;
  const out: DeathCost[] = deaths.map((death) => {
    let dTotal = 0;
    let dMissing = 0;
    let dApprox = 0;
    const items: PricedItem[] = death.items
      .filter((it) => !exclude.has(it.slot))
      .map((it) => {
        const quote = quotes[priceKey(it.type, it.quality)] ?? null;
        const isApprox = !!quote && quote.quality !== it.quality;
        if (quote) dTotal += quote.price;
        else dMissing++;
        if (isApprox) dApprox++;
        return { ...it, quote, approx: isApprox };
      });
    total += dTotal;
    missing += dMissing;
    approx += dApprox;
    itemCount += items.length;
    const m = byMember.get(death.memberKey) ?? { memberKey: death.memberKey, name: death.victim, deaths: 0, total: 0, missing: 0 };
    m.deaths++;
    m.total += dTotal;
    m.missing += dMissing;
    byMember.set(death.memberKey, m);
    return { death, items, total: dTotal, missing: dMissing, approx: dApprox };
  });
  const members = [...byMember.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  return { deaths: out, members, total, missing, approx, itemCount };
}
