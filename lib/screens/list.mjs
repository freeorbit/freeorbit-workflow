// The one list of screens to check, read from every screens.md. A screen is
// a design frame, or a test scenario with no frame of its own. Each row's
// Reach names the scenario, then app-testing run steps, joined by " › ":
//
//   `downlink-wait-mixed › go #/plugins/downlink/requests › click Brightcart`
//
// "none, <chunk>: <reason>" means nothing reaches it yet, and names the chunk
// that will. "cannot: <reason>" means run steps cannot hold that state at all,
// such as a hover. It reads the repo's shape and no one feature.

import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { findChunk } from "../docs/shape.mjs";

/** Every area's screen list that exists, `<area docs>/<design.screens>`, in the config's order. */
export function screensFiles(root, config) {
  return config.areas
    .filter((area) => area.docs)
    .map((area) => join(root, area.docs, config.design.screens))
    .filter((file) => existsSync(file));
}

/**
 * The rows of a screens.md. A table headed "Frame" holds design frames; one
 * headed "Screen" holds scenarios with no frame. Each row gives its name,
 * stories, reach (undefined when the table has no Reach column), and the
 * heading it sits under.
 */
export function parseScreens(text, file = "") {
  const rows = [];
  let columns = null;
  let section = "";
  for (const line of text.split("\n")) {
    section = line.match(/^#{2,3} (.+)$/)?.[1].trim() ?? section;
    if (!line.startsWith("|")) {
      columns = null;
      continue;
    }
    const cells = line
      .split(/(?<!\\)\|/)
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells[0] === "Frame" || cells[0] === "Screen") {
      columns = cells;
      continue;
    }
    if (!columns || /^-+$/.test(cells[0])) continue;
    const name = cells[0].match(/^`([^`]+)`/)?.[1];
    if (!name) continue;
    const at = (title) => columns.indexOf(title);
    const stories = (cells[at("Stories")] ?? "").split(",").map((story) => story.trim()).filter(Boolean);
    const reach = at("Reach") >= 0 ? cells[at("Reach")].replace(/^`|`$/g, "") : undefined;
    const caption = cells.length > 1 ? cells.at(-1) : "";
    rows.push({ name, framed: columns[0] === "Frame", stories, reach, caption, file, section });
  }
  return rows;
}

/** Every screen in the repo. */
export function allScreens(root, config) {
  return screensFiles(root, config).flatMap((file) => parseScreens(readFileSync(file, "utf8"), file));
}

/** A Reach as its scenario and steps, or null when nothing reaches it. */
export function parseReach(reach) {
  if (!reach || unreached(reach)) return null;
  const [scenario, ...steps] = reach.split("›").map((part) => part.trim()).filter(Boolean);
  return { scenario, steps };
}

/**
 * A Reach that opens nothing: waiting on the chunk it names, cannot be held by
 * run steps, or an old "none" with no chunk. Null for a Reach that opens a screen.
 */
export function unreached(reach) {
  const waiting = reach?.match(/^none, ((?:[A-Z]+-)?[0-9]+[a-z]*(?:-[a-z]+)?): (.+)$/i);
  if (waiting) return { kind: "waiting", chunk: waiting[1], reason: waiting[2] };
  const cannot = reach?.match(/^cannot: (.+)$/i);
  if (cannot) return { kind: "cannot", reason: cannot[1] };
  if (/^none\b/i.test(reach ?? "")) return { kind: "unowned" };
  return null;
}

/** Whether a chunk is still to come, done, or unknown, from the build order and the done list. */
export function chunkStatus(chunk, buildOrder, done) {
  if (findChunk([done], chunk)) return "done";
  if (findChunk([buildOrder], chunk)) return "open";
  return null;
}

/** How many frames are reached, how many wait on each chunk, and how many cannot be. */
export function reachCounts(screens) {
  const frames = screens.filter((screen) => screen.framed);
  const waiting = new Map();
  let cannot = 0;
  for (const screen of frames) {
    const gap = unreached(screen.reach);
    if (gap?.kind === "cannot") cannot += 1;
    else if (gap) waiting.set(gap.chunk ?? "no chunk", (waiting.get(gap.chunk ?? "no chunk") ?? 0) + 1);
  }
  const open = [...waiting.values()].reduce((sum, n) => sum + n, 0);
  return { frames: frames.length, reached: frames.length - open - cannot, waiting, cannot };
}

/** The counts as one line, such as "105 of 126 frames reached; 19 wait on CH-35, 1 cannot be." */
export function reachLine(counts) {
  const parts = [...counts.waiting].map(([chunk, n]) => `${n} on ${chunk}`);
  const waits = parts.length ? `; waiting: ${parts.join(", ")}` : "";
  const cannot = counts.cannot ? `; ${counts.cannot} cannot be` : "";
  return `${counts.reached} of ${counts.frames} frames reached${waits}${cannot}.`;
}

/**
 * The chunk-end gate: frames showing one of the chunk's stories that are not
 * reached and do not wait on a later chunk. A frame shared with a later chunk
 * passes when it names that chunk.
 */
export function gateProblems(screens, chunk, stories) {
  const mine = new Set(stories);
  return screens
    .filter((screen) => screen.framed && screen.stories.some((story) => mine.has(story)))
    .filter((screen) => {
      const gap = unreached(screen.reach);
      return gap && gap.kind !== "cannot" && (gap.kind === "unowned" || gap.chunk === chunk);
    })
    .map((screen) => `${screen.name} shows ${screen.stories.filter((story) => mine.has(story)).join(", ")} and is not reached: ${screen.reach}`);
}

/** One story, or a range such as "GM-19 to GM-23" as each story in it. */
export function storyRange(text) {
  const range = text.match(/^([A-Z]+)-(\d+) to \1-(\d+)$/);
  if (!range) return [text];
  const [, prefix, from, to] = range;
  const width = from.length;
  return Array.from({ length: Number(to) - Number(from) + 1 }, (_, i) => `${prefix}-${String(Number(from) + i).padStart(width, "0")}`);
}

/** The stories of a chunk, from its row in the build order or the done list. */
export function chunkStories(chunk, texts) {
  const row = findChunk(texts, chunk);
  return row ? row.stories.split(",").flatMap((story) => storyRange(story.trim())).filter(Boolean) : null;
}

/**
 * What the list is missing: a row with no Reach, a Reach naming no scenario,
 * and a scenario no row reaches. Each is one line for a person to fix.
 */
export function coverage(screens, scenarios, chunks = null, root = "") {
  const problems = [];
  const reached = new Set();
  for (const screen of screens) {
    const where = screen.file ? `${(root ? relative(root, screen.file) : screen.file)}: ` : "";
    if (screen.reach === undefined || screen.reach === "") {
      problems.push(`${where}${screen.name} has no Reach`);
      continue;
    }
    const gap = unreached(screen.reach);
    if (gap?.kind === "unowned") problems.push(`${where}${screen.name} is not reached and names no chunk; write "none, <chunk>: <reason>"`);
    if (gap?.kind === "waiting" && chunks) {
      const status = chunkStatus(gap.chunk, chunks.buildOrder, chunks.done);
      if (status === null) problems.push(`${where}${screen.name} waits on chunk ${gap.chunk}, which the build order does not have`);
      if (status === "done") problems.push(`${where}${screen.name} waits on chunk ${gap.chunk}, which is done; reach it or name the chunk that will`);
    }
    const reach = parseReach(screen.reach);
    if (!reach) continue;
    if (!scenarios.includes(reach.scenario)) problems.push(`${where}${screen.name} names no scenario called ${reach.scenario}`);
    reached.add(reach.scenario);
  }
  for (const scenario of scenarios) {
    if (!reached.has(scenario)) problems.push(`scenario ${scenario} is on no screen row; add it under "Screens with no frame"`);
  }
  return problems;
}
