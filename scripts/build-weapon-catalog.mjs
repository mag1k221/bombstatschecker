/**
 * Regenerates src/lib/weapons/catalog.generated.json (weapons: name + line) and
 * src/lib/weapons/items.generated.json (all wearable gear + mounts: name) from the community-maintained
 * Albion Online game data dumps (https://github.com/ao-data/ao-bin-dumps).
 * Usage: node scripts/build-weapon-catalog.mjs [itemsXmlPath itemsTxtPath]
 * Without arguments, the files are downloaded from GitHub.
 */
import { readFile, writeFile } from "node:fs/promises";

const BASE = "https://raw.githubusercontent.com/ao-data/ao-bin-dumps/master";
const [xmlPath, txtPath] = process.argv.slice(2);
const load = async (path, url) => (path ? readFile(path, "utf8") : (await fetch(url)).text());

const xml = await load(xmlPath, `${BASE}/items.xml`);
const txt = await load(txtPath, `${BASE}/formatted/items.txt`);

const names = new Map();
for (const line of txt.split(/\r?\n/)) {
  const m = /^\s*\d+:\s*(\S+)\s*:\s*(.*)$/.exec(line);
  if (m) names.set(m[1], m[2].trim());
}

const TIER_PREFIX = /^(Beginner's|Novice's|Journeyman's|Adept's|Expert's|Master's|Grandmaster's|Elder's)\s+/;
const catalog = {};
const tagRe = /<(weapon|transformationweapon)\s([^>]*)>/g;
const attr = (s, k) => new RegExp(`\\b${k}="([^"]*)"`).exec(s)?.[1];
for (const [, , attrs] of xml.matchAll(tagRe)) {
  const unique = attr(attrs, "uniquename");
  if (!unique || attr(attrs, "shopcategory") !== "weapons" || attr(attrs, "slottype") !== "mainhand") continue;
  const m = /^T(\d)_(.+)$/.exec(unique);
  if (!m) continue;
  const base = m[2];
  if (catalog[base] && m[1] !== "4") continue; // prefer the T4 name
  const name = (names.get(unique) ?? "").replace(TIER_PREFIX, "");
  if (!name) continue;
  catalog[base] = { name, line: attr(attrs, "shopsubcategory1") ?? "unknown" };
}

const sorted = Object.fromEntries(Object.entries(catalog).sort(([a], [b]) => a.localeCompare(b)));
await writeFile(new URL("../src/lib/weapons/catalog.generated.json", import.meta.url), JSON.stringify(sorted, null, 1) + "\n");
console.log(`Wrote ${Object.keys(sorted).length} weapons.`);

// All gear that can appear in a victim's equipment: weapons, off-hands, armor, capes, bags, mounts.
const gear = {};
const gearRe = /<(weapon|transformationweapon|equipmentitem|mount)\s([^>]*)>/g;
for (const [, tag, attrs] of xml.matchAll(gearRe)) {
  const unique = attr(attrs, "uniquename");
  const m = unique && /^T(\d)_(.+)$/.exec(unique);
  if (!m) continue;
  if (tag === "mount") {
    // Mount names differ per tier/variant (e.g. T5 Swiftclaw vs T8 Rageclaw), so key them exactly.
    for (const id of [unique, ...[1, 2, 3, 4].map((e) => `${unique}@${e}`)]) {
      const n = names.get(id);
      if (n) gear[id] = n.replace(TIER_PREFIX, "");
    }
    continue;
  }
  const base = m[2];
  if (gear[base] && m[1] !== "4") continue;
  const name = (names.get(unique) ?? "").replace(TIER_PREFIX, "");
  if (name) gear[base] = name;
}
const gearSorted = Object.fromEntries(Object.entries(gear).sort(([a], [b]) => a.localeCompare(b)));
await writeFile(new URL("../src/lib/weapons/items.generated.json", import.meta.url), JSON.stringify(gearSorted) + "\n");
console.log(`Wrote ${Object.keys(gearSorted).length} gear items.`);
