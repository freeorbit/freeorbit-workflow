import assert from "node:assert/strict";
import { test } from "node:test";

import { merge } from "../lib/config/config.mjs";
import { DEFAULTS } from "../lib/config/defaults.mjs";
import { specIds, testsIn, trace, traceLines } from "../lib/testdata-trace.mjs";

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
  "| State | What is already done |", "| --- | --- |", "| `gmail-ready` | signed in |", "| `gmail-later` | not built |",
].join("\n");
const CODE = {
  "tools/testdata/src/fixtures.rs": "fn sweep_bad_dates() {}\nconst D: &str = \"D27\";\n",
  "tools/testdata/fixtures/gmail-ready.json": "{}",
  "plugins/x/src/lib.rs": [
    "#[cfg(test)]", "mod tests {",
    "    // R-12: today is fixed.", "    #[test]", "    fn today_is_fixed() {", "        assert!(true);", "    }",
    "    #[test]", "    fn new_address_is_trimmed() {", "        check(\"new-address\");", "    }",
    "    #[test]", "    fn adds_two_numbers() {", "        assert_eq!(1 + 1, 2);", "    }",
    "}",
  ].join("\n"),
  "web/view.test.ts": "test('GM-06 shows the list', () => {\n  render();\n});\ntest('a plain helper', () => {\n  x();\n});\n",
};
const texts = { [`${DIR}/flow.md`]: SPEC, ...CODE };
const context = { config, tracked: Object.keys(texts), files: (p) => texts[p] ?? "" };

test("a spec's ids are its rules, fixtures, inputs once each, states, and datasets", () => {
  const ids = specIds([`${DIR}/flow.md`], context.files).map((each) => `${each.kind}:${each.id}`);
  assert.deepEqual(ids, ["rule:R-12", "rule:R-13", "fixture:sweep-bad-dates", "input:new-address", "state:gmail-ready", "state:gmail-later", "dataset:D27"]);
});

test("a test is its body and the comment lines above it, in Rust and in JavaScript", () => {
  const rust = testsIn("plugins/x/src/lib.rs", CODE["plugins/x/src/lib.rs"]);
  assert.deepEqual(rust.map((t) => t.name), ["today_is_fixed", "new_address_is_trimmed", "adds_two_numbers"]);
  assert.match(rust[0].text, /R-12: today is fixed/);
  assert.deepEqual(testsIn("web/view.test.ts", CODE["web/view.test.ts"]).map((t) => t.name), ["GM-06 shows the list", "a plain helper"]);
});

test("the trace: spec rows no code names, and tests that name no row and no story", () => {
  const found = trace(context);
  assert.deepEqual(found.areas.map((a) => [a.area, a.ids, a.unnamed.map((each) => each.id)]), [["uplink", 7, ["R-13", "gmail-later"]]], "a fixture named with underscores, and a state as a file name, count");
  assert.deepEqual(found.loose.map((t) => t.name), ["adds_two_numbers", "a plain helper"]);
  assert.equal(found.tests, 5);
  const lines = traceLines(found);
  assert.equal(lines[0], "uplink: 2 of 7 spec ids are named in no code file:");
  assert.ok(lines.includes("  rules (1): R-13"));
  assert.ok(lines.includes("tests: 2 of 5 name no spec row and no story, most in:"));
  assert.throws(() => trace(context, "nope"), /no area nope/);
});
