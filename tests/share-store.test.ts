import { afterEach, describe, expect, it, vi } from "vitest";
import { loadShare, normalizePayload, saveShare, shareId, shareStoreEnabled } from "@/lib/server/share-store";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("short share links", () => {
  const p = { url: "https://europe.albionbb.com/battles/441346892", members: ["Ashwick", "Brannoc"] };

  it("makes stable 8-char ids", () => {
    expect(shareId(p)).toMatch(/^[A-Za-z0-9]{8}$/);
    expect(shareId(p)).toBe(shareId({ ...p, members: [...p.members] }));
    expect(shareId(p)).not.toBe(shareId({ ...p, members: ["Ashwick"] }));
  });

  it("validates payloads", () => {
    expect(normalizePayload({ url: "https://evil.com/battles/1", members: ["a"] })).toBeNull();
    expect(normalizePayload({ url: p.url, members: [] })).toBeNull();
    expect(normalizePayload({ url: "europe.albionbb.com/battles/441346892/", members: ["Ashwick", "ashwick", "<x>"] })).toEqual({
      url: p.url,
      members: ["Ashwick"],
    });
  });

  it("is disabled without configuration", async () => {
    vi.stubEnv("KV_REST_API_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    expect(shareStoreEnabled()).toBe(false);
    expect(await loadShare("abcdefgh")).toBeNull();
  });

  it("saves and loads through the Upstash REST API", async () => {
    vi.stubEnv("KV_REST_API_URL", "https://example.upstash.io");
    vi.stubEnv("KV_REST_API_TOKEN", "t");
    const db = new Map<string, string>();
    const calls: unknown[] = [];
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      const args = JSON.parse(String(init.body)) as string[];
      calls.push(args);
      if (args[0] === "SET") db.set(args[1], args[2]);
      return new Response(JSON.stringify({ result: args[0] === "GET" ? (db.get(args[1]) ?? null) : "OK" }));
    });
    const id = await saveShare(p);
    expect(calls[0]).toEqual(["SET", `boomsquad:share:${id}`, JSON.stringify({ u: p.url, m: p.members }), "EX", 180 * 86400]);
    expect(await loadShare(id)).toEqual(p);
    expect(await loadShare("zzzzzzzz")).toBeNull();
    expect(await loadShare("../../x")).toBeNull();
  });
});

describe("prefixed Vercel variables", () => {
  it("detects bombstatshecker_KV_REST_API_URL / _TOKEN", () => {
    vi.stubEnv("KV_REST_API_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("bombstatshecker_KV_REST_API_URL", "https://x.upstash.io");
    vi.stubEnv("bombstatshecker_KV_REST_API_READ_ONLY_TOKEN", "ro");
    expect(shareStoreEnabled()).toBe(false);
    vi.stubEnv("bombstatshecker_KV_REST_API_TOKEN", "t");
    expect(shareStoreEnabled()).toBe(true);
  });
});
