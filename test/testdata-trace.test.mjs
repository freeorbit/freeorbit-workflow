import assert from "node:assert/strict";
import { test } from "node:test";

import { merge } from "../lib/config/config.mjs";
import { DEFAULTS } from "../lib/config/defaults.mjs";
import { specIds } from "../lib/testdata.mjs";
import { testsIn, trace, traceLines } from "../lib/testdata-trace.mjs";

const DIR = "docs/plugins/uplink/test-data";
const config = merge(DEFAULTS, { areas: [{ id: "uplink", prefix: "GM", docs: "docs/plugins/uplink" }] });
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

test("a chunk's checks: proven, walk, left to a later chunk, disputed, or proven by nothing; a story range counts each story", async () => {
  const { chunkChecks, chunkLines, storiesIn } = await import("../lib/testdata-trace.mjs");
  assert.deepEqual(storiesIn("GM-06 to GM-08, GM-12", ["GM"]), ["GM-06", "GM-07", "GM-08", "GM-12"]);
  const texts = {
    [`${DIR}/flow.md`]: [
      "| ID | Check | Stories | Rules | By |", "| --- | --- | --- | --- | --- |",
      "| C-GM-01 | Shown | GM-06 | | |", "| C-GM-02 | Looks right | GM-07 | | walk |", "| C-GM-03 | Needs CH-14's code | GM-06 | | CH-14 |",
      "| C-GM-04 | Cannot hold | GM-08 | | |", "", "| ID | Category | Rule | Stories | Accepted | By |", "| --- | --- | --- | --- | --- | --- |",
      "| R-GM-01 | State | Kept on restart | GM-06 | 2026-11-14 | |", "| R-GM-02 | Time | Parked | GM-06 | 2026-11-13 | CH-37a |", "| R-GM-03 | Time | Proposed | GM-06 | new | |", "", "| ID | Check | Stories | Rules | By |", "| --- | --- | --- | --- | --- |", "| C-GM-05 | Nothing proves it | GM-06 | | |", "| C-GM-06 | Another chunk's | GM-30 | | |", "| C-GM-07 | Left to this one | GM-30 | | 37d |", "| C-GM-08 | Walked before | GM-07 | | walked 19j |",
      "", "| ID | Kind | Question |", "| --- | --- | --- |", "| G-GM-01 | dispute | C-GM-04 and C-GM-01 cannot both hold on one screen |",
    ].join("\n"),
    "crates/a/src/lib.rs": "#[test]\n// C-GM-01\nfn shown() {}\n",
  };
  const found = chunkChecks({ config, tracked: Object.keys(texts), files: (p) => texts[p] ?? "" }, "37d", ["GM-06", "GM-07", "GM-08"]);
  const ids = (list) => list.map((each) => each.id);
  assert.deepEqual(ids(found.proven), ["C-GM-01", "C-GM-08"], "a walk signed off in an earlier chunk is not asked again");
  assert.deepEqual(ids(found.walk), ["C-GM-02"]);
  assert.deepEqual(ids(found.later), ["R-GM-02", "C-GM-03"], "a parked rule waits for its chunk");
  assert.deepEqual(found.disputed.map((each) => `${each.id} ${each.gap}`), ["C-GM-04 G-GM-01"], "a proven check that a dispute names stays proven");
  assert.deepEqual(ids(found.unproven), ["R-GM-01", "C-GM-05", "C-GM-07"], "another chunk's story is not this chunk's, unless its By names this chunk; a proposed rule waits for the reviewer");
  assert.match(chunkLines(found).join("\n"), /for the sign-off page, a walk by hand each: C-GM-02/);
});
