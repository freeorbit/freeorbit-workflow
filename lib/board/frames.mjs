// The frame pictures on each story's item, while board.show.frames is on, and
// the built screens on a Built story's item, while board.show.screenshots is
// on (docs/design/board-sync.md). A story shows every frame whose screen-list row
// names it, in screen-list order: the rows of each area's screens.md tables
// headed "Frame", read with the screen check's own parser. A frame's picture
// is <design.review>/<area>/<section>/<frame>.png, found under its area, since
// a section's folder is not its heading.
//
// Each upload is named <frame>.<sha8>.png, the first 8 hex of its sha256, so
// the names on the board say which pictures, in which order, at which
// content: any difference, and sync clears the column and uploads the set.
// A built screen is <design.built>/<area>/<screen>.png, which wf screens
// --accept copies from the run's Default picture. Only a .png inside the
// picture's own folder is ever read, and never through a link.

import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { relative, resolve } from "node:path";

import { parseScreens } from "../screens/list.mjs";

/** A picture's bytes, only from a real .png file inside the review folder. Throws on anything else. */
export function readPicture(root, reviewDir, path) {
  const review = realpathSync(resolve(root, reviewDir));
  const full = resolve(root, path);
  if (!path.endsWith(".png")) throw new Error(`${path} is not a .png`);
  // Outside the folder by its path alone is refused before the file is touched.
  if (relative(resolve(root, reviewDir), full).startsWith("..")) throw new Error(`${path} is outside ${reviewDir}`);
  if (lstatSync(full).isSymbolicLink()) throw new Error(`${path} is a link; frame pictures are read only as files`);
  const real = realpathSync(full);
  if (relative(review, real).startsWith("..")) throw new Error(`${path} is outside ${reviewDir}`);
  return readFileSync(real);
}

/**
 * The pictures each story's item should hold, for one file column: Map of
 * story ID to [{ frame, path, upload, bytes }] in screen-list order, and the
 * notes on pictures that are not uploaded. `rows` picks the screen-list rows,
 * `find(area, row)` the picture's tracked path, `dir` the folder it is read
 * from, and `stories` (a Set, or null for all) which stories it is for.
 */
function wantedPictures({ root, config, tracked, files }, { rows, find, dir, what, stories = null, readBytes }) {
  const present = new Set(tracked);
  const byStory = new Map();
  const notes = [];
  const read = readBytes ?? ((path) => readPicture(root, dir, path));
  for (const area of config.areas.filter((each) => each.docs)) {
    const list = `${area.docs}/${config.design.screens}`;
    if (!present.has(list)) continue;
    for (const row of parseScreens(files(list), list).filter(rows)) {
      const named = row.stories.filter((story) => !stories || stories.has(story));
      if (!named.length) continue;
      const shown = named.join(", ");
      const path = find(area, row);
      if (!path) {
        notes.push(`${what} ${row.name} has no PNG under ${dir.replace(/\/$/, "")}/${area.id}/, so ${shown} show${named.length === 1 ? "s" : ""} the rest`);
        continue;
      }
      let bytes;
      try {
        bytes = read(path);
      } catch (error) {
        notes.push(`${what} ${row.name} is not uploaded: ${error.message}`);
        continue;
      }
      if (bytes.length > config.board.frameMaxBytes) {
        notes.push(`${what} ${row.name} is ${bytes.length} bytes, over board.frameMaxBytes ${config.board.frameMaxBytes}, so it is not uploaded`);
        continue;
      }
      const upload = `${row.name}.${createHash("sha256").update(bytes).digest("hex").slice(0, 8)}.png`;
      for (const story of named) {
        if (!byStory.has(story)) byStory.set(story, []);
        byStory.get(story).push({ frame: row.name, path, upload, bytes });
      }
    }
  }
  return { byStory, notes };
}

/**
 * The frames each story's item should hold: every Frame row naming it, its
 * picture <design.review>/<area>/<section>/<frame>.png. `readBytes(path)`
 * reads a picture; tests pass their own.
 */
export function wantedFrames(context, { readBytes } = {}) {
  const review = context.config.design.review.replace(/\/$/, "");
  return wantedPictures(context, {
    rows: (row) => row.framed && row.stories.length,
    find: (area, row) => context.tracked.find((each) => each.startsWith(`${review}/${area.id}/`) && each.endsWith(`/${row.name}.png`)),
    dir: context.config.design.review,
    what: "frame",
    readBytes,
  });
}

/** The screen-list rows whose built screen an item shows, by board.screenshots.rows. */
export const screenshotRows = (config) => (row) => row.stories.length && (config.board.screenshots.rows === "all" || row.framed);

/** Where wf screens --accept keeps a screen's built picture: <design.built>/<area>/<screen>.png. */
export const builtPath = (config, areaId, name) => `${config.design.built.replace(/\/$/, "")}/${areaId}/${name}.png`;

/**
 * The built screens each Built story's item should hold: every row naming it
 * that board.screenshots.rows picks, its picture <design.built>/<area>/<screen>.png.
 * `built` is the Set of story IDs that are Built; the rest hold none.
 */
export function wantedScreenshots(context, { built, readBytes } = {}) {
  const present = new Set(context.tracked);
  return wantedPictures(context, {
    rows: screenshotRows(context.config),
    find: (area, row) => (present.has(builtPath(context.config, area.id, row.name)) ? builtPath(context.config, area.id, row.name) : null),
    dir: context.config.design.built,
    what: "screen",
    stories: built,
    readBytes,
  });
}

/** The file names a file column's value holds, in order. */
export function fileNames(value) {
  try {
    return (JSON.parse(value ?? "null")?.files ?? []).map((file) => file.name);
  } catch {
    return [];
  }
}

