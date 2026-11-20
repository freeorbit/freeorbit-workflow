// Facts about the docs that nobody checks by hand: links that lead nowhere,
// a doc missing from the index, story IDs no story file defines, a chunk whose
// status does not match its place, an area's step that does not start with a
// status word, a paragraph or bullet too long to read at a glance, and a date
// after today where a date says when something was written, and a question
// log out of its table shape, and a kind or story Risk line the kit does not
// know, a plan doc out of its shape, and an area past Step 3 with no data model. Its warnings, which never fail it, flag test data past its sizes, and an area that finished Step 3 before data models with none. A project adds its
// own checks through `extensions` in its config.

import { existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import { matcher } from "../config/config.mjs";
import { loadExtensions } from "../extensions.mjs";
import { decisionProblems } from "../logs/decisions.mjs";
import { questionProblems } from "../logs/questions.mjs";
import { boardProblems, workItemProblems } from "../board/settings.mjs";
import { readPlanDocs } from "./plan.mjs";
import { docProblems } from "./docsync.mjs";
import { roleProblems, rolesBlock, withBlock } from "../roles.mjs";
import { frameProblems } from "../design/docchecks.mjs";
import { laneProblems } from "../lanes.mjs";
import { testdataProblems, testdataWarnings } from "../testdata/checks.mjs";
import { anchors, areaRows, chunkHeader, chunkRows, futureDates, links, longBlocks, longCells, storyIds, strayRows } from "./shape.mjs";

/** The story ID prefixes, from the areas. */
const storyPrefixes = (config) => config.areas.map((area) => area.prefix).filter(Boolean);

/** The problems in one doc's links. */
function checkLinks(root, path, text, files) {
  const problems = [];
  for (const target of links(text)) {
    if (/^[a-z]+:/i.test(target)) continue;
    const [file, fragment] = target.split("#");
    const to = file ? relative(root, resolve(root, dirname(path), file)) : path;
    if (!existsSync(join(root, to))) {
      problems.push(`${path}: no file ${target}`);
    } else if (fragment && to.endsWith(".md") && !anchors(files(to)).has(fragment)) {
      problems.push(`${path}: no heading ${target}`);
    }
  }
  return problems;
}

/**
 * A doc the index leaves out. A folder's README that the index lists stands
 * for each file of that folder it links, so a folder of one-screen files takes
 * one row. A README one folder down, linked from its parent's, counts too.
 */
function checkIndex({ root, config, files }, docs, history) {
  const index = config.docs.index;
  if (!docs.includes(index)) return [];
  const skip = matcher(config.docs.notIndexed);
  const linked = (from) => new Set(links(files(from)).map((target) => relative(root, resolve(root, dirname(from), target.split("#")[0]))));
  const known = linked(index);
  const present = new Set(docs);
  const listed = new Map();
  // The README one folder up: a file's own folder's, or for a README, its parent folder's.
  const parentReadme = (path) => join(path.endsWith("/README.md") ? dirname(dirname(path)) : dirname(path), "README.md");
  const covered = (path) => {
    if (known.has(path)) return true;
    const readme = parentReadme(path);
    if (readme === path || readme === index || !present.has(readme)) return false;
    if (!listed.has(readme)) listed.set(readme, linked(readme));
    return listed.get(readme).has(path) && covered(readme);
  };
  return docs.filter((path) => path !== index && !history(path) && !covered(path) && !skip(path)).map((path) => `${index}: no row for ${path}`);
}

/** Story IDs named anywhere with no story behind them. */
function checkStories({ config, files }, docs, history) {
  const prefixes = storyPrefixes(config);
  if (!prefixes.length) return [];
  const storyFile = matcher(config.stories.files);
  const heading = new RegExp(`^#{2,4}\\s+((?:${prefixes.join("|")})-\\d{2})\\b`, "gm");
  const defined = new Set();
  for (const path of docs.filter(storyFile)) for (const match of files(path).matchAll(heading)) defined.add(match[1]);
  const problems = [];
  for (const path of docs.filter((doc) => !history(doc))) {
    // A fenced block is an example of a format, not a reference to a story.
    const text = files(path).replace(/^```[\s\S]*?^```$/gm, "");
    for (const id of storyIds(text, prefixes)) if (!defined.has(id)) problems.push(`${path}: no story ${id}`);
  }
  return problems;
}

/** Chunk rows whose status is not the word their place calls for. */
function checkChunks({ config, files }, has) {
  const { file, done, groups } = config.buildOrder;
  const open = has(file)
    ? chunkRows(files(file))
        .filter((row) => !groups.includes(row.status) || row.status !== row.group)
        .map((row) => `${file}: ${row.chunk} says ${row.status} under ${row.group}`)
    : [];
  if (!has(done)) return open;
  const closed = chunkRows(files(done))
    .filter((row) => row.status !== "Done")
    .map((row) => `${done}: ${row.chunk} says ${row.status}`);
  const stray = strayRows(files(done)).map((line) => `${done}: a row outside the chunk table: ${line.slice(0, 60)}`);
  // Each done chunk can say, in plain words, what the client can now do; the board's delivery note posts it.
  const rows = chunkRows(files(done));
  const noColumn = chunkHeader(files(done)).length && !chunkHeader(files(done)).includes("For the client") ? [`${done}: the done table has no "For the client" column; add it after Detail, one plain sentence a chunk, empty for old ones`] : [];
  const long = rows
    .filter((row) => row.forClient.split(/\s+/).filter(Boolean).length > config.docs.cellWords)
    .map((row) => `${done}: ${row.chunk} For the client has ${row.forClient.split(/\s+/).filter(Boolean).length} words, over ${config.docs.cellWords}`);
  return [...open, ...closed, ...stray, ...noColumn, ...long];
}

/** Lane rows whose lane, waits, or start break the lane rules. */
function checkLanes({ config, files }, has) {
  const { file, done } = config.buildOrder;
  if (!has(file)) return [];
  return laneProblems(config, chunkRows(files(file)), has(done) ? chunkRows(files(done)) : [], file);
}

/** Area cells that do not start with a status word. */
function checkAreas({ config, files }, has) {
  const { file, stepWords } = config.buildOrder;
  if (!has(file)) return [];
  return areaRows(files(file)).flatMap((row) =>
    Object.entries(row.steps)
      .filter(([, cell]) => !stepWords.some((word) => cell.startsWith(word)))
      .map(([step, cell]) => `${file}: ${row.area} ${step} says "${cell}", not one of ${stepWords.join(", ")}`),
  );
}

/** Whether an Areas row's Architecture step is done: the area is past Step 3. */
const pastStep3 = (row, stepWords) => (row.steps.Architecture ?? "").startsWith(stepWords[0]);

/** Whether a doc is still the kit's empty template of this name, its marker line not yet deleted. */
const stillTemplate = (text, name) => String(text ?? "").includes(`<!-- wf:template ${name}`);

/**
 * Once an area's Architecture is done, the review needs a threat model that is
 * no longer the kit's empty template, and a hot-paths doc the same when
 * review.hotPaths names one. A project that sets no hot-paths doc is not asked
 * for one: its performance pass walks the PERF rules alone.
 */
function checkThreatModel({ config, files }, has) {
  const { file, stepWords } = config.buildOrder;
  if (!has(file)) return [];
  const rows = areaRows(files(file));
  if (rows.length && rows.every((row) => !("Architecture" in row.steps))) return [`${file}: its Areas table has no Architecture column, so the threat model cannot be checked`];
  const past = rows.find((row) => pastStep3(row, stepWords));
  if (!past) return [];
  const why = `${past.area} is past Step 3`;
  const drafted = (doc, setting, what, template) => {
    if (!has(doc)) return [`${doc}: ${why}, and the ${what} ${setting} names is missing`];
    if (stillTemplate(files(doc), template)) return [`${doc}: ${why}, and it is still the kit's empty template; draft it and have the owner review it`];
    return [];
  };
  const model = config.review.threatModel;
  const out = model ? drafted(model, "review.threatModel", "threat model", "threat-model") : [`.workflow/config.json: ${why}, and review.threatModel is not set; draft one from the kit's templates/threat-model.md`];
  if (config.review.hotPaths) out.push(...drafted(config.review.hotPaths, "review.hotPaths", "hot-paths doc", "hot-paths"));
  return out;
}

/** The day v1.9.0 made a data model part of Step 3: an area past Step 3 since then needs one, and one past it before is warned. */
export const DATA_MODEL_SINCE = "2026-11-21";

/**
 * Each area past Step 3 whose data-model.md, in its docs folder, is missing or
 * still the kit's template, as { problems, warnings }. An area whose
 * Architecture cell is dated before DATA_MODEL_SINCE, or not dated, is
 * warned, so an upgrade fails no area that finished Step 3 without one.
 */
function dataModels({ config, files }, has) {
  const { file, stepWords } = config.buildOrder;
  const out = { problems: [], warnings: [] };
  if (!has(file)) return out;
  for (const row of areaRows(files(file))) {
    const area = config.areas.find((each) => each.id.toLowerCase() === row.area.toLowerCase());
    if (!pastStep3(row, stepWords) || !area?.docs) continue;
    const path = `${area.docs}/data-model.md`;
    const why = !has(path)
      ? `${path}: ${row.area} is past Step 3 and has no data model; draft it from the kit's templates/data-model.md, or say in one line that it stores nothing`
      : stillTemplate(files(path), "data-model") ? `${path}: ${row.area} is past Step 3, and its data model is still the kit's empty template` : null;
    if (!why) continue;
    const date = row.steps.Architecture.match(/\d{4}-\d{2}-\d{2}/)?.[0];
    (date && date >= DATA_MODEL_SINCE ? out.problems : out.warnings).push(why);
  }
  return out;
}

/** Story IDs a Build cell names that no chunk row, open or done, lists. */
function checkBuildStories({ config, files }, has) {
  const { file, done } = config.buildOrder;
  const prefixes = storyPrefixes(config);
  if (!has(file) || !prefixes.length) return [];
  const chunked = new Set(
    [file, done].filter(has).flatMap((path) => chunkRows(files(path)).flatMap((row) => [...storyIds(row.stories, prefixes)])),
  );
  return areaRows(files(file)).flatMap((row) =>
    [...storyIds(row.steps.Build ?? "", prefixes)]
      .filter((id) => !chunked.has(id))
      .map((id) => `${file}: ${row.area} Build names ${id}, which no chunk row lists`),
  );
}

/** Paragraphs and bullets over the limit in each held doc. */
function checkBlocks({ config, tracked, files }, history) {
  const { blockWords, cellWords, bulletWords, loose } = config.docs;
  const held = matcher(config.docs.held);
  const notHeld = matcher(config.docs.notHeld);
  const looseCells = matcher(config.docs.looseCells);
  return tracked
    .filter((path) => path.endsWith(".md") && held(path) && !notHeld(path) && !loose.includes(path) && !history(path))
    .flatMap((path) => [
      ...longBlocks(files(path), blockWords).map((block) => `${path}:${block.line}: ${block.words} words in one block, over ${blockWords}`),
      ...(looseCells(path) ? [] : longCells(files(path), cellWords, bulletWords)).map((cell) =>
        cell.split
          ? `${path}:${cell.line}: column ${cell.column} has a ${cell.words}-word line, over ${bulletWords}`
          : `${path}:${cell.line}: column ${cell.column} has ${cell.words} words in one piece, over ${cellWords}; split it into a lead and <br>• bullets`,
      ),
    ]);
}

/** Dates after `today`, the latest date on Earth, where a date says when something was written. */
function checkDates({ config, files }, docs, today) {
  const written = matcher(config.docs.written);
  return docs
    .filter(written)
    .flatMap((path) => futureDates(files(path), today).map((hit) => `${path}:${hit.line}: ${hit.date} is after today in every time zone, ${today} at the latest`));
}

/** Problems in the people and roles, and a "Who decides" block in AGENTS.md that no longer matches them. */
function checkRoles({ config, files }, has) {
  const problems = roleProblems(config).map((problem) => `.workflow/config.json: ${problem}`);
  for (const path of config.growth.always.filter(has)) {
    const text = files(path);
    const fresh = withBlock(text, rolesBlock(config));
    if (fresh !== null && fresh !== text) problems.push(`${path}: the Who decides block is out of date, run wf roles --write`);
  }
  return problems;
}

/** Today in this computer's time zone, as YYYY-MM-DD. */
export function localToday(now = new Date()) {
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

/**
 * The latest date anywhere on Earth now: the date at UTC+14, the furthest
 * ahead any time zone runs. A date a person writes can be no later than this,
 * wherever they or the check run. Comparing against the runner's own today
 * failed a date written in Australia (UTC+11) on a CI runner in UTC, still on
 * the day before (2026-11-11, PR #45); today plus a day would let through a
 * date no time zone has reached yet.
 */
export function latestToday(now = new Date()) {
  return new Date(now.getTime() + 14 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/** Every problem in the project's docs, generic checks first, then each extension's. */
export async function problems(context, today = latestToday()) {
  const { tracked } = context;
  const docs = tracked.filter((path) => path.startsWith("docs/") && path.endsWith(".md"));
  const history = matcher(context.config.docs.history);
  const present = new Set(tracked);
  const has = (path) => present.has(path);
  const extensions = await loadExtensions(context);
  return [
    ...docs.filter((path) => !history(path)).flatMap((path) => checkLinks(context.root, path, context.files(path), context.files)),
    ...checkIndex(context, docs, history),
    ...checkStories(context, docs, history),
    ...frameProblems(context),
    ...extensions.flatMap((extension) => extension.checks?.(context) ?? []),
    ...checkChunks(context, has),
    ...checkAreas(context, has),
    ...checkLanes(context, has),
    ...checkThreatModel(context, has),
    ...dataModels(context, has).problems,
    ...checkBuildStories(context, has),
    ...checkBlocks(context, history),
    ...checkDates(context, docs, today),
    ...checkRoles(context, has),
    ...(context.config.board?.boardId ? boardProblems(context.config).map((problem) => `.workflow/config.json: ${problem}`) : []),
    // Each listed plan doc's shape, board or no board; its config's problems are boardProblems' while a board is set.
    ...(context.config.board?.boardId ? [] : workItemProblems(context.config).map((problem) => `.workflow/config.json: ${problem}`)),
    ...readPlanDocs(context).problems,
    ...docProblems(context.config, (file) => (has(file) ? context.files(file) : null)),
    ...decisionProblems(context, history),
    ...questionProblems(context),
    ...testdataProblems(context),
  ];
}

/** What doc:check notes without failing: sizes and names to judge, such as a test-data file past one screen. */
export function warnings(context) {
  const present = new Set(context.tracked);
  return [...testdataWarnings(context), ...dataModels(context, (path) => present.has(path)).warnings];
}
