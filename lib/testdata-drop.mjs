// `wf testdata drop <area> <ID>... --why "<text>" [--write]`, or
// `--from <ask id>` for every row a review page marked Drop: the owner's
// word that a check or rule is not worth keeping. Applied at once, with no
// designer round trip:
//
//   the row leaves the spec, its proposed edits too;
//   it joins the `## Dropped` table in the area's README, with what it said,
//     why, and the day, so the designer never proposes it again and its ID is
//     never reused;
//   the code files that cite it are named, for the agent to take the citation
//     out, or the test when proving that row was all it did.

import { bare, cellsOf, isSeparator } from "./docs/table.mjs";
import { tableRows } from "./testdata.mjs";

export const DROPPED_HEADER = ["ID", "What", "Why", "Dropped"];

/** The area's dropped rows, from its README's Dropped table: `{ id, what, why, date }`. */
export function droppedRows(text) {
  return tableRows(text, ["ID", "What", "Why", "Dropped"]).map(({ cells }) => ({ id: bare(cells.ID), what: cells.What, why: cells.Why, date: bare(cells.Dropped) }));
}

const rowOf = (cells) => `|${cells.map((c) => (c ? ` ${c} ` : " ")).join("|")}|`;
const plain = (text) => String(text ?? "").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();

/**
 * The drops applied to an area: `{ texts: Map(path, text), dropped: [{ id,
 * what, path }], missing: [id] }`. `why` maps each ID to its reason; `today`
 * is the date written.
 */
export function dropRows(area, why, files, today) {
  const texts = new Map();
  const dropped = [];
  for (const path of area.paths) {
    const lines = String(files(path)).split("\n");
    let header = null;
    const kept = lines.filter((line, i) => {
      if (!/^\s*\|/.test(line)) { header = null; return true; }
      if (header === null) {
        const cells = cellsOf(line);
        header = isSeparator(lines[i + 1] ?? "") && cells.includes("ID") && (cells.includes("Check") || cells.includes("Rule")) ? cells : false;
        return true;
      }
      if (!header || isSeparator(line)) return true;
      const cells = Object.fromEntries(header.map((name, k) => [name, cellsOf(line)[k] ?? ""]));
      const id = bare(cells.ID);
      if (!why.has(id)) return true;
      dropped.push({ id, what: cells.Check ?? cells.Rule ?? "", path, proposed: /^(new|edit)$/i.test(bare(cells.Accepted)) });
      return false;
    });
    if (kept.length !== lines.length) texts.set(path, kept.join("\n"));
  }
  // The accepted row says what it was; a proposed edit of it goes too, but does not name it.
  const byId = new Map();
  for (const d of dropped) if (!byId.has(d.id) || (byId.get(d.id).proposed && !d.proposed)) byId.set(d.id, d);
  const seen = [...byId.values()];
  if (seen.length) {
    // The Dropped table in the area's README: added to, or begun at its end.
    const readme = `${area.dir}README.md`;
    const text = texts.get(readme) ?? files(readme) ?? "";
    const rows = seen.map((d) => rowOf([d.id, plain(d.what), plain(why.get(d.id)), today]));
    const lines = String(text).replace(/\n+$/, "").split("\n");
    const at = lines.findIndex((line, i) => isSeparator(line) && DROPPED_HEADER.every((name) => cellsOf(lines[i - 1] ?? "").includes(name)));
    if (at >= 0) {
      let end = at + 1;
      while (end < lines.length && /^\s*\|/.test(lines[end])) end++;
      lines.splice(end, 0, ...rows);
    } else lines.push("", "## Dropped", "", "Rows the owner dropped as not worth testing. The designer never proposes them again, and their IDs are never reused.", "", rowOf(DROPPED_HEADER), rowOf(DROPPED_HEADER.map(() => "---")), ...rows);
    texts.set(readme, `${lines.join("\n")}\n`);
  }
  return { texts, dropped: seen, missing: [...why.keys()].filter((id) => !seen.some((d) => d.id === id)) };
}

/**
 * The IDs a review page's answers marked Drop, with each one's note as why:
 * Map(id, why). Its question ids are `<table>.<row id>`.
 */
export function dropsFromAnswers(answers) {
  const all = answers?.answers ?? answers ?? {};
  const out = new Map();
  for (const [qid, value] of Object.entries(all)) {
    if (value?.choice !== "drop") continue;
    const id = qid.split(".").pop();
    out.set(id, String(value.note ?? "").trim() || "dropped on review");
  }
  return out;
}
