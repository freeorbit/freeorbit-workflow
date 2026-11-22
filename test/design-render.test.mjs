// The design renderer and checker in a real browser: frames are drawn as full
// pages at design.size's width, and the checker leaves content below the fold
// alone. Chromium is found as the design tools find it; without one the tests
// fail, as the kit's design checks would.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { pathToFileURL } from "node:url";

import { openChromium } from "../lib/browser/headless.mjs";
import { merge } from "../lib/config/config.mjs";
import { DEFAULTS } from "../lib/config/defaults.mjs";
import { browserFor } from "../lib/config/platform.mjs";
import { findProblems } from "../lib/design/check.mjs";
import { designPaths } from "../lib/design/frames.mjs";
import { pngSize } from "../lib/design/index.mjs";
import { fullHeight, MAX_HEIGHT, renderFrames, shoot } from "../lib/design/render.mjs";
import { frameInWindow } from "../lib/screens/run.mjs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const root = mkdtempSync(join(tmpdir(), "wf-render-"));
const config = merge(DEFAULTS, { design: { size: [1440, 900] } });
const paths = designPaths(root, config);
let browser;
before(async () => {
  browser = await openChromium(root, browserFor(config));
});
after(async () => {
  await browser?.close();
  // Chromium's helpers can still be writing as they exit; rmSync's retries leave the folder behind, rm's wait it out.
  await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

/** A frame under the frames folder, as <area>/<section>/<name>.html. */
function frame(name, body, style = "") {
  const file = join(paths.frames, "app", "reviews", `${name}.html`);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, `<!doctype html><html><head><style>body { margin: 0; } ${style}</style></head><body>${body}</body></html>`);
  return pathToFileURL(file).href;
}
const sizeOf = (name) => pngSize(readFileSync(join(paths.review, "app", "reviews", `${name}.png`)));
/** The colour of one pixel of a PNG, as #rrggbb, read back in the browser. */
async function pixel(png, x, y) {
  return browser.evaluate(`new Promise((done) => {
    const img = new Image();
    img.onload = () => { const c = document.createElement("canvas"); c.width = img.width; c.height = img.height; const g = c.getContext("2d"); g.drawImage(img, 0, 0); done("#" + [...g.getImageData(${x}, ${y}, 1, 1).data.slice(0, 3)].map((n) => n.toString(16).padStart(2, "0")).join("")); };
    img.src = "data:image/png;base64,${png.toString("base64")}";
  })`);
}

test("a frame is drawn as a full page at design.size's width, never shorter than its height", async () => {
  frame("reviews", '<div style="height:968px;background:#ff0000"></div>');
  frame("short", '<div style="height:300px;background:#00ff00"></div>');
  const lines = [];
  assert.equal(await renderFrames(paths, ["reviews", "short"], (line) => lines.push(line)), 0);
  assert.deepEqual(sizeOf("reviews"), [1440, 968], "the content's 968px, not the window's 900");
  assert.deepEqual(sizeOf("short"), [1440, 900], "a short frame keeps the window's height");
  assert.match(lines.join("\n"), /reviews: docs\/design\/review\/app\/reviews\/reviews\.png/);
  assert.equal(await renderFrames(paths, ["nothing"], (line) => lines.push(line)), 1);
  assert.match(lines.at(-1), /No frame or area named nothing/);
});

test("what sizes itself by the window keeps the window's height; a page area that scrolls on its own shows whole", async () => {
  // A hero as tall as the window, and more below it: the hero stays 900px.
  const { png: hero } = await shoot(browser, frame("hero", '<div style="min-height:100vh;background:#008000"></div><div style="height:800px;background:#ff0000"></div>'), [1440, 900], ".content");
  assert.deepEqual(pngSize(hero), [1440, 1700]);
  assert.deepEqual([await pixel(hero, 10, 880), await pixel(hero, 10, 950)], ["#008000", "#ff0000"]);
  // A sign-in page at min-height: 100vh is not stretched.
  assert.deepEqual(pngSize((await shoot(browser, frame("sign-in", '<div style="min-height:100vh;background:#008000"></div>'), [1440, 900], ".content")).png), [1440, 900]);
  // An app shell whose page area scrolls: the header and every row of the page.
  const { png: shell, clipped } = await shoot(
    browser,
    frame("shell", '<header style="height:60px;background:#333333;flex:none"></header><main class="content" style="flex:1;overflow:auto"><div style="height:1720px;background:#0000ff"></div><div style="height:20px;background:#ff00ff"></div></main>', "body { height: 100vh; display: flex; flex-direction: column; overflow: hidden; }"),
    [1440, 900],
    ".content",
  );
  assert.deepEqual(pngSize(shell), [1440, 1800]);
  assert.deepEqual([await pixel(shell, 10, 30), await pixel(shell, 10, 1790)], ["#333333", "#ff00ff"], "the last row of the page area shows");
  assert.equal(clipped, 0);
  assert.equal(fullHeight({ doc: 900, hidden: 0 }, 900), 900);
});

test("the checker does not count a page's content below the window as a problem", async () => {
  await browser.open(frame("tall", '<main class="content"><div style="height:1720px;background:#eeeeee">rows</div></main>'), 1440, 900);
  assert.deepEqual(await browser.evaluate(`(${findProblems.toString()})(${JSON.stringify(config.design.check)})`), []);
});

test("a page area inside a box that scrolls shows whole; one of a fixed height is shot as it shows, and says what it hides", async () => {
  // The page area does not scroll; the box around it does.
  const nested = await shoot(
    browser,
    frame("nested", '<div class="wrap" style="height:100vh;overflow:auto"><main class="content"><div style="height:2000px;background:#0000ff"></div></main></div>', "body { overflow: hidden; }"),
    [1440, 900],
    ".content",
  );
  assert.deepEqual([pngSize(nested.png), nested.clipped], [[1440, 2000], 0]);
  // A 500px page area does not follow the window: no blank picture, and the hidden rows are counted.
  const fixed = await shoot(browser, frame("fixed", '<header style="height:60px"></header><main class="content" style="height:500px;overflow:auto"><div style="height:2000px"></div></main>'), [1440, 900], ".content");
  assert.deepEqual([pngSize(fixed.png), fixed.clipped], [[1440, 900], 1500]);
});

test("a frame taller than a frame may be fails on its own, and the frames after it still render", async () => {
  frame("endless", `<div style="height:${MAX_HEIGHT + 1000}px"></div>`);
  frame("after", '<div style="height:100px"></div>');
  const lines = [];
  assert.equal(await renderFrames(paths, ["endless", "after"], (line) => lines.push(line)), 1);
  assert.match(lines.join("\n"), new RegExp(`endless: failed: the page is \\d+px tall, over the ${MAX_HEIGHT}px a frame may be`));
  assert.deepEqual(sizeOf("after"), [1440, 900]);
});

test("a browser that does not start fails the render with a line, and exported pictures have nothing to render", async () => {
  const lines = [];
  const broken = designPaths(root, merge(config, { design: { browser: "no-such-browser-wf" } }));
  assert.equal(await renderFrames(broken, ["after"], (line) => lines.push(line)), 1);
  assert.match(lines.join("\n"), /render: failed: the browser did not start/);
  assert.equal(await renderFrames(designPaths(root, merge(config, { design: { source: "png" } })), []), 0);
});

const magick = spawnSync("magick", ["-version"]).status === 0;
test("the screen review pairs the app's window shot with the frame's top, and the same frame always hashes the same", { skip: !magick && "needs ImageMagick" }, async () => {
  const latest = join(root, "latest");
  mkdirSync(latest, { recursive: true });
  const ctx = { latest, config };
  const tall = join(latest, "tall.png");
  writeFileSync(tall, (await shoot(browser, frame("tall-frame", '<div style="height:1720px;background:#ff0000"></div>'), [1440, 900], ".content")).png);
  const app = join(latest, "app.png");
  spawnSync("magick", ["-size", "1440x800", "xc:white", app]);
  const hash = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
  const top = frameInWindow(ctx, "tall", tall, app);
  assert.deepEqual(pngSize(readFileSync(top)), [1440, 800], "as tall as the app's own picture");
  const first = hash(top);
  await new Promise((r) => setTimeout(r, 1100));
  writeFileSync(tall, readFileSync(tall));
  assert.equal(hash(frameInWindow(ctx, "tall", tall, app)), first, "no date in the crop, so it hashes the same");
  assert.deepEqual(pngSize(readFileSync(frameInWindow(ctx, "tall", tall, null))), [1440, 900], "with no app picture, design.size's height");
  const short = join(latest, "short.png");
  spawnSync("magick", ["-size", "1440x600", "xc:white", short]);
  assert.equal(frameInWindow(ctx, "short", short, app), short, "a frame no taller is used as it is");
});
