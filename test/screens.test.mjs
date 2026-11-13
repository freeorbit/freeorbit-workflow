import assert from "node:assert/strict";
import { test } from "node:test";

import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { merge } from "../lib/config/config.mjs";
import { DEFAULTS } from "../lib/config/defaults.mjs";
import { chunkStatus, chunkStories, coverage, gateProblems, parseReach, parseScreens, reachCounts, reachLine, screensFiles, storyRange, unreached } from "../lib/screens/list.mjs";
import { briefs, migrate, reviewCovers, why } from "../lib/screens/run.mjs";
import { jobsOf, lookStep, needsDisplay, screensHeadless, sessionSteps, shotsFor, splitScreens, stepWord } from "../lib/screens/shoot.mjs";
import { words } from "../lib/app/page.mjs";
import { afterDefer, afterRun, readState } from "../lib/screens/state.mjs";

const STRESS = { appearance: "light", corners: "round", density: "compact", textSize: "large" };

const SCREENS = `# Screens

| Frame | Stories | Reach | What it shows |
| --- | --- | --- | --- |
| \`dr-overview\` | DR-01 | \`downlink-wait-mixed › go #/plugins/downlink\` | The overview. |
| \`dr-requests-wait\` | DR-09, DR-10 | \`downlink-wait-mixed › go #/plugins/downlink/requests › click "Lumen Ferry"\` | Waiting, a \\| b. |
| \`dr-requests-reply-ai\` | DR-11 | none, 35i: needs a model | The AI reply. |

| Frame | Stories | What it shows |
| --- | --- | --- |
| \`gm-old\` | GM-01 | An older table with no Reach. |

## Screens with no frame

| Screen | Reach | Why no frame |
| --- | --- | --- |
| \`downlink-fresh\` | \`downlink-fresh › go #/catalog\` | Where a fresh install opens. |
`;

test("a screens.md gives each screen its stories, reach, and whether it has a frame", () => {
  const rows = parseScreens(SCREENS);
  assert.deepEqual(
    rows.map((row) => [row.name, row.framed]),
    [
      ["dr-overview", true],
      ["dr-requests-wait", true],
      ["dr-requests-reply-ai", true],
      ["gm-old", true],
      ["downlink-fresh", false],
    ],
  );
  assert.deepEqual(rows[1].stories, ["DR-09", "DR-10"]);
  assert.equal(rows[3].reach, undefined, "a table with no Reach column");
  assert.equal(rows[0].caption, "The overview.");
  assert.equal(rows[4].caption, "Where a fresh install opens.");
});

test("each area's screen list is found under its docs folder, in the config's order", () => {
  const root = mkdtempSync(join(tmpdir(), "wf-screens-"));
  for (const path of ["docs/b/design/screens.md", "docs/a/design/screens.md"]) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), "");
  }
  const config = merge(DEFAULTS, { areas: [{ id: "b", prefix: "B", docs: "docs/b" }, { id: "a", prefix: "A", docs: "docs/a" }, { id: "c", prefix: "C", docs: "docs/c" }] });
  assert.deepEqual(screensFiles(root, config).map((path) => path.slice(root.length + 1)), ["docs/b/design/screens.md", "docs/a/design/screens.md"]);
  assert.deepEqual(readState(join(root, "none.json")), { last: "origin/main", deep: "origin/main", lightRuns: [], deferred: { count: 0, at: null } });
});

test("a brief lists each screen's reason, stories, caption, and pictures, eight to a brief", () => {
  const rows = parseScreens(SCREENS);
  const items = Array.from({ length: 9 }, (_, i) => ({ name: i ? `s-${i}` : "dr-overview", why: "new", framed: i === 0, pictures: [`/p/${i}-pair.png`, `/p/${i}-narrow-stress.png`] }));
  const out = briefs(items, rows);
  assert.equal(out.length, 2);
  assert.match(out[0], /^## dr-overview\n\n- Listed: new\n- Stories: DR-01\n- Shows: The overview\.\n- Pictures:\n {2}- \/p\/0-pair\.png \(frame left, app right\)\n {2}- \/p\/0-narrow-stress\.png\n/);
  assert.match(out[0], /## s-1\n\n- Listed: new, no frame\n- Stories: none\n- Shows: \(no caption\)/);
  assert.match(out[1], /^## s-8/);
  const split = briefs([{ name: "dr-overview", why: "new", framed: true, pictures: [] }], parseScreens(SCREENS.replace("The overview.", "Lead.<br>• One<br>• Two")));
  assert.match(split[0], /- Shows: Lead\.\n {2}- One\n {2}- Two\n/);
});

test("a reach is a scenario, then run steps", () => {
  const reach = parseReach(parseScreens(SCREENS)[1].reach);
  assert.deepEqual(reach, { scenario: "downlink-wait-mixed", steps: ["go #/plugins/downlink/requests", 'click "Lumen Ferry"'] });
  assert.equal(parseReach("none: needs a model"), null);
});

test("coverage names a row with no Reach, a Reach with no scenario, and a scenario on no row", () => {
  const problems = coverage(parseScreens(SCREENS), ["downlink-wait-mixed", "downlink-fresh", "gmail-fresh"]);
  assert.deepEqual(problems, [
    "gm-old has no Reach",
    'scenario gmail-fresh is on no screen row; add it under "Screens with no frame"',
  ]);
});

test("a chunk's stories come from its row's Stories column, and CH-03 is not CH-30", () => {
  const order = "| Chunk | Title | Who | Stories | Status |\n| --- | --- | --- | --- | --- |\n| CH-30 | Wait | developer | DR-01, DR-09 | Not started |\n| CH-31 | Follow up | developer | DR-12 | Not started |";
  assert.deepEqual(chunkStories("CH-30", ["", order]), ["DR-01", "DR-09"]);
  assert.equal(chunkStories("CH-03", [order]), null);
  const older = "| Chunk | Stories | Status |\n| --- | --- | --- |\n| 30. Wait | DR-01, DR-09 | Not started |";
  assert.deepEqual(chunkStories("30", [older]), ["DR-01", "DR-09"]);
  assert.equal(chunkStories("3", [older]), null);
});

test("a screen is read again when a picture taken now or its frame changed", () => {
  const kept = { "wide-default": "a", "narrow-stress": "b", frame: "f" };
  assert.equal(why(kept, kept), null);
  assert.equal(why({ ...kept, "wide-default": "x" }, kept), "app changed");
  assert.equal(why({ ...kept, frame: "g" }, kept), "frame changed");
  assert.equal(why({ "wide-default": "x", "narrow-stress": "b", frame: "g" }, kept), "both");
  assert.equal(why({ "wide-default": "a", frame: "f" }, kept), null, "a picture not taken now does not count");
  assert.equal(why({ "wide-stress": "s", frame: "f" }, kept), "new", "a picture never taken before");
  assert.equal(why(kept, undefined), "new");
});

test("each ticked viewport is shot as a new install shows it, and stressed when ticked", () => {
  assert.deepEqual(shotsFor([], "light"), ["wide-default"]);
  assert.deepEqual(shotsFor([], "deep"), ["wide-default", "wide-stress", "narrow-default", "narrow-stress"]);
  assert.deepEqual(shotsFor([], null), ["wide-default", "narrow-stress"]);
  assert.deepEqual(shotsFor(["--wide"], "deep"), ["wide-default"], "no stress, only what a new install shows");
  assert.deepEqual(shotsFor(["--narrow", "--stress"], "light"), ["narrow-default", "narrow-stress"]);
  assert.deepEqual(shotsFor(["--wide", "--narrow", "--stress"], "light").length, 4);
  assert.throws(() => shotsFor(["--stress"], "deep"), /needs a viewport/);
});

test("a light run adds its range, and a deep run clears the runs and any deferral", () => {
  const start = { last: "aaaaaaa1", deep: "aaaaaaa1", lightRuns: [], deferred: { count: 0, at: null } };
  const deferred = afterDefer(start, "bbbbbbb2");
  assert.deepEqual(deferred.deferred, { count: 1, at: "bbbbbbb" });
  assert.equal(deferred.last, "aaaaaaa1", "a deferral moves nothing else");
  const light = afterRun(deferred, "light", "ccccccc3");
  assert.deepEqual(light.lightRuns, ["aaaaaaa..ccccccc"]);
  assert.equal(light.deep, "aaaaaaa1");
  assert.deepEqual(light.deferred.count, 0);
  const deep = afterRun(light, "deep", "ddddddd4");
  assert.deepEqual(deep, { last: "ddddddd4", deep: "ddddddd4", lightRuns: [], deferred: { count: 0, at: null } });
});

test("older accepted pictures keep their meaning under the new names", () => {
  assert.deepEqual(migrate({ a: { wide: "w", narrow: "n", frame: "f" } }), { a: { "wide-default": "w", "narrow-stress": "n", frame: "f" } });
});

test("one session walks the Reach once and shoots each look", () => {
  const reach = { scenario: "s", steps: ["go #/a", "click B"] };
  assert.deepEqual(sessionSteps(reach, [null, STRESS], "shot", ["d.png", "s.png"]), [
    "go #/a",
    "click B",
    "shot d.png",
    lookStep(STRESS),
    "wait 300",
    "shot s.png",
  ]);
  assert.deepEqual(sessionSteps(reach, [STRESS], "page", ["s.png"]), ["go #/a", "click B", lookStep(STRESS), "wait 300", "page s.png"]);
});

test("screens split across apps in even lists, in order of scenario", () => {
  const screen = (name, scenario) => ({ name, reach: `\`${scenario} › go #/a\`` });
  const lists = splitScreens([screen("a", "s1"), screen("b", "s1"), screen("c", "s2"), screen("d", "s3"), screen("e", "s1")], 2);
  assert.deepEqual(lists.map((list) => list.map((each) => each.name)), [["a", "b", "e"], ["c", "d"]]);
  assert.deepEqual(splitScreens([screen("a", "s1"), screen("b", "s1"), screen("c", "s1"), screen("d", "s1")], 2).map((list) => list.length), [2, 2]);
  assert.equal(splitScreens([screen("a", "s1")], 4).length, 1);
  assert.equal(jobsOf(["--jobs", "3"]), 3);
  assert.equal(jobsOf([], 8, true), 8);
  assert.equal(jobsOf([], 16, true), 8);
  assert.equal(jobsOf([], 16, true, 12), 12);
  assert.equal(jobsOf([], 8, false), 1);
  assert.throws(() => jobsOf(["--jobs", "0"]));
});

test("a chunk-end run waits until the code review has run or been deferred at HEAD", () => {
  const ledger = (last, deferred) => `Last reviewed: ${last} on 2026-11-09, diff.\nDeep reviewed: 42c017c on 2026-11-08.\nDeferred: ${deferred}\n`;
  assert.equal(reviewCovers(ledger("3a25687", "none."), "3a25687"), true);
  assert.equal(reviewCovers(ledger("42c017c", "2 times, last at 3a25687 on 2026-11-09."), "3a256870"), true);
  assert.equal(reviewCovers(ledger("42c017c", "2 times, last at f9399b9 on 2026-11-08."), "3a25687"), false);
  assert.equal(reviewCovers(ledger("none", "none."), "3a25687"), false);
  assert.equal(reviewCovers(ledger("f9399b9", "none."), "3a25687", (commit) => commit === "f9399b9"), true);
  assert.equal(reviewCovers(ledger("f9399b9", "none."), "3a25687", () => false), false);
});

test("an unreached frame names its chunk, or says it cannot be reached", () => {
  assert.deepEqual(unreached("none, 35i: needs a sign-in"), { kind: "waiting", chunk: "35i", reason: "needs a sign-in" });
  assert.deepEqual(unreached("none, CH-35-fe: needs the screen"), { kind: "waiting", chunk: "CH-35-fe", reason: "needs the screen" });
  assert.deepEqual(unreached("cannot: a hover tip"), { kind: "cannot", reason: "a hover tip" });
  assert.deepEqual(unreached("none: old style"), { kind: "unowned" });
  assert.equal(unreached("gmail-fresh › go #/catalog"), null);
  assert.equal(parseReach("cannot: a hover tip"), null);
});

test("a chunk is open in the build order or done in the done list", () => {
  const buildOrder = "| Chunk | Title | Who | Stories | Status |\n| --- | --- | --- | --- | --- |\n| CH-35 | Live sign-ins | developer | APP-13 | Not started |";
  const done = "| Chunk | Title | Who | Stories | Status |\n| --- | --- | --- | --- | --- |\n| CH-34 | Missing | developer | APP-01 | Done |";
  assert.equal(chunkStatus("CH-35", buildOrder, done), "open");
  assert.equal(chunkStatus("CH-34", buildOrder, done), "done");
  assert.equal(chunkStatus("CH-99", buildOrder, done), null);
});

test("the list fails a none with no chunk, or one waiting on a done chunk", () => {
  const rows = [
    { name: "a", framed: true, stories: [], reach: "none: old" },
    { name: "b", framed: true, stories: [], reach: "none, 35g: done already" },
    { name: "c", framed: true, stories: [], reach: "none, 35i: later" },
  ];
  const problems = coverage(rows, [], { buildOrder: "| Chunk | Status |\n| --- | --- |\n| 35i. x | Not started |", done: "| Chunk | Status |\n| --- | --- |\n| 35g. y | Done |" });
  assert.equal(problems.length, 2);
  assert.match(problems[0], /a is not reached and names no chunk/);
  assert.match(problems[1], /b waits on chunk 35g, which is done/);
});

test("the counts and the gate see frames only, and a later chunk passes the gate", () => {
  const rows = [
    { name: "reached", framed: true, stories: ["GM-01"], reach: "s › go #/x" },
    { name: "mine", framed: true, stories: ["GM-01", "GM-09"], reach: "none, 35i: later here" },
    { name: "later", framed: true, stories: ["GM-02"], reach: "none, 35j: needs files" },
    { name: "hover", framed: true, stories: ["GM-01"], reach: "cannot: a hover" },
    { name: "state", framed: false, stories: [], reach: "s" },
  ];
  assert.equal(reachLine(reachCounts(rows)), "1 of 4 frames reached; waiting: 1 on 35i, 1 on 35j; 1 cannot be.");
  assert.deepEqual(gateProblems(rows, "35i", ["GM-01", "GM-02"]).length, 1);
  assert.deepEqual(gateProblems(rows, "35h", ["GM-01", "GM-02"]), []);
});

test("a story range in a chunk row is each story in it", () => {
  assert.deepEqual(storyRange("GM-19 to GM-21"), ["GM-19", "GM-20", "GM-21"]);
  assert.deepEqual(storyRange("APP-05"), ["APP-05"]);
});

test("a picture path with a space or a quote stays one word of the step", () => {
  const out = '/home/a/Atlas NX/atlas-nx/.cache/screens/sign "in".png';
  const [step] = sessionSteps({ steps: [] }, [null], "shot", [out]);
  assert.deepEqual(words(step), ["shot", out]);
  assert.equal(stepWord("/tmp/plain.png"), "/tmp/plain.png");
});

test("only a Tauri window or a web browser with a window needs a display of its own", () => {
  assert.equal(needsDisplay({ kind: "tauri", web: { headless: true } }), true);
  assert.equal(needsDisplay({ kind: "web", web: { headless: true } }), false);
  assert.equal(needsDisplay({ kind: "web", web: { headless: false } }), true);
  assert.equal(needsDisplay({ kind: "web", web: { headless: true } }, false), true, "a headed run over a headless default");
  assert.equal(needsDisplay({ kind: "web", web: { headless: false } }, true), false);
});

test("a chunk-end review and a build-time check each take their own headless setting, or app.web.headless", () => {
  const config = (headless, screens) => merge(DEFAULTS, { app: { kind: "web", web: { headless } }, screens: { headless: screens } });
  assert.equal(screensHeadless(config(true, {}), "light"), true, "unset follows app.web.headless");
  assert.equal(screensHeadless(config(false, {}), null), false);
  const atlas = config(false, { review: true, build: false });
  assert.equal(screensHeadless(atlas, "light"), true);
  assert.equal(screensHeadless(atlas, "deep"), true);
  assert.equal(screensHeadless(atlas, null), false, "named screens, a chunk, or all");
  assert.equal(screensHeadless(config(true, { build: false }), "deep"), true);
  assert.equal(screensHeadless(config(true, { build: false }), null), false);
});
