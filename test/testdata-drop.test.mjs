import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { merge } from "../lib/config/config.mjs";
import { DEFAULTS } from "../lib/config/defaults.mjs";
import { areaSpec, testdataProblems } from "../lib/testdata.mjs";
import { runDrop } from "../lib/testdata-cli.mjs";
import { dropRows, dropsFromAnswers } from "../lib/testdata-drop.mjs";

const DIR = "docs/plugins/uplink/test-data";
const config = merge(DEFAULTS, { areas: [{ id: "uplink", prefix: "GM", docs: "docs/plugins/uplink" }] });
const SPEC = {
  [`${DIR}/README.md`]: "# Uplink test data\n\nUpdated: 2026-11-14\n",
  [`${DIR}/flow.md`]: [
    "| ID | Check | Setup | Stories | Rules | Level | By |", "| --- | --- | --- | --- | --- | --- | --- |",
    "| C-GM-01 | Nothing is deleted until you confirm | | GM-07 | | core | |",
    "| C-GM-02 | The help says why each detail is asked for | | GM-07 | | polish | |",
    "", "| ID | Category | Type | Rule | Stories | Accepted |", "| --- | --- | --- | --- | --- | --- |",
    "| R-GM-01 | State | product | Undo goes back one change only | GM-07 | 2026-11-14 |",
    "", "## Proposed rules", "", "| ID | Category | Type | Rule | Stories | Accepted |", "| --- | --- | --- | --- | --- | --- |",
    "| R-GM-01 | State | product | Undo goes back two changes | GM-07 | edit |",
  ].join("\n"),
};

test("a dropped row leaves the spec with its proposed edits, and joins the README's Dropped table, begun or added to", () => {
  const area = areaSpec(config, Object.keys(SPEC), "uplink");
  const found = dropRows(area, new Map([["C-GM-02", "Help text, no promise"], ["R-GM-01", "Not ours to decide"], ["C-GM-99", "x"]]), (p) => SPEC[p] ?? "", "2026-11-15");
  assert.deepEqual(found.dropped.map((d) => [d.id, d.what]), [["C-GM-02", "The help says why each detail is asked for"], ["R-GM-01", "Undo goes back one change only"]], "the accepted row says what it was");
  assert.deepEqual(found.missing, ["C-GM-99"]);
  const flow = found.texts.get(`${DIR}/flow.md`);
  assert.ok(!/C-GM-02|R-GM-01/.test(flow) && /C-GM-01/.test(flow));
  const readme = found.texts.get(`${DIR}/README.md`);
  assert.match(readme, /## Dropped\n\nRows the owner dropped[^\n]*\n\n\| ID \| What \| Why \| Dropped \|\n\| --- \| --- \| --- \| --- \|\n\| C-GM-02 \| The help says why each detail is asked for \| Help text, no promise \| 2026-11-15 \|\n\| R-GM-01 \|/);
  const again = dropRows(area, new Map([["C-GM-01", "Covered elsewhere"]]), (p) => (p === `${DIR}/README.md` ? readme : SPEC[p]), "2026-11-16");
  assert.match(again.texts.get(`${DIR}/README.md`), /\| R-GM-01 \|[^\n]*\n\| C-GM-01 \| Nothing is deleted until you confirm \| Covered elsewhere \| 2026-11-16 \|\n$/, "a later drop joins the same table");
});

test("a review page's Drops, with each note as why", () => {
  assert.deepEqual([...dropsFromAnswers({ answers: { "GM-07.C-GM-02": { choice: "drop", note: "Help text" }, "GM-07.C-GM-01": { choice: "ok" }, "product.R-GM-01": { choice: "drop" } } })], [["C-GM-02", "Help text"], ["R-GM-01", "dropped on review"]]);
});

test("doc:check fails a dropped ID brought back or cited", () => {
  const texts = {
    [`${DIR}/README.md`]: "| ID | What | Why | Dropped |\n| --- | --- | --- | --- |\n| C-GM-07 | Old | Not worth it | 2026-11-15 |\n| R-GM-03 | Old rule | Not ours | 2026-11-15 |",
    [`${DIR}/flow.md`]: "| ID | Check | Stories | Rules | By |\n| --- | --- | --- | --- | --- |\n| C-GM-07 | Back again | GM-07 | R-GM-03 | |\n|  | New | GM-07 | | |",
  };
  const problems = testdataProblems({ config, tracked: Object.keys(texts), files: (p) => texts[p] ?? "" });
  assert.ok(problems.some((p) => /check C-GM-07 was dropped on 2026-11-15; a row it is needed for again gets a new ID/.test(p)), problems.join("\n"));
  assert.ok(problems.some((p) => /R-GM-03 was dropped on 2026-11-15; cite the rule or check that holds instead/.test(p)), problems.join("\n"));
});

test("wf testdata drop: a dry run, then --write from a page's answers, naming the code that cites the rows", () => {
  const root = mkdtempSync(join(tmpdir(), "wf-drop-"));
  const files = { ...SPEC, "src/move.test.ts": "test('help', () => {}) // C-GM-02\n" };
  for (const [path, text] of Object.entries(files)) { mkdirSync(join(root, path, ".."), { recursive: true }); writeFileSync(join(root, path), text); }
  mkdirSync(join(root, ".cache/view/answers"), { recursive: true });
  writeFileSync(join(root, ".cache/view/answers/uplink-owner-review.json"), JSON.stringify({ answers: { "GM-07.C-GM-02": { choice: "drop", note: "Help text, no promise" } } }));
  const ctx = { config, tracked: Object.keys(files), files: (p) => (existsSync(join(root, p)) ? readFileSync(join(root, p), "utf8") : "") };
  const run = (args) => { const out = []; return { code: runDrop(root, ctx, args, (l) => out.push(l), "2026-11-15"), out: out.join("\n") }; };
  assert.match(run(["uplink", "C-GM-02"]).out, /Usage/, "a drop by ID needs its why");
  const dry = run(["uplink", "--from", "uplink-owner-review"]);
  assert.match(dry.out, /1 row to drop: C-GM-02 \(a dry run/);
  assert.match(dry.out, /C-GM-02: src\/move\.test\.ts/);
  assert.match(readFileSync(join(root, `${DIR}/flow.md`), "utf8"), /C-GM-02/, "nothing written yet");
  assert.match(run(["uplink", "--from", "uplink-owner-review", "--write"]).out, /1 row dropped: C-GM-02, listed under Dropped/);
  assert.doesNotMatch(readFileSync(join(root, `${DIR}/flow.md`), "utf8"), /C-GM-02/);
  assert.match(readFileSync(join(root, `${DIR}/README.md`), "utf8"), /\| C-GM-02 \| The help says why each detail is asked for \| Help text, no promise \| 2026-11-15 \|/);
  assert.match(run(["uplink", "--from", "nope"]).out, /No answers for nope/);
});
