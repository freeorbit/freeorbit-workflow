// The design renderer and checker in a real browser: frames are drawn as full
// pages at design.size's width, and the checker leaves content below the fold
// alone. Chromium is found as the design tools find it; without one the tests
// fail, as the kit's design checks would.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
import { fullHeight, renderFrames, shoot } from "../lib/design/render.mjs";

const root = mkdtempSync(join(tmpdir(), "wf-render-"));
const config = merge(DEFAULTS, { design: { size: [1440, 900] } });
const paths = designPaths(root, config);
let browser;
before(async () => {
  browser = await openChromium(root, browserFor(config));
});
after(async () => {
  await browser?.close();
  rmSync(root, { recursive: true, force: true });
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
  const hero = await shoot(browser, frame("hero", '<div style="min-height:100vh;background:#008000"></div><div style="height:800px;background:#ff0000"></div>'), [1440, 900], ".content");
  assert.deepEqual(pngSize(hero), [1440, 1700]);
  assert.deepEqual([await pixel(hero, 10, 880), await pixel(hero, 10, 950)], ["#008000", "#ff0000"]);
  // A sign-in page at min-height: 100vh is not stretched.
  assert.deepEqual(pngSize(await shoot(browser, frame("sign-in", '<div style="min-height:100vh;background:#008000"></div>'), [1440, 900], ".content")), [1440, 900]);
  // An app shell whose page area scrolls: the header and every row of the page.
  const shell = await shoot(
    browser,
    frame("shell", '<header style="height:60px;background:#333333;flex:none"></header><main class="content" style="flex:1;overflow:auto"><div style="height:1720px;background:#0000ff"></div><div style="height:20px;background:#ff00ff"></div></main>', "body { height: 100vh; display: flex; flex-direction: column; overflow: hidden; }"),
    [1440, 900],
    ".content",
  );
  assert.deepEqual(pngSize(shell), [1440, 1800]);
  assert.deepEqual([await pixel(shell, 10, 30), await pixel(shell, 10, 1790)], ["#333333", "#ff00ff"], "the last row of the page area shows");
  assert.equal(fullHeight({ doc: 900, hidden: 0 }, 900), 900);
});

test("the checker does not count a page's content below the window as a problem", async () => {
  await browser.open(frame("tall", '<main class="content"><div style="height:1720px;background:#eeeeee">rows</div></main>'), 1440, 900);
  assert.deepEqual(await browser.evaluate(`(${findProblems.toString()})(${JSON.stringify(config.design.check)})`), []);
});
