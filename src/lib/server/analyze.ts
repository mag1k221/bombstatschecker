/** Orchestrates: validate input → load dataset (source layer) → compute stats (stats layer). */
import type { AnalyzeError, AnalyzeResponse } from "@/lib/api-types";
import { loadDataset, type LoadOptions } from "@/lib/source/albion-source";
import { demoDataset, DEMO_BATTLE_ID } from "@/lib/source/demo";
import { REGIONS } from "@/lib/source/regions";
import { LinkError, parseAlbionBBLink } from "@/lib/source/url";
import { computeSquadStats } from "@/lib/stats/compute";
import { buildRoster, MAX_ROSTER_SIZE } from "@/lib/stats/roster";
import type { BattleDataset } from "@/lib/types";

export type AnalyzeOutcome =
  | { ok: true; body: AnalyzeResponse }
  | { ok: false; status: number; body: AnalyzeError };

const fail = (status: number, code: AnalyzeError["code"], error: string): AnalyzeOutcome => ({
  ok: false,
  status,
  body: { code, error },
});

export async function analyze(input: unknown, loadOpts: LoadOptions = {}, demoEnabled = true): Promise<AnalyzeOutcome> {
  if (!input || typeof input !== "object") return fail(400, "invalid_input", "Request body must be a JSON object.");
  const body = input as Record<string, unknown>;

  if (!Array.isArray(body.members)) return fail(400, "invalid_input", "Members must be a list of nicknames.");
  if (body.members.length > MAX_ROSTER_SIZE * 4) return fail(400, "invalid_input", "Roster is too large.");
  const roster = buildRoster(body.members);
  if (roster.members.length === 0) return fail(400, "invalid_input", "Add at least one valid member nickname.");

  const demo = body.demo === true;
  if (demo && !demoEnabled) return fail(403, "demo_disabled", "Demo mode is disabled on this deployment.");

  let dataset: BattleDataset;
  let source: Omit<AnalyzeResponse["source"], "eventsConsidered" | "duplicateEventsIgnored" | "completeness" | "issues" | "battles">;

  if (demo) {
    dataset = demoDataset();
    source = {
      inputUrl: "demo",
      canonicalUrl: `demo://battles/${DEMO_BATTLE_ID}`,
      region: null,
      regionLabel: "Demo (fictional data)",
      kind: "battle",
      retrievedAt: new Date().toISOString(),
      fromCache: false,
    };
  } else {
    let link;
    try {
      link = parseAlbionBBLink(body.url);
    } catch (e) {
      if (e instanceof LinkError) return fail(400, "invalid_link", e.message);
      throw e;
    }
    const result = await loadDataset(link, { ...loadOpts, refresh: body.refresh === true });
    const region = REGIONS[link.region];
    if (result.notFoundBattleIds.length === link.battleIds.length) {
      return fail(
        404,
        "not_found",
        link.battleIds.length === 1
          ? `Battle ${link.battleIds[0]} wasn’t found on the ${region.label} server. Check that the link’s AlbionBB region matches the battle.`
          : `None of these battles were found on the ${region.label} server.`,
      );
    }
    if (result.dataset.battles.every((b) => b.status === "failed")) {
      return fail(502, "upstream_unavailable", "The official Albion Online API is unavailable right now. Please try again in a moment.");
    }
    dataset = result.dataset;
    source = {
      inputUrl: String(body.url).trim().slice(0, 2048),
      canonicalUrl: link.canonicalUrl,
      region: link.region,
      regionLabel: region.label,
      kind: link.kind,
      retrievedAt: result.retrievedAt,
      fromCache: result.fromCache,
    };
  }

  const partial = dataset.battles.some((b) => b.status !== "complete");
  const stats = computeSquadStats(roster.members, dataset, { partial });

  return {
    ok: true,
    body: {
      mode: demo ? "demo" : "live",
      source: {
        ...source,
        battles: dataset.battles,
        completeness: partial ? "partial" : "complete",
        issues: dataset.issues,
        eventsConsidered: stats.eventsConsidered,
        duplicateEventsIgnored: stats.duplicateEventsIgnored,
      },
      roster: { duplicatesRemoved: roster.duplicates, invalid: roster.invalid, overflow: roster.overflow },
      summary: stats.summary,
      members: stats.members,
      roleBreakdown: stats.roleBreakdown,
      squadDeaths: stats.squadDeaths,
      friendlyFire: stats.friendlyFire,
    },
  };
}
