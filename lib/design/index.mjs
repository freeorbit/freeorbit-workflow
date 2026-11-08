// `wf design <render | check | annotate | storyboard>`: the design module's
// commands, each reading the folders and sizes in `design` in the config.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { KIT_ROOT } from "../ai.mjs";
import { annotate } from "./annotate.mjs";
import { checkFrames } from "./check.mjs";
import { designPaths } from "./frames.mjs";
import { writeStoryboards } from "./storyboard.mjs";

export const RENDER = join(KIT_ROOT, "plugins", "design", "scripts", "render.py");

/** The render.py arguments for these frame names, from the config. */
export function renderArgs(paths, names) {
  const [width, height] = paths.config.design.size;
  return [RENDER, "--root", paths.root, "--frames", paths.frames, "--review", paths.review, "--shared", paths.shared, "--size", `${width}x${height}`, ...names];
}

export async function design([sub, ...args]) {
  const paths = designPaths();
  if (sub === "render") {
    const { status } = spawnSync("python3", ["-I", ...renderArgs(paths, args)], { cwd: paths.root, stdio: "inherit" });
    return status ?? 1;
  }
  if (sub === "check") return checkFrames(args, paths);
  if (sub === "storyboard") return writeStoryboards(paths.root, paths.config, { check: args.includes("--check") });
  if (sub === "annotate" && args[0]) {
    const raw = JSON.parse(args[0] === "-" ? readFileSync(0, "utf8") : readFileSync(args[0], "utf8"));
    const out = await annotate(raw, paths);
    console.log(out);
    // The step most easily missed, so the output says it every time.
    console.log("Next: send the sheet with the question, and open its .html beside it where a browser pane is open.");
    return 0;
  }
  console.log("Usage: wf design render [frame | area | area/section ...]\n       wf design check [frame | area | area/section ...]\n       wf design storyboard [--check]\n       wf design annotate <spec.json | ->");
  return 2;
}
