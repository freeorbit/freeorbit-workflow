import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { answersMarkdown } from "../lib/ask/answers.mjs";
import { RULES as S } from "../lib/ask/rules.mjs";
import { normalize } from "../lib/ask/spec.mjs";
import { pictures } from "../lib/ask/advice.mjs";
import { chunkAdvice, chunkDetails, chunkSpec, historyOf, startable } from "../lib/choose/chunk.mjs";
import { e2eSpec } from "../lib/choose/e2e.mjs";
import { choose } from "../lib/choose/index.mjs";
import { releaseAdvice, releaseSpec, unreleasedNotes } from "../lib/choose/release.mjs";
import { ledgerState, reviewAdvice, reviewSpec } from "../lib/choose/review.mjs";
import { screensAdvice } from "../lib/choose/screens.mjs";
import { merge } from "../lib/config/config.mjs";
import { DEFAULTS } from "../lib/config/defaults.mjs";

const EXAMPLE = JSON.parse(readFileSync(new URL("../plugins/core/skills/ask-page/examples/launch.json", import.meta.url), "utf8"));

test("a launch page asks which run, and each option as a follow-up of the runs it names", () => {
  const { spec, problems } = normalize(EXAMPLE);
  assert.deepEqual(problems, []);
  assert.deepEqual(spec.questions.map((q) => q.id), ["run", "show", "stress", "area"]);
  assert.equal(spec.questions[0].options[1].preview, "$ npx wf screens --deep");
  assert.deepEqual(spec.questions[2].showIf.is, ["light", "deep"]);
  assert.deepEqual(spec.launch.modifiers[1], { id: "stress", kind: "toggle", flag: "--wide --stress", flags: { on: "--wide --stress", off: "" } });
});

test("a launch spec that cannot make its command is refused", () => {
  const bad = (change) => normalize({ ...EXAMPLE, ...change }).problems.join("\n");
  const rows = [
    [{ runs: [{ id: "a", label: "A", why: "x" }], recommended: "a" }, /a run has the command it runs/],
    [{ modifiers: [{ id: "x", text: "X?", kind: "toggle" }] }, /a toggle has the flag it adds/],
    [{ modifiers: [{ id: "x", text: "X?", kind: "text", flag: "--x" }] }, /says where the words go, as \{value\}/],
    [{ modifiers: [{ id: "x", text: "X?", kind: "choice", options: [{ id: "a", label: "A", why: "a" }], recommended: "a", why: "w", runs: ["nope"] }] }, /runs names nope, which is not a run/],
    [{ modifiers: [{ id: "x", text: "X?", kind: "slider" }] }, /kind is toggle, choice, text/],
  ];
  for (const [change, want] of rows) assert.match(bad(change), want);
  assert.match(normalize({ id: "d", title: "D", questions: [{ id: "q", text: "Q?", type: "text" }], modifiers: [] }).problems.join(), /modifiers belong to a launch page/);
});

test("the command is the run's, then each shown option's flag, an open option counting as its recommendation", () => {
  const { spec } = normalize(EXAMPLE);
  const command = (A) => S.launchCommand(spec.launch, spec.questions, A);
  const rows = [
    [{}, null, "no run picked"],
    [{ run: { choice: "deep" } }, "npx wf screens --deep", "options left open take their recommendations"],
    [{ run: { choice: "deep" }, show: { choice: "screen" }, stress: { choice: "on" }, area: { text: "uplink,downlink" } }, "npx wf screens --deep --show screen --wide --stress --area uplink,downlink", "every option"],
    [{ run: { choice: "defer" }, show: { choice: "screen" } }, "npx wf screens --defer", "an option for other runs is left out"],
    [{ run: { choice: "light" }, area: { text: "a b; rm -rf ~" } }, "npx wf screens --light --area a 'b;' rm -rf '~'", "typed words are quoted for the shell"],
    [{ run: { choice: "light" }, area: { text: "$' $& $$" } }, "npx wf screens --light --area '$'\\''' '$&' '$$'", "a $ pattern in typed words stays as typed"],
  ];
  for (const [A, want, why] of rows) assert.equal(command(A), want, why);
});

test("a triage item's answer line gives its ID once", () => {
  const { spec } = normalize({ id: "t", title: "T", template: "triage", items: [{ id: "q-1", text: "Pick a name", recommended: "answer", why: "w" }] });
  const record = { id: "t", hash: spec.hash, submitted: "2026-11-17T10:00:00Z", answers: { "q-1": { choice: "drop" } } };
  assert.match(answersMarkdown(spec, record), /^- \*\*q-1\*\* Pick a name: \*\*drop\*\*/m);
});

test("the answers start with the command", () => {
  const { spec } = normalize(EXAMPLE);
  const record = { id: spec.id, hash: spec.hash, submitted: "2026-11-17T10:00:00Z", answers: { run: { choice: "light" }, show: { choice: "set" }, stress: { choice: "off" } } };
  assert.match(answersMarkdown(spec, record), /^Command: `npx wf screens --light`$/m);
  assert.doesNotMatch(answersMarkdown(spec, null), /Command:/);
});

test("the ledger's state, and the run each choice point recommends", () => {
  const ledger = "# Review findings\n\nLast reviewed: cf7b336d on 2026-11-17, diff.\nDeep reviewed: c318b08e on 2026-11-17.\nDeferred: 2 times, last at abc1234 on 2026-11-17.\n\n## Light runs\n\n| Range | Date | Mode |\n| --- | --- | --- |\n| `a..b` | 2026-11-17 | diff |\n| `b..c` | 2026-11-17 | diff |\n\nRubric: x\n\n## Open\n\n| `x` | y |\n";
  assert.deepEqual(ledgerState(ledger), { last: "cf7b336d", deep: "c318b08e", deferred: 2, lightRuns: 2 });
  assert.deepEqual(ledgerState("Last reviewed: none.\nDeep reviewed: none.\nDeferred: none.\n"), { last: null, deep: null, deferred: 0, lightRuns: 0 });
  const review = [[{ last: null, lightRuns: 0 }, "full"], [{ last: "a", lightRuns: 2 }, "deep"], [{ last: "a", lightRuns: 1 }, "light"]];
  for (const [state, run] of review) assert.equal(reviewAdvice(state).run, run);
  const screens = [[{ light: 0, deep: 0, lightRuns: 0 }, "defer"], [{ light: 3, deep: 9, lightRuns: 2 }, "deep"], [{ light: 0, deep: 9, lightRuns: 0 }, "deep"], [{ light: 3, deep: 9, lightRuns: 0 }, "light"]];
  for (const [state, run] of screens) assert.equal(screensAdvice(state).run, run);
});

test("wf choose review writes a launch spec from the project that builds as it is", async () => {
  const root = mkdtempSync(join(tmpdir(), "wf-choose-"));
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  git("init", "-q");
  git("config", "user.email", "t@example.test");
  git("config", "user.name", "t");
  mkdirSync(join(root, "docs/log"), { recursive: true });
  writeFileSync(join(root, "a.ts"), "a\n");
  git("add", ".");
  git("commit", "-qm", "one");
  const first = git("rev-parse", "--short", "HEAD");
  writeFileSync(join(root, "docs/log/review-findings.md"), `Last reviewed: ${first} on 2026-11-17, diff.\nDeep reviewed: ${first} on 2026-11-17.\nDeferred: none.\n`);
  writeFileSync(join(root, "a.ts"), "b\n");
  const spec = reviewSpec(root, merge(DEFAULTS, {}));
  assert.deepEqual(spec.runs.map((r) => r.id), ["light", "deep", "full", "defer"]);
  assert.equal(spec.runs[0].command, `npx wf scan diff ${first} --light`);
  assert.equal(spec.recommended, "light");
  assert.deepEqual(normalize(spec).problems, []);
  const out = [];
  assert.equal(await choose(root, merge(DEFAULTS, {}), ["nope"], (line) => out.push(line)), 2);
  assert.match(out.join("\n"), /review .*\n\s+screens /);
});

test("chunk start offers what can start, what is in progress, and a quick fix, and recommends carrying on first", () => {
  const rows = [
    { chunk: "CH-03. Search", group: "Not started", waitsOn: "CH-02" },
    { chunk: "CH-04. Labels", group: "Not started", waitsOn: "CH-01" },
    { chunk: "CH-05. Export", group: "Not started", waitsOn: "" },
  ];
  const ready = startable(rows, new Set(["CH-01"]));
  assert.deepEqual(ready.map((row) => [row.id, row.waiting]), [["CH-03", ["CH-02"]], ["CH-04", []], ["CH-05", []]]);
  const words = startable([{ chunk: "CH-06. Sync", group: "Not started", waitsOn: "—" }, { chunk: "CH-07. Share", group: "Not started", waitsOn: "None" }], new Set());
  assert.deepEqual(words.map((row) => row.waiting), [[], []], "a dash or None waits on nothing");
});

test("chunk advice: carry on, else the first with nothing open, else the first, else a quick fix", () => {
  const open = (id) => (id === "37f" ? 2 : 0);
  const rows = [
    // in progress, ready, open questions → run, why
    [[{ id: "CH-02" }], [{ id: "CH-04" }], undefined, "c-CH-02", /CH-02 is in progress/],
    [[], [{ id: "CH-04" }, { id: "CH-05" }], undefined, "c-CH-04", /CH-04 is first in the build order/],
    [[], [{ id: "37f" }, { id: "37m" }], open, "c-37m", /37f comes first but waits on 2 open questions; 37m can start now with none/],
    [[], [{ id: "37f" }], open, "c-37f", /though 2 questions on it are still open/],
    [[], [], undefined, "quick", /No chunk can start/],
  ];
  for (const [inProgress, ready, openFor, run, why] of rows) {
    const advice = chunkAdvice(inProgress, ready, openFor);
    assert.equal(advice.run, run);
    assert.match(advice.why, why);
  }
});

test("a chunk's history is the log lines naming it, once each, clipped", () => {
  const log = "# Log\n\n- 2026-11-01: chunk 36 added for the looks.\n- 2026-11-02: 36b split off.\n- 2026-11-03: 136 done.\n- 2026-11-04: " + "x ".repeat(200) + "36\n";
  const other = "- 2026-11-01: chunk 36 added for the looks.\n";
  const lines = historyOf([log, other], "36");
  assert.deepEqual(lines.map((l) => l.date), ["2026-11-01", "2026-11-04"], "36b and 136 are other chunks; a line in two logs shows once");
  assert.equal(lines[1].text.length, 280);
  assert.ok(lines[1].text.endsWith("…"));
});

test("a release recommends the open line's next pre-release, else a patch line, and knows when notes are written", () => {
  assert.equal(releaseAdvice([{ kind: "pre-release", version: "0.2.0-rc.2", why: "the next of the open line, after v0.2.0-rc.1" }]).run, "pre-release-1");
  assert.equal(releaseAdvice([{ kind: "patch" }, { kind: "minor" }]).run, "patch");
  assert.equal(unreleasedNotes("# Changelog\n\n## Unreleased\n\n- Fixed the sign-in.\n\n## 0.1.0\n\n- First.\n"), true);
  assert.equal(unreleasedNotes("# Changelog\n\n## Unreleased\n\n## 0.1.0\n\n- First.\n"), false);
});

test("each new choice point writes a launch spec that builds as it is, and one way is no choice", async () => {
  const root = mkdtempSync(join(tmpdir(), "wf-choose-points-"));
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  git("init", "-q");
  git("config", "user.email", "t@example.test");
  git("config", "user.name", "t");
  mkdirSync(join(root, "docs/log"), { recursive: true });
  mkdirSync(join(root, "docs/app/test-data"), { recursive: true });
  writeFileSync(join(root, "docs/log/build-order.md"), "## Not started\n\n| Chunk | Status | Stories | Waits on |\n| --- | --- | --- | --- |\n| CH-01. Sign-in | Not started | APP-01 | |\n| CH-04; rm -rf x. Bad | Not started | | |\n");
  writeFileSync(join(root, "docs/app/test-data/core.md"), "### DS-APP-1. Sign in\n\n### DS-APP-2. Sign out\n");
  writeFileSync(join(root, "a.txt"), "a\n");
  git("add", ".");
  git("commit", "-qm", "one");
  git("tag", "v0.1.0-rc.1");
  const config = merge(DEFAULTS, { areas: [{ id: "app", prefix: "APP", docs: "docs/app" }] });
  for (const spec of [chunkSpec(root, config), releaseSpec(root, config)]) assert.deepEqual(normalize(spec).problems, [], spec.id);
  const two = merge(DEFAULTS, { areas: [{ id: "app", prefix: "APP", docs: "docs/app" }, { id: "web", prefix: "WEB", docs: "docs/web" }] });
  assert.deepEqual(normalize(e2eSpec(root, two)).problems, [], "e2e with two areas");
  const said = [];
  assert.equal(await choose(root, config, ["e2e"], () => {}, (line) => said.push(line)), 3, "one area is no choice");
  assert.deepEqual(said, ["Nothing to choose: app. Run npx wf testdata journeys app"]);
  const chunk = chunkSpec(root, config);
  assert.equal(chunk.recommended, "c-CH-01");
  assert.ok(chunk.runs.every((run) => !/rm/.test(run.command ?? "")), "a malformed chunk id never reaches a command");
  assert.match(chunk.blocks.find((b) => b.title === "Not offered here").text, /CH-04; rm -rf x\. Bad\*\* is left out/);
  assert.equal(releaseSpec(root, config).runs[0].command, "npx wf release check 0.1.0-rc.2");
  assert.equal(e2eSpec(root, config).runs[0].why, "2 journeys");
});

test("a chunk's details say what it delivers, count it, show its frames and stories, and what is open on it", () => {
  const story = { id: "APP-26", title: "Pick a look", as: "As a person I want a dark look", acceptance: [{ text: "a", removed: false, risk: null }, { text: "b", removed: false, risk: { level: "high" } }], risk: null };
  const blocks = chunkDetails({ id: "36", forClient: "Looks you can pick", who: "Ken", waitsOn: "35" }, { stories: [story], frames: [{ image: "docs/x.png", label: "x" }], questions: [{ id: "Q-1", needs: "designer", question: "Which accent?" }], unreached: 1, doneIds: new Set(["35"]) });
  assert.deepEqual(blocks.map((b) => b.type), ["text", "stats", "pictures", "table", "text"]);
  assert.match(blocks[0].text, /\*\*For the client:\*\* Looks you can pick[\s\S]*\*\*Waits on:\*\* 35 \(done\)/);
  assert.deepEqual(blocks[1].items.map((i) => [i.label, i.value, i.note ?? ""]), [["Stories", "1", ""], ["Acceptance lines", "2", "1 high-risk"], ["Frames", "1", "1 not reached yet"], ["Open questions", "1", ""]]);
  assert.deepEqual(blocks[3].rows, [["APP-26 Pick a look", "As a person I want a dark look", "2", "1 high"]]);
  assert.match(blocks[4].text, /\*\*Q-1\*\* \(needs designer\): Which accent\?/);
});

test("a launch run's details are checked as blocks, and a pictures block's pictures are copied like a question's", () => {
  const raw = JSON.parse(JSON.stringify(EXAMPLE));
  const { spec, problems } = normalize(raw);
  assert.deepEqual(problems, []);
  assert.deepEqual(spec.launch.details.deep.map((b) => b.type), ["text", "pictures"]);
  assert.deepEqual(pictures(spec).map((p) => p.image), [".cache/screens/latest/accounts-wide.png"]);
  raw.runs[1].details = [{ type: "pictures", items: [] }];
  assert.match(normalize(raw).problems.join(), /a pictures block lists its items/);
});
