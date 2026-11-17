import assert from "node:assert/strict";
import { test } from "node:test";

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { merge } from "../lib/config/config.mjs";
import { DEFAULTS } from "../lib/config/defaults.mjs";
import { chunkStatus, chunkStories, coverage, gateProblems, parseReach, parseScreens, reachCounts, reachLine, screensFiles, unreached } from "../lib/screens/list.mjs";
import { storiesIn } from "../lib/docs/shape.mjs";
import { acceptNames, areasOf, briefs, inAreas, migrate, screens, takenBy, whereRuns, why, withOpen } from "../lib/screens/run.mjs";
import { displayApart, jobsFor, lookStep, sessionSteps, showFor, shotsFor, shotsProblem, splitScreens, stepWord } from "../lib/screens/shoot.mjs";
import { words } from "../lib/app/page.mjs";
import { afterDefer, afterRun, openAfter, readState, recordDir, statePath, withRecordLock, writeState } from "../lib/screens/state.mjs";
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
  assert.deepEqual(readState(join(root, "none.json")), { last: "origin/main", deep: "origin/main", lightRuns: [], deferred: { count: 0, at: null }, open: {} });
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
  assert.deepEqual(deep, { last: "ddddddd4", deep: "ddddddd4", lightRuns: [], deferred: { count: 0, at: null }, open: {} });
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
  writeState({ last: head, deep: "0123456789abcdef0123456789abcdef01234567", lightRuns: [], deferred: { count: 0, at: null } }, statePath(tree));
  assert.ok(!readdirSync(shared).some((f) => f.endsWith(".part")), "written whole, through a file beside it");
  const state = readState(statePath(main), "origin/main", main);
  assert.equal(state.last, head, "a commit the repository has stays");
  assert.equal(state.deep, "origin/main", "a commit since removed counts from the base");
});

test("--area narrows a run to those areas' screens, and its accept does not move the state", async () => {
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

  // A deep run narrowed to uplink is accepted: its pictures count, the state stays.
  const latest = join(root, ".cache/screens/latest");
  mkdirSync(latest, { recursive: true });
  writeFileSync(join(latest, "hashes.json"), JSON.stringify({ accounts: { "wide-default": "h" } }));
  writeFileSync(join(latest, "run.json"), JSON.stringify({ mode: "deep", shots: ["wide-default"], failed: 0, areas: ["uplink"] }));
  const lines = [];
  const log = console.log;
  console.log = (line) => lines.push(String(line));
  try {
    await screens(root, config, ["--accept"]);
  } finally {
    console.log = log;
  }
  assert.match(lines.join("\n"), /covered only uplink, so the state does not move/);
  assert.ok(!existsSync(statePath(root)), "no state written");
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

test("a light run after the state fell back to the base names its range without cutting the branch name", () => {
  const state = afterRun({ last: "origin/main", deep: "origin/main", lightRuns: [], deferred: { count: 0, at: null } }, "light", "1234567890abcdef1234567890abcdef12345678");
  assert.deepEqual(state.lightRuns, ["origin/main..1234567"]);
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

test("open screens stay until an accept takes them, and join the deep list only", () => {
  const open = openAfter({ a: "1111111", b: "1111111", gone: "1111111" }, ["a"], ["c"], "2222222abcdef", ["a", "b", "c"]);
  assert.deepEqual(open, { b: "1111111", c: "2222222" }, "a was taken, gone is off the list, c is left out now");
  const start = { last: "aaaaaaa1", deep: "aaaaaaa1", lightRuns: ["x..y"], deferred: { count: 2, at: "aaaaaaa" }, open: { b: "1111111" } };
  assert.deepEqual(afterRun(start, "deep", "ddddddd4", open), { last: "ddddddd4", deep: "ddddddd4", lightRuns: [], deferred: { count: 0, at: null }, open });
  assert.deepEqual(afterRun(start, "light", "ddddddd4").open, { b: "1111111" }, "a whole light accept keeps what was open");
  assert.deepEqual(afterDefer(start, "eeeeeee5").open, { b: "1111111" });

  const lists = { light: new Map([["b", ["b.tsx"]], ["d", ["d.tsx"]]]), deep: new Map([["e", ["shell.tsx"]]]) };
  const now = withOpen(lists, { b: "1111111", c: "2222222", gone: "1111111" }, ["b", "c", "d", "e"]);
  assert.deepEqual([...now.light.keys()], ["d"], "an open screen is on the deep list only");
  assert.deepEqual([...now.deep], [["e", ["shell.tsx"]], ["b", ["b.tsx", "left open at 1111111"]], ["c", ["left open at 2222222"]]]);
  assert.deepEqual([...now.open.keys()], ["b", "c"], "a screen off the list is not open");
  assert.deepEqual([...lists.light.keys()], ["b", "d"], "the project's lists are not changed");
});

test("a partial accept takes the named screens, moves the marks, and keeps the rest open and listed to read", async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "wf-partial-")));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "one"], { cwd: root });
  const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const config = merge(DEFAULTS, { areas: [{ id: "app", prefix: "APP", docs: "docs/app" }], screens: { scope: "scope.mjs" } });
  mkdirSync(join(root, "docs/app/design"), { recursive: true });
  const rows = ["a", "b", "c"].map((name) => `| \`${name}\` | X-1 | \`s › go #/\` | it |`).join("\n");
  writeFileSync(join(root, "docs/app/design/screens.md"), `| Screen | Stories | Reach | Shows |\n| --- | --- | --- | --- |\n${rows}\n`);
  writeFileSync(join(root, "scope.mjs"), 'export const lists = () => ({ light: new Map([["b", ["b.tsx"]]]), deep: new Map() });\n');
  const latest = join(root, ".cache/screens/latest");
  const record = recordDir(root);
  const read = (path) => JSON.parse(readFileSync(path, "utf8"));
  const shot = (mode, hashes) => {
    mkdirSync(latest, { recursive: true });
    writeFileSync(join(latest, "hashes.json"), JSON.stringify(hashes));
    writeFileSync(join(latest, "run.json"), JSON.stringify({ mode, shots: ["wide-default"], failed: 0 }));
    writeFileSync(join(root, ".cache/screens/to-read.json"), JSON.stringify(["a", "b"].map((name) => ({ name, why: "app changed", pictures: [], framed: false }))));
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

  // A deep run changed a and b; c is as accepted. b has a fault, so it is left out.
  shot("deep", { a: { "wide-default": "a1" }, b: { "wide-default": "b1" }, c: { "wide-default": "c1" } });
  await assert.rejects(say("--accept", "--except", "z"), /not in the last run: z/);
  assert.deepEqual(read(join(record, "accepted.json")), { c: { "wide-default": "c1" } }, "a wrong name accepts nothing");
  assert.match(await say("--accept", "--except", "b"), /Accepted 2 screens, left 1 to read[\s\S]*deep run is recorded[\s\S]*Left open: 1 screens/);
  assert.deepEqual(Object.keys(read(join(record, "accepted.json"))).sort(), ["a", "c"]);
  assert.deepEqual(read(statePath(root)), { last: head, deep: head, lightRuns: [], deferred: { count: 0, at: null }, open: { b: head.slice(0, 7) } });
  assert.deepEqual(read(join(root, ".cache/screens/to-read.json")).map((item) => item.name), ["b"], "b is still listed to read");
  assert.equal(await say("scope", "--names", "open"), "b");
  assert.equal(await say("scope", "--names", "light"), "", "an open screen is on the deep list only");
  assert.match(await say("scope"), /Deep, since \w{7}: 1 screens[\s\S]*Left open: 1 of the deep list's screens/);

  // b is fixed and accepted from the same run: it closes, and the run is not recorded twice.
  assert.match(await say("--accept", "b"), /Accepted 1 screens\./);
  assert.deepEqual(read(statePath(root)), { last: head, deep: head, lightRuns: [], deferred: { count: 0, at: null }, open: {} });
  assert.ok(!existsSync(join(root, ".cache/screens/to-read.json")), "nothing left to read");

  // A light run by names: only the changed screen left out is open, not the unchanged one.
  shot("light", { a: { "wide-default": "a2" }, b: { "wide-default": "b2" }, c: { "wide-default": "c1" } });
  await say("--accept", "a");
  const state = read(statePath(root));
  assert.deepEqual(state.open, { b: head.slice(0, 7) });
  assert.equal(state.lightRuns.length, 1);
  assert.equal(read(join(record, "accepted.json")).b["wide-default"], "b1", "b keeps its last accepted picture");
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
