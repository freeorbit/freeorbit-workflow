// `wf testdata`: the project's test-data steps, named in `testdata.commands`
// in its config, run with the rest of the arguments after them. The kit knows
// no generator; it only gives each project the same names for the same steps.
//
// It also holds what the kit itself knows about test data: the project kinds,
// the rule categories every project shares, and doc:check's checks of an
// area's test-data folder. It fails the kinds named, each story's Risk line,
// an ID defined twice or with another area's prefix, a table a blank line
// cuts from its header, and a rule or check cited but defined nowhere. It
// warns for a file past a page or too small, a flow area past its size, a
// category no list names, an input class listed twice, a fixture no person
// reaches, fixtures and checks past their budget, old IDs, a name two areas
// define, proposed rules waiting on the reviewer, and a rule two flow areas
// cite outside core.md.

import { spawnSync } from "node:child_process";

import { matcher } from "./config/config.mjs";
import { readStories } from "./docs/stories.mjs";
import { CHECK_OR_RULE_IN_TEXT, LETTER, OLD, RULE_IN_TEXT, prefixesOf, qualify, splitId, storyPattern } from "./ids.mjs";
import { projectCommand } from "./process.mjs";
import { BY_FILE, MergeRefused, lineCount, mergeFolder } from "./testdata-merge.mjs";

/** The command for one test-data step, or null when the project has none. */
export const commandFor = (config, name, args) => projectCommand(config.testdata.commands, name, args);

/** Run a step; `refresh-close <area> <ids>` runs covered, then index. Returns the exit code. */
export function runTestdata(root, config, name, args) {
  const steps = name === "refresh-close" ? [["covered", args], ["index", args.slice(0, 1)]] : [[name, args]];
  for (const [step, stepArgs] of steps) {
    const command = commandFor(config, step, stepArgs);
    if (!command) {
      console.error(`testdata.commands has no ${step}; add it to .workflow/config.json`);
      return 2;
    }
    const { status } = spawnSync("sh", ["-c", command], { cwd: root, stdio: "inherit" });
    if (status !== 0) return status ?? 1;
  }
  return 0;
}

/** The kinds a project or an area can be, as project-kinds.md describes them. */
export const KINDS = ["app", "domain-product", "data-pipeline", "integration", "catalog"];

/** The rule categories the kit ships. A project adds its own with testdata.categories. */
export const CATEGORIES = [
  { name: "Never sent or stored", use: "What must never leave the machine, reach a log, or be kept" },
  { name: "Money and limits", use: "Prices, spend, caps, quotas, and counts with a ceiling" },
  { name: "Time", use: "Fixed todays, dates, time zones, ages, and anything that would read the clock" },
  { name: "Input shape", use: "Formats, sizes, encodings, and malformed or huge input" },
  { name: "State", use: "What a step may change, in what order, and what survives a restart" },
  { name: "Trust", use: "Outside text, links, replies from other systems, and what is allowed to act on them" },
  { name: "Evidence and citations", use: "A judgement or extracted field and the passage it rests on" },
  { name: "Workspaces", use: "One client, tenant, or account never seeing another's data" },
];

/** Every category name a project's rules may use: the kit's, then its own. */
export const categoryNames = (config) => [...CATEGORIES, ...config.testdata.categories].map((category) => category.name);

/** An area's kind: its own, else the project's. */
export const areaKind = (config, area) => area.kind ?? config.kind;

/** Each area's test-data folder, `<docs>/test-data/`, for the areas that name a docs folder. */
const folders = (config) => config.areas.filter((area) => area.docs).map((area) => ({ area, dir: `${area.docs}/test-data/` }));

/**
 * The flow areas in one test-data folder: each top-level Markdown file but the
 * README, and each folder below it, with the Markdown paths it holds.
 */
export function flowAreas(dir, tracked) {
  const byName = new Map();
  for (const path of tracked) {
    if (!path.startsWith(dir) || !path.endsWith(".md")) continue;
    const rest = path.slice(dir.length);
    if (rest === "README.md") continue;
    const name = rest.includes("/") ? `${rest.split("/")[0]}/` : rest;
    byName.set(name, [...(byName.get(name) ?? []), path]);
  }
  return [...byName].map(([name, paths]) => ({ name: `${dir}${name}`, paths }));
}

/**
 * The Category cell of each row of each rules table, one whose header has a
 * Category column and a Rule column, as { line, category }. A gaps table may
 * name a topic instead, and a product's own Category column is not one.
 */
export function categoryCells(text) {
  const out = [];
  // undefined outside a table, -1 in a table that is not one, else the Category column.
  let column;
  String(text ?? "")
    .split("\n")
    .forEach((line, index) => {
      if (!line.startsWith("|")) {
        column = undefined;
        return;
      }
      const cells = line.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map((each) => each.trim());
      if (column === undefined) column = cells.some((each) => /^Rule\b/.test(each)) ? cells.indexOf("Category") : -1;
      else if (column >= 0 && cells[column] && !/^:?-+:?$/.test(cells[column])) out.push({ line: index + 1, category: cells[column] });
    });
  return out;
}

/**
 * The rows of each table whose header has every column `needs` names, as
 * `{ line, cells }` with cells by header. A tool finds a column by its header.
 */
export function tableRows(text, needs) {
  const out = [];
  let header;
  String(text ?? "")
    .split("\n")
    .forEach((line, index) => {
      if (!line.startsWith("|")) {
        header = undefined;
        return;
      }
      const cells = line.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map((each) => each.trim());
      if (header === undefined) header = needs.every((name) => cells.includes(name)) ? cells : null;
      else if (header && !cells.every((each) => /^:?-+:?$/.test(each))) out.push({ line: index + 1, cells: Object.fromEntries(header.map((name, i) => [name, cells[i] ?? ""])) });
    });
  return out;
}

const ids = (cell, pattern) => [...String(cell).matchAll(pattern)].map((m) => m[0]);

const bare = (cell) => String(cell ?? "").replace(/`/g, "").trim();

/**
 * The ids an area's spec defines, each `{ kind, id, path, line }`: rules,
 * checks (but those only the walk proves, when `walk` is false), gaps,
 * datasets, fixtures, inputs (once each), and states. A rule also carries
 * `stories`, `by`, and `accepted`, a check `stories` and `by`, and a gap
 * `gapKind` and its row's `text`. A rule row proposing an edit defines nothing.
 */
export function specIds(paths, files, { walk = true } = {}) {
  const out = [];
  const add = (kind, id, path, line, more = {}) => { if (id && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id)) out.push({ kind, id, path, line, ...more }); };
  for (const path of paths) {
    const text = files(path);
    // A proposed edit to an accepted rule (Accepted: edit) repeats its ID and defines nothing until it is accepted.
    for (const { line, cells } of tableRows(text, ["ID", "Category", "Rule"])) if (!/^edit$/i.test(bare(cells.Accepted))) add("rule", bare(cells.ID), path, line, { stories: cells.Stories ?? "", by: bare(cells.By), accepted: bare(cells.Accepted) });
    for (const { line, cells } of tableRows(text, ["ID", "Check"])) if (walk || !/\bwalk\b/i.test(cells.By ?? "")) add("check", bare(cells.ID), path, line, { stories: cells.Stories ?? "", by: bare(cells.By) });
    for (const { line, cells } of tableRows(text, ["ID", "Kind", "Question"])) add("gap", bare(cells.ID), path, line, { gapKind: bare(cells.Kind).toLowerCase(), text: Object.values(cells).join(" | ") });
    for (const { line, cells } of tableRows(text, ["Fixture", "Varies"])) add("fixture", bare(cells.Fixture), path, line);
    for (const { line, cells } of tableRows(text, ["Input", "Class"])) add("input", bare(cells.Input), path, line);
    for (const { line, cells } of tableRows(text, ["State"])) add("state", bare(cells.State), path, line);
    String(text).split("\n").forEach((each, i) => {
      const dataset = each.match(/^###\s+(DS-[A-Z]+-\d+|D\d+)\b/);
      if (dataset) add("dataset", dataset[1], path, i + 1);
    });
  }
  const seen = new Set();
  return out.filter((each) => (each.kind === "input" && seen.has(`input:${each.id}`) ? false : (seen.add(`${each.kind}:${each.id}`), true)));
}

/**
 * Give every check without an ID its own: `C-<prefix>-NN`, the area's next
 * free number, in file order (`C-NN` for an area with no prefix). A checks
 * table with no ID column gains one. IDs are never reused or renumbered.
 * Takes the area's Markdown paths, `files(path)`, and its prefix; returns
 * `{ texts: Map(path, new text), added }`, only the files it changed.
 */
export function fillCheckIds(paths, files, prefix = "") {
  const sorted = [...paths].sort();
  let last = 0;
  for (const path of sorted) for (const { cells } of tableRows(files(path), ["ID", "Check"])) {
    const id = splitId("check", cells.ID);
    if (id) last = Math.max(last, Number(id.number));
  }
  const next = () => `C-${prefix ? `${prefix}-` : ""}${String(++last).padStart(2, "0")}`;
  const texts = new Map();
  let added = 0;
  for (const path of sorted) {
    const lines = String(files(path)).split("\n");
    let state = null; // null outside a checks table, false in another table, else { idAt }
    let changed = false;
    lines.forEach((line, i) => {
      if (!line.startsWith("|")) { state = null; return; }
      const cells = line.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map((each) => each.trim());
      if (state === null) {
        if (!cells.includes("Check") || !cells.includes("Stories")) { state = false; return; }
        state = { idAt: cells.indexOf("ID") };
        if (state.idAt < 0) { lines[i] = `| ID ${line.trimStart()}`; changed = true; }
        return;
      }
      if (state === false) return;
      if (cells.every((each) => /^:?-+:?$/.test(each))) {
        if (state.idAt < 0) { lines[i] = `| --- ${line.trimStart()}`; changed = true; }
        return;
      }
      if (state.idAt < 0) { lines[i] = `| ${next()} ${line.trimStart()}`; added++; changed = true; return; }
      if (!cells[state.idAt]) {
        cells[state.idAt] = next();
        lines[i] = `| ${cells.join(" | ")} |`;
        added++;
        changed = true;
      }
    });
    if (changed) texts.set(path, lines.join("\n"));
  }
  return { texts, added };
}

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
    for (const { kind, id, path, line } of specIds(paths, files)) {
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
  for (const category of config.testdata.categories) {
    if (!category?.name) problems.push(`.workflow/config.json: a testdata.categories entry has no name`);
  }
  problems.push(...idProblems(config, tracked, files));
  problems.push(...tableProblems(config, tracked, files));
  const prefixes = config.areas.map((area) => area.prefix).filter(Boolean);
  const storyFile = matcher(config.stories.files);
  for (const path of tracked.filter(storyFile)) {
    for (const story of readStories(files(path), prefixes, path)) {
      if (story.risk && !story.risk.level) problems.push(`${path}:${story.line}: ${story.id} Risk says "${story.risk.raw}"; write "Risk: high (<why>)", "Risk: low", or no line for low`);
    }
  }
  return problems;
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
 * Two faults in the spec that hide rows from every tool: a table whose rows
 * a blank line cuts from its header (Markdown then shows an empty table and
 * loose lines, and no tool reads those rows), and a rule or check ID that a
 * check, fixture, input class, or dispute names but no spec defines.
 */
function tableProblems(config, tracked, files) {
  const problems = [];
  const spec = folders(config).flatMap(({ area, dir }) => tracked.filter((p) => p.startsWith(dir) && p.endsWith(".md")).map((path) => ({ area, path })));
  const defined = new Set(specIds(spec.map((each) => each.path), files).filter((each) => each.kind === "rule" || each.kind === "check").map((each) => each.id));
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
      for (const id of String(cell ?? "").match(CHECK_OR_RULE_IN_TEXT) ?? []) if (!defined.has(id)) problems.push(`${where}: ${id} is cited but defined nowhere in the spec; cite the rule or check that holds, or restore it`);
    };
    for (const header of [["ID", "Check"], ["Fixture", "Varies"], ["Input", "Class"]]) for (const { line, cells } of tableRows(text, header)) cite(cells.Rules, `${path}:${line}`);
    for (const { line, cells } of tableRows(text, ["ID", "Kind", "Question"])) if (/^dispute$/i.test(bare(cells.Kind))) cite(cells.Question, `${path}:${line}`);
  }
  return problems;
}

/** doc:check's warnings about test data: never a failure, so its volume is a choice and not a drift. */
export function testdataWarnings({ config, tracked, files }) {
  const { lines: maxLines, areaKB, loose } = config.testdata.limits;
  const isLoose = matcher(loose);
  const names = new Set(categoryNames(config));
  const warnings = [];
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
    const missing = tracked.filter((each) => each.startsWith(dir) && each.endsWith(".md")).reduce((n, path) => n + tableRows(files(path), ["Check", "Stories"]).filter(({ cells }) => !cells.ID).length, 0);
    if (missing) warnings.push(`${dir}: ${missing} ${missing === 1 ? "check has" : "checks have"} no ID; npx wf testdata ids ${area?.id ?? "<area>"} gives each its own`);
    const old = specIds(tracked.filter((each) => each.startsWith(dir) && each.endsWith(".md")), files).filter(({ kind, id }) => OLD[kind]?.test(id));
    if (old.length && area?.prefix) warnings.push(`${dir}: ${old.length} ${old.length === 1 ? "ID is" : "IDs are"} not area-qualified (${old.slice(0, 3).map((each) => each.id).join(", ")}${old.length > 3 ? ", …" : ""}); npx wf testdata rename-ids qualifies them, such as ${qualify(old[0].id, area.prefix)}`);
  }
  for (const { dir } of folders(config)) warnings.push(...ruleWarnings(dir, tracked, files));
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
 * `testdata.limits.fixtures` for a story, a flow area, or a rule.
 */
function volumeWarnings(config, dir, tracked, files) {
  const budget = config.testdata.limits.fixtures ?? {};
  const out = [];
  const paths = tracked.filter((each) => each.startsWith(dir) && each.endsWith(".md"));
  const classes = new Map();
  const byStory = new Map();
  const byRule = new Map();
  const checks = config.testdata.limits.checks ?? {};
  const checkText = new Map();
  const checkStory = new Map();
  const STORY_ID = storyPattern(prefixesOf(config));
  for (const path of paths) {
    for (const { line, cells } of tableRows(files(path), ["Check", "Stories"])) {
      const text = cells.Check.replace(/\s+/g, " ").trim();
      const key = text.toLowerCase().replace(/[`*_.]/g, "");
      const seen = checkText.get(key) ?? { text, at: [] };
      seen.at.push(`${path}:${line}`);
      checkText.set(key, seen);
      for (const story of new Set(ids(cells.Stories, STORY_ID))) checkStory.set(story, [...(checkStory.get(story) ?? []), `${path}:${line}`]);
    }
    for (const { line, cells } of tableRows(files(path), ["Input", "Class"])) {
      const key = `${cells.Input.replace(/`/g, "")}\u0000${cells.Class.toLowerCase()}`;
      if (classes.has(key)) out.push(`${path}:${line}: input ${cells.Input} class "${cells.Class}" is listed already, at ${classes.get(key)}; list an input's classes once, and name them from other flows`);
      else classes.set(key, `${path}:${line}`);
    }
    for (const { line, cells } of tableRows(files(path), ["Fixture", "Varies"])) {
      if (/^`?unit`?\b/.test(cells.Reach ?? "")) out.push(`${path}:${line}: ${cells.Fixture} reaches unit, which no person can; make it a class of its input`);
      for (const story of new Set(ids(cells.Stories, STORY_ID))) byStory.set(story, [...(byStory.get(story) ?? []), `${path}:${line}`]);
      for (const rule of new Set(ids(cells.Rules, RULE_IN_TEXT))) byRule.set(rule, [...(byRule.get(rule) ?? []), `${path}:${line}`]);
    }
  }
  for (const flow of flowAreas(dir, tracked)) {
    const n = flow.paths.reduce((sum, path) => sum + tableRows(files(path), ["Fixture", "Varies"]).length, 0);
    if (budget.area && n > budget.area) out.push(`${flow.name}: ${n} edge-case fixtures, over ${budget.area}; merge rows into one with axes, or move the cases that vary one input into its input classes`);
    const c = flow.paths.reduce((sum, path) => sum + tableRows(files(path), ["Check", "Stories"]).length, 0);
    if (checks.area && c > checks.area) out.push(`${flow.name}: ${c} checks, over ${checks.area}; keep what this flow shows that no rule says`);
  }
  // A check written in several files is a rule said again: it lives once, with one test across every state.
  for (const { text, at } of checkText.values()) {
    const where = new Set(at.map((each) => each.split(":")[0]));
    if (checks.repeated && where.size >= checks.repeated) out.push(`${at[0]}: the check "${text.slice(0, 60)}${text.length > 60 ? "…" : ""}" is in ${where.size} files; make it a rule in core.md with one test across every state, and drop it from the flows`);
  }
  for (const [story, at] of [...checkStory].sort((a, b) => b[1].length - a[1].length)) if (checks.story && at.length > checks.story) out.push(`${at[0]}: story ${story} has ${at.length} checks, over ${checks.story}; keep what only it shows, and leave what a rule says to the rule`);
  const over = (map, limit, what, hint) => {
    for (const [id, at] of [...map].sort((a, b) => b[1].length - a[1].length)) if (limit && at.length > limit) out.push(`${at[0]}: ${what} ${id} has ${at.length} edge-case fixtures, over ${limit}; ${hint}`);
  };
  over(byStory, budget.story, "story", "keep the ones only its flow shows, and ask the reviewer about any kept past it");
  over(byRule, budget.rule, "rule", "most are likely classes of one input; list them as its input classes");
  return out;
}
