// `wf testdata tag <area> <tags.md> [--write]`: apply the designer's tag
// mode to an area's spec. Its table gives each row's Level or Type, and for a
// check whose Check cell held code names, the plain Check and the Setup. A
// checks table gains Setup (after Check) and Level (before By); a rules table
// gains Type (after Category). No row is added, dropped, or reordered, and a
// row the tags do not name keeps its cells. A dry run unless --write.

import { LEVELS, TYPES, levelOf, tableRows } from "./testdata.mjs";

const isRule = (line) => /^\s*\|(\s*:?-{3,}:?\s*\|)+\s*$/.test(line);
const cellsOf = (line) => line.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map((c) => c.trim());
// An empty cell is one space, as the spec's tables write it: | a | | b |.
const rowOf = (cells) => `|${cells.map((c) => (c ? ` ${c} ` : " ")).join("|")}|`;
const bare = (s) => String(s ?? "").replace(/`/g, "").trim();

/** The designer's tags, by ID: `{ tag, plain, setup }`. */
export function readTags(text) {
  const tags = new Map();
  for (const { cells } of tableRows(text, ["ID", "Level or Type"])) {
    const id = bare(cells.ID);
    if (id) tags.set(id, { tag: bare(cells["Level or Type"]).toLowerCase(), plain: cells["Plain Check"] ?? "", setup: cells.Setup ?? "" });
  }
  return tags;
}

/** One file's text with its checks and rules tables tagged; `used` collects the IDs it tagged. */
export function tagText(text, tags, used, problems, path) {
  const lines = String(text).split("\n");
  for (let i = 0; i < lines.length - 1; i++) {
    if (!/^\s*\|/.test(lines[i]) || !isRule(lines[i + 1])) continue;
    const header = cellsOf(lines[i]);
    const check = header.includes("ID") && header.includes("Check");
    const rule = header.includes("ID") && header.includes("Category") && header.includes("Rule");
    if (!check && !rule) continue;
    const add = [];
    // Where each new column goes, and which already exist.
    let names = [...header];
    if (check && !names.includes("Setup")) names.splice(names.indexOf("Check") + 1, 0, "Setup");
    if (check && !names.includes("Level")) names.splice(names.includes("By") ? names.indexOf("By") : names.length, 0, "Level");
    if (rule && !names.includes("Type")) names.splice(names.indexOf("Category") + 1, 0, "Type");
    add.push(...names.filter((n) => !header.includes(n)));
    lines[i] = rowOf(names);
    lines[i + 1] = rowOf(names.map(() => "---"));
    for (let j = i + 2; j < lines.length && /^\s*\|/.test(lines[j]); j++) {
      const old = cellsOf(lines[j]);
      const byName = Object.fromEntries(header.map((name, k) => [name, old[k] ?? ""]));
      const id = bare(byName.ID);
      const tag = tags.get(id);
      if (tag) {
        used.add(id);
        if (check) {
          if (levelOf(tag.tag) === null || !tag.tag) problems.push(`${path}: ${id}: "${tag.tag}" is not a Level (${LEVELS.join(", ")}, with +harm)`);
          else byName.Level = tag.tag;
          if (bare(tag.plain)) byName.Check = tag.plain;
          if (bare(tag.setup)) byName.Setup = tag.setup;
        } else if (!TYPES.includes(tag.tag)) problems.push(`${path}: ${id}: "${tag.tag}" is not a Type (${TYPES.join(", ")})`);
        else byName.Type = tag.tag;
      }
      lines[j] = rowOf(names.map((name) => byName[name] ?? ""));
    }
  }
  return lines.join("\n");
}

/**
 * The tags applied to an area: `{ texts: Map(path, text), tagged, unknown,
 * untouched, problems }`. `unknown` are tag IDs no spec row has; `untouched`
 * are the area's checks and rules the tags left without a Level or Type.
 */
export function applyTags({ config, tracked, files }, areaId, tagsText) {
  const area = config.areas.find((each) => each.id === areaId && each.docs);
  if (!area) throw new Error(`no area ${areaId} with a docs folder in .workflow/config.json`);
  const tags = readTags(tagsText);
  if (!tags.size) throw new Error("the tags file has no | ID | Level or Type | table");
  const dir = `${area.docs}/test-data/`;
  const used = new Set();
  const problems = [];
  const texts = new Map();
  for (const path of tracked.filter((p) => p.startsWith(dir) && p.endsWith(".md"))) {
    const before = files(path);
    const after = tagText(before, tags, used, problems, path);
    if (after !== before) texts.set(path, after);
  }
  return { texts, tagged: used.size, unknown: [...tags.keys()].filter((id) => !used.has(id)), problems };
}
