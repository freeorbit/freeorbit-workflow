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
// Each story is { id, title, group, as, acceptance, removed, path, line }:
// `group` is the `##` heading above it, `as` the first paragraph, and
// `acceptance` the top-level bullets under "Acceptance:", each { text, sub }.
// A story dropped from the product keeps its heading with a line starting
// "Removed", and reads as `removed`. Pure: it knows no file system.

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
  return { id, title, group, as: removed ? "" : first, acceptance, removed, path, line };
}

/** The area a story belongs to, by its ID's prefix, or null. */
export function areaOf(config, id) {
  return config.areas.find((area) => area.prefix && id.startsWith(`${area.prefix}-`)) ?? null;
}
