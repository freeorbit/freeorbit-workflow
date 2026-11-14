// `wf testdata prune <area> [--all] [--write]`: take out the check
// rows nothing uses. Checks are from before v0.69.0, when the designer wrote
// test cases beside the stories; an acceptance line is the check now. A check
// row no code cites proves nothing and gates nothing, so it only costs a read.
//
// A check row goes when all of this holds:
//
//   no code file names its ID, and no doc outside the area's spec does;
//   its By is empty: a `walk`, a `walked <chunk>`, or a chunk's id is kept;
//   no open dispute names it;
//   every story it names is in a done chunk, unless `--all`.
//
// A table left with no rows goes too, with a heading that then holds nothing.
// Rules, fixtures, input classes, states, and datasets are never touched: a
// rule the generator follows is not cited by a test. Git keeps what was cut.

import { cellsOf, isSeparator } from "./docs/table.mjs";
import { chunkRows, storiesIn } from "./docs/shape.mjs";
import { CHECK_OR_RULE_IN_TEXT, TEXT } from "./ids.mjs";
import { areaSpec, bare, specIds } from "./testdata.mjs";
import { namedInCode } from "./testdata-trace.mjs";

/** The stories the done list's chunks built. */
export function builtStories(doneText) {
  return new Set(chunkRows(String(doneText ?? "")).flatMap((row) => storiesIn(row.stories)));
}

/**
 * The prune for one area: `{ texts: Map(path, text), pruned: [{ id, path }],
 * kept: { cited, by, disputed, unbuilt } }`, the counts of the check
 * rows kept and why.
 */
export function pruneChecks(ctx, areaId, { built = new Set(), all = false } = {}) {
  const { tracked, files } = ctx;
  const area = areaSpec(ctx.config, tracked, areaId);
  const rows = specIds(area.paths, files);
  const named = namedInCode(ctx);
  // A doc outside the spec that names a check, such as a screen list or a decision, still needs it defined.
  // The kit's own docs only name IDs as examples, so they cite nothing.
  const kitDocs = `${String(ctx.config.docs?.workflow ?? "docs/workflow").replace(/\/+$/, "")}/`;
  for (const path of tracked.filter((p) => p.endsWith(".md") && TEXT.test(p) && !p.startsWith(area.dir) && !p.startsWith(kitDocs))) for (const id of String(files(path)).match(CHECK_OR_RULE_IN_TEXT) ?? []) named.add(id);
  const disputed = new Set(rows.filter((row) => row.kind === "gap" && row.gapKind === "dispute").flatMap((row) => row.text.match(CHECK_OR_RULE_IN_TEXT) ?? []));
  const kept = { cited: 0, by: 0, disputed: 0, unbuilt: 0 };
  const go = new Set();
  for (const row of rows.filter((each) => each.kind === "check")) {
    if (named.has(row.id)) kept.cited++;
    else if (row.by) kept.by++;
    else if (disputed.has(row.id)) kept.disputed++;
    else if (!all && !storiesIn(row.stories).every((s) => built.has(s))) kept.unbuilt++;
    else go.add(row.id);
  }
  const texts = new Map();
  const pruned = [];
  for (const path of area.paths) {
    const lines = String(files(path)).split("\n");
    let header = null;
    const out = lines.filter((line, i) => {
      if (!/^\s*\|/.test(line)) { header = null; return true; }
      if (header === null) {
        const cells = cellsOf(line);
        header = isSeparator(lines[i + 1] ?? "") && cells.includes("ID") && cells.includes("Check") ? cells.indexOf("ID") : false;
        return true;
      }
      if (header === false || isSeparator(line)) return true;
      const id = bare(cellsOf(line)[header] ?? "");
      if (!go.has(id)) return true;
      pruned.push({ id, path });
      return false;
    });
    if (out.length !== lines.length) texts.set(path, tidy(out).join("\n"));
  }
  return { texts, pruned, kept };
}

/** Lines without a checks table that has no rows left, a heading that then holds nothing, or a run of blank lines. Any other empty table stays. */
function tidy(lines) {
  const isRow = (line) => /^\s*\|/.test(line ?? "");
  const out = [...lines];
  for (let i = 0; i < out.length - 1; i++) {
    if (!isRow(out[i]) || !isSeparator(out[i + 1]) || isRow(out[i - 1]) || isRow(out[i + 2])) continue;
    if (!["ID", "Check"].every((name) => cellsOf(out[i]).includes(name))) continue;
    out.splice(i, 2);
    let before = i - 1;
    while (before >= 0 && !out[before].trim()) before--;
    let after = i;
    while (after < out.length && !out[after].trim()) after++;
    const heading = /^(#{2,6})\s/.exec(out[before] ?? "");
    const next = /^(#{1,6})\s/.exec(out[after] ?? "");
    if (heading && (after >= out.length || (next && next[1].length <= heading[1].length))) out.splice(before, 1);
    i = Math.max(-1, before - 2);
  }
  return out.filter((line, i) => line.trim() || (out[i - 1] ?? "").trim());
}

/** The prune as lines to print. */
export function pruneLines(found, { write = false } = {}) {
  const k = found.kept;
  const lines = [`${found.pruned.length} check ${found.pruned.length === 1 ? "row" : "rows"} ${write ? "pruned" : "to prune"}, in ${found.texts.size} ${found.texts.size === 1 ? "file" : "files"}${write || !found.pruned.length ? "." : " (a dry run; --write applies it)."}`];
  lines.push(`Kept: ${k.cited} a test, code, or another doc cites; ${k.by} with a By (walk, walked, or a chunk); ${k.disputed} disputed; ${k.unbuilt} whose stories are not all built (--all takes them too).`);
  if (found.pruned.length) lines.push(`  ${found.pruned.slice(0, 20).map((each) => each.id).join(", ")}${found.pruned.length > 20 ? ", …" : ""}`);
  return lines;
}
