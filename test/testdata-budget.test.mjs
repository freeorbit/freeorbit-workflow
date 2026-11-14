import assert from "node:assert/strict";
import { test } from "node:test";

import { merge } from "../lib/config/config.mjs";
import { DEFAULTS } from "../lib/config/defaults.mjs";
import { readStories, riskLines } from "../lib/docs/stories.mjs";
import { findId } from "../lib/idfind.mjs";
import { kindOf } from "../lib/ids.mjs";
import { testdataProblems, testdataWarnings } from "../lib/testdata.mjs";
import { budget, budgetLines, checkDelta, grown } from "../lib/testdata-budget.mjs";
import { builtStories, pruneChecks, pruneLines } from "../lib/testdata-prune.mjs";

const DOCS = "docs/plugins/uplink";
const DIR = `${DOCS}/test-data`;
const config = (more = {}) => merge(DEFAULTS, { areas: [{ id: "uplink", prefix: "GM", docs: DOCS }], stories: { files: ["docs/plugins/*/user-stories.md"] }, ...more });
const context = (cfg, texts) => ({ config: cfg, tracked: Object.keys(texts), files: (p) => texts[p] ?? "" });
const story = (id, lines, risk = "") => `### ${id}. A story\n\nAs a user, I want it.\n\n${risk ? `${risk}\n\n` : ""}Acceptance:\n\n${lines.map((l) => `- ${l}`).join("\n")}\n`;
const FIXTURES = "| Fixture | Varies | Expect | Stories | Rules | Reach |\n| --- | --- | --- | --- | --- | --- |";
const fixtures = (name, n, stories, rules = "") => Array.from({ length: n }, (_, i) => `| \`${name}-${i}\` | a state | kept | ${stories} | ${rules} | typed at \`ready\` |`);

test("an acceptance line has an ID by its place, a removed line keeps its place, and a line can be tagged high-risk on its own", () => {
  const [s] = readStories(story("GM-07", ["The letter is filled in.", "My details are kept for the next letter. Risk: high (privacy)", "Removed (2026-11-14).", "The step finishes\n  with AI off. Risk: high"]), ["GM"]);
  assert.deepEqual(s.acceptance.map((a) => [a.id, a.text, Boolean(a.risk), a.removed]), [["GM-07.1", "The letter is filled in.", false, false], ["GM-07.2", "My details are kept for the next letter.", true, false], ["GM-07.3", "Removed (2026-11-14).", false, true], ["GM-07.4", "The step finishes with AI off.", true, false]]);
  assert.deepEqual(s.acceptance[1].risk, { level: "high", reasons: ["privacy"] });
  const found = riskLines(s);
  assert.deepEqual([found.by, found.lines.length, found.high.map((a) => a.id)], ["line", 3, ["GM-07.2", "GM-07.4"]]);
  const [whole] = readStories(story("GM-08", ["One", "Two"], "Risk: high (money)"), ["GM"]);
  assert.deepEqual([riskLines(whole).by, riskLines(whole).high.length], ["story", 2], "a story's own Risk line makes every line high");
  assert.equal(riskLines(readStories(story("GM-09", ["One"]), ["GM"])[0]).by, "low");
});

test("wf id knows an acceptance line, and finds it in its story", () => {
  const cfg = config();
  assert.equal(kindOf("GM-07.2", cfg), "acceptance");
  assert.equal(kindOf("GM-07", cfg), "story");
  const texts = { [`${DOCS}/user-stories.md`]: story("GM-07", ["Shown", "Kept"]), "src/a.test.ts": "test('kept', () => {}) // GM-07.2\n" };
  const found = findId(context(cfg, texts), "GM-07.2");
  assert.deepEqual(found.defined.map((d) => d.text), ["GM-07. A story: Kept"]);
  assert.deepEqual(found.cited.map((c) => c.path), ["src/a.test.ts"]);
});

test("a fixture budget follows the risk: a high story's cap, two for each high line, none for a low story; allow raises one", () => {
  const texts = {
    [`${DOCS}/user-stories.md`]: [story("GM-01", ["a", "b"], "Risk: high (money)"), story("GM-02", ["a", "b. Risk: high (privacy)"]), story("GM-03", ["a"])].join("\n"),
    [`${DIR}/move.md`]: [FIXTURES, ...fixtures("m-one", 6, "GM-01", "R-GM-01"), ...fixtures("m-two", 2, "GM-02"), ...fixtures("m-three", 1, "GM-03")].join("\n"),
  };
  const found = budget(context(config(), texts), "uplink");
  assert.deepEqual(found.stories.map((s) => [s.id, s.by, s.fixtures, s.cap]), [["GM-01", "story", 6, 5], ["GM-02", "line", 2, 2], ["GM-03", "low", 1, 0]]);
  assert.deepEqual(found.over.map((each) => each.text.slice(0, 44)), ["GM-01: 6 edge-case fixtures, over its 5", "GM-03: 1 edge-case fixtures, over its 0 (a l", "R-GM-01: 6 edge-case fixtures cite it, over "]);
  const lines = budgetLines(found, config().testdata.limits);
  assert.equal(lines[0], "Budget:");
  assert.ok(lines.includes("- GM-02 (1 high-risk line): fixtures 2 of 2, no room"));
  assert.ok(lines.includes("- At most 2 proposed acceptance lines a story and 5 questions in all, the most important first; anything past that is cut."));
  assert.ok(lines.includes("- A file holds about 100 lines, and a flow area about 40 KB."));
  const numbered = { ...texts, [`${DIR}/rules.md`]: "| ID | Category | Rule | Stories | Accepted |\n| --- | --- | --- | --- | --- |\n| R-GM-07 | Time | Fixed today | GM-01 | 2026-11-13 |\n\n| ID | What | Why | Dropped |\n| --- | --- | --- | --- |\n| R-GM-12 | Old | No | 2026-11-14 |\n\n### DS-GM-03. Mail\n" };
  assert.ok(budgetLines(budget(context(config(), numbered), "uplink"), config().testdata.limits).includes("- Next free IDs: R-GM-13 for a rule, G-GM-01 for a gap, DS-GM-04 for a dataset."), "a dropped rule's number is never given again");
  const scoped = budget(context(config(), texts), "uplink", ["GM-02"]);
  assert.deepEqual([scoped.stories.map((s) => s.id), scoped.over], [["GM-02"], []], "a refresh is held to its own stories");
  const allowed = budget(context(config({ testdata: { limits: { allow: { "GM-01": 6, "R-GM-01": 6, "GM-03": 1 } } } }), texts), "uplink");
  assert.deepEqual(allowed.over, []);
});

test("a designer's return is held to its caps: five questions, two proposed lines a story, and no check rows", () => {
  const q = (n) => `| G-GM-${String(n).padStart(2, "0")} | gap | Time | Question ${n}? | GM-07 |`;
  const text = ["# Test data delta", "", "## Questions", "| ID | Kind | Category | Question | Stories |", "| --- | --- | --- | --- | --- |", ...[1, 2, 3, 4, 5, 6, 7].map(q), "",
    "## Proposed acceptance", "| Story | Proposed line | Why |", "| --- | --- | --- |", "| GM-07 | One | x |", "| GM-07 | Two | x |", "| GM-07 | Three | x |", "| DR-01 | Other area | x |", "",
    "| ID | Check | Stories |", "| --- | --- | --- |", "| C-GM-99 | A check | GM-07 |"].join("\n");
  const found = checkDelta(text, config(), "GM");
  assert.equal(found.problems.length, 4, found.problems.join("\n"));
  assert.match(found.problems[0], /1 check rows: the designer writes no checks/);
  assert.match(found.problems[1], /7 questions, over 5: keep the first 5; held back: G-GM-06, G-GM-07/);
  assert.match(found.problems[2], /DR-01, which is not one of this area's/);
  assert.match(found.problems[3], /GM-07: 3 proposed acceptance lines, over 2/);
  assert.deepEqual(found.held, ["G-GM-06", "G-GM-07", "GM-07: Three"]);
  assert.deepEqual(checkDelta("Need: none", config(), "GM"), { problems: [], held: [] });
  // A first draft's files hold gaps tables of their own: those rows are the files', not this run's questions.
  const draft = ["`docs/x/test-data/move.md`", "", "## Gaps", "", "| ID | Kind | Category | Question | Stories |", "| --- | --- | --- | --- | --- |", ...[1, 2, 3, 4, 5, 6, 7].map(q)].join("\n");
  assert.deepEqual(checkDelta(draft, config(), "GM").problems, []);
});

test("doc:check warns when over a third of an area's acceptance lines are high-risk, and fails a proof row or a dispute that names no line", () => {
  const stories = { [`${DOCS}/user-stories.md`]: [story("GM-01", ["a", "b"], "Risk: high (money)"), story("GM-02", ["a", "b", "c"])].join("\n") };
  const warned = testdataWarnings(context(config(), stories)).filter((w) => /Risk: high/.test(w));
  assert.deepEqual(warned, [`${DOCS}: 2 of 5 acceptance lines are Risk: high, over 34%, 1 story tagged whole; end only the lines that are with "Risk: high (<why>)" and take the story's own Risk line out, so depth goes where the risk is`]);
  const lined = { [`${DOCS}/user-stories.md`]: [story("GM-01", ["a", "b. Risk: high (money)"]), story("GM-02", ["a", "b", "c"])].join("\n") };
  assert.deepEqual(testdataWarnings(context(config(), lined)).filter((w) => /Risk: high/.test(w)), []);
  const texts = { ...lined, [`${DIR}/move.md`]: ["| Line | By |", "| --- | --- |", "| GM-01.2 | walk |", "| GM-01.9 | walk |", "| GM-02.1 | soon |", "", "| ID | Kind | Question |", "| --- | --- | --- |", "| G-GM-01 | dispute | GM-02.7 cannot hold |"].join("\n") };
  assert.deepEqual(testdataProblems(context(config(), texts)).map((p) => p.replace(/^.*?: /, "").slice(0, 38)), ["the proof table names GM-01.9, which i", 'GM-02.1 By "soon" is not walk, walked ', "GM-02.7 is disputed but is no story's "]);
});

test("prune takes out check rows nothing cites, for built stories; cited, walked, disputed, and unbuilt rows stay", () => {
  const CHECKS = "| ID | Check | Stories | Rules | By |\n| --- | --- | --- | --- | --- |";
  const texts = {
    [`${DIR}/move.md`]: ["# Move", "", "## Checks", "", CHECKS,
      "| C-GM-01 | Cited by a test | GM-01 | | |", "| C-GM-02 | Cited by nothing | GM-01 | | |", "| C-GM-03 | Walked | GM-01 | | walk |", "| C-GM-04 | Disputed | GM-01 | | |",
      "| C-GM-05 | Not built yet | GM-02 | | |", "| C-GM-07 | Named in a screen list | GM-01 | | |", "| C-GM-08 | Also uncited | GM-01 | | |", "",
      "## Gaps", "", "| ID | Kind | Question |", "| --- | --- | --- |", "| G-GM-01 | dispute | C-GM-04 cannot hold |", ""].join("\n"),
    [`${DIR}/old.md`]: ["# Old", "", "Kept text.", "", "## Checks", "", CHECKS, "| C-GM-09 | Gone | GM-01 | | |", "", "## Rules", "", "| ID | Category | Rule | Stories | Accepted |", "| --- | --- | --- | --- | --- |", "| R-GM-01 | Time | Today is fixed | GM-01 | 2026-11-13 |", ""].join("\n"),
    "docs/design/screens.md": "The Reach of this frame shows C-GM-07.\n",
    "crates/a/src/lib.rs": "#[test]\n// C-GM-01\nfn shown() {}\n",
  };
  const built = builtStories("## Done\n\n| Chunk | Title | Stories | Status |\n| --- | --- | --- | --- |\n| CH-01 | Move | GM-01 | Done |\n");
  assert.deepEqual([...built], ["GM-01"]);
  const found = pruneChecks(context(config(), texts), "uplink", { built });
  assert.deepEqual(found.pruned.map((p) => p.id), ["C-GM-02", "C-GM-08", "C-GM-09"]);
  assert.deepEqual(found.kept, { cited: 2, by: 1, disputed: 1, unbuilt: 1 });
  assert.equal(found.texts.get(`${DIR}/old.md`), ["# Old", "", "Kept text.", "", "## Rules", "", "| ID | Category | Rule | Stories | Accepted |", "| --- | --- | --- | --- | --- |", "| R-GM-01 | Time | Today is fixed | GM-01 | 2026-11-13 |", ""].join("\n"), "an emptied table goes with its heading; a rule is never touched");
  assert.ok(!/C-GM-02|C-GM-08/.test(found.texts.get(`${DIR}/move.md`)) && /C-GM-01[\s\S]*C-GM-03[\s\S]*## Gaps/.test(found.texts.get(`${DIR}/move.md`)));
  assert.match(pruneLines(found)[0], /3 check rows to prune, in 2 files \(a dry run; --write applies it\)\./);
  const all = pruneChecks(context(config(), texts), "uplink", { built, all: true });
  assert.deepEqual(all.pruned.map((p) => p.id), ["C-GM-02", "C-GM-05", "C-GM-08", "C-GM-09"]);
});

test("a refresh is held to what it added: an overage already there at the last commit does not stop the close, and an area the kit cannot read is the project's to report", async () => {
  const { runCloseGate } = await import("../lib/testdata-cli.mjs");
  const stories = { [`${DOCS}/user-stories.md`]: [story("GM-01", ["a"], "Risk: high (money)"), story("GM-03", ["a"]), story("GM-04", ["a"]), story("GM-05", ["a"])].join("\n") };
  const before = { ...stories, [`${DIR}/move.md`]: [FIXTURES, ...fixtures("m-one", 6, "GM-01"), ...fixtures("m-three", 1, "GM-03")].join("\n") };
  const now = { ...stories, [`${DIR}/move.md`]: [FIXTURES, ...fixtures("m-one", 7, "GM-01"), ...fixtures("m-three", 1, "GM-03")].join("\n") };
  const over = (texts, ids) => grown(budget(context(config(), texts), "uplink", ids), budget(context(config(), before), "uplink", ids)).map((each) => each.key);
  assert.deepEqual(over(before, ["GM-01", "GM-03"]), [], "GM-01 and GM-03 were over before this refresh");
  assert.deepEqual(over(now, ["GM-01", "GM-03"]), ["GM-01"], "only the story the refresh added to");
  const run = (args) => { const out = []; return { code: runCloseGate(context(config(), now), (p) => before[p] ?? "", args, (line) => out.push(line)), out: out.join("\n") }; };
  assert.equal(run(["uplink", "GM-03"]).code, 0);
  assert.match(run(["uplink", "GM-01"]).out, /more than at the last commit:\n {2}GM-01: 7 edge-case fixtures, over its 5[\s\S]*refresh-close refused/);
  assert.equal(run(["uplnk", "GM-01"]).code, 0, "a mistyped area goes on to the project's own step");
  // A Stories cell is read as the build order reads one: a range names every story in it.
  const ranged = { ...stories, [`${DIR}/move.md`]: [FIXTURES, ...fixtures("m-range", 2, "GM-03 to GM-05")].join("\n") };
  assert.deepEqual(budget(context(config(), ranged), "uplink").stories.map((s) => [s.id, s.fixtures]), [["GM-01", 0], ["GM-03", 2], ["GM-04", 2], ["GM-05", 2]]);
});

test("a retired setting is ignored, not refused; a line's own words ending in risk: high are not a tag", async () => {
  const { unknownKeys } = await import("../lib/config/config.mjs");
  assert.deepEqual(unknownKeys({ testdata: { limits: { checks: { story: 12 }, cheks: 1 } } }), ["testdata.limits.cheks"]);
  const [s] = readStories(story("GM-07", ["A late request shows its risk: high", "Kept. Risk: high (privacy)"]), ["GM"]);
  assert.deepEqual(s.acceptance.map((a) => [a.text, Boolean(a.risk)]), [["A late request shows its risk: high", false], ["Kept.", true]]);
});

test("prune leaves an empty table that is not a checks table, and the kit's own docs cite nothing; a Drop on the solo craft row names no rule", async () => {
  const CHECKS = "| ID | Check | Stories |\n| --- | --- | --- |";
  const texts = {
    [`${DIR}/move.md`]: ["# Move", "", "## Proposed rules", "", "| ID | Category | Rule | Stories | Accepted |", "| --- | --- | --- | --- | --- |", "", "## Checks", "", CHECKS, "| C-GM-41 | An example in the kit's docs | GM-01 |", ""].join("\n"),
    "docs/workflow/ids.md": "A test cites `C-GM-41`.\n",
  };
  const found = pruneChecks(context(config(), texts), "uplink", { built: new Set(["GM-01"]) });
  assert.deepEqual(found.pruned.map((p) => p.id), ["C-GM-41"]);
  assert.equal(found.texts.get(`${DIR}/move.md`), ["# Move", "", "## Proposed rules", "", "| ID | Category | Rule | Stories | Accepted |", "| --- | --- | --- | --- | --- |", ""].join("\n"));
  const { mkdtempSync, mkdirSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { runDrop } = await import("../lib/testdata-cli.mjs");
  const root = mkdtempSync(join(tmpdir(), "wf-craft-"));
  mkdirSync(join(root, ".cache/view/answers"), { recursive: true });
  writeFileSync(join(root, ".cache/view/answers/page.json"), JSON.stringify({ answers: { "craft.craft": { choice: "drop", note: "all of them" } } }));
  const out = [];
  assert.equal(runDrop(root, context(config(), texts), ["uplink", "--from", "page"], (line) => out.push(line)), 0);
  assert.deepEqual(out, ["The craft row stands for every craft rule: mark the ones to drop on npx wf testdata review uplink --team.", "Nothing marked Drop."]);
});
