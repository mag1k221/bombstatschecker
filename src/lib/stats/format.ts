/** Compact number formatting: 950, 12.5k, 2.7m, 1.2b. */
export function formatCompact(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  const fmt = (v: number, suf: string) => `${(Math.round(v * 10) / 10).toString()}${suf}`;
  if (a >= 1e9) return fmt(n / 1e9, "b");
  if (a >= 1e6) return fmt(n / 1e6, "m");
  if (a >= 1e3) return fmt(n / 1e3, "k");
  return String(Math.round(n));
}
