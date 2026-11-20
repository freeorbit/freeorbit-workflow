// `wf design render`: each HTML frame to its PNG review copy, through headless
// Chromium's debugging protocol. A frame is drawn as a full page at
// design.size's width: its picture is that wide, and as tall as the page,
// never shorter than design.size's height. The window stays design.size, so
// what sizes itself by the window (100vh, min-height: 100%) lays out as it
// would on that screen; a fixed bar, such as a footer at bottom: 0, sits where
// that window's bottom is, partway down a taller picture. A page area that
// scrolls on its own (design.check.page), or sits in a box that does, is the
// one exception: the window grows by what they hide, so the whole page shows,
// as a design tool's full-page frame does.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative } from "node:path";
import { pathToFileURL } from "node:url";

import { openChromium } from "../browser/headless.mjs";
import { browserFor } from "../config/platform.mjs";
import { pickFrames } from "./frames.mjs";

/** The tallest picture a frame may make, so a page that reports any height cannot make an endless one. */
export const MAX_HEIGHT = 20000;

/**
 * What a loaded page measures, once its fonts are in: the document's height,
 * and the most any page area hides, with what each box around it that
 * scrolls hides too. Run in the page.
 */
const MEASURE = (page) => `document.fonts.ready.then(() => {
  const hides = (el) => {
    const s = getComputedStyle(el);
    return /(auto|scroll|hidden|clip)/.test(s.overflowY) ? Math.max(0, el.scrollHeight - el.clientHeight) : 0;
  };
  let hidden = 0;
  for (const area of document.querySelectorAll(${JSON.stringify(page)})) {
    let sum = 0;
    for (let el = area; el && el !== document.documentElement; el = el.parentElement) sum += el === area ? Math.max(0, area.scrollHeight - area.clientHeight) : hides(el);
    hidden = Math.max(hidden, sum);
  }
  return { doc: document.documentElement.scrollHeight, hidden };
})`;

/** A measurement the page returned, checked: whole numbers, none below zero. */
function measured(value, url) {
  const ok = (n) => Number.isFinite(n) && n >= 0;
  if (!value || !ok(value.doc) || !ok(value.hidden)) throw new Error(`${url} measured as ${JSON.stringify(value)}, not a height`);
  return { doc: Math.ceil(value.doc), hidden: Math.ceil(value.hidden) };
}

/**
 * The height a frame's picture takes at a window `height` tall: the page's,
 * with what its page area hides, and never less than the window.
 */
export const fullHeight = ({ doc, hidden }, height) => Math.max(height, doc + hidden);

/**
 * One frame's picture as PNG bytes, from a browser opened with openChromium.
 * Gives { png, height, clipped }: `clipped` is what a page area still hides
 * after the window grew, when it does not grow with the window.
 */
export async function shoot(browser, url, [width, height], page) {
  await browser.open(url, width, height);
  const first = measured(await browser.evaluate(MEASURE(page)), url);
  let full = fullHeight(first, height);
  let clipped = 0;
  // A page area that scrolls on its own clips what it hides, so the window grows to show it, and the page is measured again.
  if (first.hidden > 0 && full <= MAX_HEIGHT) {
    await browser.command("Emulation.setDeviceMetricsOverride", { width, height: full, deviceScaleFactor: 1, mobile: false });
    const grown = measured(await browser.evaluate(MEASURE(page)), url);
    if (grown.hidden < first.hidden) {
      full = Math.max(full, grown.doc);
      clipped = grown.hidden;
    } else {
      // A page area of a fixed height does not grow with the window: it is shot as it shows, at the window's height, and says what it hides.
      await browser.command("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
      full = fullHeight({ doc: first.doc, hidden: 0 }, height);
      clipped = first.hidden;
    }
  }
  if (full > MAX_HEIGHT) throw new Error(`the page is ${full}px tall, over the ${MAX_HEIGHT}px a frame may be`);
  const { data } = await browser.command("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width, height: full, scale: 1 } });
  return { png: Buffer.from(data, "base64"), height: full, clipped };
}

/**
 * Render the frames these names pick (a frame, an area, or area/section; all
 * of them with none), each to its PNG. Logs a line a frame, `<name>: failed:
 * <why>` for one that failed; resolves to the exit code: 1 when a name picks
 * nothing, the browser does not start, or a frame fails. With design.source
 * png the frames are pictures already, and there is nothing to do.
 */
export async function renderFrames(paths, names, log = console.log) {
  if (paths.config.design.source === "png") return 0;
  for (const name of names) {
    if (!pickFrames([name], paths).length) {
      log(`No frame or area named ${name} under ${relative(paths.root, paths.frames)}`);
      return 1;
    }
  }
  const frames = pickFrames(names, paths);
  if (!frames.length) return 0;
  const { size, check } = paths.config.design;
  const start = () => openChromium(paths.root, browserFor(paths.config));
  let browser;
  try {
    browser = await start();
  } catch (err) {
    log(`render: failed: the browser did not start: ${err.message}`);
    return 1;
  }
  let failed = 0;
  try {
    for (const frame of frames) {
      try {
        const { png, clipped } = await shoot(browser, pathToFileURL(frame.html).href, size, check.page);
        mkdirSync(dirname(frame.png), { recursive: true });
        writeFileSync(frame.png, png);
        log(`${frame.name}: ${relative(paths.root, frame.png)}${clipped ? `; its page area still hides ${clipped}px, since its height does not follow the window` : ""}`);
      } catch (err) {
        failed += 1;
        log(`${frame.name}: failed: ${err.message}`);
        // A frame that hung or failed may still be running in the page, so the next one starts in a fresh browser.
        await browser.close();
        browser = null;
        try {
          browser = await start();
        } catch (again) {
          log(`render: failed: the browser did not start again: ${again.message}`);
          return 1;
        }
      }
    }
  } finally {
    await browser?.close();
  }
  return failed ? 1 : 0;
}
