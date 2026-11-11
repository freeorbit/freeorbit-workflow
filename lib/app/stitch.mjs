// `page <file>` for the tauri kind: WebKit shoots only the window, so the
// whole page is the window's tallest scrolling box, shot a window at a time
// and joined with ImageMagick, so what is below the fold is seen too.

import { readFileSync, rmSync, writeFileSync } from "node:fs";

import { sleep } from "../process.mjs";
import { SCROLLER, SCROLL_TO } from "./page.mjs";

/** Shoot the page to `out` a window at a time and join the shots. Resolves with how many windows it took. */
export async function stitchPage(p, out, capture, sh) {
  const box = JSON.parse(await p.evaluate(SCROLLER));
  const parts = [];
  let overlap = 0;
  for (let top = 0, i = 0; ; i++) {
    const at = Math.min(top, box.max);
    overlap = top - at;
    await p.evaluate(`(${SCROLL_TO})(${at})`);
    await sleep(150);
    const size = JSON.parse(await p.evaluate("JSON.stringify([innerWidth, innerHeight])"));
    const part = `${out}.part${i}.png`;
    writeFileSync(part, await capture(p, size[0], size[1]));
    parts.push(part);
    if (at >= box.max) break;
    top += box.step;
  }
  await p.evaluate(`(${SCROLL_TO})(0)`);
  // The first window shows the whole screen down to the box's foot. The rest show
  // only the box, so the sidebar and the status bar are not repeated.
  const scale = readFileSync(parts[0]).readUInt32BE(16) / JSON.parse(await p.evaluate("innerWidth"));
  const [x, y, w, h] = box.box.map((n) => Math.round(n * scale));
  const args = [];
  args.push("(", parts[0], "-gravity", "northwest", "-crop", `${x + w}x${y + h}+0+0`, "+repage", ")");
  for (const [i, part] of parts.slice(1).entries()) {
    const chop = i === parts.length - 2 ? Math.round(overlap * scale) : 0;
    args.push("(", part, "-gravity", "northwest", "-crop", `${w}x${h - chop}+${x}+${y + chop}`, "+repage", ")");
  }
  // No date chunks, so the same page always gives the same bytes and the same hash.
  const joined = sh("magick", [...args, "-background", "#000", "-gravity", "east", "-append", "-define", "png:exclude-chunks=date,time", out]);
  for (const part of parts) rmSync(part, { force: true });
  if (!joined.ok) throw new Error(`magick could not join the shots:\n${joined.out}`);
  return parts.length;
}
