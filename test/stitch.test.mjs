import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { BESIDE, LEAVE, SCROLLER, STILL } from "../lib/app/page.mjs";
import { runSteps } from "../lib/app/steps.mjs";
import { stitchPage } from "../lib/app/stitch.mjs";
import { sh } from "../lib/process.mjs";

const magick = sh("magick", ["-version"]).ok;

// A page 100x60 whose scrolling box is 140 tall: three windows, the last one
// overlapping the second by 40. box is where the scrolling box stands in the window; beside, the colours left and right of it.
function fakePage({ box = [0, 0, 100, 60], beside = ["rgb(255, 255, 255)", "rgb(255, 255, 255)"] } = {}) {
  const calls = [];
  return {
    calls,
    async evaluate(js) {
      calls.push(js);
      if (js === SCROLLER) return JSON.stringify({ max: 80, step: 60, box });
      if (js === BESIDE) return JSON.stringify(beside);
      if (js.includes("innerWidth, innerHeight")) return "[100,60]";
      if (js === "innerWidth") return "100";
      if (js.includes("location.href")) return JSON.stringify({ url: "tauri://localhost/#/x", text: "x" });
      return "null";
    },
    async call(method) {
      calls.push(method);
      if (method === "Page.captureScreenshot") return { data: (await capture(null, 100, 140)).toString("base64") };
      return {};
    },
  };
}

const colours = ["#f00", "#0f0", "#00f"];
let shots = 0;
const capture = async (_p, w, h) => {
  const out = join(mkdtempSync(join(tmpdir(), "wf-part-")), "p.png");
  sh("magick", ["-size", `${w}x${h}`, `xc:${colours[shots++ % 3]}`, out]);
  return readFileSync(out);
};

// The same keys driver.mjs puts on its driver object, which has no sh: a step
// must not lean on the driver for one.
const driverFor = (root, web) => ({ s: { root, state: join(root, "state"), web }, capture, saveState() {}, loadState: () => ({}) });

for (const web of [false, true]) {
  test(`page joins its shots with the kit's own sh for the ${web ? "web" : "tauri"} kind`, { skip: !magick && "needs ImageMagick" }, async () => {
    const root = mkdtempSync(join(tmpdir(), "wf-stitch-"));
    mkdirSync(join(root, ".cache", "screens", "latest"), { recursive: true });
    const file = ".cache/screens/latest/x-narrow-stress.png";
    const exit = process.exitCode;
    const lines = [];
    const log = console.log;
    console.log = (line) => lines.push(String(line));
    try {
      await runSteps(fakePage(), [`page ${file}`], driverFor(root, web));
    } finally {
      console.log = log;
    }
    const failed = process.exitCode === 1;
    process.exitCode = exit;
    assert.ok(!failed, lines.join("\n"));
    const out = join(root, file);
    assert.ok(existsSync(out), lines.join("\n"));
    assert.equal(sh("magick", ["identify", "-format", "%wx%h", out]).out, "100x140");
    assert.deepEqual(readdirSync(join(root, ".cache", "screens", "latest")), ["x-narrow-stress.png"], "the part files are removed");
    if (!web) assert.match(lines.join("\n"), /\(3 windows\)/);
  });
}

const pixel = (file, x, y) => sh("magick", [file, "-format", `%[hex:p{${x},${y}}]`, "info:"]).out.trim();

test("a box narrower than the window: the picture is the window's width, with the box's neighbours' colour beside the later windows", { skip: !magick && "needs ImageMagick" }, async () => {
  const root = mkdtempSync(join(tmpdir(), "wf-stitch-"));
  const out = join(root, "x.png");
  shots = 0;
  // A sidebar 20 wide on the left, a box 60 wide, and a column 20 wide on the right.
  const page = fakePage({ box: [20, 0, 60, 60], beside: ["rgb(18, 52, 86)", "rgb(171, 205, 239)"] });
  const windows = await stitchPage(page, out, capture);
  assert.equal(windows, 3);
  assert.equal(sh("magick", ["identify", "-format", "%wx%h", out]).out, "100x140", "as wide as the window, not cut at the box's right edge");
  assert.equal(pixel(out, 90, 10), "FF0000", "the first window keeps what is right of the box");
  assert.equal(pixel(out, 5, 90), "123456", "left of a later window is the colour that stood there, not black");
  assert.equal(pixel(out, 50, 90), "00FF00", "the second window's box, at its place across");
  assert.equal(pixel(out, 95, 90), "ABCDEF", "right of a later window is the colour that stood there");
  assert.equal(pixel(out, 50, 130), "0000FF", "the last window, past its overlap");
});

test("what stays put in the window is drawn once: fixed and sticky elements are stilled after the first window, then put back", { skip: !magick && "needs ImageMagick" }, async () => {
  const root = mkdtempSync(join(tmpdir(), "wf-stitch-"));
  const page = fakePage();
  const shotsAt = [];
  const counting = async (p, w, h) => { shotsAt.push(page.calls.length); return capture(p, w, h); };
  await stitchPage(page, join(root, "x.png"), counting);
  const still = page.calls.indexOf(STILL);
  const leave = page.calls.indexOf(LEAVE);
  // shotsAt holds how many calls came before each shot, so a call at that index came after it.
  assert.ok(still >= shotsAt[0] && still < shotsAt[1], "stilled after the first window and before the second");
  assert.ok(leave >= shotsAt.at(-1), "put back after the last");
  assert.equal(page.calls.filter((c) => c === STILL).length, 1);
});

test("the page scripts still only what does not hold the box, and hide a modal's backdrop", () => {
  assert.match(STILL, /e\.contains\(box\)\) continue/);
  assert.match(STILL, /::backdrop\{display:none/);
  assert.match(STILL, /position === 'fixed'|at === 'fixed'/);
  assert.match(STILL, /at === 'sticky'/);
  assert.match(LEAVE, /wf-stitch/);
});
