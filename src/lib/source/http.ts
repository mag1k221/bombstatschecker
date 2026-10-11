import { ALLOWED_UPSTREAM_HOSTS } from "./regions";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface HttpClientOptions {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  maxBytes?: number;
  retries?: number;
  /** Minimum spacing between upstream requests issued by this client. */
  minIntervalMs?: number;
  /** Sleep function (injectable for tests). */
  sleep?: (ms: number) => Promise<void>;
  userAgent?: string;
}

export type FetchResult<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number | null; error: string };

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Minimal JSON client for the official game-info API.
 * - Only allow-listed upstream hosts over HTTPS (SSRF defense in depth).
 * - Redirects are never followed.
 * - Per-request timeout and response size cap.
 * - Bounded retries for 429/5xx/network errors, honoring Retry-After; global request spacing.
 */
export class HttpClient {
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly maxBytes: number;
  private readonly retries: number;
  private readonly minIntervalMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly userAgent: string;
  private queue: Promise<void> = Promise.resolve();
  private lastRequestAt = 0;

  constructor(opts: HttpClientOptions = {}) {
    this.fetchImpl = opts.fetchImpl ?? ((i, init) => fetch(i, init));
    this.timeoutMs = opts.timeoutMs ?? 20_000;
    this.maxBytes = opts.maxBytes ?? 16 * 1024 * 1024;
    this.retries = opts.retries ?? 2;
    this.minIntervalMs = opts.minIntervalMs ?? 200;
    this.sleep = opts.sleep ?? defaultSleep;
    this.userAgent = opts.userAgent ?? "BoomsquadTracker/1.0";
  }

  /** Serializes request starts so they are spaced by at least minIntervalMs. */
  private async throttle(): Promise<void> {
    if (this.minIntervalMs <= 0) return;
    const turn = this.queue.then(async () => {
      const wait = this.lastRequestAt + this.minIntervalMs - Date.now();
      if (wait > 0) await this.sleep(wait);
      this.lastRequestAt = Date.now();
    });
    this.queue = turn.catch(() => undefined);
    return turn;
  }

  async getJson<T = unknown>(url: string): Promise<FetchResult<T>> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { ok: false, status: null, error: "Invalid upstream URL" };
    }
    if (parsed.protocol !== "https:" || !ALLOWED_UPSTREAM_HOSTS.has(parsed.host)) {
      return { ok: false, status: null, error: "Upstream host not allowed" };
    }

    let last: FetchResult<T> = { ok: false, status: null, error: "Request not attempted" };
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      await this.throttle();
      const res = await this.once<T>(parsed.toString());
      if (res.ok) return res;
      last = res.result;
      if (!res.retriable || attempt === this.retries) break;
      const backoff = res.retryAfterMs ?? 500 * 2 ** attempt;
      await this.sleep(Math.min(backoff, 10_000));
    }
    return last;
  }

  private async once<T>(
    url: string,
  ): Promise<
    | { ok: true; status: number; data: T }
    | { ok: false; result: FetchResult<T>; retriable: boolean; retryAfterMs?: number }
  > {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const resp = await this.fetchImpl(url, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        cache: "no-store",
        headers: { Accept: "application/json", "User-Agent": this.userAgent },
      });
      if (resp.status >= 300 && resp.status < 400) {
        return { ok: false, retriable: false, result: { ok: false, status: resp.status, error: "Upstream redirect refused" } };
      }
      if (!resp.ok) {
        const retriable = resp.status === 429 || resp.status >= 500;
        const ra = Number(resp.headers.get("retry-after"));
        return {
          ok: false,
          retriable,
          retryAfterMs: Number.isFinite(ra) && ra > 0 ? ra * 1000 : undefined,
          result: { ok: false, status: resp.status, error: `Upstream responded ${resp.status}` },
        };
      }
      const declared = Number(resp.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > this.maxBytes) {
        return { ok: false, retriable: false, result: { ok: false, status: resp.status, error: "Upstream response too large" } };
      }
      const text = await readLimited(resp, this.maxBytes);
      if (text === null) {
        return { ok: false, retriable: false, result: { ok: false, status: resp.status, error: "Upstream response too large" } };
      }
      try {
        return { ok: true, status: resp.status, data: JSON.parse(text) as T };
      } catch {
        return { ok: false, retriable: true, result: { ok: false, status: resp.status, error: "Upstream returned malformed JSON" } };
      }
    } catch (err) {
      const aborted = (err as Error)?.name === "AbortError";
      return {
        ok: false,
        retriable: true,
        result: { ok: false, status: null, error: aborted ? "Upstream request timed out" : "Upstream unreachable" },
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

async function readLimited(resp: Response, maxBytes: number): Promise<string | null> {
  if (!resp.body) {
    const t = await resp.text();
    return new TextEncoder().encode(t).length > maxBytes ? null : t;
  }
  const reader = resp.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    buf.set(c, o);
    o += c.byteLength;
  }
  return new TextDecoder("utf-8").decode(buf);
}
