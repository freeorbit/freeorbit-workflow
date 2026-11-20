// `wf design render`: each HTML frame to its PNG review copy, through headless
// Chromium's debugging protocol. A frame is drawn as a full page at
// design.size's width: its picture is that wide, and as tall as the page,
// never shorter than design.size's height. The window stays design.size, so
// what sizes itself by the window (100vh, min-height: 100%, position: fixed)
// lays out as it would on that screen. A page area that scrolls on its own
// (design.check.page) is the one exception: the window grows by what it hides,
// so the whole page shows, as a design tool's full-page frame does.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative } from "node:path";
import { pathToFileURL } from "node:url";

import { openChromium } from "../browser/headless.mjs";
import { browserFor } from "../config/platform.mjs";
import { pickFrames } from "./frames.mjs";

/**
 * What a loaded page measures, once its fonts are in: the document's height,
 * and how much the page area hides below its own box when it scrolls on its
 * own. Run in the page.
 */
const MEASURE = (page) => `document.fonts.ready.then(() => {
  const area = document.querySelector(${JSON.stringify(page)});
  return { doc: document.documentElement.scrollHeight, hidden: area ? Math.max(0, area.scrollHeight - area.clientHeight) : 0 };
})`;

/**
 * The height a frame's picture takes at a window `height` tall: the page's,
 * with what the page area hides, and never less than the window.
 */
export const fullHeight = ({ doc, hidden }, height) => Math.max(height, doc + hidden);

/** One frame's picture as PNG bytes, from a browser opened with openChromium. */
export async function shoot(browser, url, [width, height], page) {
  await browser.open(url, width, height);
  const measured = await browser.evaluate(MEASURE(page));
  let full = fullHeight(measured, height);
  // A page area that scrolls on its own clips what it hides, so the window grows to show it, and the page is measured again.
  if (measured.hidden > 0) {
    await browser.command("Emulation.setDeviceMetricsOverride", { width, height: full, deviceScaleFactor: 1, mobile: false });
    full = fullHeight(await browser.evaluate(MEASURE(page)), full);
  }
  const { data } = await browser.command("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width, height: full, scale: 1 } });
  return Buffer.from(data, "base64");
}

/**
 * Render the frames these names pick (a frame, an area, or area/section; all
 * of them with none), each to its PNG. Logs a line a frame; resolves to the
 * exit code: 1 when a name picks nothing or a frame fails.
 */
export async function renderFrames(paths, names, log = console.log) {
  for (const name of names) {
    if (!pickFrames([name], paths).length) {
      log(`No frame or area named ${name} under ${relative(paths.root, paths.frames)}`);
      return 1;
    }
  }
  const frames = pickFrames(names, paths);
  if (!frames.length) return 0;
  const { size, check } = paths.config.design;
  const browser = await openChromium(paths.root, browserFor(paths.config));
  let failed = 0;
  try {
    for (const frame of frames) {
      try {
        const png = await shoot(browser, pathToFileURL(frame.html).href, size, check.page);
        mkdirSync(dirname(frame.png), { recursive: true });
        writeFileSync(frame.png, png);
        log(`${frame.name}: ${relative(paths.root, frame.png)}`);
      } catch (err) {
        failed += 1;
        log(`${frame.name}: failed: ${err.message}`);
      }
    }
  } finally {
    await browser.close();
  }
  return failed ? 1 : 0;
}
