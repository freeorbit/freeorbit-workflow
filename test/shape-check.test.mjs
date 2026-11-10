import assert from "node:assert/strict";
import { test } from "node:test";

import { anchor, anchors, areaRows, chunkRows, futureDates, links, longBlocks, storyIds, strayRows } from "../lib/docs/shape.mjs";

test("links in code are not links", () => {
  const text = "See [a](a.md) and `[b](b.md)`.\n\n```\n[c](c.md)\n```\n";
  assert.deepEqual(links(text), ["a.md"]);
});

test("an anchor matches the way headings link", () => {
  assert.equal(anchor("Every size of window (APP-25)"), "every-size-of-window-app-25");
  assert.equal(anchor("Chunks 14 and 14b: move"), "chunks-14-and-14b-move");
});

test("a heading in a code block is not an anchor", () => {
  assert.deepEqual([...anchors("# One\n\n```\n# Two\n```\n")], ["one"]);
});

test("a chunk row keeps its group and status, and other tables do not count", () => {
  const text = [
    "### Waiting",
    "",
    "| Chunk | Stories | Status | Detail |",
    "| --- | --- | --- | --- |",
    "| 7. Provider | GM-03 | Waiting | Awaits review. |",
    "",
    "### Other",
    "",
    "| Provider | What to try |",
    "| --- | --- |",
    "| Tuta | The same |",
  ].join("\n");
  assert.deepEqual(chunkRows(text), [
    { chunk: "7. Provider", group: "Waiting", status: "Waiting", stories: "GM-03", waitsOn: "", title: "", who: "" },
  ]);
});

test("a chunk row reads its id, Title, and Who cells", () => {
  const text = "### Not started\n\n| Chunk | Title | Who | Stories | Status | Waits on |\n| --- | --- | --- | --- | --- | --- |\n| CH-01-fe | Sign-in screen | developer:frontend | APP-01 | Not started | CH-01-contract |\n";
  assert.deepEqual(chunkRows(text), [
    { chunk: "CH-01-fe", group: "Not started", status: "Not started", stories: "APP-01", waitsOn: "CH-01-contract", title: "Sign-in screen", who: "developer:frontend" },
  ]);
});

test("only two-digit story IDs count", () => {
  assert.deepEqual([...storyIds("GM-29, DR-05, APP-04, GM-1, SEC-020", ["GM", "DR", "APP"])], ["GM-29", "DR-05", "APP-04"]);
});

test("an area row maps each step to its cell", () => {
  const text = [
    "| Area | Stories | Frames |",
    "| --- | --- | --- |",
    "| [App](#app) | Done 2026-10-29 | Waiting on Ken 2026-11-04: `app-handover` |",
    "",
    "| Chunk | Status |",
  ].join("\n");
  assert.deepEqual(areaRows(text), [
    { area: "App", steps: { Stories: "Done 2026-10-29", Frames: "Waiting on Ken 2026-11-04: `app-handover`" } },
  ]);
});

test("a long paragraph or bullet is flagged at its first line, and code, tables, and sub-bullets are apart", () => {
  const words = (n) => Array(n).fill("word").join(" ");
  const text = [
    "---",
    `description: ${words(9)}`,
    "---",
    words(5),
    words(5),
    "",
    `- ${words(4)}`,
    `  ${words(4)}`,
    `  - ${words(4)}`,
    "",
    "```",
    words(20),
    "```",
    `| ${words(20)} |`,
  ].join("\n");
  assert.deepEqual(longBlocks(text, 8), [
    { line: 4, words: 10 },
    { line: 7, words: 9 },
  ]);
});

test("a row with no chunk header above it is stray", () => {
  const table = "| Chunk | Status |\n| --- | --- |\n| 1. A | Done |\n";
  assert.deepEqual(strayRows(`# Done\n\n${table}`), []);
  assert.deepEqual(strayRows("| 2. B | Done |\n\n| 3. C | Done |\n"), ["| 2. B | Done |", "| 3. C | Done |"]);
  assert.deepEqual(strayRows(`${table}\n| 4. D | Done |\n`), ["| 4. D | Done |"]);
});

test("a date after today is found, and today or earlier is not", () => {
  const text = "| 2026-11-08 | ok |\n| 2026-11-09 | slip |\nOn 2025-12-31 and 2026-11-07.";
  assert.deepEqual(futureDates(text, "2026-11-08"), [{ line: 2, date: "2026-11-09" }]);
});
