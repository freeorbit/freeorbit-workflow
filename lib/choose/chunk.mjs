// Chunk start's choice page: which chunk to start or carry on, or a quick
// fix outside any chunk, from the build order, the done list, and the open
// questions. The answer is the `wf ready` command the track starts from.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { chunkRows, readBuildOrder } from "../docs/shape.mjs";
import { chunkId } from "../lanes.mjs";
import { questionRows } from "../logs/questions.mjs";

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

/** The run to recommend and why: carry on a chunk in progress; else the first that can start; else a quick fix. */
export function chunkAdvice(inProgress, ready) {
  if (inProgress.length) return { run: runId(inProgress[0].id), why: `${inProgress[0].id} is in progress; finishing it before another keeps one chunk open at a time.` };
  if (ready.length) return { run: runId(ready[0].id), why: `${ready[0].id} is first in the build order of the chunks nothing holds back.` };
  return { run: "quick", why: "No chunk can start: each waits on another. A quick fix goes on meanwhile." };
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
  const why = (row) => [row.stories && row.stories !== "none" ? `stories ${row.stories}` : "no stories", row.who ? `by ${row.who}` : "", openFor(row.id) ? plural(openFor(row.id), "open question") : ""].filter(Boolean).join(" · ");
  const label = (row) => (row.title ? `${row.id}: ${row.title}` : row.chunk);
  const runs = [
    ...inProgress.map((row) => ({ id: runId(row.id), label: `Carry on ${label(row)}`, why: why(row), command: `npx wf ready chunk ${row.id}` })),
    ...ready.slice(0, SHOWN).map((row) => ({ id: runId(row.id), label: `Start ${label(row)}`, why: why(row), command: `npx wf ready chunk ${row.id}` })),
    { id: "quick", label: "A quick fix, outside any chunk", why: "A small change on its own branch, with the quick track's checks", command: "npx wf ready quick" },
  ];
  const held = candidates.filter((row) => row.waiting.length);
  const advice = chunkAdvice(inProgress, ready);
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
      { type: "questions" },
    ],
    runs,
    recommended: advice.run,
    why: advice.why,
  };
}
