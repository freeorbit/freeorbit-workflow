// Chunk start's choice page: which chunk to start or carry on, or a quick
// fix outside any chunk, from the build order, the done list, and the open
// questions. The answer is the `wf ready` command the track starts from.

import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { matcher, project } from "../config/config.mjs";
import { designPaths, frameFiles } from "../design/frames.mjs";
import { chunkRows, readBuildOrder, storiesIn } from "../docs/shape.mjs";
import { areaOf, readStories, riskLines } from "../docs/stories.mjs";
import { chunkId } from "../lanes.mjs";
import { questionRows } from "../logs/questions.mjs";
import { allScreens, gateProblems } from "../screens/list.mjs";

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** A run's id from a chunk's, as an option id takes it. */
const runId = (id) => `c-${id.replace(/[^A-Za-z0-9_.-]/g, "-")}`;
/** How many chunks a page offers to start, so it stays a choice and not the whole order. */
const SHOWN = 6;

/**
 * Which chunks can start: not started, and every chunk it waits on done.
 * `waitsOn` is a cell of chunk ids, commas between; a chunk named there and
 * not in the done list holds it back.
 */
export function startable(rows, doneIds) {
  return rows
    .filter((row) => row.group === "Not started")
    .map((row) => ({ ...row, id: chunkId(row.chunk), waiting: String(row.waitsOn).split(/[,;]\s*/).map((each) => chunkId(each)).filter((each) => each && each !== "none" && !doneIds.has(each)) }));
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

/** What a chunk's details panel shows: what it delivers, its frames, its stories, and what is still open on it. */
export function chunkDetails(row, { stories, frames, questions, unreached, doneIds }) {
  const blocks = [];
  const waits = String(row.waitsOn || "").split(/[,;]\s*/).map((each) => chunkId(each)).filter((each) => each && each !== "none");
  const facts = [
    row.forClient ? `**For the client:** ${row.forClient}` : "",
    row.who ? `**Who:** ${row.who}` : "",
    waits.length ? `**Waits on:** ${waits.map((id) => `${id}${doneIds.has(id) ? " (done)" : " (not done)"}`).join(", ")}` : "",
  ].filter(Boolean);
  if (facts.length) blocks.push({ type: "text", text: facts.join("\n\n") });
  const lines = stories.reduce((n, story) => n + riskLines(story).lines.length, 0);
  const high = stories.reduce((n, story) => n + riskLines(story).high.length, 0);
  blocks.push({
    type: "stats",
    items: [
      { label: "Stories", value: String(stories.length), tone: "info" },
      { label: "Acceptance lines", value: String(lines), tone: "info", note: high ? `${high} high-risk` : "" },
      { label: "Frames", value: String(frames.length), tone: "info", note: unreached ? `${unreached} not reached yet` : "" },
      { label: "Open questions", value: String(questions.length), tone: questions.length ? "warn" : "ok" },
    ],
  });
  if (frames.length) blocks.push({ type: "pictures", title: "What it builds", items: frames.slice(0, 12) });
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

/** Chunks by area, done, in progress, and not started, as a table's rows: an area by its chunks' first story. */
export function byArea(config, rows, done) {
  const area = (row) => areaOf(config, storiesIn(row.stories)[0] ?? "")?.id ?? "no stories";
  const out = new Map();
  const add = (row, column) => {
    const key = area(row);
    if (!out.has(key)) out.set(key, [0, 0, 0]);
    out.get(key)[column] += 1;
  };
  for (const row of done) add(row, 0);
  for (const row of rows) add(row, row.group === "In progress" ? 1 : 2);
  return [...out].map(([key, [d, now, next]]) => [key, String(d), String(now), String(next)]);
}

/** Chunk start's launch spec, from the project at `root`. */
export function chunkSpec(root, config) {
  const texts = readBuildOrder(root, config);
  const rows = chunkRows(texts.buildOrder);
  const doneIds = new Set(chunkRows(texts.done).map((row) => chunkId(row.chunk)));
  const inProgress = rows.filter((row) => row.group === "In progress").map((row) => ({ ...row, id: chunkId(row.chunk) }));
  const candidates = startable(rows, doneIds);
  const ready = candidates.filter((row) => !row.waiting.length);
  const questionsFile = join(root, config.logs.openQuestions);
  const questions = existsSync(questionsFile) ? questionRows(readFileSync(questionsFile, "utf8")) : [];
  const openFor = (id) => questions.filter((q) => chunkId(q.heading) === id).length;
  // What each chunk's panel shows: its stories, frames, and open questions.
  const ctx = project(root);
  const prefixes = config.areas.map((area) => area.prefix).filter(Boolean);
  const storyFiles = ctx.tracked.filter(matcher(config.stories.files)).filter((path) => !ctx.links.has(path));
  const allStories = storyFiles.flatMap((path) => readStories(ctx.files(path), prefixes, path)).filter((story) => !story.removed);
  const screens = allScreens(root, config);
  let pictures = new Map();
  try {
    pictures = new Map(frameFiles(designPaths(root, config)).map((frame) => [frame.name, relative(root, frame.png)]));
  } catch {
    // No design folder: the panel shows no frames.
  }
  const detailsOf = (row) => {
    const ids = new Set(storiesIn(row.stories));
    const stories = allStories.filter((story) => ids.has(story.id));
    const frames = screens
      .filter((screen) => screen.framed && screen.stories.some((id) => ids.has(id)))
      .map((screen) => ({ image: pictures.get(screen.name), label: screen.name }))
      .filter((frame) => frame.image && existsSync(join(root, frame.image)));
    const unreached = gateProblems(screens, row.id, [...ids]).length;
    return chunkDetails(row, { stories, frames, questions: questions.filter((q) => chunkId(q.heading) === row.id), unreached, doneIds });
  };
  const why = (row) => [row.stories && row.stories !== "none" ? `stories ${row.stories}` : "no stories", row.who ? `by ${row.who}` : "", openFor(row.id) ? plural(openFor(row.id), "open question") : ""].filter(Boolean).join(" · ");
  const label = (row) => (row.title ? `${row.id}: ${row.title}` : row.chunk);
  const runs = [
    ...inProgress.map((row) => ({ id: runId(row.id), label: `Carry on ${label(row)}`, why: why(row), command: `npx wf ready chunk ${row.id}`, details: detailsOf(row) })),
    ...ready.slice(0, SHOWN).map((row) => ({ id: runId(row.id), label: `Start ${label(row)}`, why: why(row), command: `npx wf ready chunk ${row.id}`, details: detailsOf(row) })),
    { id: "quick", label: "A quick fix, outside any chunk", why: "A small change on its own branch, with the quick track's checks", command: "npx wf ready quick" },
  ];
  const held = candidates.filter((row) => row.waiting.length);
  const advice = chunkAdvice(inProgress, ready, openFor);
  const next = rows.filter((row) => row.group === "Not started").slice(0, 8);
  return {
    id: "chunk-start",
    title: "Which chunk next?",
    template: "launch",
    intro: `Pick the chunk to start or carry on. The command above Send is the track's first check.${held.length ? ` Not offered, each waiting on another: ${held.slice(0, 5).map((row) => `${row.id} (on ${row.waiting.join(", ")})`).join("; ")}.` : ""}`,
    from: "developer",
    blocks: [
      {
        type: "stats",
        title: "The build order",
        items: [
          { label: "In progress", value: String(inProgress.length), tone: inProgress.length ? "warn" : "ok", note: inProgress.map((row) => row.id).join(", ") },
          { label: "Can start", value: String(ready.length), tone: "info", note: ready.slice(0, 3).map((row) => row.id).join(", ") },
          { label: "Waiting on another", value: String(held.length), tone: held.length ? "warn" : "ok" },
          { label: "Done", value: String(doneIds.size), tone: "ok" },
        ],
      },
      { type: "table", title: "Chunks by area", columns: ["Area", "Done", "In progress", "Not started"], rows: byArea(config, rows, chunkRows(texts.done)) },
      ...(next.length ? [{ type: "text", title: "Next in the build order", text: next.map((row) => `- **${chunkId(row.chunk)}** ${row.title || row.chunk.replace(/^[^.]*\.\s*/, "")}${row.stories && row.stories !== "none" ? ` (${row.stories})` : ""}`).join("\n") }] : []),
      { type: "questions" },
    ],
    runs,
    recommended: advice.run,
    why: advice.why,
  };
}
