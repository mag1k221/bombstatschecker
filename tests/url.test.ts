import { describe, expect, it } from "vitest";
import { LinkError, parseAlbionBBLink } from "@/lib/source/url";

describe("parseAlbionBBLink", () => {
  it("accepts battle links for each region", () => {
    expect(parseAlbionBBLink("https://albionbb.com/battles/1407921257")).toMatchObject({ region: "americas", battleIds: [1407921257] });
    expect(parseAlbionBBLink("europe.albionbb.com/battles/441346892/")).toMatchObject({ region: "europe", canonicalUrl: "https://europe.albionbb.com/battles/441346892" });
    expect(parseAlbionBBLink("https://east.albionbb.com/battles/442742880?x=1#y")).toMatchObject({ region: "asia" });
  });

  it("accepts multi-battle links and dedupes IDs", () => {
    const r = parseAlbionBBLink("https://east.albionbb.com/battles/multi?ids=1,2,2,3");
    expect(r).toMatchObject({ kind: "multi", battleIds: [1, 2, 3] });
  });

  it.each([
    "https://evil.com/battles/1",
    "https://albionbb.com.evil.com/battles/1",
    "https://user:pw@albionbb.com/battles/1",
    "https://albionbb.com:8443/battles/1",
    "https://albionbb.com/players/Someone",
    "https://albionbb.com/battles/abc",
    "https://albionbb.com/battles/multi?ids=1,../x",
    "javascript:alert(1)",
    "https://127.0.0.1/battles/1",
    "",
  ])("rejects %s", (u) => {
    expect(() => parseAlbionBBLink(u)).toThrow(LinkError);
  });

  it("limits multi-battle size", () => {
    const ids = Array.from({ length: 11 }, (_, i) => i + 1).join(",");
    expect(() => parseAlbionBBLink(`https://albionbb.com/battles/multi?ids=${ids}`)).toThrow(/limited/);
  });
});
