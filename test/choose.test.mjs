import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { answersMarkdown } from "../lib/ask/answers.mjs";
import { RULES as S } from "../lib/ask/rules.mjs";
import { normalize } from "../lib/ask/spec.mjs";
import { choose } from "../lib/choose/index.mjs";
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
  ];
  for (const [A, want, why] of rows) assert.equal(command(A), want, why);
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
