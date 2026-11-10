// The frame pictures on each story's item, while board.show.frames is on
// (docs/design/board-sync.md). A story shows every frame whose screen-list row
// names it, in screen-list order: the rows of each area's screens.md tables
// headed "Frame", read with the screen check's own parser. A frame's picture
// is <design.review>/<area>/<section>/<frame>.png, found under its area, since
// a section's folder is not its heading.
//
// Each upload is named <frame>.<sha8>.png, the first 8 hex of its sha256, so
// the names on the board say which pictures, in which order, at which
// content: any difference, and sync clears the column and uploads the set.
// Only a .png inside design.review is ever read, and never through a link.

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
 * The frames each story's item should hold: Map of story ID to
 * [{ frame, path, upload, bytes }], and the notes on frames that are not
 * uploaded. `readBytes(path)` reads a picture; tests pass their own.
 */
export function wantedFrames({ root, config, tracked, files }, { readBytes = (path) => readPicture(root, config.design.review, path) } = {}) {
  const present = new Set(tracked);
  const byStory = new Map();
  const notes = [];
  const review = config.design.review.replace(/\/$/, "");
  for (const area of config.areas.filter((each) => each.docs)) {
    const list = `${area.docs}/${config.design.screens}`;
    if (!present.has(list)) continue;
    for (const row of parseScreens(files(list), list).filter((each) => each.framed && each.stories.length)) {
      const path = tracked.find((each) => each.startsWith(`${review}/${area.id}/`) && each.endsWith(`/${row.name}.png`));
      const shown = row.stories.join(", ");
      if (!path) {
        notes.push(`frame ${row.name} has no PNG under ${review}/${area.id}/, so ${shown} show${row.stories.length === 1 ? "s" : ""} the rest`);
        continue;
      }
      let bytes;
      try {
        bytes = readBytes(path);
      } catch (error) {
        notes.push(`frame ${row.name} is not uploaded: ${error.message}`);
        continue;
      }
      if (bytes.length > config.board.frameMaxBytes) {
        notes.push(`frame ${row.name} is ${bytes.length} bytes, over board.frameMaxBytes ${config.board.frameMaxBytes}, so it is not uploaded`);
        continue;
      }
      const upload = `${row.name}.${createHash("sha256").update(bytes).digest("hex").slice(0, 8)}.png`;
      for (const story of row.stories) {
        if (!byStory.has(story)) byStory.set(story, []);
        byStory.get(story).push({ frame: row.name, path, upload, bytes });
      }
    }
  }
  return { byStory, notes };
}

/** The file names a file column's value holds, in order. */
export function fileNames(value) {
  try {
    return (JSON.parse(value ?? "null")?.files ?? []).map((file) => file.name);
  } catch {
    return [];
  }
}

