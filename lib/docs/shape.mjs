// Pure readers of a Markdown doc's shape: links, headings, blocks, and the
// table and log forms the workflow's logs keep. They know no feature and no
// project; every path and word list comes from the caller.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { storyPattern } from "../ids.mjs";
import { chunkId } from "../lanes.mjs";

/** Every link target in Markdown text, leaving out code. */
export function links(text) {
  const plain = text.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
  return [...plain.matchAll(/\]\(([^)\s]+)\)/g)].map((match) => match[1]);
}

/** A heading's anchor, as GitHub makes it. */
export function anchor(heading) {
  return heading
    .replace(/[`*]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

/** The anchors a Markdown file offers. */
export function anchors(text) {
  const plain = text.replace(/```[\s\S]*?```/g, "");
  return new Set([...plain.matchAll(/^#{1,6}\s+(.+)$/gm)].map((match) => anchor(match[1])));
}

/** Story IDs a text names with one of the prefixes, such as GM-29. Ranges and test IDs do not count. */
export function storyIds(text, prefixes) {
  return new Set([...String(text).matchAll(storyPattern(prefixes))].map((match) => `${match[1]}-${match[2]}`));
}

/** Paragraphs and bullets over a word limit, with the line each starts on. Code, tables, headings, and frontmatter do not count. */
export function longBlocks(text, limit) {
  const long = [];
  let block = null;
  let fenced = false;
  const close = () => {
    if (block && block.words > limit) long.push(block);
    block = null;
  };
  const lines = text.replace(/^---\n[\s\S]*?\n---\n/, (front) => "\n".repeat(front.split("\n").length - 1)).split("\n");
  lines.forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    const words = line.split(/\s+/).filter(Boolean).length;
    if (fenced || /^\s*(```|~~~|#|\||<|>)/.test(line) || !line.trim()) close();
    else if (/^\s*([-*+]|\d+\.)\s/.test(line)) {
      close();
      block = { line: i + 1, words };
    } else if (block) block.words += words;
    else block = { line: i + 1, words };
  });
  close();
  return long;
}

/**
 * Table cells too long to read at a glance: a cell over `cellLimit` words in
 * one piece, or a piece over `bulletLimit` words in a cell split with <br>,
 * each as { line, column, words, split }. A long cell is split into a short
 * lead and `<br>• ` bullets, since a table cell holds no real list.
 */
export function longCells(text, cellLimit, bulletLimit) {
  const long = [];
  let fenced = false;
  text.split("\n").forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (fenced || !/^\s*\|/.test(line) || /^\s*\|[\s|:-]*$/.test(line)) return;
    const cells = line.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/);
    cells.forEach((cell, column) => {
      const pieces = cell.split(/<br\s*\/?>/i);
      const count = (piece) => piece.replace(/`[^`]*`/g, "x").split(/\s+/).filter(Boolean).length;
      if (pieces.length === 1) {
        if (count(cell) > cellLimit) long.push({ line: i + 1, column: column + 1, words: count(cell), split: false });
      } else {
        for (const piece of pieces) if (count(piece) > bulletLimit) long.push({ line: i + 1, column: column + 1, words: count(piece), split: true });
      }
    });
  });
  return long;
}

/**
 * Each chunk row in a text: its id cell, the heading above it, its status, and
 * its Stories, Waits on, Title, and Who cells. The id cell is an id such as
 * CH-01 or CH-01-fe, beside a Title column; an older table has one cell, such
 * as "35i. Ask the assistant", and chunkId reads the id from either.
 */
export function chunkRows(text) {
  const rows = [];
  let group = "";
  let column = -1;
  let at = {};
  const cell = (cells, name) => (at[name] > 0 ? cells[at[name]] ?? "" : "");
  for (const line of text.split("\n")) {
    group = line.match(/^#{2,3}\s+(.+)$/)?.[1] ?? group;
    const cells = line.split("|").map((cell) => cell.trim());
    if (!line.startsWith("|")) column = -1;
    else if (cells[1] === "Chunk") {
      column = cells.indexOf("Status");
      at = Object.fromEntries(["Stories", "Waits on", "Title", "Who", "For the client"].map((name) => [name, cells.indexOf(name)]));
    } else if (column > 0 && !/^-+$/.test(cells[1]))
      rows.push({
        chunk: cells[1],
        group,
        status: cells[column],
        stories: cell(cells, "Stories"),
        waitsOn: cell(cells, "Waits on"),
        title: cell(cells, "Title"),
        who: cell(cells, "Who"),
        forClient: cell(cells, "For the client"),
      });
  }
  return rows;
}

/** The header cells of the first chunk table in a text, or [] when it has none. */
export function chunkHeader(text) {
  const line = String(text ?? "").split("\n").find((each) => /^\|\s*Chunk\s*\|/.test(each));
  return line ? line.split("|").map((cell) => cell.trim()).filter(Boolean) : [];
}

/** The first row, across the texts, whose id is `chunk`, such as CH-01 or 35i, or null. */
export function findChunk(texts, chunk) {
  for (const text of texts) {
    const row = chunkRows(text).find((row) => chunkId(row.chunk) === chunk);
    if (row) return row;
  }
  return null;
}

/**
 * Every story ID a cell names, in order: a range such as DR-01 to DR-20, or
 * DR-01–DR-20, gives each story in it. GM-49 inside C-GM-49 is part of
 * another ID, not a story.
 */
export function storiesIn(cell) {
  const out = [];
  const add = (id) => { if (!out.includes(id)) out.push(id); };
  for (const m of String(cell ?? "").matchAll(/(?<![A-Za-z0-9_]-)\b([A-Z]+)-(\d{2,})(?:\s*(?:to|–|—)\s*(?:([A-Z]+)-)?(\d{2,}))?\b/g)) {
    const [, prefix, from, other, to] = m;
    if (!to || (other && other !== prefix)) {
      add(`${prefix}-${from}`);
      if (to) add(`${other}-${to}`);
      continue;
    }
    for (let n = Number(from); n <= Number(to); n++) add(`${prefix}-${String(n).padStart(from.length, "0")}`);
  }
  return out;
}

/** The stories of a chunk, from its row in the build order or the done list, or null when it has no row. */
export function chunkStories(chunk, texts) {
  const row = findChunk(texts, chunk);
  return row ? storiesIn(row.stories) : null;
}

/** Each area row in the Areas table: its name and one cell per step. */
export function areaRows(text) {
  const rows = [];
  let steps = null;
  for (const line of text.split("\n")) {
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    if (!line.startsWith("|")) steps = null;
    else if (cells[0] === "Area" && cells.includes("Stories")) steps = cells.slice(1);
    else if (steps && !/^-+$/.test(cells[0])) {
      const area = cells[0].replace(/^\[(.+)\]\(.*\)$/, "$1");
      rows.push({ area, steps: Object.fromEntries(steps.map((step, i) => [step, cells[i + 1] ?? ""])) });
    }
  }
  return rows;
}

/** Table rows that sit under no `| Chunk |` header, so chunkRows cannot see them. */
export function strayRows(text) {
  const stray = [];
  let inTable = false;
  for (const line of text.split("\n")) {
    if (!line.startsWith("|")) inTable = false;
    else if (/^\|\s*Chunk\s*\|/.test(line)) inTable = true;
    else if (!inTable) stray.push(line);
  }
  return stray;
}

/** Each date in a text later than `today` (YYYY-MM-DD), as `{ line, date }`. */
export function futureDates(text, today) {
  return text.split("\n").flatMap((row, index) =>
    [...row.matchAll(/\b(\d{4}-\d{2}-\d{2})\b/g)]
      .filter((match) => match[1] > today)
      .map((match) => ({ line: index + 1, date: match[1] })),
  );
}

/** Rough tokens for a byte count. */
export const tokens = (bytes) => Math.round(bytes / 4);

/** The frontmatter between the first two `---` lines, or "". */
export function frontmatter(text) {
  return text.match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? "";
}

/** The body under a heading, up to the next heading at its level or above. */
export function section(text, heading) {
  const level = heading.match(/^#+/)[0].length;
  const lines = text.split("\n");
  const start = lines.indexOf(heading);
  if (start < 0) return "";
  const end = lines.findIndex((line, i) => i > start && new RegExp(`^#{1,${level}} `).test(line));
  return lines.slice(start + 1, end < 0 ? undefined : end).join("\n");
}

/** Summary rows of a findings table: `| [ID](...) |`. */
export const findingRows = (text) => text.split("\n").filter((line) => line.startsWith("| ["));

/** The last efficiency check's date, and the chunks built after it. */
export function efficiencyDue(efficiency, done, every) {
  const last = [...section(efficiency, "## Check").matchAll(/^\| (\d{4}-\d\d-\d\d) \|/gm)].at(-1)?.[1] ?? "";
  const since = done.filter((row) => (row.match(/Built (\d{4}-\d\d-\d\d)/)?.[1] ?? "") > last).length;
  return { last: last || "never", since, due: since >= every };
}

/** Headings that appear twice at the same level in one file, outside code. */
export function repeatedHeadings(text) {
  const plain = text.replace(/```[\s\S]*?```/g, "");
  const seen = new Map();
  for (const match of plain.matchAll(/^(#{1,3}) (.+)$/gm)) seen.set(match[0], (seen.get(match[0]) ?? 0) + 1);
  return [...seen].filter(([, count]) => count > 1).map(([heading]) => heading);
}

/** Sentences in a prompt that say to read a named large doc, with no search in them. */
export function wholeReads(text, large) {
  return text
    .split(/(?<=\.)\s+|\n/)
    .filter((line) => /\bread\b(?!-)/i.test(line) && !/\b(search|grep|never read|range|section|row)\b/i.test(line))
    .flatMap((line) => large.filter((path) => line.includes(path.split("/").pop())).map((path) => ({ line, path })));
}

/** Plain text of a Markdown line for matching: emphasis, links, and code marks removed, lower case. */
const plain = (text) => text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_`]/g, "").trim().toLowerCase();

/** Every entry in a Markdown text that starts with the query, as `{ line, text }`. */
export function entries(text, query) {
  const want = query.toLowerCase();
  const lines = text.split("\n");
  const found = [];
  let fenced = false;
  let header = null;
  lines.forEach((line, i) => {
    if (/^\s*```/.test(line)) fenced = !fenced;
    if (fenced) return;
    const heading = line.match(/^(#{1,6}) (.+)$/);
    if (heading) {
      if (!plain(heading[2]).includes(want)) return;
      const end = lines.findIndex((next, j) => j > i && new RegExp(`^#{1,${heading[1].length}} `).test(next));
      found.push({ line: i + 1, text: lines.slice(i, end < 0 ? undefined : end).join("\n").trimEnd() });
    } else if (line.startsWith("|")) {
      const first = line.split("|")[1] ?? "";
      if (!header) header = [line, lines[i + 1] ?? ""];
      else if (!/^\s*:?-+/.test(first) && plain(first).startsWith(want)) found.push({ line: i + 1, text: [...header, line].join("\n") });
    } else {
      header = null;
      const bullet = line.match(/^- (.+)$/);
      if (!bullet || !plain(bullet[1]).startsWith(want)) return;
      let end = i + 1;
      while (end < lines.length && /^\s+\S/.test(lines[end])) end += 1;
      found.push({ line: i + 1, text: lines.slice(i, end).join("\n") });
    }
  });
  return found;
}

/** The build order and the done list's text, each "" when the file is not there yet. */
export function readBuildOrder(root, config) {
  const read = (file) => (existsSync(join(root, file)) ? readFileSync(join(root, file), "utf8") : "");
  return { buildOrder: read(config.buildOrder.file), done: read(config.buildOrder.done) };
}

/** `wf doc:find`: each entry starting with the query in the Markdown files under the paths (default docs), tracked or not ignored. */
export function findEntries(root, query, paths = []) {
  const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", ...(paths.length ? paths : ["docs"])], { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter((path) => path.endsWith(".md"));
  return files.flatMap((path) => entries(readFileSync(join(root, path), "utf8"), query).map((entry) => ({ path, ...entry })));
}
