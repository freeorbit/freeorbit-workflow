// Chunk start's choice page: which chunk to start or carry on, or a quick
// fix outside any chunk, from the build order, the done list, and the open
// questions. The answer is the `wf ready` command the track starts from.

import { existsSync } from "node:fs";
import { dirname, join, relative } from "node:path";

import { BLOCK_LIMITS } from "../ask/blocks.mjs";
import { matcher, project } from "../config/config.mjs";
import { designPaths, frameFiles } from "../design/frames.mjs";
import { chunkRows, readBuildOrder, storiesIn } from "../docs/shape.mjs";
import { areaOf, readStories, riskLines } from "../docs/stories.mjs";
import { CHUNK_ID, chunkId, waitsOn } from "../lanes.mjs";
import { questionRows } from "../logs/questions.mjs";
import { allScreens, gateProblems } from "../screens/list.mjs";
import { plural } from "./words.mjs";

/** A run's id from a chunk's, as an option id takes it. */
const runId = (id) => `c-${id.replace(/[^A-Za-z0-9_.-]/g, "-")}`;
/** How many chunks a page offers to start, so it stays a choice and not the whole order. */
const SHOWN = 6;
/** The area of a chunk whose row names no story. */
const NO_AREA = "No area (no stories)";

/**
 * Which chunks can start: not started, and every chunk it waits on done. The
 * Waits on cell is read as `wf ready` reads it (waitsOn), so the two agree.
 */
export function startable(rows, doneIds) {
  return rows
    .filter((row) => row.group === "Not started")
    .map((row) => ({ ...row, id: chunkId(row.chunk), waiting: waitsOn(row.waitsOn).map((each) => chunkId(each)).filter((each) => !doneIds.has(each)) }));
}

/**
 * The run to recommend and why: carry on a chunk in progress; else the first
 * that can start with no question still open on it; else the first that can
 * start; else a quick fix. `openFor(id)` counts a chunk's open questions.
 */
export function chunkAdvice(inProgress, ready, openFor = () => 0) {
  if (inProgress.length) return { run: runId(inProgress[0].id), why: `${inProgress[0].id} is in progress; finishing it before another keeps one chunk open at a time.` };
  const clear = ready.find((row) => !openFor(row.id));
  if (clear && clear !== ready[0]) return { run: runId(clear.id), why: `${ready[0].id} comes first but waits on ${plural(openFor(ready[0].id), "open question")}; ${clear.id} can start now with none.` };
  if (ready.length) return { run: runId(ready[0].id), why: `${ready[0].id} is first in the build order of the chunks nothing holds back${openFor(ready[0].id) ? `, though ${plural(openFor(ready[0].id), "question")} on it ${openFor(ready[0].id) === 1 ? "is" : "are"} still open` : ""}.` };
  return { run: "quick", why: "No chunk can start: each waits on another. A quick fix goes on meanwhile." };
}

/** The lines of an area's build-order log that name a chunk, newest last: what it was added for and how it grew. */
export function historyOf(texts, id) {
  const named = new RegExp(`(?<![\\w-])${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`);
  return texts
    .flatMap((text) => String(text).split("\n"))
    .map((line) => line.match(/^- (\d{4}-\d{2}-\d{2}): (.+)$/))
    .filter((m) => m && named.test(m[2]))
    // A line kept in two areas' logs is shown once.
    .filter((m, i, all) => all.findIndex((other) => other[0] === m[0]) === i)
    .map((m) => ({ date: m[1], text: m[2].length > 280 ? `${m[2].slice(0, 279)}…` : m[2] }));
}

/** What a chunk's details panel shows: what it delivers, its numbers, frames, stories, and what is still open on it. */
export function chunkDetails(row, { stories, frames, questions, unreached, doneIds, history = [] }) {
  const blocks = [];
  const waits = waitsOn(row.waitsOn).map((each) => chunkId(each));
  const facts = [
    row.forClient ? `**For the client:** ${row.forClient}` : "",
    row.who ? `**Who:** ${row.who}` : "",
    waits.length ? `**Waits on:** ${waits.map((id) => `${id}${doneIds.has(id) ? " (done)" : " (not done)"}`).join(", ")}` : "",
  ].filter(Boolean);
  if (facts.length) blocks.push({ type: "text", text: facts.join("\n\n") });
  if (history.length) blocks.push({ type: "text", title: "From the build order's log", text: history.slice(-3).map((each) => `- ${each.date}: ${each.text}`).join("\n") });
  if (!stories.length && !frames.length && !questions.length) {
    blocks.push({ type: "text", text: "No stories, frames, or open questions are linked to this chunk yet." });
    return blocks;
  }
  const lines = stories.reduce((n, story) => n + riskLines(story).lines.length, 0);
  const high = stories.reduce((n, story) => n + riskLines(story).high.length, 0);
  // A zero is no news, so it is neutral; a count that needs care is a warning.
  blocks.push({
    type: "stats",
    items: [
      { label: "Stories", value: String(stories.length), tone: stories.length ? "info" : "" },
      { label: "Acceptance lines", value: String(lines), tone: high ? "warn" : lines ? "info" : "", note: high ? `${high} high-risk` : "" },
      { label: "Frames", value: String(frames.length), tone: unreached ? "warn" : frames.length ? "info" : "", note: unreached ? `${unreached} not reached yet` : "" },
      { label: "Open questions", value: String(questions.length), tone: questions.length ? "warn" : "" },
    ],
  });
  if (frames.length) blocks.push({ type: "pictures", title: "What it builds", items: frames.slice(0, BLOCK_LIMITS.pictures) });
  if (stories.length) {
    const clip = (text, n) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);
    blocks.push({
      type: "table",
      title: "Stories",
      columns: ["Story", "As", "Lines", "Risk"],
      rows: stories.map((story) => [`${story.id} ${clip(story.title, 60)}`, clip(story.as, 200), String(riskLines(story).lines.length), riskLines(story).high.length ? `${riskLines(story).high.length} high` : "low"]),
    });
  }
  if (questions.length) blocks.push({ type: "text", title: "Still open on it", text: questions.slice(0, 8).map((q) => `- **${q.id}** (needs ${q.needs || "someone"}): ${q.question}`).join("\n") });
  return blocks;
}

/** Chunks by area, done, in progress, and not started, as a table's rows: an area by its chunks' first story, chunks with none last. */
export function byArea(config, rows, done) {
  const area = (row) => areaOf(config, storiesIn(row.stories)[0] ?? "")?.id ?? NO_AREA;
  const out = new Map();
  const add = (row, column) => {
    const key = area(row);
    if (!out.has(key)) out.set(key, [0, 0, 0]);
    out.get(key)[column] += 1;
  };
  for (const row of done) add(row, 0);
  for (const row of rows) add(row, row.group === "In progress" ? 1 : 2);
  return [...out]
    .sort(([a], [b]) => (a === NO_AREA) - (b === NO_AREA))
    .map(([key, [d, now, next]]) => [key, String(d), String(now), String(next)]);
}

/**
 * What every chunk's panel is read from, once: the stories, the screens and
 * their frame pictures, the open questions, and each area's build-order log.
 * Files are read through the project's own reader, so a link that leads out
 * of it is never read. Gives { questions, openFor, detailsOf }.
 */
export function chunkContext(root, config, doneIds) {
  const ctx = project(root);
  const read = (path) => (ctx.tracked.includes(path) && !ctx.links.has(path) ? ctx.files(path) : "");
  const questions = questionRows(read(config.logs.openQuestions));
  const openFor = (id) => questions.filter((q) => chunkId(q.heading) === id).length;
  const prefixes = config.areas.map((area) => area.prefix).filter(Boolean);
  const storyFiles = ctx.tracked.filter(matcher(config.stories.files)).filter((path) => !ctx.links.has(path));
  const stories = storyFiles.flatMap((path) => readStories(ctx.files(path), prefixes, path)).filter((story) => !story.removed);
  const logDir = `${dirname(config.buildOrder.file)}/${config.buildOrder.file.split("/").pop().replace(/\.md$/, "")}/`;
  const logs = ctx.tracked.filter((path) => path.startsWith(logDir) && path.endsWith(".md")).map(read);
  const screens = allScreens(root, config);
  let pictures = new Map();
  try {
    pictures = new Map(frameFiles(designPaths(root, config)).map((frame) => [frame.name, relative(root, frame.png)]));
  } catch {
    // No design folder: the panel shows no frames.
  }
  const detailsOf = (row) => {
    const ids = new Set(storiesIn(row.stories));
    const frames = screens
      .filter((screen) => screen.framed && screen.stories.some((id) => ids.has(id)))
      .map((screen) => ({ image: pictures.get(screen.name), label: screen.name }))
      .filter((frame) => frame.image && existsSync(join(root, frame.image)));
    return chunkDetails(row, {
      stories: stories.filter((story) => ids.has(story.id)),
      frames,
      questions: questions.filter((q) => chunkId(q.heading) === row.id),
      unreached: gateProblems(screens, row.id, [...ids]).length,
      doneIds,
      history: historyOf(logs, row.id),
    });
  };
  return { questions, openFor, detailsOf };
}

/** A list of chunk ids for a note: all of them, or the first few and how many more. */
const idsNote = (rows, n = 4) => (rows.length > n ? `${rows.slice(0, n).map((row) => row.id).join(", ")} +${rows.length - n}` : rows.map((row) => row.id).join(", "));

/** Chunk start's launch spec, from the project at `root`. */
export function chunkSpec(root, config) {
  const texts = readBuildOrder(root, config);
  const rows = chunkRows(texts.buildOrder);
  const doneIds = new Set(chunkRows(texts.done).map((row) => chunkId(row.chunk)));
  // A chunk id goes into the command the agent runs, so only a well-formed one is offered (SEC-INJECT).
  const wellFormed = (row) => CHUNK_ID.test(row.id);
  const inProgressAll = rows.filter((row) => row.group === "In progress").map((row) => ({ ...row, id: chunkId(row.chunk) }));
  const candidates = startable(rows, doneIds);
  const malformed = [...inProgressAll, ...candidates].filter((row) => !wellFormed(row));
  const inProgress = inProgressAll.filter(wellFormed);
  const ready = candidates.filter((row) => !row.waiting.length && wellFormed(row));
  const held = candidates.filter((row) => row.waiting.length && wellFormed(row));
  const { openFor, detailsOf } = chunkContext(root, config, doneIds);
  const why = (row) => [row.stories && row.stories !== "none" ? `stories ${row.stories}` : "no stories linked", row.who ? `by ${row.who}` : "", openFor(row.id) ? plural(openFor(row.id), "open question") : ""].filter(Boolean).join(" · ");
  const label = (row) => (row.title ? `${row.id}: ${row.title}` : row.chunk);
  const offered = ready.slice(0, SHOWN);
  const runs = [
    ...inProgress.map((row) => ({ id: runId(row.id), label: `Carry on ${label(row)}`, why: why(row), command: `npx wf ready chunk ${row.id}`, details: detailsOf(row) })),
    ...offered.map((row) => ({ id: runId(row.id), label: `Start ${label(row)}`, why: why(row), command: `npx wf ready chunk ${row.id}`, details: detailsOf(row) })),
    { id: "quick", label: "A quick fix, outside any chunk", why: "A small change on its own branch, with the quick track's checks", command: "npx wf ready quick" },
  ];
  const advice = chunkAdvice(inProgress, ready, openFor);
  // What the page does not offer, so nothing waits out of sight: chunks held back, and ready ones past the first few.
  const notOffered = [
    ...held.map((row) => `- **${row.id}** waits on ${row.waiting.join(", ")}`),
    ...ready.slice(SHOWN).map((row) => `- **${row.id}** can start, after the ${SHOWN} offered`),
    ...malformed.map((row) => `- **${row.chunk}** is left out: its id is not a chunk id, such as CH-12 or 37d`),
  ];
  return {
    id: "chunk-start",
    title: "Which chunk next?",
    template: "launch",
    prompt: "Which chunk?",
    intro: "Pick the chunk to start or carry on. Point at one to see what it builds; the command above Send is the track's first check.",
    from: "developer",
    blocks: [
      { type: "questions" },
      {
        type: "stats",
        title: "The build order",
        items: [
          { label: "In progress", value: String(inProgress.length), tone: inProgress.length ? "warn" : "", note: idsNote(inProgress) },
          { label: "Can start", value: String(ready.length), tone: ready.length ? "info" : "", note: idsNote(ready) },
          { label: "Waiting on another", value: String(held.length), tone: held.length ? "warn" : "", note: idsNote(held) },
          { label: "Done", value: String(doneIds.size), tone: "" },
        ],
      },
      ...(notOffered.length ? [{ type: "text", title: "Not offered here", text: notOffered.join("\n") }] : []),
      { type: "table", title: "Chunks by area", columns: ["Area", "Done", "In progress", "Not started"], rows: byArea(config, rows, chunkRows(texts.done)) },
    ],
    runs,
    recommended: advice.run,
    why: advice.why,
  };
}
