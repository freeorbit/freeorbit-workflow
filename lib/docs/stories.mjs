// Reads the stories out of a project's story files, in the shape
// writing-docs.md gives:
//
//   ## Sign in
//
//   ### APP-01. Sign in with work email and password
//
//   As a Governance User, I want …, so that ….
//
//   Acceptance:
//
//   - Given …, then ….
//     - A detail under it.
//
// A story may carry a risk tier on a line of its own before Acceptance,
// `Risk: high (money, outside input)` or `Risk: low`; with no line it is low.
//
// Each story is { id, title, group, as, acceptance, removed, risk, path, line }:
// `group` is the `##` heading above it, `as` the first paragraph, and
// `acceptance` the top-level bullets under "Acceptance:", each { id, text, sub,
// risk, removed }. A line's `id` is the story's and its place, `APP-01.2` for
// the second: a test cites it, so a new line goes last and a line taken out
// keeps its place as `- Removed (<date>).`. A line may end `Risk: high (<why>)`,
// which reads as its `risk` and is left out of its `text`.
// A story dropped from the product keeps its heading with a line starting
// "Removed", and reads as `removed`. `risk` is null with no Risk line, else
// { level, reasons, raw }, with level "high", "low", or "" when it says neither.
// Pure: it knows no file system.

import { matcher } from "../config/config.mjs";

/** Each story in one story file's text. `prefixes` are the areas' story ID prefixes. */
export function readStories(text, prefixes, path = "") {
  if (!prefixes.length) return [];
  const heading = new RegExp(`^(#{2,4})\\s+((?:${prefixes.join("|")})-\\d{2})\\.?\\s+(.*)$`);
  const lines = String(text ?? "")
    .replace(/^```[\s\S]*?^```$/gm, (block) => block.replace(/[^\n]/g, ""))
    .split("\n");
  const stories = [];
  let group = "";
  let current = null;
  const close = () => {
    if (current) stories.push(finish(current));
    current = null;
  };
  lines.forEach((line, index) => {
    const story = line.match(heading);
    const other = !story && line.match(/^(#{1,6})\s+(.+)$/);
    if (story) {
      close();
      current = { id: story[2], title: story[3].trim(), group, level: story[1].length, body: [], path, line: index + 1 };
    } else if (other) {
      // A heading at the story's level or above ends it; a `##` one also names the next group.
      if (current && other[1].length <= current.level) close();
      if (other[1].length === 2) group = other[2].trim();
    } else if (current) current.body.push(line);
  });
  close();
  return stories;
}

/** A story's parts from its body lines. */
function finish({ id, title, group, body, path, line }) {
  const paragraphs = body.join("\n").trim().split(/\n\s*\n/);
  const first = (paragraphs[0] ?? "").replace(/\s*\n\s*/g, " ").trim();
  const removed = /^removed\b/i.test(first);
  const acceptance = [];
  let inAcceptance = false;
  for (const row of body) {
    if (/^acceptance\s*:?\s*$/i.test(row.trim())) inAcceptance = true;
    else if (!inAcceptance) continue;
    else if (/^[-*] /.test(row)) acceptance.push({ text: row.slice(2).trim(), sub: [] });
    else if (/^\s+[-*] /.test(row) && acceptance.length) acceptance.at(-1).sub.push(row.trim().slice(2).trim());
    else if (/^\s{2,}\S/.test(row) && acceptance.length) {
      // A wrapped line continues the bullet above it.
      const last = acceptance.at(-1);
      if (last.sub.length) last.sub[last.sub.length - 1] += ` ${row.trim()}`;
      else last.text += ` ${row.trim()}`;
    } else if (row.trim() && !/^[-*\s]/.test(row)) inAcceptance = false;
  }
  acceptance.forEach((each, i) => {
    const tag = each.text.match(LINE_RISK);
    each.id = `${id}.${i + 1}`;
    each.risk = tag ? { level: "high", reasons: tag[1] ? tag[1].split(/,\s*/) : [] } : null;
    if (tag) each.text = each.text.slice(0, tag.index).trim();
    each.removed = /^removed\b/i.test(each.text);
  });
  return { id, title, group, as: removed ? "" : first, acceptance, removed, risk: riskOf(body), path, line };
}

// A line's own tag, at its end, as written: `Risk: high (privacy)`. A line whose own words end "risk: high" is not one.
const LINE_RISK = /\s+Risk: high\b\s*(?:\(([^)]*)\))?\.?\s*$/;

/** A story's live acceptance lines, and those that are high-risk: every one under a story-level `Risk: high`, else each tagged line. */
export function riskLines(story) {
  const lines = story.acceptance.filter((each) => !each.removed);
  const high = story.risk?.level === "high" ? lines : lines.filter((each) => each.risk);
  return { lines, high, by: story.risk?.level === "high" ? "story" : high.length ? "line" : "low" };
}

/** The Risk line before a story's acceptance, or null. */
function riskOf(body) {
  const end = body.findIndex((row) => /^acceptance\s*:?\s*$/i.test(row.trim()));
  const found = (end === -1 ? body : body.slice(0, end)).map((row) => row.trim().match(/^risk\s*:\s*(.*)$/i)).find(Boolean);
  if (!found) return null;
  const match = found[1].match(/^(high|low)\b\s*(?:\((.*)\))?\s*\.?$/i);
  return { level: match ? match[1].toLowerCase() : "", reasons: match?.[2] ? match[2].split(/,\s*/) : [], raw: found[1] };
}

/** The area a story belongs to, by its ID's prefix, or null. */
export function areaOf(config, id) {
  return config.areas.find((area) => area.prefix && id.startsWith(`${area.prefix}-`)) ?? null;
}

/** Every story in the project's story files, with its area. */
export function projectStories({ config, tracked, files }) {
  const prefixes = config.areas.map((area) => area.prefix).filter(Boolean);
  const storyFile = matcher(config.stories.files);
  return tracked
    .filter(storyFile)
    .sort()
    .flatMap((path) => readStories(files(path), prefixes, path))
    .map((story) => ({ ...story, area: areaOf(config, story.id) }));
}
