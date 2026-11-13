// Limits on what a page holds, and the fixes from the code review of
// v0.50.1..v0.53.0: CSV cells, and one rule for a number on a scale.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

import { checkAnswers } from "../lib/ask/answers.mjs";
import { normalize } from "../lib/ask/spec.mjs";
import { KIT_KINDS } from "../lib/design/annotate.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ADVICE = /a recommendation|a suggested order|in why/;
/** One question on a page, checked, less the asking rules' problems. */
const one = (q) => { const out = normalize({ id: "rich", title: "Rich", questions: [q] }); return { ...out, problems: out.problems.filter((p) => !ADVICE.test(p)) }; };
/** One block on a page, checked: the block made ready, and the problems. */
const oneBlock = (b) => {
  const { spec, problems } = normalize({ id: "viz", title: "Viz", questions: [{ id: "q", text: "Fine?" }], blocks: [b] });
  return { block: spec?.sections?.[0]?.blocks?.[0], problems: problems.join(" | ") };
};
/** The answer steps, loaded as the page loads them. */
function answerSteps() {
  const sandbox = { window: {} };
  runInNewContext(readFileSync(join(here, "../lib/ask/browser/state.js"), "utf8"), sandbox);
  return sandbox.window.wfAskState;
}

test("every block limit is checked, and the costly ones before the work they guard", async () => {
  const { BLOCK_LIMITS, layout } = await import("../lib/ask/blocks.mjs");
  const L = BLOCK_LIMITS;
  const words = (n) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");
  const lines = (n) => Array.from({ length: n }, (_, i) => `l${i}`).join("\n");
  const cases = [
    [{ type: "text", text: "x".repeat(L.text + 1) }, /at most 4000 characters/],
    [{ type: "table", columns: ["a"], rows: Array.from({ length: L.rows + 1 }, () => ["x"]) }, /at most 500 rows/],
    [{ type: "table", columns: Array.from({ length: L.columns + 1 }, (_, i) => `c${i}`), rows: [] }, /at most 20 columns/],
    [{ type: "diff", before: lines(L.diff + 1), after: "x" }, /a diff compares at most 2000 lines a side/],
    [{ type: "diff", by: "word", before: words(L.diff + 1), after: "x" }, /a diff compares at most 2000 words a side/],
    [{ type: "chart", labels: Array.from({ length: L.points + 1 }, (_, i) => `p${i}`), series: [{ values: Array(L.points + 1).fill(1) }] }, /at most 200 points/],
    [{ type: "diagram", nodes: ["a", "b"], links: Array.from({ length: L.links + 1 }, () => ({ from: "a", to: "b" })) }, /at most 80 links/],
    [{ type: "timeline", events: Array.from({ length: L.events + 1 }, () => ({ title: "e" })) }, /at most 100 events/],
    [{ type: "board", columns: ["a"], cards: Array.from({ length: L.cards + 1 }, () => ({ title: "c", column: "a" })) }, /at most 200 cards/],
    [{ type: "board", columns: Array.from({ length: L.lanes + 1 }, (_, i) => `c${i}`) }, /at most 8 columns/],
  ];
  for (const [b, pattern] of cases) assert.match(oneBlock(b).problems, pattern, b.type);
  assert.equal(oneBlock({ type: "diff", by: "word", before: words(L.diff), after: "x" }).problems, "", "2000 words is within the limit");
  const cell = oneBlock({ type: "table", columns: ["a"], rows: [["x".repeat(L.cell + 50)]] }).block.rows[0][0];
  assert.equal(cell.length, L.cell, "a long cell is cut, ending in …");
  assert.ok(cell.endsWith("…"));
  // A page over the block limit is refused before any block is built.
  const many = { id: "viz", title: "Viz", questions: [{ id: "q", text: "Fine?" }], blocks: Array.from({ length: L.blocks + 1 }, () => ({ type: "diff", before: lines(L.diff), after: lines(L.diff).replace("l0", "x") })) };
  const started = Date.now();
  assert.match(normalize(many).problems.join(), /61 blocks; a page holds at most 60/);
  assert.ok(Date.now() - started < 1000, "no diff was worked out");
  // A diagram over its limit is not laid out, and a long chain cannot run out of the stack.
  const chain = Array.from({ length: 20000 }, (_, i) => ({ id: `n${i}` }));
  const links = chain.slice(1).map((n, i) => ({ from: `n${i}`, to: n.id }));
  assert.match(oneBlock({ type: "diagram", nodes: chain, links }).problems, /at most 40 nodes/);
  const walked = layout(chain.slice(0, 5000), links.slice(0, 4999).map((l) => ({ ...l })).filter((l) => Number(l.to.slice(1)) < 5000));
  assert.equal(walked.nodes.at(-1).rank, 4999);
  // An edits question over its count is refused before its diffs are worked out.
  const edits = one({ id: "e", text: "Edits", type: "edits", edits: Array.from({ length: 31 }, (_, i) => ({ id: `e${i}`, before: "a", after: "b" })) });
  assert.match(edits.problems.join(), /at most 30 edits/);
  assert.equal(edits.spec.questions[0].edits.length, 30);
});

test("a CSV cell a spreadsheet would run as a formula opens as text", () => {
  const sandbox = { window: {} };
  runInNewContext(readFileSync(join(here, "../lib/ask/browser/shared.js"), "utf8"), sandbox);
  const { csvCell } = sandbox.window.wfAskShared;
  assert.equal(csvCell("=HYPERLINK(\"x\")"), `"'=HYPERLINK(""x"")"`);
  for (const lead of ["+", "-", "@", "\t", "\r"]) assert.ok(csvCell(`${lead}cmd`).replace(/^"/, "").startsWith("'"), JSON.stringify(lead));
  assert.equal(csvCell("-2.5"), "-2.5", "a plain number stays a number");
  assert.equal(csvCell("+1,000"), `"+1,000"`);
  assert.equal(csvCell("a\rb"), `"a\rb"`, "a return is quoted");
  assert.equal(csvCell("plain"), "plain");
  assert.equal(csvCell(null), "");
});

test("a number is on a scale by one rule, on the page and in the record", () => {
  const S = answerSteps();
  const sc = { min: 1, max: 5, step: 1 };
  assert.deepEqual([1, 5, 3, 2.5, 0, 6, NaN, "3"].map((n) => S.onScale(sc, n)), [true, true, true, false, false, false, false, false]);
  assert.equal(S.onScale({ min: 0, max: 1, step: 0.1 }, 0.3), true, "a step of a tenth");
  assert.match(one({ id: "s", text: "Rate", type: "scale", recommended: 2.5 }).problems.join(), /a number on the scale/);
  const { spec } = normalize({ id: "s", title: "S", questions: [{ id: "s", text: "Rate", type: "scale" }] });
  assert.match(checkAnswers(spec, { id: spec.id, hash: spec.hash, answers: { s: { number: 2.5 } } }, KIT_KINDS).problems.join(), /from 1 to 5, by 1/);
  const page = readFileSync(join(here, "../lib/ask/browser/page/35-answers.js"), "utf8");
  assert.match(page, /S\.onScale\(sc, n\)/, "the page's number box uses the same rule");
});
