// Where each design frame and its picture live. A frame is
// <frames>/<area>/<section>/<frame>.html, and its picture is the same path
// under <review>/ with .png, both from `design` in the project's config. The
// section folder is its screen-list heading as a slug, so tools find a frame
// by name and need not know its section. With design.source "png", a frame is
// only its picture, exported from a design tool such as Figma, and has no HTML.

import { readdirSync } from "node:fs";
import { join } from "node:path";

import { loadConfig, projectRoot } from "../config.mjs";

/** The project's frame folders as absolute paths, from its config. */
export function designPaths(root = projectRoot(), config = loadConfig(root)) {
  const { frames, review, shared } = config.design;
  return { root, config, frames: join(root, frames), review: join(root, review), shared };
}

/** A section heading as its folder name, such as "Ask and send" to "ask-and-send". */
export function sectionFolder(heading) {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function folders(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  } catch {
    return [];
  }
}

/** Every frame, by area then section then name, with its HTML and picture paths. */
export function frameFiles(paths = designPaths()) {
  const { frames, review, shared } = paths;
  if (paths.config.design.source === "png") return pictureFrames(review);
  const out = [];
  for (const area of folders(frames).filter((entry) => entry.name !== shared)) {
    for (const section of folders(join(frames, area.name))) {
      for (const file of readdirSync(join(frames, area.name, section.name))) {
        if (!file.endsWith(".html")) continue;
        const name = file.slice(0, -".html".length);
        out.push({
          area: area.name,
          section: section.name,
          name,
          html: join(frames, area.name, section.name, file),
          png: join(review, area.name, section.name, `${name}.png`),
        });
      }
    }
  }
  return out.sort((a, b) => a.html.localeCompare(b.html));
}

/** Every frame drawn in a design tool, by its exported picture alone. */
function pictureFrames(review) {
  const out = [];
  for (const area of folders(review)) {
    for (const section of folders(join(review, area.name))) {
      for (const file of readdirSync(join(review, area.name, section.name))) {
        if (!file.endsWith(".png")) continue;
        out.push({ area: area.name, section: section.name, name: file.slice(0, -".png".length), html: null, png: join(review, area.name, section.name, file) });
      }
    }
  }
  return out.sort((a, b) => a.png.localeCompare(b.png));
}

/** One frame by name, or null. */
export function findFrame(name, paths = designPaths()) {
  return frameFiles(paths).find((frame) => frame.name === name) ?? null;
}

/** The frames that match names, areas, or area/section; every frame when none is given. */
export function pickFrames(args, paths = designPaths()) {
  const all = frameFiles(paths);
  if (args.length === 0) return all;
  return all.filter((f) => args.includes(f.name) || args.includes(f.area) || args.includes(`${f.area}/${f.section}`));
}
