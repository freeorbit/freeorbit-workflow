// doc:check's checks of each area's test-data folder: the problems that fail
// it and the warnings it prints, as index.mjs's header lists them.

import { bare } from "../docs/table.mjs";
import { matcher } from "../config/config.mjs";
import { readStories, riskLines } from "../docs/stories.mjs";
import { ACCEPTANCE_IN_TEXT, CHECK_OR_RULE_IN_TEXT, LETTER, OLD, RULE_IN_TEXT, prefixesOf, qualify, splitId } from "../ids.mjs";
import { CHUNK_ID } from "../lanes.mjs";
import { budget } from "./budget.mjs";
import { BY_FILE, MergeRefused, lineCount, mergeFolder } from "./merge.mjs";
import { categoryCells, categoryNames, CRAFT_CATEGORIES, flowAreas, folders, isJargon, KINDS, proofRows, specIds, tableRows, TYPES } from "./index.mjs";

/**
 * IDs across every area's spec: one that is neither its kind's pattern with
 * the area's prefix nor an old one, one with another area's prefix, and one
 * defined twice anywhere in the app. Old IDs (R-12) are only warned about.
 */
function idProblems(config, tracked, files) {
  const problems = [];
  const seen = new Map();
  for (const { area, dir } of folders(config)) {
    const paths = tracked.filter((each) => each.startsWith(dir) && each.endsWith(".md")).sort();
    const oldSeen = new Map();
    const rows = specIds(paths, files);
    // A dropped ID comes back only as a new row with a new ID.
    const dropped = new Map(rows.filter((row) => row.kind === "dropped").map((row) => [row.id, row]));
    for (const { kind, id, path, line } of rows) {
      if (dropped.has(id) && kind !== "dropped") problems.push(`${path}:${line}: ${kind} ${id} was dropped on ${dropped.get(id).date || "an earlier day"}; a row it is needed for again gets a new ID`);
      const letter = LETTER[kind];
      if (!letter) continue;
      const at = `${path}:${line}`;
      const parts = splitId(kind, id);
      if (parts?.prefix) {
        if (area.prefix && parts.prefix !== area.prefix) problems.push(`${at}: ${kind} ${id} has another area's prefix; this area's is ${area.prefix}`);
        else if (seen.has(id)) problems.push(`${at}: ${kind} ${id} is defined already, at ${seen.get(id)}; an ID is unique across the app`);
        else seen.set(id, at);
      } else if (parts) {
        const key = `${kind}:${id}`;
        if (oldSeen.has(key)) problems.push(`${at}: ${kind} ${id} is defined already, at ${oldSeen.get(key)}`);
        else oldSeen.set(key, at);
      } else problems.push(`${at}: ${kind} ID "${id}" is not ${letter}-${area.prefix || "<prefix>"}-<number>`);
    }
  }
  return problems;
}

/** The kinds a config names that the kit does not know, and each story's Risk line that says neither high nor low. */
export function testdataProblems({ config, tracked, files }) {
  const problems = [];
  if (!KINDS.includes(config.kind)) problems.push(`.workflow/config.json: kind "${config.kind}" is not one of ${KINDS.join(", ")}`);
  for (const area of config.areas) {
    if (area.kind !== undefined && !KINDS.includes(area.kind)) problems.push(`.workflow/config.json: area ${area.id} kind "${area.kind}" is not one of ${KINDS.join(", ")}`);
  }
  if (!["high", "all"].includes(config.testdata.chunkScope ?? "high")) problems.push(`.workflow/config.json: testdata.chunkScope "${config.testdata.chunkScope}" is not high or all; until it is one, the chunk end holds every line`);
  for (const category of config.testdata.categories) {
    if (!category?.name) problems.push(`.workflow/config.json: a testdata.categories entry has no name`);
  }
  problems.push(...idProblems(config, tracked, files));
  problems.push(...tableProblems(config, tracked, files));
  problems.push(...tagProblems(config, tracked, files));
  const prefixes = config.areas.map((area) => area.prefix).filter(Boolean);
  const storyFile = matcher(config.stories.files);
  for (const path of tracked.filter(storyFile)) {
    for (const story of readStories(files(path), prefixes, path)) {
      if (story.risk && !story.risk.level) problems.push(`${path}:${story.line}: ${story.id} Risk says "${story.risk.raw}"; write "Risk: high (<why>)", "Risk: low", or no line for low`);
    }
  }
  return problems;
}

// A note about a line's history, which belongs in story-changes.md: a date, or a decision's ID.
const LINE_NOTE = /\b\d{4}-\d{2}-\d{2}\b|\bD-[A-Z]+-\d{3}\b/;


/**
 * Warnings about who a rule is for: rules with no Type whose category
 * implies none; a Stand-ins or Data markers rule not typed craft; and code
 * names in a product rule, which the owner reads.
 */
function tagWarnings(config, dir, tracked, files) {
  const out = [];
  const rows = specIds(tracked.filter((p) => p.startsWith(dir) && p.endsWith(".md")), files);
  const untagged = rows.filter((row) => row.kind === "rule" && !row.type);
  if (untagged.length && (config.testdata.untagged ?? "warn") !== "fail") out.push(`${dir}: ${untagged.length} ${untagged.length === 1 ? "rule has" : "rules have"} no Type (product, safety, or craft) and a category that implies none; until typed each is the owner's to review`);
  for (const row of rows.filter((each) => each.kind === "rule" && each.type)) {
    if (CRAFT_CATEGORIES.has(row.category.toLowerCase()) && row.type !== "craft") out.push(`${row.path}:${row.line}: rule ${row.id} is ${row.category}, how test data is built, so its Type is craft, not ${row.type}`);
    if (row.type === "product" && isJargon(row.text)) out.push(`${row.path}:${row.line}: rule ${row.id} is the owner's to read; say it in plain words, with no code names`);
  }
  return out;
}

/**
 * Warnings about an area's rules: proposed rules and proposed edits waiting
 * on the reviewer, and a rule defined in one flow area's file that two or
 * more flow areas cite, which belongs in core.md with the rules they share.
 */
function ruleWarnings(dir, tracked, files) {
  const out = [];
  const paths = tracked.filter((p) => p.startsWith(dir) && p.endsWith(".md"));
  // A flow area by its file or folder; core.md, formats.md, and a shared folder hold what flows share.
  const flowOf = (path) => {
    const top = path.slice(dir.length).split("/")[0].replace(/\.md$/, "");
    return ["core", "formats", "shared", "README"].includes(top) ? null : top;
  };
  let waiting = 0;
  for (const path of paths) for (const { cells } of tableRows(files(path), ["ID", "Category", "Rule"])) if (/^(new|edit)$/i.test(bare(cells.Accepted))) waiting++;
  if (waiting) out.push(`${dir}: ${waiting} proposed ${waiting === 1 ? "rule waits" : "rules wait"} for the reviewer (Accepted new or edit); accept or drop them by category`);
  const citedBy = new Map();
  for (const path of paths) {
    const flow = flowOf(path);
    if (!flow) continue;
    for (const header of [["ID", "Check"], ["Fixture", "Varies"], ["Input", "Class"]]) for (const { cells } of tableRows(files(path), header)) for (const id of String(cells.Rules ?? "").match(RULE_IN_TEXT) ?? []) citedBy.set(id, new Set([...(citedBy.get(id) ?? []), flow]));
  }
  for (const rule of specIds(paths, files).filter((each) => each.kind === "rule")) {
    const flows = [...(citedBy.get(rule.id) ?? [])];
    const home = flowOf(rule.path);
    if (home && flows.length >= 2) out.push(`${rule.path}:${rule.line}: rule ${rule.id} is cited by ${flows.length} flow areas (${flows.sort().join(", ")}); a rule two flow areas need goes in core.md`);
  }
  return out;
}

/**
 * A rule's Type: a value not on the list fails. A rule with none, whose
 * category implies none, fails only when `testdata.untagged` is "fail";
 * otherwise it warns.
 */
function tagProblems(config, tracked, files) {
  const problems = [];
  const strict = (config.testdata.untagged ?? "warn") === "fail";
  for (const { dir } of folders(config)) {
    for (const row of specIds(tracked.filter((p) => p.startsWith(dir) && p.endsWith(".md")), files)) {
      const at = `${row.path}:${row.line}`;
      if (row.kind === "rule") {
        if (row.type && !TYPES.includes(row.type)) problems.push(`${at}: ${row.id} Type "${row.type}" is not ${TYPES.join(", ")}`);
        else if (!row.type && strict) problems.push(`${at}: ${row.id} has no Type`);
      }
    }
  }
  return problems;
}

/**
 * Two faults in the spec that hide rows from every tool: a table whose rows
 * a blank line cuts from its header (Markdown then shows an empty table and
 * loose lines, and no tool reads those rows), and a rule or check ID that a
 * check, fixture, input class, or dispute names but no spec defines.
 */
function tableProblems(config, tracked, files) {
  const problems = [];
  const spec = folders(config).flatMap(({ area, dir }) => tracked.filter((p) => p.startsWith(dir) && p.endsWith(".md")).map((path) => ({ area, path })));
  const all = specIds(spec.map((each) => each.path), files);
  const defined = new Set(all.filter((each) => each.kind === "rule" || each.kind === "check").map((each) => each.id));
  const dropped = new Map(all.filter((each) => each.kind === "dropped").map((each) => [each.id, each]));
  // Every acceptance line the stories hold, for a proof row or a dispute that names one.
  const lineIds = new Set();
  for (const path of tracked.filter(matcher(config.stories.files))) for (const story of readStories(files(path), prefixesOf(config), path)) for (const each of story.acceptance) lineIds.add(each.id);
  const ruleIds = new Set(all.filter((each) => each.kind === "rule").map((each) => each.id));
  for (const row of proofRows(spec.map((each) => each.path), files)) {
    if (!lineIds.has(row.id)) problems.push(`${row.path}:${row.line}: the proof table names ${row.id || "no line"}, which is no story's acceptance line; a line's ID is its story and its place, such as GM-07.3`);
    else if (/^R-[A-Z]+-\d+$/.test(row.by) ? !ruleIds.has(row.by) : !/^(walk|walked\s+\S+)$/i.test(row.by) && !CHUNK_ID.test(row.by)) problems.push(`${row.path}:${row.line}: ${row.id} By "${row.by}" is not walk, walked <chunk>, a later chunk's id, or a rule the spec defines`);
  }
  for (const { path } of spec) {
    const lines = String(files(path)).split("\n");
    let fenced = false;
    lines.forEach((line, i) => {
      if (/^\s*```/.test(line)) fenced = !fenced;
      if (fenced || !/^\s*\|(\s*:?-{3,}:?\s*\|)+\s*$/.test(line)) return;
      let next = i + 1;
      while (next < lines.length && !lines[next].trim()) next++;
      if (next > i + 1 && next < lines.length && /^\s*\|/.test(lines[next]) && !/^\s*\|(\s*:?-{3,}:?\s*\|)+\s*$/.test(lines[next + 1] ?? "")) problems.push(`${path}:${i + 2}: a blank line cuts the table's rows from its header, so no tool reads them; remove it`);
    });
    const text = files(path);
    const cite = (cell, where) => {
      for (const id of String(cell ?? "").match(CHECK_OR_RULE_IN_TEXT) ?? []) {
        if (defined.has(id)) continue;
        if (dropped.has(id)) problems.push(`${where}: ${id} was dropped on ${dropped.get(id).date || "an earlier day"}; cite the rule or check that holds instead`);
        else problems.push(`${where}: ${id} is cited but defined nowhere in the spec; cite the rule or check that holds, or restore it`);
      }
    };
    for (const header of [["ID", "Check"], ["Fixture", "Varies"], ["Input", "Class"]]) for (const { line, cells } of tableRows(text, header)) cite(cells.Rules, `${path}:${line}`);
    for (const { line, cells } of tableRows(text, ["ID", "Kind", "Question"])) {
      if (!/^dispute$/i.test(bare(cells.Kind))) continue;
      cite(cells.Question, `${path}:${line}`);
      for (const id of String(cells.Question ?? "").match(ACCEPTANCE_IN_TEXT) ?? []) if (!lineIds.has(id)) problems.push(`${path}:${line}: ${id} is disputed but is no story's acceptance line`);
    }
  }
  return problems;
}

/** doc:check's warnings about test data: never a failure, so its volume is a choice and not a drift. */
export function testdataWarnings({ config, tracked, files }) {
  const { lines: maxLines, areaKB, loose } = config.testdata.limits;
  const warnings = [];
  // Risk is rationed: when most of an area's acceptance lines are high, the tier no longer says where depth goes.
  const share = config.testdata.limits.highShare ?? 0;
  for (const area of config.areas.filter((each) => each.prefix)) {
    let all = 0, high = 0, whole = 0;
    const noted = new Map();
    for (const path of tracked.filter(matcher(config.stories.files))) for (const story of readStories(files(path), [area.prefix], path)) {
      if (story.removed) continue;
      const found = riskLines(story);
      // The client reads each line on the board, where a date or a decision ID is jargon.
      for (const line of found.lines) if (LINE_NOTE.test(line.text) || line.sub.some((sub) => LINE_NOTE.test(sub))) noted.set(path, [...(noted.get(path) ?? []), line.id]);
      all += found.lines.length;
      high += found.high.length;
      if (found.by === "story") whole++;
    }
    // One warning a story file, so a project moving its notes sees a count, not a line for each.
    for (const [path, ids] of noted) warnings.push(`${path}: ${ids.length} acceptance ${ids.length === 1 ? "line holds" : "lines hold"} a date or a decision ID (${ids.slice(0, 5).join(", ")}${ids.length > 5 ? ", …" : ""}); the client reads these lines, so each note goes in the area's story-changes.md, | Line | Change | Date | Decision |`);
    if (share && all && high / all > share) warnings.push(`${area.docs ?? area.id}: ${high} of ${all} acceptance lines are Risk: high, over ${Math.round(share * 100)}%${whole ? `, ${whole} ${whole === 1 ? "story" : "stories"} tagged whole` : ""}; end only the lines that are with "Risk: high (<why>)" and take the story's own Risk line out, so depth goes where the risk is`);
  }
  const isLoose = matcher(loose);
  const names = new Set(categoryNames(config));
  for (const { dir } of folders(config)) {
    for (const flow of flowAreas(dir, tracked)) {
      const bytes = flow.paths.reduce((sum, path) => sum + Buffer.byteLength(files(path)), 0);
      if (bytes > areaKB * 1024) warnings.push(`${flow.name}: ${Math.round(bytes / 1024)} KB, over ${areaKB}; split it by dataset group, or into a folder of page-sized files`);
      warnings.push(...folderWarnings(flow, { config, tracked, files }));
    }
    for (const path of tracked.filter((each) => each.startsWith(dir) && each.endsWith(".md"))) {
      const count = files(path).replace(/\n+$/, "").split("\n").length;
      if (count > maxLines && !isLoose(path)) warnings.push(`${path}: ${count} lines, over ${maxLines}, about a page; move a topic into a file of its own`);
      const unknown = new Map();
      for (const { line, category } of categoryCells(files(path))) if (!names.has(category)) unknown.set(category, [...(unknown.get(category) ?? []), line]);
      for (const [category, lines] of unknown) warnings.push(`${path}:${lines[0]}: category "${category}" (${lines.length === 1 ? "1 rule" : `${lines.length} rules`}) is not the kit's or in testdata.categories`);
    }
    warnings.push(...volumeWarnings(config, dir, tracked, files));
    const area = config.areas.find((each) => `${each.docs}/test-data/` === dir);
    const old = specIds(tracked.filter((each) => each.startsWith(dir) && each.endsWith(".md")), files).filter(({ kind, id }) => OLD[kind]?.test(id));
    if (old.length && area?.prefix) warnings.push(`${dir}: ${old.length} ${old.length === 1 ? "ID is" : "IDs are"} not area-qualified (${old.slice(0, 3).map((each) => each.id).join(", ")}${old.length > 3 ? ", …" : ""}); npx wf testdata rename-ids qualifies them, such as ${qualify(old[0].id, area.prefix)}`);
  }
  for (const { dir } of folders(config)) warnings.push(...ruleWarnings(dir, tracked, files), ...tagWarnings(config, dir, tracked, files));
  // A fixture, a state, or an input is named once in the whole app.
  const named = new Map();
  for (const { dir } of folders(config)) {
    for (const { kind, id, path, line } of specIds(tracked.filter((each) => each.startsWith(dir) && each.endsWith(".md")), files)) {
      if (!["fixture", "state", "input"].includes(kind)) continue;
      const other = named.get(`${kind}:${id}`);
      if (other && other.dir !== dir) warnings.push(`${path}:${line}: ${kind} ${id} is also defined at ${other.at}; a name is unique across the app`);
      else if (!other) named.set(`${kind}:${id}`, { dir, at: `${path}:${line}` });
    }
  }
  return warnings;
}

/**
 * Advice for a flow area's folder with too many files: make it one file when
 * the merge fits a page and keeps every row (`testdata.limits.folder`), else
 * fold each file under `testdata.limits.small` into a sibling with room, a
 * topic file before one named for a part.
 */
function folderWarnings(flow, ctx) {
  const { lines: maxLines, small = 0, folder = 0 } = ctx.config.testdata.limits;
  if (!flow.name.endsWith("/")) return [];
  const count = (path) => lineCount(ctx.files(path));
  const total = flow.paths.reduce((sum, path) => sum + count(path), 0);
  if (folder && flow.paths.length > 1 && total < folder) {
    try {
      const found = mergeFolder(ctx, flow.name, { relink: false });
      if (found.lines <= maxLines && found.before === found.after) return [`${flow.name}: ${flow.paths.length} files, ${total} lines in all; npx wf testdata merge ${flow.name} makes it one file of ${found.lines} lines`];
    } catch (error) {
      if (!(error instanceof MergeRefused)) throw error;
    }
  }
  if (!small) return [];
  const parts = flow.paths.filter((path) => !path.endsWith("/README.md"));
  const named = (path) => Boolean(BY_FILE[path.split("/").at(-1)]);
  return parts.filter((path) => count(path) < small).map((path) => {
    const sibling = parts.filter((other) => other !== path && count(other) + count(path) <= maxLines).sort((a, b) => named(a) - named(b) || count(a) - count(b))[0];
    return `${path}: ${count(path)} ${count(path) === 1 ? "line" : "lines"}, under ${small}; ${sibling ? `npx wf testdata fold ${path} ${sibling}` : "fold it into a sibling file"}`;
  });
}

/**
 * Warnings about how many cases an area's folder holds: an input class listed
 * twice, a fixture that reaches `unit` (an input class), and fixtures past
 * `testdata.limits.fixtures` for a story, a flow area, or a rule, as
 * `budget()` counts them. These warn for the whole folder; `wf testdata
 * refresh-close` holds a refresh to what it adds.
 */
function volumeWarnings(config, dir, tracked, files) {
  const out = [];
  const paths = tracked.filter((each) => each.startsWith(dir) && each.endsWith(".md"));
  const classes = new Map();
  for (const path of paths) {
    for (const { line, cells } of tableRows(files(path), ["Input", "Class"])) {
      const key = `${cells.Input.replace(/`/g, "")}\u0000${cells.Class.toLowerCase()}`;
      if (classes.has(key)) out.push(`${path}:${line}: input ${cells.Input} class "${cells.Class}" is listed already, at ${classes.get(key)}; list an input's classes once, and name them from other flows`);
      else classes.set(key, `${path}:${line}`);
    }
    for (const { line, cells } of tableRows(files(path), ["Fixture", "Varies"])) {
      if (/^`?unit`?\b/.test(cells.Reach ?? "")) out.push(`${path}:${line}: ${cells.Fixture} reaches unit, which no person can; make it a class of its input`);
    }
  }
  // The same count `wf testdata budget --check` fails on, so the warning and the gate never disagree.
  const area = config.areas.find((each) => `${each.docs}/test-data/` === dir);
  if (area) for (const each of budget({ config, tracked, files }, area.id).over) out.push(each.kind === "flow" ? each.text : `${dir}: ${each.text}`);
  return out;
}
