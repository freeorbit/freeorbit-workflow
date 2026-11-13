import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { SCROLLER } from "../lib/app/page.mjs";
import { runSteps } from "../lib/app/steps.mjs";
import { sh } from "../lib/process.mjs";

const magick = sh("magick", ["-version"]).ok;

// A page 100x60 whose scrolling box is 140 tall: three windows, the last one
// overlapping the second by 40.
function fakePage() {
  const calls = [];
  return {
    calls,
    async evaluate(js) {
      calls.push(js);
      if (js === SCROLLER) return JSON.stringify({ max: 80, step: 60, box: [0, 0, 100, 60] });
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
