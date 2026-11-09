// Facts about the docs that nobody checks by hand: links that lead nowhere,
// a doc missing from the index, story IDs no story file defines, a chunk whose
// status does not match its place, an area's step that does not start with a
// status word, a paragraph or bullet too long to read at a glance, and a date
// after today where a date says when something was written. A project adds its
// own checks through `extensions` in its config.

import { existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import { matcher } from "../config.mjs";
import { loadExtensions } from "../extensions.mjs";
import { decisionProblems } from "../decisions.mjs";
import { docProblems } from "../docsync.mjs";
import { roleProblems, rolesBlock, withBlock } from "../roles.mjs";
import { anchors, areaRows, chunkRows, futureDates, links, longBlocks, longCells, storyIds, strayRows } from "./shape.mjs";

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

/** A doc the index leaves out. */
function checkIndex({ root, config, files }, docs, history) {
  const index = config.docs.index;
  if (!docs.includes(index)) return [];
  const skip = matcher(config.docs.notIndexed);
  const known = new Set(links(files(index)).map((target) => relative(root, resolve(root, dirname(index), target.split("#")[0]))));
  return docs.filter((path) => path !== index && !history(path) && !known.has(path) && !skip(path)).map((path) => `${index}: no row for ${path}`);
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
    for (const id of storyIds(files(path), prefixes)) if (!defined.has(id)) problems.push(`${path}: no story ${id}`);
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
  return [...open, ...closed, ...stray];
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

/** Dates after today where a date says when something was written. */
function checkDates({ config, files }, docs, today) {
  const written = matcher(config.docs.written);
  return docs
    .filter(written)
    .flatMap((path) => futureDates(files(path), today).map((hit) => `${path}:${hit.line}: ${hit.date} is after today, ${today}`));
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

/** Every problem in the project's docs, generic checks first, then each extension's. */
export async function problems(context, today = localToday()) {
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
    ...extensions.flatMap((extension) => extension.checks?.(context) ?? []),
    ...checkChunks(context, has),
    ...checkAreas(context, has),
    ...checkBuildStories(context, has),
    ...checkBlocks(context, history),
    ...checkDates(context, docs, today),
    ...checkRoles(context, has),
    ...docProblems(context.config, (file) => (has(file) ? context.files(file) : null)),
    ...decisionProblems(context, history),
  ];
}
