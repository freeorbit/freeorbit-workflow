import assert from "node:assert/strict";
import { test } from "node:test";

import { entries } from "../lib/docs/shape.mjs";

const text = [
  "## GM-01 notes",
  "Body.",
  "### Under it",
  "More.",
  "## Other",
  "",
  "| Date | Decision |",
  "| --- | --- |",
  "| 2026-11-03 | Keep it. |",
  "| 2026-11-04 | Says 2026-11-03 later. |",
  "",
  "- **GM-01.** A bullet",
  "  with a second line.",
  "- Mentions GM-01 in passing.",
  "```",
  "## GM-01 in code",
  "```",
].join("\n");

test("a heading match prints its section down to the next heading at its level", () => {
  assert.deepEqual(entries(text, "gm-01")[0], { line: 1, text: "## GM-01 notes\nBody.\n### Under it\nMore." });
});

test("a row matches on its first cell and keeps its header", () => {
  assert.deepEqual(entries(text, "2026-11-03"), [
    { line: 9, text: "| Date | Decision |\n| --- | --- |\n| 2026-11-03 | Keep it. |" },
  ]);
});

test("a bullet matches on its start, keeps its lines, and code does not count", () => {
  assert.deepEqual(entries(text, "GM-01").slice(1), [{ line: 12, text: "- **GM-01.** A bullet\n  with a second line." }]);
});
