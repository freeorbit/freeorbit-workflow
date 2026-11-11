// `wf design check`: open design frames at each window size in
// `design.check.sizes` and list what runs past the window or is cut off inside
// its box.
//
//   wf design check                    every frame
//   wf design check gm-move uplink     named frames, areas, or area/section
//
// It opens each frame in headless Chromium and prints one line per problem.
// A box that scrolls on purpose (overflow: auto or scroll) is not a problem,
// and neither is text cut with an ellipsis.

import { pathToFileURL } from "node:url";

import { openChromium } from "../browser/headless.mjs";
import { browserFor } from "../platform.mjs";
import { designPaths, pickFrames } from "./frames.mjs";

// Runs in the page, with `design.check` as its options. Returns one string per problem.
export function findProblems({ page: pageSelector, skip, narrowBelow }) {
  const width = window.innerWidth;
  const out = [];
  const label = (el) => {
    const text = (el.innerText || "").trim().replace(/\s+/g, " ").slice(0, 40);
    const cls = typeof el.className === "string" && el.className ? "." + el.className.split(" ").join(".") : "";
    return `${el.tagName.toLowerCase()}${cls}${text ? ` "${text}"` : ""}`;
  };
  const skipped = (el) => Boolean(skip) && Boolean(el.closest(skip));
  // The page area scrolls up and down. Sideways scrolling there is a problem,
  // so it does not count as a box that scrolls on purpose.
  const page = (p) => (pageSelector && p.matches?.(pageSelector)) || p === document.body || p === document.documentElement;
  if (pageSelector) {
    for (const el of document.querySelectorAll(pageSelector)) {
      if (el.scrollWidth > el.clientWidth + 1) out.push(`the page scrolls sideways by ${el.scrollWidth - el.clientWidth}px`);
    }
  }
  const scrolls = (el) => {
    for (let p = el.parentElement; p && !page(p); p = p.parentElement) {
      const s = getComputedStyle(p);
      if (/(auto|scroll)/.test(s.overflowX) || /(auto|scroll)/.test(s.overflow)) return true;
    }
    return false;
  };
  for (const el of document.querySelectorAll("body *")) {
    const s = getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden" || s.position === "fixed") continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.right > width + 1 && !scrolls(el)) {
      out.push(`past the window by ${Math.round(r.right - width)}px: ${label(el)}`);
      continue;
    }
    const clipsX = /(hidden|clip)/.test(s.overflowX);
    if (clipsX && el.scrollWidth > el.clientWidth + 2 && s.textOverflow !== "ellipsis" && !skipped(el)) {
      out.push(`cut off inside its box: ${label(el)}`);
      continue;
    }
    // A box that hides overflow top to bottom and has more inside than shows.
    // Only below narrowBelow: wide frames may draw a scrolling list as a pane
    // cut at the bottom on purpose, and narrow panes grow instead.
    const clipsY = width < narrowBelow && /(hidden|clip)/.test(s.overflowY);
    if (clipsY && el.scrollHeight > el.clientHeight + 4 && !skipped(el) && !el.matches("body, html")) {
      out.push(`cut off at the bottom: ${label(el)}`);
      continue;
    }
    // A list or panel squeezed to nothing although it has content.
    if (el.children.length > 0 && r.height < 8 && el.scrollHeight > 40) {
      out.push(`squeezed to ${Math.round(r.height)}px high: ${label(el)}`);
    }
  }
  return [...new Set(out)].slice(0, 12);
}

/** Check the frames that match `args`; resolves to the exit code. */
export async function checkFrames(args, paths = designPaths()) {
  const picked = pickFrames(args, paths);
  if (picked.length === 0) {
    console.error("No frames matched.");
    return 2;
  }
  const { sizes, ...options } = paths.config.design.check;
  const browser = await openChromium(paths.root, browserFor(paths.config));
  try {
    let problems = 0;
    for (const frame of picked) {
      for (const [w, h] of sizes) {
        await browser.open(pathToFileURL(frame.html).href, w, h);
        const found = await browser.evaluate(`(${findProblems})(${JSON.stringify(options)})`).catch((error) => {
          throw new Error(`${frame.name} @${w}x${h}: the frame check could not run: ${error.message}`);
        });
        for (const line of found ?? []) {
          problems++;
          console.log(`${frame.name} @${w}x${h}: ${line}`);
        }
      }
    }
    console.log(problems ? `${problems} problems in ${picked.length} frames.` : `No problems in ${picked.length} frames.`);
    return problems ? 1 : 0;
  } finally {
    await browser.close();
  }
}
