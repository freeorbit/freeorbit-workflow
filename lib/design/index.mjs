// `wf design <render | check | annotate | storyboard>`: the design module's
// commands, each reading the folders and sizes in `design` in the config.

import { spawnSync } from "node:child_process";
import { closeSync, openSync, readFileSync, readSync } from "node:fs";
import { join } from "node:path";

import { KIT_ROOT } from "../setup/ai.mjs";
import { annotate, annotateForAsk } from "./annotate.mjs";
import { checkFrames } from "./check.mjs";
import { designPaths, pickFrames } from "./frames.mjs";
import { VIEW_DIR, viewAddress } from "../view/view.mjs";
import { startHub } from "../view/hub.mjs";
import { browserFor } from "../config/platform.mjs";
import { writeStoryboards } from "./storyboard.mjs";

export const RENDER = join(KIT_ROOT, "plugins", "design", "scripts", "render.py");

/** The render.py arguments for these frame names, from the config. */
export function renderArgs(paths, names) {
  const [width, height] = paths.config.design.size;
  return [RENDER, "--root", paths.root, "--frames", paths.frames, "--review", paths.review, "--shared", paths.shared, "--size", `${width}x${height}`, "--browser", browserFor(paths.config), ...names];
}

/** The eight bytes every PNG file starts with. */
const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A PNG's width and height, from its header; null when the file is not a PNG. */
export function pngSize(bytes) {
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(SIGNATURE) || bytes.toString("latin1", 12, 16) !== "IHDR") return null;
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

/** A file's first 24 bytes, enough for a PNG's size; empty for a folder or a missing file. */
function header(file) {
  try {
    const fd = openSync(file, "r");
    try {
      const bytes = Buffer.alloc(24);
      return bytes.subarray(0, readSync(fd, bytes, 0, 24, 0));
    } finally {
      closeSync(fd);
    }
  } catch {
    return Buffer.alloc(0);
  }
}

/** With design.source png: each picture is a PNG at design.size. */
export function checkPictures(args, paths, log = console.log) {
  const [width, height] = paths.config.design.size;
  const frames = pickFrames(args, paths);
  if (!frames.length) {
    log(args.length ? `No frame matches ${args.join(", ")}.` : "No frames yet: export them from the design tool into the review folder.");
    return 1;
  }
  let wrong = 0;
  for (const frame of frames) {
    const size = pngSize(header(frame.png));
    if (size && size[0] === width && size[1] === height) continue;
    wrong += 1;
    log(`${frame.area}/${frame.section}/${frame.name}: ${size ? `${size[0]}x${size[1]}` : "not a PNG"}, not design.size ${width}x${height}; export it at 1x, or set design.size`);
  }
  log(wrong ? `${wrong} of ${frames.length} frames to fix.` : `All ${frames.length} frames are ${width}x${height}.`);
  return wrong ? 1 : 0;
}

/** `wf design <render | check | storyboard | annotate> ...`; resolves to the exit code. */
export async function design([sub, ...args]) {
  const paths = designPaths();
  if (sub === "render" && paths.config.design.source === "png") {
    console.log("Frames are pictures exported from the design tool (design.source is png): there is nothing to render.");
    return 0;
  }
  if (sub === "check" && paths.config.design.source === "png") return checkPictures(args, paths);
  if (sub === "render") {
    const { status } = spawnSync("python3", ["-I", ...renderArgs(paths, args)], { cwd: paths.root, stdio: "inherit" });
    return status ?? 1;
  }
  if (sub === "check") return checkFrames(args, paths);
  if (sub === "storyboard") return writeStoryboards(paths.root, paths.config, { check: args.includes("--check") });
  if (sub === "annotate" && args[0] && args.includes("--ask")) {
    const raw = JSON.parse(args[0] === "-" ? readFileSync(0, "utf8") : readFileSync(args[0], "utf8"));
    const { json, parts } = await annotateForAsk(raw, paths);
    console.log(json);
    console.log(`${parts.pairs.length} ${parts.pairs.length === 1 ? "pair" : "pairs"}, ${parts.pictures.length} ${parts.pictures.length === 1 ? "picture" : "pictures"} on ${parts.pairs.length + parts.pictures.length === 1 ? "its" : "their"} own, each with its boxes as data.`);
    console.log("Next: put each pair in a compare template's pairs, or a question's compare as [left, right], and each picture in a question's pictures; the page draws the boxes (the ask-page skill).");
    return 0;
  }
  if (sub === "annotate" && args[0]) {
    const raw = JSON.parse(args[0] === "-" ? readFileSync(0, "utf8") : readFileSync(args[0], "utf8"));
    const out = await annotate(raw, paths);
    console.log(out);
    // The step most easily missed, so the output says it every time.
    const address = viewAddress(paths.root, out.replace(/\.png$/, ".html"));
    if (address) await startHub(paths.root);
    console.log(
      address
        ? `Next: open ${address} in the browser pane to ask in the chat. For an ask page, run it again with --ask: each picture on its own, with its boxes as data.`
        : `Next: send the sheet with the question. Write it under ${VIEW_DIR} to open it from the question-pictures server in a browser pane.`,
    );
    return 0;
  }
  console.log("Usage: wf design render [frame | area | area/section ...]\n       wf design check [frame | area | area/section ...]\n       wf design storyboard [--check]\n       wf design annotate <spec.json | -> [--ask]");
  return 2;
}
