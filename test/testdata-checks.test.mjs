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

test("warnings: a file past one screen, a flow area past its size, an unknown category; loose files are not counted", () => {
  const texts = {
    [`${DIR}/README.md`]: lines(10),
    [`${DIR}/long.md`]: lines(41),
    [`${DIR}/old.md`]: lines(90),
    [`${DIR}/big/a.md`]: "x".repeat(30 * 1024),
    [`${DIR}/big/b.md`]: "x".repeat(11 * 1024),
    [`${DIR}/rules.md`]: "| ID | Category | Rule |\n| --- | --- | --- |\n| R-01 | Stand-ins | A |\n| R-02 | Stand-ins | B |\n| R-03 | Time | C |\n",
  };
  const found = testdataWarnings(context(config({ testdata: { limits: { loose: [`${DIR}/old.md`] } } }), texts));
  assert.deepEqual(found, [
    `${DIR}/big/: 41 KB, over 40; split it by dataset group, or into a folder of one-screen files`,
    `${DIR}/long.md: 41 lines, over 40, about one screen; move a topic into a file of its own`,
    `${DIR}/rules.md:3: category "Stand-ins" (2 rules) is not the kit's or in testdata.categories`,
  ]);
  const extended = config({ testdata: { categories: [{ name: "Stand-ins", use: "Fakes" }], limits: { lines: 100, areaKB: 50 } } });
  assert.deepEqual(testdataWarnings(context(extended, texts)), []);
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
