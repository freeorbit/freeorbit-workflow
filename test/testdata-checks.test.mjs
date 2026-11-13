import assert from "node:assert/strict";
import { test } from "node:test";

import { merge } from "../lib/config/config.mjs";
import { DEFAULTS } from "../lib/config/defaults.mjs";
import { readStories } from "../lib/docs/stories.mjs";
import { CATEGORIES, areaKind, categoryCells, categoryNames, flowAreas, testdataProblems, testdataWarnings } from "../lib/testdata.mjs";

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
