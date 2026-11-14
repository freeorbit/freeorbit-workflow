// `wf testdata rename-ids [area] [--write]`: qualify each area's old IDs with
// its prefix, so every ID is unique across the app: R-12 becomes R-GM-12,
// C-41 C-GM-41, G-03 G-GM-03, and a dataset D27 DS-GM-27.
//
// Only IDs an area's spec defines are renamed. One only that area defines is
// its, wherever it is mentioned. One several areas define (R-76 in two) is
// told apart by its place: the area's docs folder, a path with the area's id
// as a folder or a file name, such as plugins/uplink/ or decisions/uplink.md, or one of the area's `code`
// paths in .workflow/config.json. Anywhere else it is listed for a person,
// never guessed. Without --write nothing is written.

import { OLD, qualify } from "./ids.mjs";
import { specIds } from "./testdata.mjs";

const TEXT = /\.(md|rs|ts|tsx|js|mjs|cjs|py|toml|json|ya?ml|html|css|txt)$/;

/** The area a code or doc path belongs to, or null when none or several claim it. */
export function areaOfPath(path, areas) {
  const parts = path.split("/");
  const stem = parts.at(-1).replace(/\.[^.]+$/, "");
  const claims = areas.filter((area) => (area.docs && path.startsWith(`${area.docs}/`)) || (area.code ?? []).some((prefix) => path.startsWith(prefix)) || parts.slice(0, -1).includes(area.id) || stem === area.id);
  return claims.length === 1 ? claims[0] : null;
}

/**
 * The renames for every area with a prefix and a docs folder, or for one:
 * `{ texts: Map(path, new text), areas: [{ id, docs, code, ids }], ambiguous: [{ path, line, id, areas }] }`.
 */
export function renameIds({ config, tracked, files }, areaId = null) {
  const areas = config.areas.filter((area) => area.prefix && area.docs);
  const chosen = areas.filter((area) => !areaId || area.id === areaId);
  if (areaId && !chosen.length) throw new Error(`no area ${areaId} with a prefix and a docs folder in .workflow/config.json`);
  // Each area's old IDs, from its own spec.
  const defined = new Map();
  for (const area of areas) {
    const spec = tracked.filter((p) => p.startsWith(`${area.docs}/test-data/`) && p.endsWith(".md"));
    defined.set(area.id, new Set(specIds(spec, files).filter(({ kind, id }) => OLD[kind]?.test(id)).map(({ id }) => id)));
  }
  const owners = (id) => areas.filter((area) => defined.get(area.id).has(id));
  const token = /(?<![A-Za-z0-9_-])(?:[RCG]-\d+|D\d+)(?![A-Za-z0-9_-])/g;
  const texts = new Map();
  const ambiguous = [];
  const counts = new Map(chosen.map((area) => [area.id, { id: area.id, docs: 0, code: 0, ids: defined.get(area.id).size }]));
  for (const path of tracked.filter((p) => TEXT.test(p))) {
    const text = files(path);
    if (!text || !token.test(text)) continue;
    token.lastIndex = 0;
    const area = areaOfPath(path, areas);
    let changed = false;
    const lines = text.split("\n").map((line, i) => line.replace(token, (old) => {
      const who = owners(old);
      if (!who.length) return old;
      // One area defines it: that area's, wherever it is. Several do: the place must name one of them.
      const owner = who.length === 1 ? who[0] : who.find((each) => each.id === area?.id);
      if (!owner) {
        ambiguous.push({ path, line: i + 1, id: old, areas: who.map((each) => each.id) });
        return old;
      }
      if (!counts.has(owner.id)) return old;
      counts.get(owner.id)[path.startsWith(`${owner.docs}/`) ? "docs" : "code"]++;
      changed = true;
      return qualify(old, owner.prefix);
    }));
    if (changed) texts.set(path, lines.join("\n"));
  }
  return { texts, areas: [...counts.values()], ambiguous: ambiguous.filter((each) => !areaId || each.areas.includes(areaId)) };
}

/** The renames as lines to print. */
export function renameLines(found, { write = false, all = false } = {}) {
  const lines = found.areas.map((a) => `${a.id}: ${a.ids} old IDs; ${a.docs} mentions in its docs and ${a.code} elsewhere ${write ? "renamed" : "to rename"}.`);
  lines.push(`${found.texts.size} ${found.texts.size === 1 ? "file" : "files"} ${write ? "written" : "would change"}.`);
  if (found.ambiguous.length) {
    lines.push(`${found.ambiguous.length} old IDs left for a person, where the place does not say the area:`);
    for (const each of all ? found.ambiguous : found.ambiguous.slice(0, 25)) lines.push(`  ${each.path}:${each.line}: ${each.id} (${each.areas.join(" or ")})`);
    if (!all && found.ambiguous.length > 25) lines.push("  … --all lists every one.");
  }
  if (!write) lines.push("Nothing written; --write applies it. Commit it alone, then run npx wf doc:check.");
  return lines;
}
