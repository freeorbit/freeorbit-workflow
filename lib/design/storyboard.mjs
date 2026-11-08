// `wf design storyboard`: writes each area's storyboard, its review PNGs in
// the order its screen list gives them, under the screen list's headings, with
// the stories and the caption. Then lists the frames changed since the base
// branch, in that same order, for the person reviewing. It reads the screen
// lists' shape and knows no feature.
//
//   wf design storyboard           write every storyboard
//   wf design storyboard --check   list the stale ones, write nothing

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, posix } from "node:path";

import { sectionFolder } from "./frames.mjs";

/** Each area's screen list, `<area docs>/<design.screens>` when it is tracked: `[area, path]`. */
export function screenLists(config, tracked) {
  const have = new Set(tracked);
  return config.areas
    .filter((area) => area.docs)
    .map((area) => [area.id, posix.join(area.docs, config.design.screens)])
    .filter(([, path]) => have.has(path));
}

/** The storyboard's path for an area. */
export const storyboardPath = (config, area) => posix.join(config.design.review, area, "storyboard.md");

/** The frames in a screen list, in order, each under the heading above it. */
export function frames(text) {
  const out = [];
  let section = "";
  let columns = 3;
  for (const line of text.split("\n")) {
    section = line.match(/^#{2,3} (.+)$/)?.[1] ?? section;
    if (line.startsWith("| Frame |")) columns = line.split(" | ").length;
    // A "Screen" table lists scenarios with no frame, so it has no pictures here.
    if (line.startsWith("| Screen |")) columns = 0;
    if (!line.startsWith("|")) columns = columns === 0 ? 3 : columns;
    const row = line.match(/^\| `([a-z0-9-]+)` \| (.*) \|$/);
    if (!row || columns === 0) continue;
    // Stories come second and the caption last, which may hold " | " itself.
    // A Reach column, when the header has one, sits between.
    const cells = row[2].split(" | ");
    out.push({ frame: row[1], stories: cells[0], caption: cells.slice(columns - 2).join(" | "), section });
  }
  return out;
}

// Frames in a row of the grid. Two stay readable at GitHub's page width.
const COLUMNS = 2;

/** A frame's picture, beside the storyboard in its section's folder. */
export const picture = (row) => `${row.section ? `${sectionFolder(row.section)}/` : ""}${row.frame}.png`;

/** An HTML table of thumbnails, COLUMNS to a row, each linking to its PNG. */
export function grid(rows) {
  const out = ["<table>"];
  for (let i = 0; i < rows.length; i += COLUMNS) {
    out.push("<tr>");
    for (const row of rows.slice(i, i + COLUMNS)) {
      out.push(
        `<td width="50%" valign="top"><a href="${picture(row)}"><img src="${picture(row)}" alt="${row.frame}" width="100%"></a><br><b>${row.n}. ${row.frame}</b><br>${row.stories}</td>`,
      );
    }
    out.push("</tr>");
  }
  out.push("</table>");
  return out;
}

/** The storyboard Markdown for one area. */
export function storyboard(config, area, list, text) {
  const title = text.match(/^# (.+)$/m)?.[1] ?? area;
  const all = frames(text);
  const out = [
    `# ${title}: storyboard`,
    "",
    `Written by \`wf design storyboard\` from [the screen list](${posix.relative(posix.dirname(storyboardPath(config, area)), list)}). Do not edit it by hand. The frames are in the order a user meets them, two to a row. Open a picture for its full size, and read what it shows in the list under its grid.`,
    "",
  ];
  const numbered = all.map((row, i) => ({ ...row, n: i + 1 }));
  const sections = [];
  for (const row of numbered) {
    if (!sections.length || sections.at(-1).name !== row.section) sections.push({ name: row.section, rows: [] });
    sections.at(-1).rows.push(row);
  }
  const named = sections.filter((section) => section.name);
  if (named.length > 1) {
    out.push(`Contents: ${named.map(({ name, rows }) => `[${name}](#${sectionFolder(name)}) (${rows.length})`).join(" · ")}`, "");
  }
  for (const { name, rows } of sections) {
    if (name) out.push(`## ${name}`, "");
    out.push(...grid(rows), "");
    for (const row of rows) out.push(`${row.n}. **${row.frame}** (${row.stories}). ${row.caption}`);
    out.push("");
  }
  return out.join("\n");
}

const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Frames whose HTML or PNG differs from the base branch, committed or not, in story order. */
export function changed(config, area, rows, paths) {
  const folders = [config.design.frames, config.design.review].map(escapeRegex).join("|");
  const touched = new Set(
    paths
      .map((path) => path.match(new RegExp(`^(?:${folders})/${escapeRegex(area)}/(?:[a-z0-9-]+/)?([a-z0-9-]+)\\.(?:html|png)$`))?.[1])
      .filter(Boolean),
  );
  return rows.filter((row) => touched.has(row.frame)).map((row) => row.frame);
}

function git(root, args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
}

/** Write each storyboard, or with `check` list the stale ones; returns the exit code. */
export function writeStoryboards(root, config, { check = false } = {}) {
  const tracked = git(root, ["ls-files", "--cached", "--others", "--exclude-standard"]);
  let base = null;
  try {
    base = git(root, ["merge-base", "HEAD", config.design.base])[0];
  } catch {
    // No base branch here, so nothing to compare with.
  }
  const since = base ? [...git(root, ["diff", "--name-only", base]), ...git(root, ["ls-files", "--others", "--exclude-standard"])] : [];
  let stale = 0;
  for (const [area, list] of screenLists(config, tracked)) {
    const text = readFileSync(join(root, list), "utf8");
    const path = storyboardPath(config, area);
    const want = storyboard(config, area, list, text);
    const have = existsSync(join(root, path)) ? readFileSync(join(root, path), "utf8") : null;
    if (check) {
      if (have !== want) {
        stale += 1;
        console.log(`${path}: out of date, run wf design storyboard`);
      }
      continue;
    }
    if (have !== want) writeFileSync(join(root, path), want);
    const review = changed(config, area, frames(text), since);
    if (review.length) console.log(`${area}, to review in this order: ${review.join(", ")}`);
  }
  return check && stale ? 1 : 0;
}
