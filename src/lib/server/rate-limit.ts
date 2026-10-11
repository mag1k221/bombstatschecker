/** Fixed-window per-key rate limiter (in-memory, per instance). */
export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();
  constructor(private readonly limit: number, private readonly windowMs: number, private readonly now: () => number = Date.now) {}

  check(key: string): { allowed: boolean; retryAfterSec: number } {
    const t = this.now();
    if (this.hits.size > 5000) for (const [k, v] of this.hits) if (v.resetAt <= t) this.hits.delete(k);
    const cur = this.hits.get(key);
    if (!cur || cur.resetAt <= t) {
      this.hits.set(key, { count: 1, resetAt: t + this.windowMs });
      return { allowed: true, retryAfterSec: 0 };
    }
    if (cur.count >= this.limit) return { allowed: false, retryAfterSec: Math.ceil((cur.resetAt - t) / 1000) };
    cur.count++;
    return { allowed: true, retryAfterSec: 0 };
  }
}
