/** K/D helpers. Numeric value: Infinity when deaths = 0 and kills > 0; null when both are 0. */
export function kdValue(kills: number, deaths: number): number | null {
  if (deaths === 0) return kills > 0 ? Infinity : null;
  return kills / deaths;
}

export function formatKD(kills: number, deaths: number): string {
  const v = kdValue(kills, deaths);
  if (v === null) return "—";
  if (v === Infinity) return "∞";
  return v.toFixed(2);
}
