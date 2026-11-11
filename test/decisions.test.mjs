import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { merge } from "../lib/config/config.mjs";
import { addDecision, decisionFiles, decisionProblems, emptyFile, rows, supersede } from "../lib/logs/decisions.mjs";
import { DEFAULTS } from "../lib/config/defaults.mjs";
import { matcher } from "../lib/config/config.mjs";

const config = (more = {}) => merge(DEFAULTS, { areas: [{ id: "uplink", prefix: "GM", docs: "docs/plugins/uplink" }], ...more });

test("one file per area and topic, each with its prefix", () => {
  assert.deepEqual(decisionFiles(config()).map((file) => `${file.id}:${file.prefix}:${file.path}`), [
    "uplink:GM:docs/log/decisions/uplink.md",
    "stack:ST:docs/log/decisions/stack.md",
    "design:DS:docs/log/decisions/design.md",
    "workflow:WF:docs/log/decisions/workflow.md",
  ]);
});

test("add puts the next ID on top, past closed ones, and refuses a long cell", () => {
  const root = mkdtempSync(join(tmpdir(), "wf-dec-"));
  assert.equal(addDecision(root, config(), "uplink", "Copy over IMAP where the provider allows it.", "Free plans have no IMAP.", "2026-11-06"), "D-GM-001");
  assert.equal(addDecision(root, config(), "uplink", "Takeout is the everyday path.", "It needs no app password.", "2026-11-07"), "D-GM-002");
  const text = readFileSync(join(root, "docs/log/decisions/uplink.md"), "utf8");
  assert.deepEqual(rows(text).map((row) => row.id), ["D-GM-002", "D-GM-001"]);
  supersede(root, config(), "D-GM-002", "D-GM-001");
  assert.deepEqual(rows(readFileSync(join(root, "docs/log/decisions-closed/uplink.md"), "utf8")).map((row) => `${row.id} ${row.status}`), ["D-GM-002 superseded by D-GM-001"]);
  assert.equal(addDecision(root, config(), "uplink", "Next.", "Because.", "2026-11-08"), "D-GM-003", "a closed ID is never reused");
  assert.throws(() => addDecision(root, config(), "uplink", "word ".repeat(31), "Why.", "2026-11-08"), /31 words; keep it to 30/);
  assert.throws(() => addDecision(root, config(), "nope", "A.", "B.", "2026-11-08"), /no decisions file nope/);
});

test("doc:check holds IDs, order, status, length, and citations", () => {
  const file = decisionFiles(config())[0];
  const good = `${emptyFile(file)}| D-GM-002 | 2026-11-07 | Two. | Why. | active |\n| D-GM-001 | 2026-11-06 | One. | Why. | active |\n`;
  const bad = `${emptyFile(file)}| D-GM-001 | 2026-11-06 | One. | Why. | active |\n| D-ST-002 | 2026-11-07 | ${"long ".repeat(31)}| Why. | superseded by D-GM-001 |\n| D-GM-001 | 2026-11-05 | Again. | Why. | active |\n`;
  const texts = {
    "docs/log/decisions/uplink.md": bad,
    "docs/app/architecture.md": "As D-GM-001 says, and D-GM-009 does not exist (decided 2026-11-06). D-XYZ-001 is not a decision prefix.",
    "docs/research/old.md": "decided 2026-10-01, D-GM-777",
  };
  const context = { config: config(), tracked: Object.keys(texts), files: (path) => texts[path] };
  const found = decisionProblems(context, matcher(context.config.docs.history));
  for (const pattern of [/D-ST-002 does not belong in uplink/, /D-ST-002 is newer than the row above/, /D-ST-002 Decision has 31 words/, /D-ST-002 is superseded by D-GM-001; move it/, /D-GM-001 is also at/, /architecture\.md: no decision D-GM-009/, /architecture\.md: cites a decision by its date/]) {
    assert.ok(found.some((problem) => pattern.test(problem)), `${pattern}: ${found.join("\n")}`);
  }
  assert.ok(!found.some((problem) => problem.includes("old.md")), "history is not checked");
  assert.ok(!found.some((problem) => problem.includes("D-XYZ")));
  const fine = { config: config(), tracked: ["docs/log/decisions/uplink.md"], files: () => good };
  assert.deepEqual(decisionProblems(fine, matcher(fine.config.docs.history)), []);
  const longForm = { ...context, config: config({ docs: { longDecisions: ["uplink"] } }) };
  assert.ok(!decisionProblems(longForm, matcher(longForm.config.docs.history)).some((problem) => /words, over/.test(problem)));
  const moved = { config: config(), tracked: ["docs/log/decisions-closed/uplink.md"], files: () => `${emptyFile(file, true)}| D-GM-003 | 2026-11-07 | Moved. | Why. | moved to D-ST-009 |\n` };
  assert.deepEqual(decisionProblems(moved, matcher(moved.config.docs.history)), []);
});
