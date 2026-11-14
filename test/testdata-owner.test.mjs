import assert from "node:assert/strict";
import { test } from "node:test";

import { merge } from "../lib/config/config.mjs";
import { DEFAULTS } from "../lib/config/defaults.mjs";
import { forOwner, isJargon, testdataProblems, testdataWarnings } from "../lib/testdata.mjs";
import { chunkChecks } from "../lib/testdata-trace.mjs";
import { reviewSpec } from "../lib/testdata-review.mjs";

const DIR = "docs/plugins/uplink/test-data";
const config = (more = {}) => merge(DEFAULTS, { areas: [{ id: "uplink", prefix: "GM", docs: "docs/plugins/uplink" }], ...more });
const context = (cfg, texts) => ({ config: cfg, tracked: Object.keys(texts), files: (p) => texts[p] ?? "" });
const CHECKS = "| ID | Check | Stories | Rules | By |\n| --- | --- | --- | --- | --- |";
const RULES = "| ID | Category | Type | Rule | Stories | Accepted |\n| --- | --- | --- | --- | --- | --- |";
const SPEC = {
  [`${DIR}/flow.md`]: [
    CHECKS,
    "| C-GM-01 | Nothing is deleted until you confirm | GM-07 | | |",
    "| C-GM-02 | Retry goes only to the contacts that failed | GM-07 | | |",
    "| C-GM-03 | A name in two scripts shows as typed | GM-07 | | |",
    "| C-GM-04 | The help says why each detail is asked for | GM-07 | | |",
    "| C-GM-05 | An untagged check | GM-07 | | |",
    "", RULES,
    "| R-GM-01 | State | product | Undo goes back one change only | GM-07 | 2026-11-14 |",
    "| R-GM-02 | Never sent or stored | safety | Nothing is ever sent to Google | GM-07 | 2026-11-14 |",
    "| R-GM-03 | Stand-ins | craft | Invented companies use .test domains | GM-07 | 2026-11-14 |",
  ].join("\n"),
  [`${DIR}/glossary.md`]: "| Term | Plain meaning |\n| --- | --- |\n| Erasure | Asking a company to delete what it holds about you |",
  "docs/plugins/uplink/user-stories.md": "### GM-07. Move mail\n\nAcceptance:\n- moved\n",
};
const STORY_FILES = { stories: { files: ["docs/plugins/*/user-stories.md"] } };

test("the owner's rules are product, safety, and any with no Type; a plain line holds no code names", () => {
  const row = (type) => ({ kind: "rule", type });
  assert.deepEqual(["product", "safety", "craft", "saftey", ""].map((type) => forOwner(row(type))), [true, true, false, true, true], "a mistyped Type stays the owner's");
  assert.equal(forOwner({ kind: "check" }), false, "a check row is nobody's to review");
  for (const [text, jargon] of [["The list stays up-to-date after a restart", false], ["A letter dated 2026-11-14 is kept", false], ["Shown in `gmail-ready`", true], ["The downlink-gb-in-flight request waits", true], ["No DLCANARY-D23-1 reaches the log", true], ["APPMARK-3 stays out", true]]) assert.equal(isJargon(text), jargon, text);
});

test("doc:check fails a Type off the list; a rule's category gives its Type where it can, and the rest warn, or fail when the project says so", () => {
  const texts = { [`${DIR}/x.md`]: [RULES, "| R-GM-01 | Time | odd | A rule | GM-07 | 2026-11-14 |", "| R-GM-02 | Stand-ins | product | Fake domains | GM-07 | 2026-11-14 |", "| R-GM-03 | Data markers | | Emails on example.com | GM-07 | 2026-11-14 |", "| R-GM-04 | Never sent or stored | | No real name | GM-07 | 2026-11-14 |", "| R-GM-05 | State | | Kept on restart | GM-07 | 2026-11-14 |"].join("\n") };
  assert.deepEqual(testdataProblems(context(config(), texts)).filter((p) => /Type/.test(p)).map((p) => p.replace(/^.*?: /, "").slice(0, 22)), ['R-GM-01 Type "odd" is ']);
  assert.deepEqual(testdataProblems(context(config({ testdata: { untagged: "fail" } }), texts)).filter((p) => /has no Type/.test(p)).map((p) => p.split(": ")[1]), ["R-GM-05 has no Type"]);
  const warned = testdataWarnings(context(config(), texts));
  assert.ok(warned.some((w) => /1 rule has no Type/.test(w)), warned.join("\n"));
  assert.ok(warned.some((w) => /R-GM-02 is Stand-ins, how test data is built, so its Type is craft/.test(w)));
});

test("at chunk end an acceptance line and the owner's rules fail; craft rules are the team's; check rows are only counted", () => {
  const found = chunkChecks(context(config(STORY_FILES), SPEC), "37d", ["GM-07"], { open: ["37d"], done: [] });
  const ids = (list) => list.map((each) => each.id).sort();
  assert.deepEqual(ids(found.unproven), ["GM-07.1", "R-GM-01", "R-GM-02"]);
  assert.deepEqual(ids(found.ungated), ["R-GM-03"]);
  assert.deepEqual(found.legacy, { checks: 5, cited: 0 });
});

test("the owner's page holds product and safety rules with the glossary, and the team's the craft rules; solo, the craft rules are one row on the one page", () => {
  const team = config({ team: "team", people: [{ name: "A", roles: ["owner"] }, { name: "B", roles: ["developer"] }] });
  const owner = reviewSpec(context(team, SPEC), "uplink", { chunk: "37d", stories: ["GM-07"] });
  assert.equal(owner.template, "testdata");
  assert.deepEqual(owner.tables.map((t) => [t.title, t.rows.map((r) => r.id)]), [["How the app behaves: product rules", ["R-GM-01"]], ["Promises about privacy and safety: one list", ["R-GM-02"]]], "check rows are not reviewed: acceptance lines are the checks");
  assert.match(owner.blocks[0].text, /The team handles 1 craft rules: npx wf testdata review uplink --chunk 37d --team/);
  assert.deepEqual(owner.blocks[1].rows, [["Erasure", "Asking a company to delete what it holds about you"]]);
  const theirs = reviewSpec(context(team, SPEC), "uplink", { team: true });
  assert.deepEqual(theirs.tables.map((t) => [t.id, t.rows.map((r) => r.id)]), [["craft-stand-ins", ["R-GM-03"]]], "craft rules a category at a time");
  const solo = reviewSpec(context(config(), SPEC), "uplink", {});
  assert.deepEqual(solo.tables.map((t) => t.id), ["product", "safety", "craft"]);
  assert.deepEqual(solo.tables[2].rows, [{ id: "craft", cells: ["1 craft rule: Stand-ins 1. npx wf testdata review uplink --team lists each."], recommended: "ok" }]);
  assert.match(solo.blocks[0].text, /The 1 craft rules are one row at the end/);
});

test("the review command: a chunk's stories, an empty flag refused, and a chunk with no row", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, readFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { runReview } = await import("../lib/testdata-cli.mjs");
  const root = mkdtempSync(join(tmpdir(), "wf-owner-"));
  const texts = { ...SPEC, "docs/log/build-order.md": "## Chunks\n\n| Chunk | Status | Stories |\n| --- | --- | --- |\n| 37d. Move | In progress | GM-07 |\n" };
  for (const [path, text] of Object.entries(texts)) { mkdirSync(join(root, path, ".."), { recursive: true }); writeFileSync(join(root, path), text); }
  const ctx = { config: config({ buildOrder: { file: "docs/log/build-order.md", done: "docs/log/chunks-done.md" } }), tracked: Object.keys(texts), files: (p) => readFileSync(join(root, p), "utf8") };
  const run = (fn, args) => { const out = []; return { code: fn(root, ctx, args, (line) => out.push(line)), out: out.join("\n") }; };
  const page = JSON.parse(run(runReview, ["uplink", "--chunk", "37d"]).out);
  assert.equal(page.id, "uplink-owner-review-37d");
  assert.deepEqual(page.tables.map((t) => t.id), ["product", "safety", "craft"]);
  assert.throws(() => run(runReview, ["uplink", "--chunk"]), /--chunk needs a value/);
  assert.match(run(runReview, ["uplink", "--chunk", "99z"]).out, /No row for 99z/);
});

test("a product rule in code words warns; the trace names what nothing proves", async () => {
  const texts = { [`${DIR}/x.md`]: `${RULES}\n| R-GM-01 | State | product | Undo in \`gmail-ready\` goes back once | GM-07 | 2026-11-14 |` };
  assert.ok(testdataWarnings(context(config(), texts)).some((w) => /R-GM-01 is the owner's to read; say it in plain words/.test(w)));
  const { chunkLines } = await import("../lib/testdata-trace.mjs");
  const lines = chunkLines(chunkChecks(context(config(STORY_FILES), SPEC), "37d", ["GM-07"], { open: ["37d"], done: [] })).join("\n");
  assert.match(lines, /proven by nothing: 3/);
  assert.match(lines, /craft rules no test cites yet, the team's, not gated: 1/);
});
