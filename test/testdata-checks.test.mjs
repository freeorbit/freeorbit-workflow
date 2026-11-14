import assert from "node:assert/strict";
import { test } from "node:test";

import { merge } from "../lib/config/config.mjs";
import { DEFAULTS } from "../lib/config/defaults.mjs";
import { readStories } from "../lib/docs/stories.mjs";
import { CATEGORIES, areaKind, categoryCells, categoryNames, flowAreas, tableRows, testdataProblems, testdataWarnings } from "../lib/testdata.mjs";

const config = (more = {}) => merge(DEFAULTS, { areas: [{ id: "uplink", prefix: "GM", docs: "docs/plugins/uplink" }], ...more });
const context = (cfg, texts) => ({ config: cfg, tracked: Object.keys(texts), files: (path) => texts[path] ?? "" });
const DIR = "docs/plugins/uplink/test-data";
const lines = (n) => Array.from({ length: n }, (_, i) => `line ${i}`).join("\n");

test("the kit ships eight categories, and a project adds its own after them", () => {
  assert.equal(CATEGORIES.length, 8);
  assert.deepEqual(categoryNames(config({ testdata: { categories: [{ name: "Stand-ins", use: "Fakes" }] } })).slice(-2), ["Workspaces", "Stand-ins"]);
});

test("an area's kind is its own, else the project's", () => {
  const cfg = config({ kind: "domain-product" });
  assert.equal(areaKind(cfg, { id: "sign-in", kind: "app" }), "app");
  assert.equal(areaKind(cfg, { id: "review" }), "domain-product");
});

test("flow areas are top-level files but the README, and each folder", () => {
  const tracked = [`${DIR}/README.md`, `${DIR}/core.md`, `${DIR}/guides-tab/README.md`, `${DIR}/guides-tab/rules.md`, `${DIR}/coverage.toml`, "docs/other.md"];
  assert.deepEqual(flowAreas(`${DIR}/`, tracked), [
    { name: `${DIR}/core.md`, paths: [`${DIR}/core.md`] },
    { name: `${DIR}/guides-tab/`, paths: [`${DIR}/guides-tab/README.md`, `${DIR}/guides-tab/rules.md`] },
  ]);
});

test("only a rules table's Category cells are read", () => {
  const text = [
    "| ID | Category | Rule | Stories | Accepted |",
    "| --- | --- | --- | --- | --- |",
    "| R-01 | Time | Today is fixed | GM-01 | 2026-11-13 |",
    "",
    "| Service | Category |",
    "| --- | --- |",
    "| Netflix | Shopping |",
  ].join("\n");
  assert.deepEqual(categoryCells(text), [{ line: 3, category: "Time" }]);
});

test("warnings: a file past a page, a flow area past its size, a folder too small to split, a tiny file, an unknown category; loose files are not counted", () => {
  const texts = {
    [`${DIR}/README.md`]: lines(10),
    [`${DIR}/long.md`]: lines(101),
    [`${DIR}/old.md`]: lines(190),
    [`${DIR}/thin/README.md`]: lines(5),
    [`${DIR}/thin/a.md`]: lines(60),
    [`${DIR}/split/README.md`]: lines(10),
    [`${DIR}/split/a.md`]: lines(90),
    [`${DIR}/split/b.md`]: lines(80),
    [`${DIR}/split/c.md`]: lines(8),
    [`${DIR}/big/a.md`]: "x".repeat(30 * 1024),
    [`${DIR}/big/b.md`]: "x".repeat(11 * 1024),
    [`${DIR}/rules.md`]: "| ID | Category | Rule |\n| --- | --- | --- |\n| R-01 | Stand-ins | A |\n| R-02 | Stand-ins | B |\n| R-03 | Time | C |\n",
  };
  const found = testdataWarnings(context(config({ testdata: { limits: { loose: [`${DIR}/old.md`] } } }), texts)).filter((w) => !/area-qualified/.test(w));
  assert.deepEqual(found, [
    `${DIR}/thin/: 2 files, 65 lines in all, under 150; make it one file`,
    `${DIR}/split/c.md: 8 lines, under 15; fold it into a sibling file`,
    `${DIR}/big/: 41 KB, over 40; split it by dataset group, or into a folder of page-sized files`,
    `${DIR}/big/: 2 files, 2 lines in all, under 150; make it one file`,
    `${DIR}/long.md: 101 lines, over 100, about a page; move a topic into a file of its own`,
    `${DIR}/rules.md:3: category "Stand-ins" (2 rules) is not the kit's or in testdata.categories`,
  ]);
  const extended = config({ testdata: { categories: [{ name: "Stand-ins", use: "Fakes" }], limits: { lines: 200, areaKB: 50, small: 0, folder: 0 } } });
  assert.deepEqual(testdataWarnings(context(extended, texts)).filter((w) => !/area-qualified/.test(w)), []);
});

test("a table's rows are read by their header, and only from tables that have the columns asked for", () => {
  const text = "| Input | Class | Values |\n| --- | --- | --- |\n| `addr` | Blanks | two spaces |\n\n| Other | Class |\n| --- | --- |\n| x | y |\n";
  assert.deepEqual(tableRows(text, ["Input", "Class"]), [{ line: 3, cells: { Input: "`addr`", Class: "Blanks", Values: "two spaces" } }]);
});

test("warnings: an input class listed twice, a fixture that reaches unit, and fixtures past a story's, a flow area's, or a rule's budget", () => {
  const fixtures = (rows) => ["| Fixture | Varies | Expect | Stories | Rules | Reach |", "| --- | --- | --- | --- | --- | --- |", ...rows].join("\n");
  const row = (id, stories, rules, reach = "typed at `ready`") => `| \`${id}\` | x | y | ${stories} | ${rules} | ${reach} |`;
  const texts = {
    [`${DIR}/formats.md`]: "| Input | Class | Values | Expect | Stories | Rules |\n| --- | --- | --- | --- | --- | --- |\n| `addr` | Blanks at the edges | two spaces | Trimmed | GM-06 | R-12 |\n",
    [`${DIR}/setup.md`]: [
      "| Input | Class | Values | Expect | Stories | Rules |",
      "| --- | --- | --- | --- | --- | --- |",
      "| `addr` | blanks at the edges | a tab | Trimmed | GM-06 | R-12 |",
      "",
      fixtures([row("a1", "GM-06", "R-12"), row("a2", "GM-06", "R-12"), row("a3", "GM-06, GM-07", "R-12"), row("a4", "GM-06", "R-12"), row("a5", "GM-06", "R-12"), row("a6", "GM-06", "R-13", "`unit`")]),
    ].join("\n"),
  };
  const found = testdataWarnings(context(config(), texts));
  assert.deepEqual(found, [
    `${DIR}/setup.md:3: input \`addr\` class "blanks at the edges" is listed already, at ${DIR}/formats.md:3; list an input's classes once, and name them from other flows`,
    `${DIR}/setup.md:12: \`a6\` reaches unit, which no person can; make it a class of its input`,
    `${DIR}/setup.md:7: story GM-06 has 6 edge-case fixtures, over 5; keep the ones only its flow shows, and ask the reviewer about any kept past it`,
    `${DIR}/setup.md:7: rule R-12 has 5 edge-case fixtures, over 4; most are likely classes of one input; list them as its input classes`,
  ]);
  const roomy = config({ testdata: { limits: { fixtures: { story: 10, area: 3, rule: 10 } } } });
  assert.deepEqual(testdataWarnings(context(roomy, texts)).filter((w) => /fixtures, over/.test(w)), [`${DIR}/setup.md: 6 edge-case fixtures, over 3; merge rows into one with axes, or move the cases that vary one input into its input classes`]);
});

test("a story's Risk line reads as high or low, and anything else is a problem", () => {
  const text = [
    "### GM-01. Pay",
    "",
    "As a user, I want to pay, so that it is done.",
    "",
    "Risk: high (money, outside input)",
    "",
    "Acceptance:",
    "",
    "- Risk: this line is acceptance, not the tier.",
    "",
    "### GM-02. Look",
    "",
    "As a user, I want to look.",
    "",
    "Acceptance:",
    "",
    "- It shows.",
    "",
    "### GM-03. Odd",
    "",
    "Risk: medium",
    "",
    "Acceptance:",
    "",
    "- It shows.",
  ].join("\n");
  const [pay, look, odd] = readStories(text, ["GM"], "docs/plugins/uplink/user-stories.md");
  assert.deepEqual(pay.risk, { level: "high", reasons: ["money", "outside input"], raw: "high (money, outside input)" });
  assert.equal(look.risk, null);
  assert.equal(odd.risk.level, "");
  const found = testdataProblems(context(config({ stories: { files: ["docs/plugins/*/user-stories.md"] } }), { "docs/plugins/uplink/user-stories.md": text }));
  assert.deepEqual(found, ['docs/plugins/uplink/user-stories.md:19: GM-03 Risk says "medium"; write "Risk: high (<why>)", "Risk: low", or no line for low']);
});

test("a kind the kit does not know is a problem, for the project or an area", () => {
  const cfg = merge(DEFAULTS, { kind: "website", areas: [{ id: "a", prefix: "A", kind: "pipeline" }], testdata: { categories: [{ use: "no name" }] } });
  assert.deepEqual(testdataProblems(context(cfg, {})), [
    '.workflow/config.json: kind "website" is not one of app, domain-product, data-pipeline, integration, catalog',
    '.workflow/config.json: area a kind "pipeline" is not one of app, domain-product, data-pipeline, integration, catalog',
    ".workflow/config.json: a testdata.categories entry has no name",
  ]);
});

test("warnings: a check written in many files is a rule restated, and checks past a story's or a flow area's budget", () => {
  const checks = (rows) => ["| Check | Stories | Rules |", "| --- | --- | --- |", ...rows].join("\n");
  const ai = "| All of the above with *AI off* and no model | GM-06 | R-29 |";
  const texts = {
    [`${DIR}/a.md`]: checks([ai, ...Array.from({ length: 8 }, (_, i) => `| Step ${i} shows its own result | GM-06 | R-1 |`)]),
    [`${DIR}/b.md`]: checks(["| all of the above with AI off and no model. | GM-07 | R-29 |"]),
    [`${DIR}/c/one.md`]: checks([ai]),
  };
  const found = testdataWarnings(context(config(), texts)).filter((w) => /check/.test(w) && !/no ID/.test(w));
  assert.deepEqual(found, [
    `${DIR}/a.md:3: the check "All of the above with *AI off* and no model" is in 3 files; make it a rule in core.md with one test across every state, and drop it from the flows`,
    `${DIR}/a.md:3: story GM-06 has 10 checks, over 8; keep what only it shows, and leave what a rule says to the rule`,
  ]);
  const tight = config({ testdata: { limits: { checks: { story: 20, area: 5, repeated: 9 } } } });
  assert.deepEqual(testdataWarnings(context(tight, texts)).filter((w) => /check/.test(w) && !/no ID/.test(w)), [`${DIR}/a.md: 9 checks, over 5; keep what this flow shows that no rule says`]);
});

test("check IDs: filled in file order from the area's last, never renumbered; a repeat fails, a missing one warns", async () => {
  const { fillCheckIds } = await import("../lib/testdata.mjs");
  const texts = {
    [`${DIR}/a.md`]: "# A\n\n| ID | Check | Stories | Rules | By |\n| --- | --- | --- | --- | --- |\n| C-07 | Kept as it is | GM-06 | R-1 | |\n|  | Has none | GM-06 | R-1 | walk |\n",
    [`${DIR}/b.md`]: "| Check | Stories | Rules |\n| --- | --- | --- |\n| First | GM-07 | |\n| Second | GM-07 | R-2 |\n\nText after.\n",
    [`${DIR}/c.md`]: "| ID | Category | Rule | Stories | Accepted |\n| --- | --- | --- | --- | --- |\n| R-01 | Time | Today is fixed | GM-06 | 2026-11-13 |\n",
  };
  const files = (p) => texts[p] ?? "";
  const { texts: out, added } = fillCheckIds(Object.keys(texts), files);
  assert.equal(added, 3);
  assert.deepEqual([...out.keys()], [`${DIR}/a.md`, `${DIR}/b.md`], "a rules table is left alone");
  assert.match(out.get(`${DIR}/a.md`), /\| C-07 \| Kept as it is \|[\s\S]*\| C-08 \| Has none \| GM-06 \| R-1 \| walk \|/);
  assert.equal(out.get(`${DIR}/b.md`), "| ID | Check | Stories | Rules |\n| --- | --- | --- | --- |\n| C-09 | First | GM-07 | |\n| C-10 | Second | GM-07 | R-2 |\n\nText after.\n");
  const done = { ...texts, ...Object.fromEntries(out) };
  assert.equal(fillCheckIds(Object.keys(done), (p) => done[p]).added, 0, "a second run changes nothing");
  // Before: one warning that checks have no ID; after: none.
  assert.ok(testdataWarnings(context(config(), texts)).includes(`${DIR}/: 3 checks have no ID; npx wf testdata ids uplink gives each its own`));
  assert.ok(!testdataWarnings(context(config(), done)).some((w) => /no ID/.test(w)));
  const twice = { ...done, [`${DIR}/d.md`]: "| ID | Check | Stories |\n| --- | --- | --- |\n| C-07 | Again | GM-06 |\n| X-1 | Odd | GM-06 |\n" };
  assert.deepEqual(testdataProblems(context(config(), twice)).filter((p) => /check/.test(p)), [
    `${DIR}/d.md:3: check C-07 is defined already, at ${DIR}/a.md:5`,
    `${DIR}/d.md:4: check ID "X-1" is not C-GM-<number>`,
  ]);
});
