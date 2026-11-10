import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { merge } from "../lib/config.mjs";
import { DEFAULTS } from "../lib/defaults.mjs";
import { emptyOpen, emptyResolved } from "../lib/questions.mjs";
import { addQuestion, blockingRows, insertRow, looseBullets, nextId, questionCounts, questionProblems, questionRows, resolveQuestion } from "../lib/questions.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(join(here, "fixtures/questions", name), "utf8");
const config = (more = {}) => merge(DEFAULTS, { areas: [{ id: "review", prefix: "REV", docs: "docs/review" }], ...more });
const OPEN = DEFAULTS.logs.openQuestions;
const RESOLVED = DEFAULTS.logs.questionsResolved;

/** doc:check's question problems for the given texts, by path. */
function check(texts, more = {}) {
  return questionProblems({ config: config(more), tracked: Object.keys(texts), files: (path) => texts[path] });
}

test("rows are read from each heading's table, with their cells and heading", () => {
  const rows = questionRows(fixture("open.md"));
  assert.deepEqual(rows.map((row) => `${row.id} ${row.needs} ${row.from} ${row.story} ${row.heading}`), [
    "Q-012 owner client (monday) REV-03 CH-03: Risk register",
    "Q-013 developer:backend designer REV-03, REV-04 CH-03: Risk register",
    "Q-014 owner owner none Not tied to a chunk yet",
  ]);
  assert.equal(rows[0].question, "Should risk names match the client's register exactly?");
});

test("a well-formed open and resolved log pass", () => {
  assert.deepEqual(check({ [OPEN]: fixture("open.md"), [RESOLVED]: fixture("resolved.md") }), []);
});

test("the new logs wf init writes pass", () => {
  assert.deepEqual(check({ [OPEN]: emptyOpen({ decisions: "decisions", resolved: "questions-resolved.md" }), [RESOLVED]: emptyResolved({ decisions: "decisions", open: "open-questions.md" }) }), []);
});

test("an old-style log fails on each bullet and the ticked item, until it is listed as loose", () => {
  const found = check({ [OPEN]: fixture("old-open.md") });
  assert.equal(found.filter((problem) => /a ticked question stays here/.test(problem)).length, 1);
  assert.equal(found.filter((problem) => /is a row in its heading's table/.test(problem)).length, 3);
  const loose = check({ [OPEN]: fixture("old-open.md") }, { logs: { looseQuestions: [OPEN] } });
  assert.deepEqual(loose.map((problem) => problem.replace(/:\d+:.*/, "")), [OPEN], "a loose log still fails on a ticked item");
  assert.match(loose[0], /ticked/);
});

test("doc:check holds the IDs, cells, header, and details", () => {
  const head = "| ID | Question | Needs | From | Story | Raised |\n| --- | --- | --- | --- | --- | --- |";
  const bad = [
    "## CH-01",
    "",
    head,
    "| Q-1 | Short? | owner | owner | none | 2026-11-10 |",
    "| Q-002 | Who? | boss | somebody | APP-01 | 10 Nov |",
    `| Q-003 | ${"long ".repeat(31)}| owner | client (monday) | none | 2026-11-10 |`,
    "| Q-003 | Twice? | owner | owner | none | 2026-11-10 |",
    "| Q-004 | Short? | owner | owner | none |",
    "",
    "- **Q-009.** Detail for a row that is not here.",
    "",
    "## CH-02",
    "",
    "| ID | Question | Needs |",
    "| --- | --- | --- |",
  ].join("\n");
  const found = check({ [OPEN]: bad });
  for (const pattern of [
    /Q-1 is not an ID/,
    /Q-002 Needs "boss"/,
    /Q-002 From "somebody"/,
    /Q-002 Story is "none" or story IDs/,
    /Q-002 Raised is a date/,
    /Q-003 Question has 31 words, over 30/,
    /Q-003 is also at/,
    /Q-004 has 5 cells, not 6/,
    /a detail bullet for Q-009/,
    /the table header is \| ID \| Question \| Needs \| From \| Story \| Raised \|/,
  ]) {
    assert.ok(found.some((problem) => pattern.test(problem)), `${pattern} in:\n${found.join("\n")}`);
  }
});

test("an ID used in both logs fails, and a resolved row needs its date and decision", () => {
  const resolved = fixture("resolved.md").replace("| D-ST-004 |", "| decided |").replace("| 2026-11-10 | none:", "| 2026-11-01 | none:");
  const open = fixture("open.md").replace("Q-014", "Q-001");
  const found = check({ [OPEN]: open, [RESOLVED]: resolved });
  assert.ok(found.some((problem) => /Q-001 is also at docs\/log\/open-questions.md/.test(problem)), found.join("\n"));
  assert.ok(found.some((problem) => /Q-001 Decision cites decision IDs/.test(problem)));
  assert.ok(found.some((problem) => /Q-011 is resolved before it was raised/.test(problem)));
});

test("counts per heading take table rows and old bullets, not details", () => {
  assert.deepEqual(questionCounts(fixture("open.md")), [
    { heading: "CH-03: Risk register", count: 2 },
    { heading: "Not tied to a chunk yet", count: 1 },
  ]);
  assert.deepEqual(questionCounts(fixture("old-open.md")), [
    { heading: "CH-01: skeleton and sign-in", count: 2 },
    { heading: "Not tied to a chunk yet", count: 1 },
  ]);
  assert.deepEqual(looseBullets("- **Q-001.** detail\n- old\n  - nested").map((bullet) => bullet.line), [2]);
});

test("only rows under a chunk's heading block a merge", () => {
  assert.deepEqual(blockingRows(fixture("open.md")).map((row) => `${row.id} ${row.role}`), ["Q-012 owner", "Q-013 developer:backend"]);
});

test("the next ID is past every one in both logs", () => {
  assert.equal(nextId([fixture("open.md"), fixture("resolved.md")]), "Q-015");
  assert.equal(nextId(["", ""]), "Q-001");
});

test("a row goes into its heading's table, which is made in place of None. or before the untied heading", () => {
  const start = emptyOpen({ decisions: "decisions", resolved: "questions-resolved.md" });
  const one = insertRow(start, "Not tied to a chunk yet", "", "| Q-001 | A? | owner | owner | none | 2026-11-10 |");
  assert.doesNotMatch(one, /None\./);
  const two = insertRow(one, "CH-02", "Search", "| Q-002 | B? | owner | owner | none | 2026-11-10 |");
  assert.ok(two.indexOf("## CH-02: Search") < two.indexOf("## Not tied to a chunk yet"));
  const three = insertRow(two, "CH-02", "Search", "| Q-003 | C? | owner | owner | none | 2026-11-10 |");
  assert.deepEqual(questionRows(three).map((row) => `${row.id} ${row.heading}`), ["Q-002 CH-02: Search", "Q-003 CH-02: Search", "Q-001 Not tied to a chunk yet"]);
  assert.deepEqual(check({ [OPEN]: three }), []);
});

test("add assigns the next ID and refuses a bad cell; resolve moves the row, its detail, and leaves None.", () => {
  const root = mkdtempSync(join(tmpdir(), "wf-questions-"));
  mkdirSync(join(root, "docs/log"), { recursive: true });
  writeFileSync(join(root, OPEN), fixture("open.md"));
  writeFileSync(join(root, RESOLVED), fixture("resolved.md"));
  const id = addQuestion(root, config(), { chunk: "none", question: "Can a client add a risk?", needs: "owner", from: "client (monday)", date: "2026-11-15" });
  assert.equal(id, "Q-015");
  assert.throws(() => addQuestion(root, config(), { chunk: "none", question: "Q?", needs: "boss", from: "owner", date: "2026-11-15" }), /Needs "boss"/);

  resolveQuestion(root, config(), "Q-012", "D-REV-001", "2026-11-16");
  resolveQuestion(root, config(), "Q-013", "none: the import keeps every field", "2026-11-16");
  const open = readFileSync(join(root, OPEN), "utf8");
  assert.doesNotMatch(open, /Q-012|Q-013/, "the rows and their details are gone");
  assert.match(open, /## CH-03: Risk register\n\nNone\.\n/);
  const resolved = questionRows(readFileSync(join(root, RESOLVED), "utf8"));
  assert.deepEqual(resolved.map((row) => `${row.id} ${row.resolved} ${row.decision}`), [
    "Q-001 2026-11-10 D-ST-004",
    "Q-011 2026-11-10 none: approved as drafted",
    "Q-012 2026-11-16 D-REV-001",
    "Q-013 2026-11-16 none: the import keeps every field",
  ]);
  assert.throws(() => resolveQuestion(root, config(), "Q-014", "because", "2026-11-16"), /decision IDs/);
  assert.throws(() => resolveQuestion(root, config(), "Q-099", "D-REV-001", "2026-11-16"), /Q-099 is not in/);
  assert.deepEqual(check({ [OPEN]: open, [RESOLVED]: readFileSync(join(root, RESOLVED), "utf8") }), []);
});
