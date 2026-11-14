// `wf testdata tag <area> <tags.md> [--write]`: apply the designer's tag
// mode to an area's spec. Its table gives each row's Level or Type, and for a
// check whose Check cell held code names, the plain Check and the Setup. A
// checks table gains Setup (after Check) and Level (before By); a rules table
// gains Type (after Category). No row is added, dropped, or reordered, and a
// row the tags do not name keeps its cells. A row that cannot be kept whole,
// one with more cells than its header, stops the write.
//
// A tag that moves a row off the owner's side (a check tagged likely, rare,
// or polish without +harm; a rule tagged craft) is the model's judgment taking
// the row from the owner's review and from the chunk-end gate. Each such move
// is listed, and `wf testdata review` shows the list to the owner once.

import { bare, cellsOf, isSeparator } from "./docs/table.mjs";
import { LEVELS, TYPES, forOwner, levelOf, tableRows } from "./testdata.mjs";

// An empty cell is one space, as the spec's tables write it: | a | | b |.
const rowOf = (cells) => `|${cells.map((c) => (c ? ` ${c} ` : " ")).join("|")}|`;

/** The designer's tags, by ID: `{ tag, plain, setup }`. */
export function readTags(text) {
  const tags = new Map();
  for (const { cells } of tableRows(text, ["ID", "Level or Type"])) {
    const id = bare(cells.ID);
    if (id) tags.set(id, { tag: bare(cells["Level or Type"]).toLowerCase(), plain: cells["Plain Check"] ?? "", setup: cells.Setup ?? "" });
  }
  return tags;
}

/**
 * One file's text with its checks and rules tables tagged. `found` gathers
 * the IDs it tagged (`used`), the rows it moved to the team (`moves`), the
 * rows still untagged (`untouched`), and `problems`.
 */
export function tagText(text, tags, found, path) {
  const lines = String(text).split("\n");
  for (let i = 0; i < lines.length - 1; i++) {
    if (!/^\s*\|/.test(lines[i]) || !isSeparator(lines[i + 1])) continue;
    const header = cellsOf(lines[i]);
    const check = header.includes("ID") && header.includes("Check");
    const rule = header.includes("ID") && header.includes("Category") && header.includes("Rule");
    if (!check && !rule) continue;
    const names = [...header];
    if (check && !names.includes("Setup")) names.splice(names.indexOf("Check") + 1, 0, "Setup");
    if (check && !names.includes("Level")) names.splice(names.includes("By") ? names.indexOf("By") : names.length, 0, "Level");
    if (rule && !names.includes("Type")) names.splice(names.indexOf("Category") + 1, 0, "Type");
    lines[i] = rowOf(names);
    lines[i + 1] = rowOf(names.map(() => "---"));
    for (let j = i + 2; j < lines.length && /^\s*\|/.test(lines[j]); j++) {
      const old = cellsOf(lines[j]);
      if (old.length > header.length) found.problems.push(`${path}:${j + 1}: the row has ${old.length} cells and its header ${header.length}, so a | in a cell is not escaped as \\|; fix it before tagging`);
      const byName = Object.fromEntries(header.map((name, k) => [name, old[k] ?? ""]));
      const id = bare(byName.ID);
      const tag = tags.get(id);
      if (tag) {
        found.used.add(id);
        const was = byName.Check ?? byName.Rule ?? "";
        if (check) {
          const parsed = tag.tag ? levelOf(tag.tag) : null;
          if (!parsed) found.problems.push(`${path}: ${id}: "${tag.tag}" is not a Level (${LEVELS.join(", ")}, with +harm)`);
          else {
            byName.Level = tag.tag;
            if (!forOwner({ kind: "check", ...parsed })) found.moves.push({ id, was, tag: tag.tag, plain: bare(tag.plain) ? tag.plain : "" });
          }
          if (bare(tag.plain)) byName.Check = tag.plain;
          if (bare(tag.setup)) byName.Setup = tag.setup;
        } else if (!TYPES.includes(tag.tag)) found.problems.push(`${path}: ${id}: "${tag.tag}" is not a Type (${TYPES.join(", ")})`);
        else {
          byName.Type = tag.tag;
          if (!forOwner({ kind: "rule", type: tag.tag })) found.moves.push({ id, was, tag: tag.tag, plain: "" });
        }
      } else if (id && !bare(byName.Level ?? byName.Type ?? "")) found.untouched.push(id);
      lines[j] = rowOf(names.map((name) => byName[name] ?? ""));
    }
  }
  return lines.join("\n");
}

/**
 * The tags applied to an area: `{ texts: Map(path, text), tagged, unknown,
 * untouched, moves, problems }`. `unknown` are tag IDs no spec row has;
 * `untouched` are the area's checks and rules still with no Level or Type;
 * `moves` the rows the tags took off the owner's side.
 */
export function applyTags(area, tagsText, files) {
  const tags = readTags(tagsText);
  if (!tags.size) throw new Error("the tags file has no | ID | Level or Type | table");
  const found = { used: new Set(), moves: [], untouched: [], problems: [] };
  const texts = new Map();
  for (const path of area.paths) {
    const before = files(path);
    const after = tagText(before, tags, found, path);
    if (after !== before) texts.set(path, after);
  }
  return { texts, tagged: found.used.size, unknown: [...tags.keys()].filter((id) => !found.used.has(id)), untouched: found.untouched, moves: found.moves, problems: found.problems };
}

/** The moves as a Markdown table, for `wf testdata review` to show the owner once. */
export const movesTable = (moves) => ["| ID | Was | Tag | Plain |", "| --- | --- | --- | --- |", ...moves.map((m) => rowOf([m.id, m.was, m.tag, m.plain]))].join("\n");
