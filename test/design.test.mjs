import assert from "node:assert/strict";
import { test } from "node:test";

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { merge } from "../lib/config.mjs";
import { DEFAULTS } from "../lib/defaults.mjs";
import { boxArgs, checkSpec, fit, indexHtml, KIT_KINDS as KINDS, kindsFor, legend, viewerHtml } from "../lib/design/annotate.mjs";
import { designPaths, findFrame, frameFiles, pickFrames, sectionFolder } from "../lib/design/frames.mjs";
import { renderArgs } from "../lib/design/index.mjs";
import { changed, frames, grid, picture, screenLists, storyboard } from "../lib/design/storyboard.mjs";

const config = (design = {}, more = {}) => merge(DEFAULTS, { design, ...more });

test("a spec gets labels, numbers, and the look kind by default", () => {
  const spec = checkSpec({ pictures: [{ frame: "gm-accounts", boxes: [{ selector: ".task-tabs" }] }, { image: "x.png" }] });
  assert.equal(spec.out, ".cache/view/sheet.png");
  assert.deepEqual(spec.pictures.map((p) => p.label), ["A", "B"]);
  assert.deepEqual(spec.pictures[0].boxes[0], { n: 1, kind: "look", rect: undefined, selector: ".task-tabs", text: undefined, nth: 0 });
  assert.equal(spec.pictures[0].name, "gm-accounts");
});

test("a spec that cannot be drawn says what is wrong", () => {
  const bad = [
    [{}, /list of pictures/],
    [{ pictures: [{ label: "A", frame: "f" }, { label: "A", frame: "g" }] }, /Two pictures are labelled A/],
    [{ pictures: [{ frame: "f", image: "x.png" }] }, /a frame or an image/],
    [{ pictures: [{ frame: "f", boxes: [{ kind: "oops", rect: [0, 0, 1, 1] }] }] }, /kind "oops"/],
    [{ pictures: [{ frame: "f", boxes: [{ rect: [0, 0, 1] }] }] }, /four numbers/],
    [{ pictures: [{ frame: "f", boxes: [{}] }] }, /a selector or a rect/],
    [{ pictures: [{ image: "x.png", boxes: [{ selector: ".a" }] }] }, /screenshot, so its boxes are rects/],
  ];
  for (const [spec, message] of bad) assert.throws(() => checkSpec(spec), message);
});

test("a box is padded and kept inside the picture", () => {
  assert.deepEqual(fit([100, 50, 200, 30], 1280, 800), [96, 46, 304, 84]);
  assert.deepEqual(fit([0, 0, 1280, 800], 1280, 800), [2, 2, 1277, 797]);
});

test("each kind draws in its own colour, thin, with its number", () => {
  const args = boxArgs([{ n: 1, kind: "bug", rect: [10, 10, 50, 20] }, { n: 12, kind: "drift", rect: [100, 100, 50, 20] }], 1280, 800);
  assert.ok(args.includes(KINDS.bug.color) && args.includes(KINDS.drift.color));
  assert.equal(args[args.indexOf("-strokewidth") + 1], "2");
  assert.ok(args.includes("1") && args.includes("12"));
});

test("the legend lists only the kinds used, in a fixed order", () => {
  assert.deepEqual(legend([{ kind: "ok" }, { kind: "bug" }, { kind: "bug" }]), ["bug", "ok"]);
});

// A kind keeps its colour and word for good. A new kind adds its line here.
const FIXED = {
  look: ["#3b82f6", "look here"],
  bug: ["#ef4444", "bug"],
  drift: ["#f59e0b", "drift"],
  ok: ["#22c55e", "fine"],
  new: ["#a855f7", "new or changed"],
};

test("every kind keeps its colour and word, and each colour is one kind's", () => {
  assert.deepEqual(Object.keys(KINDS), Object.keys(FIXED), "a kind was added, removed, or moved; add new kinds at the end, and to FIXED");
  for (const [kind, [color, word]] of Object.entries(FIXED)) {
    assert.equal(KINDS[kind].color, color, kind);
    assert.equal(KINDS[kind].word, word, kind);
    assert.ok(KINDS[kind].use, `${kind} says when to use it`);
  }
  const colors = Object.values(KINDS).map((k) => k.color.toLowerCase());
  assert.equal(new Set(colors).size, colors.length, "two kinds share a colour");
});

test("a project adds its own kinds after the kit's, and may not change one", () => {
  const extra = { pin: { color: "#14b8a6", word: "pinned", use: "A value fixed on purpose." } };
  assert.deepEqual(Object.keys(kindsFor(config({ kinds: extra }))), [...Object.keys(KINDS), "pin"]);
  assert.throws(() => kindsFor(config({ kinds: { bug: { color: "#000001", word: "b", use: "u" } } })), /already has a kind named bug/);
  assert.throws(() => kindsFor(config({ kinds: { mine: { color: "#EF4444", word: "m", use: "u" } } })), /already the colour of bug/);
  assert.throws(() => kindsFor(config({ kinds: { mine: { color: "#000001" } } })), /a color, a word, and a use/);
  assert.equal(checkSpec({ pictures: [{ image: "x.png", boxes: [{ kind: "pin", rect: [0, 0, 1, 1] }] }] }, kindsFor(config({ kinds: extra }))).pictures[0].boxes[0].kind, "pin");
});

test("the server's root sends the pane on to the newest sheet", () => {
  const page = indexHtml("question sheet.html");
  assert.match(page, /http-equiv="refresh" content="0; url=question%20sheet\.html"/);
  assert.match(page, /<a href="question%20sheet\.html">/);
});

test("the pane's page puts the pictures two to a row, in order", () => {
  const page = viewerHtml(
    [{ label: "A", name: "gm-accounts" }, { label: "B", name: "the app" }],
    ["/x/sheet-A.png", "/x/sheet-B.png"],
  );
  assert.match(page, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.ok(page.indexOf("sheet-A.png") < page.indexOf("sheet-B.png"));
  assert.match(page, /alt="A gm-accounts"/);
});

const LIST = [
  "# Demo screens",
  "",
  "## Start",
  "",
  "| Frame | Stories | What it shows |",
  "| --- | --- | --- |",
  "| `d-start` | D-01 | Nothing yet. |",
  "",
  "## Later",
  "",
  "| Frame | Stories | What it shows |",
  "| --- | --- | --- |",
  "| `d-later` | D-02, D-03 | A | B. |",
].join("\n");

const AREAS = { areas: [{ id: "app", prefix: "APP", docs: "docs/app" }, { id: "demo", prefix: "D", docs: "docs/plugins/demo" }, { id: "none", prefix: "N" }] };

test("screen lists are each area's, under its docs folder, when tracked", () => {
  const tracked = ["docs/app/design/screens.md", "docs/plugins/demo/design/screens.md", "docs/plugins/demo/overview.md"];
  assert.deepEqual(screenLists(config({}, AREAS), tracked), [
    ["app", "docs/app/design/screens.md"],
    ["demo", "docs/plugins/demo/design/screens.md"],
  ]);
  assert.deepEqual(screenLists(config({ screens: "screens.md" }, AREAS), ["docs/app/screens.md"]), [["app", "docs/app/screens.md"]]);
});

test("a caption split with <br>• bullets reads as a lead and nested items", async () => {
  const { captionLines } = await import("../lib/design/storyboard.mjs");
  assert.deepEqual(captionLines("Dialog over the catalog.<br>• Keep my data<br>• Cancel, or Uninstall"), ["Dialog over the catalog.", "Keep my data", "Cancel, or Uninstall"]);
  const list = "## One\n\n| Frame | Stories | What it shows |\n| --- | --- | --- |\n| `d-x` | D-01 | Lead.<br>• First<br>• Second |\n";
  const text = storyboard(config(), "demo", "docs/plugins/demo/design/screens.md", list);
  assert.match(text, /^1\. \*\*d-x\*\* \(D-01\)\. Lead\.\n {3}- First\n {3}- Second$/m);
});

test("frames keep their order and the heading above them", () => {
  assert.deepEqual(
    frames(LIST).map((row) => [row.frame, row.section, row.caption]),
    [
      ["d-start", "Start", "Nothing yet."],
      ["d-later", "Later", "A | B."],
    ],
  );
});

test("a Reach column between the stories and the caption is skipped", () => {
  const list = "## Wait\n\n| Frame | Stories | Reach | What it shows |\n| --- | --- | --- | --- |\n| `d-wait` | D-02 | `d-scenario › go #/x` | Waiting. |\n";
  assert.deepEqual(frames(list).map((row) => [row.frame, row.stories, row.caption]), [["d-wait", "D-02", "Waiting."]]);
});

test("a table of screens with no frame gives no pictures", () => {
  const list = "## Wait\n\n| Frame | Stories | What it shows |\n| --- | --- | --- |\n| `d-wait` | D-02 | Waiting. |\n\n## Screens with no frame\n\n| Screen | Reach | Why no frame |\n| --- | --- | --- |\n| `d-fresh` | `d-fresh › go #/catalog` | Fresh. |\n";
  assert.deepEqual(frames(list).map((row) => row.frame), ["d-wait"]);
});

test("a storyboard numbers the frames under their headings", () => {
  const text = storyboard(config(), "demo", "docs/plugins/demo/design/screens.md", LIST);
  assert.match(text, /^# Demo screens: storyboard$/m);
  assert.match(text, /\(\.\.\/\.\.\/\.\.\/plugins\/demo\/design\/screens\.md\)/);
  assert.match(text, /## Start\n\n<table>\n<tr>\n<td [^>]*><a href="start\/d-start\.png"><img src="start\/d-start\.png" alt="d-start" width="100%"><\/a><br><b>1\. d-start<\/b><br>D-01<\/td>\n<\/tr>\n<\/table>/);
  assert.match(text, /^1\. \*\*d-start\*\* \(D-01\)\. Nothing yet\.$/m);
  assert.match(text, /^Contents: \[Start\]\(#start\) \(1\) · \[Later\]\(#later\) \(1\)$/m);
  assert.match(text, /## Later\n\n<table>[\s\S]*<b>2\. d-later<\/b>/);
});

test("frames to review follow the story order, from HTML or PNG changes", () => {
  const paths = ["docs/design/review/demo/later/d-later.png", "docs/design/frames/demo/start/d-start.html", "docs/design/frames/other/start/d-start.html"];
  assert.deepEqual(changed(config(), "demo", frames(LIST), paths), ["d-start", "d-later"]);
  assert.deepEqual(changed(config(), "demo", frames(LIST), ["docs/design/frames/shared/frame.css"]), []);
  assert.deepEqual(changed(config({ frames: "design/f", review: "design/r" }), "demo", frames(LIST), ["design/f/demo/start/d-start.html", ...paths]), ["d-start"]);
});

test("the grid puts two frames in a row", () => {
  const rows = Array.from({ length: 5 }, (_, i) => ({ frame: `f-${i}`, stories: "D-01", n: i + 1 }));
  const lines = grid(rows);
  assert.equal(lines.filter((line) => line === "<tr>").length, 3);
  assert.equal(lines.filter((line) => line.startsWith("<td")).length, 5);
});

test("a section heading becomes its folder name", () => {
  assert.equal(sectionFolder("Ask and send"), "ask-and-send");
  assert.equal(sectionFolder("Hand-over"), "hand-over");
  assert.equal(picture({ frame: "d-start", section: "With the assistant" }), "with-the-assistant/d-start.png");
  assert.equal(picture({ frame: "d-start", section: "" }), "d-start.png");
});

test("frames are found by name in their area's section folders, from the config's folders", () => {
  const root = mkdtempSync(join(tmpdir(), "frames-"));
  for (const path of ["docs/design/frames/demo/start/d-start.html", "docs/design/frames/demo/later/d-later.html", "docs/design/frames/shared/frame.css", "docs/design/frames/shared/x/shared.html"]) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), "");
  }
  const paths = designPaths(root, config());
  assert.deepEqual(frameFiles(paths).map((frame) => [frame.area, frame.section, frame.name]), [["demo", "later", "d-later"], ["demo", "start", "d-start"]]);
  assert.equal(findFrame("d-start", paths).png, join(root, "docs/design/review/demo/start/d-start.png"));
  assert.equal(findFrame("d-none", paths), null);
  assert.deepEqual(pickFrames(["demo/start"], paths).map((f) => f.name), ["d-start"]);
  assert.deepEqual(pickFrames(["d-later", "nothing"], paths).map((f) => f.name), ["d-later"]);
  const other = designPaths(root, config({ frames: "art", review: "art-png", shared: "common" }));
  assert.deepEqual(frameFiles(other), []);
});

test("render gets the folders and window size from the config", () => {
  const args = renderArgs(designPaths("/p", config({ size: [1440, 900] })), ["d-start"]);
  assert.deepEqual(args.slice(1), ["--root", "/p", "--frames", "/p/docs/design/frames", "--review", "/p/docs/design/review", "--shared", "shared", "--size", "1440x900", "d-start"]);
  assert.match(args[0], /plugins\/design\/scripts\/render\.py$/);
});

test("with design.source png, frames are the exported pictures, and render and check have nothing to do", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { merge } = await import("../lib/config.mjs");
  const { DEFAULTS } = await import("../lib/defaults.mjs");
  const { designPaths, frameFiles, findFrame } = await import("../lib/design/frames.mjs");
  const root = mkdtempSync(join(tmpdir(), "wf-png-"));
  mkdirSync(join(root, "docs/design/review/review/control-review"), { recursive: true });
  writeFileSync(join(root, "docs/design/review/review/control-review/controls.png"), "x");
  writeFileSync(join(root, "docs/design/review/review/control-review/notes.txt"), "x");
  const paths = designPaths(root, merge(DEFAULTS, { design: { source: "png" } }));
  assert.deepEqual(frameFiles(paths).map((f) => [f.area, f.section, f.name, f.html]), [["review", "control-review", "controls", null]]);
  assert.equal(findFrame("controls", paths).png, join(root, "docs/design/review/review/control-review/controls.png"));
  assert.deepEqual(frameFiles(designPaths(root, merge(DEFAULTS, {}))), []);
});

test("with design.source png, render has nothing to do, and check holds each picture to design.size", async () => {
  const { spawnSync } = await import("node:child_process");
  const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const root = mkdtempSync(join(tmpdir(), "wf-png-cli-"));
  spawnSync("git", ["init", "-q"], { cwd: root });
  mkdirSync(join(root, ".workflow"));
  writeFileSync(join(root, ".workflow/config.json"), JSON.stringify({ design: { source: "png", size: [1440, 960] } }));
  const png = (w, h) => {
    const b = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b);
    b.write("IHDR", 12, "latin1");
    b.writeUInt32BE(w, 16);
    b.writeUInt32BE(h, 20);
    return b;
  };
  mkdirSync(join(root, "docs/design/review/app/sign-in"), { recursive: true });
  writeFileSync(join(root, "docs/design/review/app/sign-in/sign-in.png"), png(1440, 960));
  const wf = new URL("../bin/wf.mjs", import.meta.url).pathname;
  const run = (sub, ...more) => spawnSync(process.execPath, [wf, "design", sub, ...more], { cwd: root, encoding: "utf8" });
  assert.match(run("render").stdout, /nothing to render/);
  assert.match(run("check", "nope").stdout, /No frame matches nope/);
  assert.equal(run("check").status, 0);
  writeFileSync(join(root, "docs/design/review/app/sign-in/invite.png"), png(2880, 1920));
  const wrong = run("check");
  assert.equal(wrong.status, 1);
  assert.match(wrong.stdout, /app\/sign-in\/invite: 2880x1920, not design.size 1440x960; export it at 1x/);
  writeFileSync(join(root, "docs/design/review/app/sign-in/invite.png"), "not a picture");
  mkdirSync(join(root, "docs/design/review/app/sign-in/folder.png"));
  const bad = run("check").stdout;
  assert.match(bad, /invite: not a PNG/);
});

test("only a real PNG header gives a size", async () => {
  const { pngSize } = await import("../lib/design/index.mjs");
  const good = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]).copy(good);
  good.write("IHDR", 12, "latin1");
  good.writeUInt32BE(1440, 16);
  good.writeUInt32BE(960, 20);
  assert.deepEqual(pngSize(good), [1440, 960]);
  assert.equal(pngSize(Buffer.alloc(0)), null);
  assert.equal(pngSize(good.subarray(0, 10)), null);
  assert.equal(pngSize(Buffer.concat([Buffer.from("xPNG"), good.subarray(4)])), null);
  assert.equal(pngSize(Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Buffer.alloc(20)])), null);
  const noIhdr = Buffer.from(good);
  noIhdr.write("IDAT", 12, "latin1");
  assert.equal(pngSize(noIhdr), null);
});
