import assert from "node:assert/strict";
import { test } from "node:test";

import { merge } from "../lib/config.mjs";
import { DEFAULTS } from "../lib/defaults.mjs";
import { frameProblems, screensStatus } from "../lib/design/docchecks.mjs";
import { storyboard } from "../lib/design/storyboard.mjs";

const CONFIG = merge(DEFAULTS, { areas: [{ id: "app", prefix: "APP", docs: "docs/app" }] });
const PNG = merge(DEFAULTS, { areas: [{ id: "app", prefix: "APP", docs: "docs/app" }], design: { source: "png" } });
const LIST = "docs/app/design/screens.md";
const BOARD = "docs/design/review/app/storyboard.md";
const SCREENS = [
  "# App screens",
  "",
  "## Home",
  "",
  "| Frame | Stories | Reach | Caption |",
  "| --- | --- | --- | --- |",
  "| `home` | APP-01 | `home` | The home screen |",
  "| `ghost` | APP-01 | none, 99: later | A row with no frame |",
  "",
].join("\n");

const fake = (config, tracked, texts) => ({ root: "/p", config, tracked, files: (path) => texts[path] ?? "" });

test("each frame problem is named: missing picture, wrong folder, no row, no frame, stale storyboard", () => {
  const tracked = [LIST, "docs/design/frames/app/other/home.html", "docs/design/frames/app/home/stray.html"];
  assert.deepEqual(frameProblems(fake(CONFIG, tracked, { [LIST]: SCREENS })), [
    'docs/design/frames/app/other/home.html: belongs in docs/design/frames/app/home/, under its section "Home"',
    `${LIST}: no row for stray`,
    `${LIST}: no frame ghost`,
    `${BOARD}: out of date, run npx wf design storyboard`,
  ]);
});

test("a frame in its folder with no picture says to render it", () => {
  const problems = frameProblems(fake(CONFIG, [LIST, "docs/design/frames/app/home/home.html"], { [LIST]: SCREENS }));
  assert.ok(problems.includes("docs/design/review/app/home/home.png: missing, run npx wf design render home"));
});

test("a frame in its folder, with its picture and an up-to-date storyboard, leaves only the row with no frame", () => {
  const tracked = [LIST, BOARD, "docs/design/frames/app/home/home.html", "docs/design/review/app/home/home.png"];
  const board = storyboard(CONFIG, "app", LIST, SCREENS);
  assert.deepEqual(frameProblems(fake(CONFIG, tracked, { [LIST]: SCREENS, [BOARD]: board })), [`${LIST}: no frame ghost`]);
});

test("with design.source png the pictures are the frames, and an empty screen list asks for nothing", () => {
  const tracked = [LIST, BOARD, "docs/design/review/app/home/home.png", "docs/design/review/app/extra/loose.png"];
  const board = storyboard(PNG, "app", LIST, SCREENS);
  assert.deepEqual(frameProblems(fake(PNG, tracked, { [LIST]: SCREENS, [BOARD]: board })), [
    `${LIST}: no row for loose`,
    `${LIST}: no frame ghost; export it from the design tool as ghost.png`,
  ]);
  assert.deepEqual(frameProblems(fake(PNG, [LIST], { [LIST]: "# App screens\n\nNone yet.\n" })), []);
});

test("the Screens line counts reached frames, and a project with no screen list has none", () => {
  const [line] = screensStatus(fake(CONFIG, [LIST], { [LIST]: SCREENS }));
  assert.match(line, /^ {2}Screens: .*1 of 2 frames reached/);
  assert.deepEqual(screensStatus(fake(CONFIG, [], {})), []);
});

test("a png in the wrong section is one problem, a name in two folders is named, and a storyboard on disk counts", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const tracked = [LIST, "docs/design/review/app/other/home.png", "docs/design/review/app/home/ghost.png", "docs/design/review/app/old/ghost.png"];
  const problems = frameProblems(fake(PNG, tracked, { [LIST]: SCREENS }));
  assert.ok(problems.includes('docs/design/review/app/other/home.png: belongs in docs/design/review/app/home/, under its section "Home"'));
  assert.ok(problems.includes(`${LIST}: ghost is in more than one folder: docs/design/review/app/home/ghost.png, docs/design/review/app/old/ghost.png`));
  const html = frameProblems(fake(CONFIG, [LIST, "docs/design/frames/app/other/home.html"], { [LIST]: SCREENS }));
  assert.ok(!html.some((line) => line.includes("home.png: missing")));
  const root = mkdtempSync(join(tmpdir(), "wf-board-"));
  mkdirSync(join(root, "docs/design/review/app"), { recursive: true });
  const board = storyboard(PNG, "app", LIST, SCREENS);
  writeFileSync(join(root, BOARD), board);
  const onDisk = frameProblems({ root, config: PNG, tracked: [LIST, "docs/design/review/app/home/home.png"], files: (path) => ({ [LIST]: SCREENS, [BOARD]: board })[path] ?? "" });
  assert.ok(!onDisk.some((line) => line.includes("storyboard")));
});
