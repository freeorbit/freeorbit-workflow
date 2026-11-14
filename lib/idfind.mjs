// `wf id <ID> [--all]`: where an ID is defined, and every place that cites
// it, across the docs, the logs, the spec, and the code. The kind comes from
// the one table of ID patterns (lib/ids.mjs), so a lookup never guesses a
// pattern: R-GM-1 is never found inside R-GM-12.

import { idKinds, kindOf, within } from "./ids.mjs";

const TEXT = /\.(md|rs|ts|tsx|js|mjs|cjs|py|toml|json|ya?ml|html|css|txt)$/;
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Where a citing path sits: the test-data spec, the logs, other docs, tests, or code. */
export function placeOf(path) {
  if (/\/test-data\//.test(path) && path.endsWith(".md")) return "spec";
  if (/^docs\/log\//.test(path)) return "logs";
  if (path.endsWith(".md")) return "docs";
  if (/(^|\/)tests?\//.test(path) || /\.test\.[a-z]+$/.test(path) || /_tests?\.rs$/.test(path)) return "tests";
  return "code";
}

/**
 * One ID's kind, definitions, and citations: `{ id, kind, means, defined:
 * [{ path, line, text }], cited: [{ path, line, text, place }] }`. A name (a
 * fixture, a state, an input) is also found written with underscores, as code
 * names it.
 */
export function findId({ config, tracked, files }, id) {
  const kind = kindOf(id, config);
  const info = idKinds(config).find((each) => each.kind === kind);
  const forms = kind === "name" ? [...new Set([id, id.replace(/-/g, "_")])] : [id];
  const finds = forms.map(within);
  // A definition: the first cell of a table row, a heading, or a ledger link.
  const define = new RegExp(`^(\\|\\s*\`?\\[?${escape(id)}\`?\\]?(\\([^)]*\\))?\\s*\\||#{2,4}\\s+\\[?${escape(id)}\\b)`);
  const defined = [];
  const cited = [];
  for (const path of tracked.filter((p) => TEXT.test(p))) {
    const text = files(path);
    if (!text || !forms.some((form) => text.includes(form))) continue;
    text.split("\n").forEach((line, i) => {
      if (!finds.some((re) => re.test(line))) return;
      const at = { path, line: i + 1, text: line.trim() };
      // A name is defined in the test-data spec only; a design doc that lists it cites it.
      if (path.endsWith(".md") && define.test(line) && (kind !== "name" || /\/test-data\//.test(path))) defined.push(at);
      else cited.push({ ...at, place: placeOf(path) });
    });
  }
  return { id, kind, means: info?.means ?? (kind === "name" ? "A fixture, a journey state, or an input, by its name" : kind?.startsWith("old ") ? "An ID from before areas qualified them; npx wf testdata rename-ids qualifies it" : "Not an ID the workflow makes"), defined, cited };
}

/** The lookup as lines to print. */
export function idLines(found, { all = false } = {}) {
  const cut = (s) => (s.length > 150 ? `${s.slice(0, 149)}…` : s);
  const lines = [`${found.id}: ${found.kind ?? "unknown"}. ${found.means}.`];
  if (!found.defined.length) lines.push("Defined nowhere in the tracked docs.");
  else {
    if (found.defined.length > 1) lines.push(`Defined ${found.defined.length} times: an ID is defined once, so one of these is a duplicate.`);
    for (const d of found.defined) lines.push(`Defined at ${d.path}:${d.line}`, `  ${cut(d.text)}`);
  }
  const by = {};
  for (const c of found.cited) by[c.place] = (by[c.place] ?? 0) + 1;
  lines.push(found.cited.length ? `Cited ${found.cited.length} ${found.cited.length === 1 ? "time" : "times"}: ${Object.entries(by).map(([k, n]) => `${k} ${n}`).join(", ")}` : "Cited nowhere.");
  for (const c of all ? found.cited : found.cited.slice(0, 15)) lines.push(`  ${c.path}:${c.line}  ${cut(c.text)}`);
  if (!all && found.cited.length > 15) lines.push("  … --all lists every one.");
  return lines;
}
