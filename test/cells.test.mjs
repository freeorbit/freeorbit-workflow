import assert from "node:assert/strict";
import { test } from "node:test";

import { longCells } from "../lib/docs/shape.mjs";

test("a long table cell must be split into a lead and short bullets", () => {
  const long = "word ".repeat(31).trim();
  const text = [
    "| A | B |",
    "| --- | --- |",
    `| short | ${long} |`,
    `| split | Lead.<br>• ${"w ".repeat(16).trim()}<br>• fine |`,
    `| ok | Lead.<br>• fine<br>• also fine |`,
    `| code | \`${long}\` |`,
    "```",
    `| ${long} |`,
    "```",
  ].join("\n");
  assert.deepEqual(longCells(text, 30, 15), [
    { line: 3, column: 2, words: 31, split: false },
    { line: 4, column: 2, words: 17, split: true },
  ]);
});

test("doc:check reports long and long-bulleted cells, and docs.looseCells silences a doc", async () => {
  const { problems } = await import("../lib/docs/check.mjs");
  const { merge } = await import("../lib/config/config.mjs");
  const { DEFAULTS } = await import("../lib/config/defaults.mjs");
  const texts = {
    "docs/a.md": `# A\n\n| A | B |\n| --- | --- |\n| x | ${"word ".repeat(31).trim()} |\n| y | Lead.<br>• ${"w ".repeat(16).trim()} |\n`,
  };
  const context = (docs = {}) => ({ root: "/nowhere", config: merge(DEFAULTS, { docs: { index: "none.md", ...docs } }), tracked: Object.keys(texts), files: (path) => texts[path] });
  const found = (await problems(context(), "2026-11-09")).filter((line) => line.startsWith("docs/a.md"));
  assert.deepEqual(found, [
    "docs/a.md:5: column 2 has 31 words in one piece, over 30; split it into a lead and <br>• bullets",
    "docs/a.md:6: column 2 has a 17-word line, over 15",
  ]);
  assert.deepEqual((await problems(context({ looseCells: ["docs/a.md"] }), "2026-11-09")).filter((line) => line.startsWith("docs/a.md")), []);
});
