// The design plugin's own doc:check and doc:facts lines, for every project
// with screen lists: each frame has its row in its area's screen list and each
// row its frame, a frame sits in its section's folder with its picture beside
// it, and each storyboard matches its list. With design.source png the frames
// are the pictures themselves. The Screens line says how many frames a run
// can reach.

import { existsSync } from "node:fs";
import { join, posix } from "node:path";

import { parseScreens, reachCounts, reachLine } from "../screens/list.mjs";
import { sectionFolder } from "./frames.mjs";
import { frames as framesIn, screenLists, storyboard, storyboardPath } from "./storyboard.mjs";

/** Frames with no row, rows with no frame, a frame outside its section's folder, a missing picture, and a stale storyboard. */
export function frameProblems({ root, config, tracked, files }) {
  const problems = [];
  const pictures = config.design.source === "png";
  const ending = pictures ? ".png" : ".html";
  for (const [area, list] of screenLists(config, tracked)) {
    const top = posix.join(pictures ? config.design.review : config.design.frames, area);
    const paths = tracked.filter((path) => path.startsWith(`${top}/`) && path.endsWith(ending));
    const frames = paths.map((path) => posix.basename(path, ending));
    // Only Frame tables name frames; a "Screen" table lists test states with no frame.
    const listed = framesIn(files(list));
    const rows = listed.map((row) => row.frame);
    for (const frame of new Set(frames)) {
      const twice = paths.filter((path) => posix.basename(path, ending) === frame);
      if (twice.length > 1) problems.push(`${list}: ${frame} is in more than one folder: ${twice.join(", ")}`);
    }
    for (const row of listed) {
      const section = sectionFolder(row.section);
      const path = paths.find((each) => each.endsWith(`/${row.frame}${ending}`));
      if (path && !path.startsWith(`${top}/${section}/`)) {
        // Its picture follows it once it moves, so one problem is enough.
        problems.push(`${path}: belongs in ${top}/${section}/, under its section "${row.section}"`);
        continue;
      }
      const png = posix.join(config.design.review, area, section, `${row.frame}.png`);
      if (!pictures && path && !tracked.includes(png)) problems.push(`${png}: missing, run npx wf design render ${row.frame}`);
    }
    for (const frame of frames) if (!rows.includes(frame)) problems.push(`${list}: no row for ${frame}`);
    for (const row of rows) if (!frames.includes(row)) problems.push(`${list}: no frame ${row}${pictures ? `; export it from the design tool as ${row}.png` : ""}`);
    // A list with no frames yet has no storyboard to keep, and an emptied one keeps its old storyboard until a frame is added.
    if (!rows.length) continue;
    const board = storyboardPath(config, area);
    // A storyboard just written and not yet committed counts, as `wf design storyboard` leaves it.
    const there = tracked.includes(board) || (root && existsSync(join(root, board)));
    if (!there || files(board) !== storyboard(config, area, list, files(list))) problems.push(`${board}: out of date, run npx wf design storyboard`);
  }
  return problems;
}

/** The Screens line: how many frames a run reaches. Unreached frames are a debt each open chunk owns. */
export function screensStatus({ config, tracked, files }) {
  const screens = screenLists(config, tracked).flatMap(([, path]) => parseScreens(files(path), path));
  return screens.length ? [`  Screens: ${reachLine(reachCounts(screens))}`] : [];
}
