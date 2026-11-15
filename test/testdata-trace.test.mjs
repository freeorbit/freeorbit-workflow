import assert from "node:assert/strict";
import { test } from "node:test";

import { merge } from "../lib/config/config.mjs";
import { DEFAULTS } from "../lib/config/defaults.mjs";
import { specIds } from "../lib/testdata.mjs";
import { testsIn, trace, traceLines } from "../lib/testdata-trace.mjs";

const DIR = "docs/plugins/uplink/test-data";
const config = merge(DEFAULTS, { areas: [{ id: "uplink", prefix: "GM", docs: "docs/plugins/uplink" }], stories: { files: ["docs/plugins/*/user-stories.md"] } });
const SPEC = [
  "### D27. Assess archives",
  "| ID | Category | Rule | Stories | Accepted |", "| --- | --- | --- | --- | --- |",
  "| R-12 | Time | Today is fixed | GM-06 | 2026-11-13 |", "| R-13 | Time | Not built yet | GM-09 | 2026-11-13 |", "",
  "| Fixture | Varies | Expect | Stories | Rules | Reach |", "| --- | --- | --- | --- | --- | --- |",
  "| `sweep-bad-dates` | dates | refused | GM-06 | R-12 | stored in `ready` |", "",
  "| Input | Class | Values | Expect | Stories | Rules |", "| --- | --- | --- | --- | --- | --- |",
  "| `new-address` | Blanks | two spaces | trimmed | GM-06 | R-12 |", "| `new-address` | IP domain | x@1.2.3.4 | refused | GM-06 | R-12 |", "",
  "| State | What is already done |", "| --- | --- |", "| `gmail-ready` | signed in |", "| `gmail-later` | not built |", "",
  "| ID | Check | Stories | Rules | By |", "| --- | --- | --- | --- | --- |", "| C-01 | The list shows | GM-06 | R-12 | |", "| C-02 | It looks right | GM-06 | | walk |", "| C-03 | Not proven | GM-06 | | |",
].join("\n");
const CODE = {
  "tools/testdata/src/fixtures.rs": "fn sweep_bad_dates() {}\nconst D: &str = \"D27\";\n",
  "tools/testdata/fixtures/gmail-ready.json": "{}",
  "plugins/x/src/lib.rs": [
    "#[cfg(test)]", "mod tests {",
    "    // R-12, C-01: today is fixed.", "    #[test]", "    fn today_is_fixed() {", "        assert!(true);", "    }",
    "    #[test]", "    fn new_address_is_trimmed() {", "        check(\"new-address\");", "    }",
    "    #[test]", "    fn adds_two_numbers() {", "        assert_eq!(1 + 1, 2);", "    }",
    "}",
  ].join("\n"),
  "web/view.test.ts": "test('GM-06 shows the list', () => {\n  render();\n});\ntest('a plain helper', () => {\n  x();\n});\n",
};
const texts = { [`${DIR}/flow.md`]: SPEC, ...CODE };
const context = { config, tracked: Object.keys(texts), files: (p) => texts[p] ?? "" };

test("a spec's ids are its rules, fixtures, inputs once each, states, and datasets", () => {
  const ids = specIds([`${DIR}/flow.md`], context.files, { walk: false }).map((each) => `${each.kind}:${each.id}`);
  assert.deepEqual(ids, ["rule:R-12", "rule:R-13", "check:C-01", "check:C-03", "fixture:sweep-bad-dates", "input:new-address", "state:gmail-ready", "state:gmail-later", "dataset:D27"], "a check proven by the walk is no code's to name");
});

test("a test is its body and the comment lines above it, in Rust and in JavaScript", () => {
  const rust = testsIn("plugins/x/src/lib.rs", CODE["plugins/x/src/lib.rs"]);
  assert.deepEqual(rust.map((t) => t.name), ["today_is_fixed", "new_address_is_trimmed", "adds_two_numbers"]);
  assert.match(rust[0].text, /R-12, C-01: today is fixed/);
  assert.deepEqual(testsIn("web/view.test.ts", CODE["web/view.test.ts"]).map((t) => t.name), ["GM-06 shows the list", "a plain helper"]);
});

test("the trace: spec rows no code names, and tests that name no row and no story", () => {
  const found = trace(context);
  assert.deepEqual(found.areas.map((a) => [a.area, a.ids, a.unnamed.map((each) => each.id)]), [["uplink", 9, ["R-13", "C-03", "gmail-later"]]], "a fixture named with underscores, and a state as a file name, count");
  assert.deepEqual(found.loose.map((t) => t.name), ["adds_two_numbers", "a plain helper"]);
  assert.equal(found.tests, 5);
  const lines = traceLines(found);
  assert.equal(lines[0], "uplink: 3 of 9 spec ids are named in no code file:");
  assert.ok(lines.includes("  checks (1): C-03"));
  assert.ok(lines.includes("  rules (1): R-13"));
  assert.ok(lines.includes("tests: 2 of 5 name no spec row and no story, most in:"));
  assert.throws(() => trace(context, "nope"), /no area nope/);
});

const STORIES = "docs/plugins/uplink/user-stories.md";
// Every line held, so these tests show what a proof is; the risk-aware gate has its own test below.
const strict = merge(config, { testdata: { chunkScope: "all" } });
const story = (id, lines) => `### ${id}. A story\n\nAs a user, I want it.\n\nAcceptance:\n\n${lines.map((l) => `- ${l}`).join("\n")}\n`;

test("a chunk's acceptance lines and rules: proven, walk, left to a later chunk, disputed, or proven by nothing; check rows are counted, never gated", async () => {
  const { chunkChecks, chunkLines } = await import("../lib/testdata-trace.mjs");
  const texts = {
    [STORIES]: [story("GM-06", ["Shown", "Needs CH-14's code", "Nothing proves it", "Removed (2026-11-14).", "Walked before"]), story("GM-07", ["Looks right"]), story("GM-08", ["Cannot hold"]), story("GM-30", ["Another chunk's"])].join("\n"),
    [`${DIR}/flow.md`]: [
      "| Line | By |", "| --- | --- |", "| GM-07.1 | walk |", "| GM-06.2 | CH-14 |", "| GM-06.5 | walked 19j |", "",
      "| ID | Category | Rule | Stories | Accepted | By |", "| --- | --- | --- | --- | --- | --- |",
      "| R-GM-01 | State | Kept on restart | GM-06 | 2026-11-14 | |", "| R-GM-02 | Time | Parked | GM-06 | 2026-11-13 | CH-37a |", "| R-GM-03 | Time | Proposed | GM-06 | new | |", "| R-GM-04 | Data markers | Fake domains | GM-06 | 2026-11-13 | |", "| R-GM-05 | Time | Left to this one | GM-30 | 2026-11-13 | 37d |", "",
      "| ID | Check | Stories | Rules | By |", "| --- | --- | --- | --- | --- |", "| C-GM-01 | An old row, cited | GM-06 | | |", "| C-GM-05 | An old row, cited by nothing | GM-06 | | |", "| C-GM-06 | Another chunk's | GM-30 | | |",
      "", "| ID | Kind | Question |", "| --- | --- | --- |", "| G-GM-01 | dispute | GM-08.1 and GM-06.1 cannot both hold on one screen |",
    ].join("\n"),
    "crates/a/src/lib.rs": "#[test]\n// GM-06.1, C-GM-01\nfn shown() {}\n",
  };
  const found = chunkChecks({ config: strict, tracked: Object.keys(texts), files: (p) => texts[p] ?? "" }, "37d", ["GM-06", "GM-07", "GM-08"], { open: ["37d", "CH-14", "CH-37a"], done: ["19j"] });
  const ids = (list) => list.map((each) => each.id);
  assert.deepEqual(ids(found.proven), ["GM-06.1", "GM-06.5"], "a walk signed off in an earlier chunk is not asked again; a removed line is no line");
  assert.deepEqual(ids(found.walk), ["GM-07.1"]);
  assert.deepEqual(ids(found.later), ["GM-06.2", "R-GM-02"], "a parked rule waits for its chunk");
  assert.deepEqual(found.disputed.map((each) => `${each.id} ${each.gap}`), ["GM-08.1 G-GM-01"], "a proven line that a dispute names stays proven");
  assert.deepEqual(ids(found.unproven), ["GM-06.3", "R-GM-01", "R-GM-05"], "another chunk's story is not this chunk's, unless a rule's By names this chunk; a proposed rule waits for the reviewer");
  assert.deepEqual(ids(found.ungated), ["R-GM-04"], "a Data markers rule is craft by its category");
  assert.deepEqual(found.legacy, { checks: 2, cited: 1 });
  const lines = chunkLines(found).join("\n");
  assert.match(lines, /37d: 6 acceptance lines and 4 rules/);
  assert.match(lines, /for the sign-off page, a walk by hand each: GM-07.1/);
  assert.match(lines, /check rows from before acceptance lines were the checks, not gated: 2, 1 cited by a test/);
  assert.match(lines, /GM-06\.3 {2}Nothing proves it/);
});

test("a By that names no open chunk, or walked a chunk not done, proves nothing; a lane can be named; only a test or a scenario proves", async () => {
  const { chunkChecks, chunkTrace } = await import("../lib/testdata-trace.mjs");
  const texts = {
    [STORIES]: story("GM-06", ["Typo", "Not walked yet", "A lane's", "Named in app code", "Named in a fixture", "In a test file"]),
    [`${DIR}/flow.md`]: ["| Line | By |", "| --- | --- |", "| GM-06.1 | CH-99 |", "| GM-06.2 | walked 37d |", "| GM-06.3 | CH-01-fe |"].join("\n"),
    "src/app.ts": "// GM-06.4 is shown here\n",
    "tools/testdata/fixtures/a.json": '{"proves": "GM-06.5"}',
    "tests/flow.spec.ts": "test('x', () => {}) // GM-06.6\n",
  };
  const ctx = { config: strict, tracked: Object.keys(texts), files: (p) => texts[p] ?? "" };
  const found = chunkChecks(ctx, "37d", ["GM-06"], { open: ["37d", "CH-01-fe"], done: ["19j"] });
  assert.deepEqual(found.proven.map((each) => each.id), ["GM-06.6"]);
  assert.deepEqual(found.later.map((each) => each.id), ["GM-06.3"]);
  assert.deepEqual(found.unproven.map((each) => [each.id, each.bad ?? ""]), [
    ["GM-06.1", "By names CH-99, which is not an open chunk"],
    ["GM-06.2", "By says walked 37d, which is not a done chunk"],
    ["GM-06.4", ""],
    ["GM-06.5", ""],
  ]);
  const order = "## Chunks\n\n| Chunk | Status | Stories |\n| --- | --- | --- |\n| 37d. Catalog | In progress | GM-06 |\n";
  const read = (p) => (p === strict.buildOrder.file ? order : "");
  assert.equal(chunkTrace(ctx, "37d", read).found.chunk, "37d");
  assert.deepEqual(chunkTrace(ctx, "99z", read), { noRow: true });
});

test("the chunk end holds high-risk lines to a proof and counts the low-risk ones; chunkScope all holds every line; a proof row is honoured for either", async () => {
  const { chunkChecks, chunkLines } = await import("../lib/testdata-trace.mjs");
  const risky = (id, lines, risk = "") => `### ${id}. A story\n\nAs a user, I want it.\n\n${risk ? `${risk}\n\n` : ""}Acceptance:\n\n${lines.map((l) => `- ${l}`).join("\n")}\n`;
  const texts = {
    [STORIES]: [risky("GM-06", ["Low, no test", "High, no test. Risk: high (privacy)", "Low, walked by hand", "Low, cited", "Low, a row that proves nothing"]), risky("GM-07", ["Whole story high"], "Risk: high (money)")].join("\n"),
    [`${DIR}/flow.md`]: ["| Line | By |", "| --- | --- |", "| GM-06.3 | walk |", "| GM-06.5 | CH-99 |"].join("\n"),
    "crates/a/src/lib.rs": "#[test]\n// GM-06.4\nfn cited() {}\n",
  };
  const run = (cfg) => chunkChecks({ config: cfg, tracked: Object.keys(texts), files: (p) => texts[p] ?? "" }, "37d", ["GM-06", "GM-07"], { open: ["37d"], done: [] });
  const ids = (list) => list.map((each) => each.id);
  const found = run(config);
  assert.deepEqual(ids(found.unproven), ["GM-06.2", "GM-06.5", "GM-07.1"], "a tagged line, a line of a story tagged whole, and a row that names no open chunk");
  assert.deepEqual(ids(found.low), ["GM-06.1"]);
  assert.deepEqual(ids(found.walk), ["GM-06.3"], "a walk row is honoured for a low-risk line");
  assert.deepEqual(ids(found.proven), ["GM-06.4"]);
  const lines = chunkLines(found).join("\n");
  assert.match(lines, /low-risk lines no test cites, not gated: 1 \(--all lists them\)/);
  assert.match(lines, /held by the chunk end and proven by nothing: 3/);
  assert.ok(!lines.includes("Low, no test"));
  assert.match(chunkLines(found, { all: true }).join("\n"), /not gated: 1\n {4}GM-06\.1 {2}Low, no test/);
  const all = run(merge(config, { testdata: { chunkScope: "all" } }));
  assert.deepEqual([ids(all.unproven), ids(all.low)], [["GM-06.1", "GM-06.2", "GM-06.5", "GM-07.1"], []]);
  const typo = merge(config, { testdata: { chunkScope: "All" } });
  assert.deepEqual(ids(run(typo).low), [], "a mistyped scope never relaxes the gate");
  const { testdataProblems } = await import("../lib/testdata.mjs");
  assert.ok(testdataProblems({ config: typo, tracked: [], files: () => "" }).some((p) => /testdata.chunkScope "All" is not high or all/.test(p)));
});
