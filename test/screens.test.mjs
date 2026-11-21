import assert from "node:assert/strict";
import { test } from "node:test";

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { merge } from "../lib/config/config.mjs";
import { DEFAULTS } from "../lib/config/defaults.mjs";
import { chunkStatus, chunkStories, coverage, gateProblems, parseReach, parseScreens, reachCounts, reachLine, screensFiles, unreached } from "../lib/screens/list.mjs";
import { storiesIn } from "../lib/docs/shape.mjs";
import { acceptNames, areasOf, briefs, dueLists, inAreas, migrate, screens, takenBy, whereRuns, why } from "../lib/screens/run.mjs";
import { displayApart, jobsFor, lookStep, sessionSteps, showFor, shotsFor, shotsProblem, splitScreens, stepWord } from "../lib/screens/shoot.mjs";
import { words } from "../lib/app/page.mjs";
import { afterAccept, afterDefer, fromV1, markOf, readState, recordDir, statePath, withRecordLock, writeState } from "../lib/screens/state.mjs";
import { retiredRuns } from "../lib/config/config.mjs";
import { reviewCovers } from "../lib/review.mjs";

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
  assert.deepEqual(readState(join(root, "none.json")), { version: 2, marks: {}, last: null, deferred: { count: 0, at: null } });
});

test("a brief lists each screen's reason, stories, caption, and pictures, 24 pictures to a brief", () => {
  const rows = parseScreens(SCREENS);
  const items = Array.from({ length: 13 }, (_, i) => ({ name: i ? `s-${i}` : "dr-overview", why: "new", framed: i === 0, pictures: [`/p/${i}-pair.png`, `/p/${i}-narrow-stress.png`] }));
  const out = briefs(items, rows);
  assert.equal(out.length, 2);
  assert.match(out[1], /^## s-12/);
  const one = items.map((item) => ({ ...item, pictures: item.pictures.slice(0, 1) }));
  assert.equal(briefs(one, rows).length, 1);
  assert.deepEqual(briefs([...one, ...one], rows).map((text) => text.match(/^## /gm).length), [24, 2]);
  assert.deepEqual(briefs(one.slice(0, 3), rows, 2).map((text) => text.match(/^## /gm).length), [2, 1]);
  assert.equal(briefs([{ ...items[0], pictures: ["a", "b", "c"] }, items[1]], rows, 2).length, 2);
  assert.match(out[0], /^## dr-overview\n\n- Listed: new\n- Stories: DR-01\n- Shows: The overview\.\n- Pictures:\n {2}- \/p\/0-pair\.png \(frame left, app right\)\n {2}- \/p\/0-narrow-stress\.png\n/);
  assert.match(out[0], /## s-1\n\n- Listed: new, no frame\n- Stories: none\n- Shows: \(no caption\)/);
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
  assert.deepEqual(shotsFor([], "deep"), ["wide-default"], "Default only, unless asked");
  assert.deepEqual(shotsFor([], null), ["wide-default"]);
  assert.deepEqual(shotsFor(["--wide"], "deep"), ["wide-default"], "no stress, only what a new install shows");
  assert.deepEqual(shotsFor(["--narrow", "--stress"], "light"), ["narrow-default", "narrow-stress"]);
  assert.deepEqual(shotsFor(["--wide", "--narrow", "--stress"], "light").length, 4);
  assert.throws(() => shotsFor(["--stress"], "deep"), /needs a viewport/);
});

test("an accept marks each picture it took at the run's commit, and a chunk-end run clears a deferral", () => {
  const start = { version: 2, marks: { a: { "wide-default": "aaaaaaa1" }, b: { "wide-default": "aaaaaaa1" } }, last: "aaaaaaa1", deferred: { count: 0, at: null } };
  const deferred = afterDefer(start, "bbbbbbb2");
  assert.deepEqual(deferred.deferred, { count: 1, at: "bbbbbbb" });
  assert.deepEqual(deferred.marks, start.marks, "a deferral moves nothing else");
  // Some screens, outside chunk end: only their marks move, and the deferral stays.
  const named = afterAccept(deferred, { a: ["wide-default", "narrow-default"] }, "ccccccc3");
  assert.deepEqual(named.marks, { a: { "wide-default": "ccccccc3", "narrow-default": "ccccccc3" }, b: { "wide-default": "aaaaaaa1" } });
  assert.equal(named.deferred.count, 1);
  assert.equal(named.last, "aaaaaaa1");
  // A light run at chunk end: its screens, the last run, and no deferral.
  const light = afterAccept(named, { b: ["wide-default"] }, "ddddddd4", true);
  assert.deepEqual(light.marks.b, { "wide-default": "ddddddd4" });
  assert.deepEqual([light.last, light.deferred], ["ddddddd4", { count: 0, at: null }]);
  assert.equal(markOf(light, "a", "narrow-default"), "ccccccc3");
  assert.equal(markOf(light, "b", "narrow-default"), "origin/main", "a picture never accepted is due from the base");
  assert.equal(markOf(light, "new", "wide-default", "main"), "main");
});

test("a record from before marks keeps what each screen was due from", () => {
  const v1 = { last: "1111111", deep: "0000000", lightRuns: ["0000000..1111111"], deferred: { count: 2, at: "1111111" }, open: { c: "2222222" } };
  const accepted = { a: { "wide-default": "h", "narrow-default": "n", frame: "f" } };
  assert.deepEqual(fromV1(v1, new Map([["b", ["shell.tsx"]], ["c", ["c.tsx"]]]), ["a", "b", "c"], accepted), {
    version: 2,
    marks: {
      a: { "wide-default": "1111111", "narrow-default": "1111111" },
      b: { "wide-default": "0000000" },
      c: { "wide-default": "0000000" },
    },
    pending: ["c"],
    last: "1111111",
    deferred: { count: 2, at: "1111111" },
  }, "a: off the deep list, so the last run; b: on it, so the deep run; c: left open, so pending until accepted");
});

test("each screen is due from its own mark: the project's module is asked once a mark, as if the whole app were marked there", async () => {
  const asked = [];
  // Since the base, b changed in one place and the shell reached a and b; since x, only c changed.
  const listsAt = async (at) => {
    asked.push(at);
    return at === "base"
      ? { light: new Map([["b", ["b.tsx"]]]), deep: new Map([["a", ["shell.tsx"]], ["b", ["shell.tsx"]]]) }
      : { light: new Map([["c", ["c.tsx"]]]), deep: new Map() };
  };
  const state = { version: 2, marks: { a: { "wide-default": "x" }, c: { "wide-default": "x" } } };
  const { light, deep, marks } = await dueLists(["a", "b", "c"], state, ["wide-default"], listsAt, "base");
  assert.deepEqual(new Set(light.keys()), new Set(["b", "c"]), "a's mark is past the shell change; b has none, so is due from the base");
  assert.deepEqual(new Set(deep.keys()), new Set(["b", "c"]), "the deep list holds every screen due");
  assert.deepEqual(deep.get("b"), ["shell.tsx", "b.tsx"]);
  assert.deepEqual([asked.sort(), marks], [["base", "x"], 1], "the base is asked about, but is not a mark");
  // A screen left open before marks is due whatever changed, on the deep list only, until an accept takes it.
  const held = await dueLists(["a", "b", "c"], { ...state, pending: ["a", "c", "gone"] }, ["wide-default"], listsAt, "base");
  assert.deepEqual([new Set(held.light.keys()), held.deep.get("a")], [new Set(["b"]), ["left out of an accept"]]);
  assert.ok(!held.deep.has("gone"), "a screen off the list is not due");
  assert.deepEqual(afterAccept({ version: 2, marks: {}, pending: ["a", "c"] }, { a: ["wide-default"] }, "x").pending, ["c"]);
  assert.ok(!("pending" in afterAccept({ version: 2, marks: {}, pending: ["a"] }, { a: ["wide-default"] }, "x")), "none left, none kept");
  // A run with a picture a screen never had takes that picture from the base.
  const narrow = await dueLists(["a"], state, ["wide-default", "narrow-default"], listsAt, "base");
  assert.deepEqual([...narrow.deep.keys()], ["a"], "a's narrow picture was never accepted, so the shell change is due");
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
  assert.deepEqual(storiesIn("GM-19 to GM-21"), ["GM-19", "GM-20", "GM-21"]);
  assert.deepEqual(storiesIn("APP-05"), ["APP-05"]);
  assert.deepEqual(storiesIn("DR-01–DR-03, APP-26, GM-08 to 10; C-GM-49"), ["DR-01", "DR-02", "DR-03", "APP-26", "GM-08", "GM-09", "GM-10"], "an en dash and a bare end make a range; a story inside another ID is none");
});

test("a picture path with a space or a quote stays one word of the step", () => {
  const out = '/home/a/Atlas NX/atlas-nx/.cache/screens/sign "in".png';
  const [step] = sessionSteps({ steps: [] }, [null], "shot", [out]);
  assert.deepEqual(words(step), ["shot", out]);
  assert.equal(stepWord("/tmp/plain.png"), "/tmp/plain.png");
});

test("each kind of run says where its apps show and how many at once", () => {
  const tauri = (runs) => merge(DEFAULTS, { screens: { runs } });
  const web = (runs) => merge(DEFAULTS, { app: { kind: "web" }, screens: { runs } });
  // auto is headless for a web app's browser, a virtual display for any other window.
  assert.equal(showFor(tauri({}), "deep"), "virtual");
  assert.equal(showFor(web({}), null), "headless");
  // Freeorbit: the review off the screen, a build-time check on it.
  const freeorbit = tauri({ review: { show: "virtual", jobs: 4 }, build: { show: "screen" } });
  assert.equal(showFor(freeorbit, "light"), "virtual");
  assert.equal(showFor(freeorbit, null), "screen", "named screens, a chunk, or all");
  assert.equal(showFor(freeorbit, null, ["--show", "virtual"]), "virtual", "--show for one run");
  assert.throws(() => showFor(freeorbit, null, ["--show", "headless"]), /--show is headless, which is for a web app's browser/);
  assert.throws(() => showFor(freeorbit, null, ["--show", "hidden"]), /--show is screen, virtual, headless, or auto, not "hidden"/);
  // Jobs: the kind's own, held to the cores; one on the screen; --jobs for one run.
  assert.equal(jobsFor(freeorbit, "deep", "virtual", [], 8), 4);
  assert.equal(jobsFor(freeorbit, "deep", "virtual", [], 2), 2, "held to the cores");
  assert.equal(jobsFor(freeorbit, "deep", "virtual", ["--jobs", "6"], 8), 6);
  assert.equal(jobsFor(tauri({ build: { jobs: 3 } }), null, "virtual", [], 8), 3, "build has its own jobs");
  assert.equal(jobsFor(tauri({ review: { jobs: 3 } }), null, "virtual", [], 8), 8, "review's jobs do not cap a build run");
  assert.equal(jobsFor(freeorbit, null, "screen", [], 8), 1);
  assert.equal(jobsFor(freeorbit, null, "screen", ["--jobs", "1"], 8), 1);
  assert.throws(() => jobsFor(freeorbit, null, "screen", ["--jobs", "3"], 8), /--jobs 3 needs the apps off the person's screen: add --show virtual$/);
  assert.throws(() => jobsFor(freeorbit, null, "virtual", ["--jobs", "0"], 8), /usage: --jobs N/);
  // Each run says where it shows; virtual without KWin is the screen, one at a time, and says why.
  assert.deepEqual(whereRuns(freeorbit, "deep", [], () => true, 8), { show: "virtual", jobs: 4, line: "A review run: 4 apps at once, on virtual displays, off your screen." });
  assert.deepEqual(whereRuns(freeorbit, null, [], () => true, 8), { show: "screen", jobs: 1, line: "A build run: one app, on your screen." });
  assert.deepEqual(whereRuns(freeorbit, "deep", [], () => false, 8), { show: "screen", jobs: 1, line: "A review run: one app, on your screen: virtual displays need kwin_wayland on Linux, which is not here." });
  assert.equal(whereRuns(web({}), "light", [], () => false, 8).line, "A review run: 8 apps at once, headless, with no window.", "headless needs no KWin");
});

test("a setting a run cannot use stops every command, and the old keys say what to write", async () => {
  const { valueProblems, unknownKeys } = await import("../lib/config/config.mjs");
  const check = (given) => valueProblems(merge(DEFAULTS, given), given);
  assert.deepEqual(check({}), []);
  assert.deepEqual(check({ screens: { runs: { build: { show: "screen" } } } }), [], "the default jobs is not blamed");
  assert.deepEqual(check({ screens: { runs: { build: { show: "screen", jobs: 4 } } } }), ["screens.runs.build.jobs is 4, but show is screen, which is always one app; leave jobs out"]);
  assert.deepEqual(check({ screens: { runs: { review: { show: "headless" } } } }), ["screens.runs.review.show is headless, which is for a web app's browser; an app's window is screen or virtual"]);
  assert.deepEqual(check({ app: { kind: "web" }, screens: { runs: { review: { show: "headless" } } } }), []);
  assert.deepEqual(check({ screens: { runs: { review: { show: "off" } } } }), ['screens.runs.review.show is screen, virtual, headless, auto, not "off"']);
  assert.deepEqual(check({ screens: { runs: { review: { jobs: 0 } } } }), ["screens.runs.review.jobs is a whole number from 1 to 16, not 0"]);
  // The old keys still load, do nothing, and the run and the doctor say what to write.
  assert.deepEqual(unknownKeys({ screens: { headless: { build: false }, jobsMax: 4, display: "kwin" } }), []);
  assert.equal(retiredRuns(merge(DEFAULTS, {})), null);
  assert.deepEqual(retiredRuns(merge(DEFAULTS, { screens: { jobsMax: 4, headless: { review: true, build: false } } })), { review: { show: "virtual", jobs: 4 }, build: { show: "screen" } }, "Freeorbit's");
  assert.deepEqual(retiredRuns(merge(DEFAULTS, { app: { kind: "web" }, screens: { headless: { review: true, build: null } } })), { review: { show: "headless", jobs: 8 }, build: { show: "headless", jobs: 8 } }, "null followed app.web.headless");
  assert.deepEqual(retiredRuns(merge(DEFAULTS, { screens: { display: "none" } })), { review: { show: "screen" }, build: { show: "screen" } });
});

test("the review's record is the main checkout's, shared by its worktrees, and a removed commit counts from the base", () => {
  const main = mkdtempSync(join(tmpdir(), "wf-record-"));
  const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  git(main, "init", "-q", "-b", "main");
  git(main, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "one");
  const tree = join(mkdtempSync(join(tmpdir(), "wf-record-")), "wt");
  git(main, "worktree", "add", "-q", tree);
  const shared = join(realpathSync(main), ".cache/screens");
  assert.equal(recordDir(main), shared);
  assert.equal(recordDir(tree), shared, "a worktree reads and writes the main checkout's record");
  assert.equal(statePath(tree), join(shared, "state.json"));
  const outside = mkdtempSync(join(tmpdir(), "wf-record-"));
  assert.equal(recordDir(outside), join(outside, ".cache/screens"), "outside git, the project's own");

  const head = git(tree, "rev-parse", "HEAD");
  const gone = "0123456789abcdef0123456789abcdef01234567";
  writeState({ version: 2, marks: { a: { "wide-default": head }, b: { "wide-default": gone } }, last: head, deferred: { count: 0, at: null } }, statePath(tree));
  assert.ok(!readdirSync(shared).some((f) => f.endsWith(".part")), "written whole, through a file beside it");
  const state = readState(statePath(main), "origin/main", main);
  assert.equal(markOf(state, "a", "wide-default"), head, "a commit the repository has stays");
  assert.equal(markOf(state, "b", "wide-default"), "origin/main", "a commit since removed counts from the base");
  writeState({ last: head, deep: gone, lightRuns: [], deferred: { count: 0, at: null } }, statePath(tree));
  assert.equal(readState(statePath(main), "origin/main", main).deep, "origin/main", "and so in a record from before marks");
});

test("--area narrows a run to those areas' screens, and its accept moves only their marks", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "wf-area-")));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "one"], { cwd: root });
  const config = merge(DEFAULTS, { areas: [{ id: "app", prefix: "APP", docs: "docs/app" }, { id: "uplink", prefix: "GM", docs: "docs/uplink" }] });
  for (const [area, name] of [["app", "home"], ["uplink", "accounts"]]) {
    mkdirSync(join(root, "docs", area, "design"), { recursive: true });
    writeFileSync(join(root, "docs", area, "design", "screens.md"), `| Screen | Stories | Reach | Shows |\n| --- | --- | --- | --- |\n| \`${name}\` | X-1 | \`s › go #/\` | it |\n`);
  }
  const all = screensFiles(root, config).flatMap((file) => parseScreens(readFileSync(file, "utf8"), file));
  assert.deepEqual(inAreas(all, areasOf(["--deep", "--area", "uplink"], config), root, config).map((s) => s.name), ["accounts"]);
  assert.deepEqual(inAreas(all, areasOf(["--area", "app,uplink"], config), root, config).length, 2);
  assert.equal(areasOf(["--deep"], config), null);
  assert.throws(() => areasOf(["--area", "downlink"], config), /--area app\|uplink.*no area downlink/);
  assert.throws(() => areasOf(["--area"], config), /usage: --area/);

  // A deep run narrowed to uplink is accepted: its screen is marked where the run was shot, and home is not.
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const latest = join(root, ".cache/screens/latest");
  mkdirSync(latest, { recursive: true });
  writeFileSync(join(latest, "hashes.json"), JSON.stringify({ accounts: { "wide-default": "h" } }));
  writeFileSync(join(latest, "run.json"), JSON.stringify({ mode: "deep", shots: ["wide-default"], at: head, failed: 0, unreached: [], areas: ["uplink"] }));
  const lines = [];
  const log = console.log;
  console.log = (line) => lines.push(String(line));
  try {
    await screens(root, config, ["--accept"]);
  } finally {
    console.log = log;
  }
  assert.match(lines.join("\n"), /Marked 1 screens at \w{7}, and the deep run as the last/);
  assert.deepEqual(JSON.parse(readFileSync(statePath(root), "utf8")).marks, { accounts: { "wide-default": head } });
  assert.deepEqual(JSON.parse(readFileSync(join(recordDir(root), "accepted.json"), "utf8")), { accounts: { "wide-default": "h" } });
});

test("narrow and stress are a project's own: off until set, and asking for them unset says what to set", () => {
  const plain = merge(DEFAULTS, {});
  assert.equal(plain.screens.narrow, "");
  assert.deepEqual(plain.screens.stress, {});
  assert.equal(shotsProblem(["wide-default"], plain), null, "Default needs nothing set");
  assert.match(shotsProblem(shotsFor(["--narrow"], "deep"), plain), /set screens\.narrow/);
  assert.match(shotsProblem(shotsFor(["--wide", "--stress"], null), plain), /set screens\.stress/);
  const set = merge(DEFAULTS, { screens: { narrow: "800x560", stress: { appearance: "light" } } });
  assert.equal(shotsProblem(shotsFor(["--wide", "--narrow", "--stress"], "deep"), set), null);
});

test("a project in a folder of its repository keeps its record in that folder of the main checkout; the lock serialises changes", () => {
  const main = realpathSync(mkdtempSync(join(tmpdir(), "wf-record-")));
  const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  git(main, "init", "-q", "-b", "main");
  mkdirSync(join(main, "packages/web"), { recursive: true });
  writeFileSync(join(main, "packages/web/x"), "x");
  git(main, "add", ".");
  git(main, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "one");
  const tree = join(mkdtempSync(join(tmpdir(), "wf-record-")), "wt");
  git(main, "worktree", "add", "-q", tree);
  const want = join(main, "packages/web/.cache/screens");
  assert.equal(recordDir(join(main, "packages/web")), want, "where it was before, in the project's folder");
  assert.equal(recordDir(join(tree, "packages/web")), want, "a worktree's project folder shares it");

  const dir = recordDir(main);
  const order = [];
  withRecordLock(dir, () => {
    order.push("outer");
    assert.ok(existsSync(join(dir, "record.lock")), "held while changing");
  });
  assert.ok(!existsSync(join(dir, "record.lock")), "let go after");
  mkdirSync(join(dir, "record.lock"));
  utimesSync(join(dir, "record.lock"), new Date(Date.now() - 120_000), new Date(Date.now() - 120_000));
  withRecordLock(dir, () => order.push("after a stale lock"));
  assert.deepEqual(order, ["outer", "after a stale lock"]);
});

test("an accept takes the whole run, the named screens, or all but them; a name the run lacks takes nothing", () => {
  const latest = { a: {}, b: {}, c: {} };
  assert.deepEqual(takenBy(latest, [], false), ["a", "b", "c"]);
  assert.deepEqual(takenBy(latest, ["c", "a"], false), ["a", "c"]);
  assert.deepEqual(takenBy(latest, ["b"], true), ["a", "c"]);
  assert.throws(() => takenBy(latest, ["a", "z"], false), /not in the last run: z\. Nothing was accepted/);
  assert.throws(() => takenBy(latest, [], true), /usage: wf screens --accept --except/);
  const root = mkdtempSync(join(tmpdir(), "wf-names-"));
  writeFileSync(join(root, "left.txt"), "b\n\n c \n");
  assert.deepEqual(acceptNames(["--accept", "--except", "a", "@left.txt"], root), ["a", "b", "c"]);
});

test("a partial accept marks the screens it took; those left out stay due and listed to read", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "wf-partial-")));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "one"], { cwd: root });
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const config = merge(DEFAULTS, { areas: [{ id: "app", prefix: "APP", docs: "docs/app" }], screens: { scope: "scope.mjs" } });
  mkdirSync(join(root, "docs/app/design"), { recursive: true });
  const rows = ["a", "b", "c"].map((name) => `| \`${name}\` | X-1 | \`s › go #/\` | it |`).join("\n");
  writeFileSync(join(root, "docs/app/design/screens.md"), `| Screen | Stories | Reach | Shows |\n| --- | --- | --- | --- |\n${rows}\n`);
  // Since the base, b changed in one place and the shell reached a; nothing has changed since HEAD.
  writeFileSync(join(root, "scope.mjs"), `export const lists = ({ state }) => state.last === "${head}" ? { light: new Map(), deep: new Map() } : { light: new Map([["b", ["b.tsx"]]]), deep: new Map([["a", ["shell.tsx"]]]) };\n`);
  const latest = join(root, ".cache/screens/latest");
  const record = recordDir(root);
  const read = (path) => JSON.parse(readFileSync(path, "utf8"));
  const shot = (mode, hashes, more = {}) => {
    mkdirSync(latest, { recursive: true });
    writeFileSync(join(latest, "hashes.json"), JSON.stringify(hashes));
    writeFileSync(join(latest, "run.json"), JSON.stringify({ mode, shots: ["wide-default"], at: head, failed: 0, unreached: [], ...more }));
    writeFileSync(join(root, ".cache/screens/to-read.json"), JSON.stringify(Object.keys(hashes).filter((name) => name !== "c").map((name) => ({ name, why: "app changed", pictures: [], framed: false }))));
  };
  const lines = [];
  const say = async (...args) => {
    lines.length = 0;
    const log = console.log;
    console.log = (line) => lines.push(String(line));
    try {
      await screens(root, config, args);
    } finally {
      console.log = log;
    }
    return lines.join("\n");
  };
  mkdirSync(record, { recursive: true });
  writeFileSync(join(record, "accepted.json"), JSON.stringify({ c: { "wide-default": "c1" } }));
  assert.equal(await say("scope", "--names", "light"), "b");
  assert.equal(await say("scope", "--names", "deep"), "a\nb");

  // A deep run changed a and b; c is as accepted. b has a fault, so it is left out.
  shot("deep", { a: { "wide-default": "a1" }, b: { "wide-default": "b1" }, c: { "wide-default": "c1" } });
  await assert.rejects(say("--accept", "--except", "z"), /not in the last run: z/);
  assert.deepEqual(read(join(record, "accepted.json")), { c: { "wide-default": "c1" } }, "a wrong name accepts nothing");
  assert.match(await say("--accept", "--except", "b"), /Accepted 2 screens, left 1 to read[\s\S]*Marked 2 screens at \w{7}, and the deep run as the last[\s\S]*1 changed screens left out keep their marks/);
  const state = read(statePath(root));
  assert.deepEqual(state.marks, { a: { "wide-default": head }, c: { "wide-default": head } }, "b keeps no mark, so it is due from the base");
  assert.equal(state.version, 2);
  assert.deepEqual(read(join(root, ".cache/screens/to-read.json")).map((item) => item.name), ["b"], "b is still listed to read");
  assert.equal(await say("scope", "--names", "light"), "", "b left out is pending: on the deep list only, whatever changed");
  assert.equal(await say("scope", "--names", "deep"), "b", "a left the deep list");
  assert.deepEqual(read(statePath(root)).pending, ["b"]);
  assert.match(await say("scope"), /Light: 0 screens[\s\S]*Deep: 1 screens, 1 of them only through shared code[\s\S]*1 commit now; the last chunk-end run was at \w{7}[\s\S]*due until accepted: 1 screens/);

  // b is fixed and accepted from the same run: nothing is due.
  assert.match(await say("--accept", "b"), /Accepted 1 screens\.[\s\S]*Marked 1 screens/);
  assert.equal(await say("scope", "--names", "deep"), "");
  assert.ok(!existsSync(join(root, ".cache/screens/to-read.json")), "nothing left to read");

  // A run by names, outside chunk end, also marks what it took, and a screen it could not reach.
  shot(null, { a: { "wide-default": "a2" } }, { unreached: ["c"] });
  assert.match(await say("--accept"), /Marked 2 screens at \w{7}\./);
  assert.equal(read(join(record, "accepted.json")).b["wide-default"], "b1");
});

test("an accept marks where the run was shot, takes the unchanged screens left out, and moves settled marks forward", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "wf-shot-at-")));
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  git("init", "-q", "-b", "main");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "one");
  const shotAt = git("rev-parse", "HEAD");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "two");
  const later = git("rev-parse", "HEAD");
  const config = merge(DEFAULTS, { areas: [{ id: "app", prefix: "APP", docs: "docs/app" }], screens: { scope: "scope.mjs" } });
  mkdirSync(join(root, "docs/app/design"), { recursive: true });
  const rows = ["a", "b", "c", "d"].map((name) => `| \`${name}\` | X-1 | \`s › go #/\` | it |`).join("\n");
  writeFileSync(join(root, "docs/app/design/screens.md"), `| Screen | Stories | Reach | Shows |\n| --- | --- | --- | --- |\n${rows}\n`);
  // From any commit, a and b are due; c and d are not.
  writeFileSync(join(root, "scope.mjs"), 'export const lists = () => ({ light: new Map([["a", ["a.tsx"]], ["b", ["b.tsx"]]]), deep: new Map() });\n');
  const record = recordDir(root);
  mkdirSync(record, { recursive: true });
  writeFileSync(join(record, "accepted.json"), JSON.stringify({ b: { "wide-default": "b0" }, c: { "wide-default": "c1" } }));
  writeState({ version: 2, marks: { d: { "wide-default": shotAt } }, pending: ["gone"], last: null, deferred: { count: 1, at: "1234567" } }, statePath(root));
  const latest = join(root, ".cache/screens/latest");
  mkdirSync(latest, { recursive: true });
  // Shot at the first commit; accepted after a second. a changed, b changed, c is as accepted.
  writeFileSync(join(latest, "hashes.json"), JSON.stringify({ a: { "wide-default": "a1" }, b: { "wide-default": "b1" }, c: { "wide-default": "c1" } }));
  writeFileSync(join(latest, "run.json"), JSON.stringify({ mode: null, shots: ["wide-default"], at: shotAt, failed: 0, unreached: [] }));
  const log = console.log;
  console.log = () => {};
  try {
    await screens(root, config, ["--accept", "a"]);
  } finally {
    console.log = log;
  }
  const state = JSON.parse(readFileSync(statePath(root), "utf8"));
  assert.equal(state.marks.a["wide-default"], shotAt, "marked where the run was shot, not at the later HEAD");
  assert.equal(state.marks.c["wide-default"], shotAt, "c was left out but unchanged, so it is taken");
  assert.ok(!state.marks.b, "b changed and was left out, so it keeps no mark");
  assert.equal(state.marks.d["wide-default"], shotAt, "d is not due, so its mark moves with the accept");
  assert.deepEqual(state.pending, ["b"], "b, left out changed, is pending; the pending screen off the list goes");
  assert.deepEqual(state.deferred, { count: 1, at: "1234567" }, "a run outside chunk end leaves a deferral");
  assert.deepEqual(JSON.parse(readFileSync(join(latest, "hashes.json"), "utf8")), { b: { "wide-default": "b1" } }, "only the changed screen left out stays to accept");
  assert.equal(JSON.parse(readFileSync(join(latest, "run.json"), "utf8")).at, shotAt, "and keeps where it was shot");
  assert.notEqual(later, shotAt);
});

test("an accept settles nothing from a run with uncommitted changes, never moves a mark back, holds a screen that did not shoot, and counts a chunk end once", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "wf-settle-")));
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  const commit = (m) => git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", m);
  git("init", "-q", "-b", "main");
  commit("one");
  const first = git("rev-parse", "HEAD");
  commit("two");
  const second = git("rev-parse", "HEAD");
  const config = merge(DEFAULTS, { areas: [{ id: "app", prefix: "APP", docs: "docs/app" }], screens: { scope: "scope.mjs" } });
  mkdirSync(join(root, "docs/app/design"), { recursive: true });
  const rows = ["a", "b", "c", "d"].map((name) => `| \`${name}\` | X-1 | \`s › go #/\` | it |`).join("\n");
  writeFileSync(join(root, "docs/app/design/screens.md"), `| Screen | Stories | Reach | Shows |\n| --- | --- | --- | --- |\n${rows}\n`);
  writeFileSync(join(root, "scope.mjs"), "export const lists = () => ({ light: new Map(), deep: new Map() });\n");
  const record = recordDir(root);
  mkdirSync(record, { recursive: true });
  writeFileSync(join(record, "accepted.json"), JSON.stringify({ b: { "wide-default": "b0" } }));
  const latest = join(root, ".cache/screens/latest");
  mkdirSync(latest, { recursive: true });
  const accept = async (run, hashes, args = []) => {
    writeFileSync(join(latest, "hashes.json"), JSON.stringify(hashes));
    writeFileSync(join(latest, "run.json"), JSON.stringify({ shots: ["wide-default"], failed: 0, unreached: [], ...run }));
    const log = console.log;
    console.log = () => {};
    try {
      await screens(root, config, ["--accept", ...args]);
    } finally {
      console.log = log;
    }
    return JSON.parse(readFileSync(statePath(root), "utf8"));
  };
  // c's mark is past the first commit, so an accept shot there never moves it back; d is marked at the first.
  writeState({ version: 2, marks: { c: { "wide-default": second }, d: { "wide-default": first } }, last: null, deferred: { count: 0, at: null } }, statePath(root));
  let state = await accept({ mode: "light", at: first, dirty: true, failedNames: ["a"] }, { b: { "wide-default": "b1" } }, ["--except", "b"]);
  assert.deepEqual(state.marks, { c: { "wide-default": second }, d: { "wide-default": first } }, "a run with uncommitted changes settles nothing, and b was left out");
  assert.deepEqual(state.pending, ["a", "b"], "a did not shoot and b was left out: both stay due");
  assert.equal(state.last, first);
  // A deferral at the next chunk end, then the leftovers accepted: the chunk end is not counted again.
  writeState({ ...state, deferred: { count: 1, at: "1234567" } }, statePath(root));
  state = await accept(JSON.parse(readFileSync(join(latest, "run.json"), "utf8")), { b: { "wide-default": "b1" } }, ["b"]);
  assert.deepEqual(state.deferred, { count: 1, at: "1234567" });
  assert.equal(state.last, first);
  assert.deepEqual(state.pending, ["a"]);
  // A clean run at the first commit leaves c, whose mark is not on that run's history, where it is.
  state = await accept({ mode: null, at: first }, {});
  assert.equal(state.marks.c["wide-default"], second, "never moved back");
  // A clean run at the second moves d, which nothing reached, forward to it; a, pending, stays unmarked.
  state = await accept({ mode: null, at: second }, {});
  assert.equal(state.marks.d["wide-default"], second);
  assert.ok(!state.marks.a, "a is pending, so not settled");
  await assert.rejects(accept({ mode: null, at: "HEAD" }, {}), /is not a commit id/);
});

test("a git that cannot check the record's commits stops the read, so no mark is dropped", () => {
  const notRepo = mkdtempSync(join(tmpdir(), "wf-not-repo-"));
  const path = join(notRepo, "state.json");
  writeFileSync(path, JSON.stringify({ version: 2, marks: { a: { "wide-default": "0123456789abcdef0123456789abcdef01234567" } } }));
  assert.throws(() => readState(path, "origin/main", notRepo), /git could not check the screen record's commits/);
  writeFileSync(path, JSON.stringify({ version: 2, marks: {}, pending: "a", deferred: 5, last: "HEAD" }));
  const odd = readState(path, "origin/main", notRepo);
  assert.deepEqual([odd.pending, odd.deferred, odd.last], [undefined, { count: 0, at: null }, null], "values that are not what the record holds are dropped");
});

test("a mark is a commit id the repository has; any other is dropped, and counted", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "wf-marks-")));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "one"], { cwd: root });
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const path = join(root, "state.json");
  writeFileSync(path, JSON.stringify({ version: 2, marks: { a: { "wide-default": head, "narrow-default": "HEAD" }, b: { "wide-default": "--output=/tmp/x" }, c: { "wide-default": ["HEAD"] }, d: { "wide-default": "0123456789abcdef0123456789abcdef01234567" }, e: "x" } }));
  const state = readState(path, "origin/main", root);
  assert.deepEqual(state.marks, { a: { "wide-default": head }, b: {}, c: {}, d: {} });
  assert.equal(state.pruned, 4);
  assert.ok(!JSON.stringify(state).includes("pruned"), "the count is not written back");
});

test("a record from before marks is turned into them on the first accept, keeping what was left open", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "wf-v1-")));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "one"], { cwd: root });
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const config = merge(DEFAULTS, { areas: [{ id: "app", prefix: "APP", docs: "docs/app" }], screens: { scope: "scope.mjs" } });
  mkdirSync(join(root, "docs/app/design"), { recursive: true });
  const rows = ["a", "b", "c"].map((name) => `| \`${name}\` | X-1 | \`s › go #/\` | it |`).join("\n");
  writeFileSync(join(root, "docs/app/design/screens.md"), `| Screen | Stories | Reach | Shows |\n| --- | --- | --- | --- |\n${rows}\n`);
  writeFileSync(join(root, "scope.mjs"), "export const lists = () => ({ light: new Map(), deep: new Map() });\n");
  writeState({ last: head, deep: head, lightRuns: [], deferred: { count: 3, at: "1234567" }, open: { b: head.slice(0, 7) } }, statePath(root));
  const latest = join(root, ".cache/screens/latest");
  mkdirSync(latest, { recursive: true });
  writeFileSync(join(latest, "hashes.json"), JSON.stringify({ a: { "wide-default": "a1" } }));
  writeFileSync(join(latest, "run.json"), JSON.stringify({ mode: null, shots: ["wide-default"], at: head, failed: 0, unreached: [] }));
  const log = console.log;
  console.log = () => {};
  try {
    await screens(root, config, ["--accept"]);
  } finally {
    console.log = log;
  }
  const state = JSON.parse(readFileSync(statePath(root), "utf8"));
  assert.deepEqual(state, { version: 2, marks: { a: { "wide-default": head }, b: { "wide-default": head }, c: { "wide-default": head } }, pending: ["b"], last: head, deferred: { count: 3, at: "1234567" } });
});

test("a virtual display keeps apart from the person's desktop: no KWin scripts, its own D-Bus", () => {
  const runtime = mkdtempSync(join(tmpdir(), "wf-display-"));
  writeFileSync(join(runtime, "stale"), "");
  mkdirSync(join(runtime, "app-agent-display-1-config"));
  writeFileSync(join(runtime, "app-agent-display-1-config", "kwinrc"), "[Plugins]\nkrohnkiteEnabled=true\n");
  const args = displayApart(runtime, "app-agent-display-1", () => true);
  assert.deepEqual(args, [`--setenv=XDG_CONFIG_HOME=${join(runtime, "app-agent-display-1-config")}`, "dbus-run-session", "--"]);
  assert.deepEqual(readdirSync(join(runtime, "app-agent-display-1-config")), [], "an empty config each start, so no script runs");
  assert.deepEqual(displayApart(runtime, "app-agent-display-1", () => false).length, 1, "without dbus-run-session, the empty config still keeps scripts out");
});

test("an app that failed to start says why, in the app's own words, not systemd's", async () => {
  const { startProblem } = await import("../lib/screens/shoot.mjs");
  const rows = [
    ["a Rust panic", "thread 'main' panicked at crates/core/src/db.rs:42:9:\nThe app could not update its saved data\nnote: run with RUST_BACKTRACE=1\napp-1.service: Main process exited, code=dumped\napp-1.service: Consumed 312ms CPU time.", "The app could not update its saved data at crates/core/src/db.rs:42:9:"],
    ["an error line", "loading\nError: no app binary at /x; build it first\napp-1.service: Failed with result 'exit-code'.", "Error: no app binary at /x; build it first"],
    ["only systemd's lines", "app-1.service: Consumed 312ms CPU time.", "app-1.service: Consumed 312ms CPU time."],
    ["nothing", "", "no output"],
  ];
  for (const [what, out, want] of rows) assert.equal(startProblem(out), want, what);
});

test("after two starts in a row fail the same way, an app's other screens are not tried", async () => {
  const { shootList, START_FAILS } = await import("../lib/screens/shoot.mjs");
  const screens = ["a", "b", "c", "d"].map((name) => ({ name }));
  const tried = [];
  const broken = (ctx, screen) => (tried.push(screen.name), "could not start: The app could not update its saved data");
  const problems = shootList({}, screens, [], "", broken);
  assert.equal(START_FAILS, 2);
  assert.deepEqual(tried, ["a", "b"]);
  assert.match(problems.d, /^not tried: the app failed to start 2 times in a row \(The app could not update its saved data\)/);
  // Failures that differ, or a screen that shoots between them, do not stop the list.
  tried.length = 0;
  const mixed = { a: "could not start: one", b: "could not start: two", c: null, d: "could not start: two" };
  shootList({}, screens, [], "", (ctx, screen) => (tried.push(screen.name), mixed[screen.name]));
  assert.deepEqual(tried, ["a", "b", "c", "d"]);
});

test("a run by name does not shoot over a light or deep run not yet accepted, unless --replace", async () => {
  const { unacceptedReview } = await import("../lib/screens/run.mjs");
  const root = realpathSync(mkdtempSync(join(tmpdir(), "wf-replace-")));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
  const config = merge(DEFAULTS, { areas: [{ id: "app", prefix: "APP", docs: "docs/app" }] });
  mkdirSync(join(root, "docs/app/design"), { recursive: true });
  writeFileSync(join(root, "docs/app/design/screens.md"), "| Screen | Stories | Reach | Shows |\n| --- | --- | --- | --- |\n| `a` | X-1 | `s › go #/` | it |\n");
  const latest = join(root, ".cache/screens/latest");
  mkdirSync(latest, { recursive: true });
  const ctx = { run: join(latest, "run.json"), latest };
  writeFileSync(ctx.run, JSON.stringify({ mode: "deep", shots: ["wide-default"] }));
  writeFileSync(join(latest, "hashes.json"), JSON.stringify({ a: {}, b: {} }));
  assert.deepEqual(unacceptedReview(ctx), { mode: "deep", count: 2 });
  await assert.rejects(screens(root, config, ["a"]), /the last run is a deep run with 2 screens not yet accepted; accept it first \(npx wf screens --accept\), or pass --replace/);
  writeFileSync(ctx.run, JSON.stringify({ mode: null }));
  assert.equal(unacceptedReview(ctx), null, "a run by name may be shot over");
  writeFileSync(ctx.run, JSON.stringify({ mode: "light" }));
  writeFileSync(join(latest, "hashes.json"), "{}");
  assert.equal(unacceptedReview(ctx), null, "a review run fully accepted may be shot over");
});

test("the app is built with app.build before a run, or an old binary is refused by app.sources", async () => {
  const { appBuild } = await import("../lib/screens/run.mjs");
  const root = realpathSync(mkdtempSync(join(tmpdir(), "wf-appbuild-")));
  const at = (file, when) => {
    mkdirSync(join(root, file, ".."), { recursive: true });
    writeFileSync(join(root, file), "x");
    utimesSync(join(root, file), when, when);
  };
  const ctx = (app) => ({ root, config: merge(DEFAULTS, { app: { binary: "target/debug/app", ...app } }) });
  const log = console.log;
  console.log = () => {};
  try {
    assert.equal(appBuild(ctx({ build: "true" })), null, "a build that passes");
    assert.match(appBuild(ctx({ build: "echo 'error: it broke' >&2; false" })), /app\.build failed, so nothing was shot:\nerror: it broke/);
  } finally {
    console.log = log;
  }
  at("target/debug/app", new Date("2026-11-20T10:00:00Z"));
  at("crates/core/migrations/0001.sql", new Date("2026-11-21T10:00:00Z"));
  at("crates/core/src/old.rs", new Date("2026-11-19T10:00:00Z"));
  const tracked = () => ["crates/core/migrations/0001.sql", "crates/core/src/old.rs", "README.md"];
  const sources = ["**/migrations/**", "**/*.rs"];
  assert.match(appBuild(ctx({ sources }), [], tracked), /the app binary target\/debug\/app is older than 1 of the files it is built from, such as crates\/core\/migrations\/0001\.sql; build it/);
  assert.equal(appBuild(ctx({ sources }), ["--stale-app"], tracked), null);
  assert.equal(appBuild(ctx({}), [], tracked), null, "with neither set, nothing is checked");
  assert.equal(appBuild(ctx({ sources, kind: "web" }), [], tracked), null, "a web app has no binary");
  at("target/debug/app", new Date("2026-11-22T10:00:00Z"));
  assert.equal(appBuild(ctx({ sources }), [], tracked), null, "built since");
  rmSync(join(root, "target/debug/app"));
  assert.match(appBuild(ctx({ sources }), [], tracked), /no app binary at target\/debug\/app; build it first, or set app\.build/);
});
