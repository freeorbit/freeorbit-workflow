import assert from "node:assert/strict";
import { test } from "node:test";

import { merge } from "../lib/config/config.mjs";
import { DEFAULTS } from "../lib/config/defaults.mjs";
import { areaSpec, forOwner, isJargon, levelOf, testdataProblems, testdataWarnings } from "../lib/testdata.mjs";
import { chunkChecks } from "../lib/testdata-trace.mjs";
import { reviewSpec } from "../lib/testdata-review.mjs";
import { applyTags } from "../lib/testdata-tag.mjs";

const DIR = "docs/plugins/uplink/test-data";
const config = (more = {}) => merge(DEFAULTS, { areas: [{ id: "uplink", prefix: "GM", docs: "docs/plugins/uplink" }], ...more });
const context = (cfg, texts) => ({ config: cfg, tracked: Object.keys(texts), files: (p) => texts[p] ?? "" });
const CHECKS = "| ID | Check | Setup | Stories | Rules | Level | By |\n| --- | --- | --- | --- | --- | --- | --- |";
const RULES = "| ID | Category | Type | Rule | Stories | Accepted |\n| --- | --- | --- | --- | --- | --- |";
const SPEC = {
  [`${DIR}/flow.md`]: [
    CHECKS,
    "| C-GM-01 | Nothing is deleted until you confirm | `gmail-ready` | GM-07 | | core+harm | |",
    "| C-GM-02 | Retry goes only to the contacts that failed | `gmail-partial` | GM-07 | | likely | |",
    "| C-GM-03 | A name in two scripts shows as typed | `names-mixed` | GM-07 | | rare | |",
    "| C-GM-04 | The help says why each detail is asked for | | GM-07 | | polish | |",
    "| C-GM-05 | An untagged check | | GM-07 | | | |",
    "", RULES,
    "| R-GM-01 | State | product | Undo goes back one change only | GM-07 | 2026-11-14 |",
    "| R-GM-02 | Never sent or stored | safety | Nothing is ever sent to Google | GM-07 | 2026-11-14 |",
    "| R-GM-03 | Stand-ins | craft | Invented companies use .test domains | GM-07 | 2026-11-14 |",
  ].join("\n"),
  [`${DIR}/glossary.md`]: "| Term | Plain meaning |\n| --- | --- |\n| Erasure | Asking a company to delete what it holds about you |",
  "docs/plugins/uplink/user-stories.md": "### GM-07. Move mail\n\nAcceptance:\n- moved\n",
};
const STORY_FILES = { stories: { files: ["docs/plugins/*/user-stories.md"] } };

test("a Level reads with +harm; the owner's rows are core, +harm, product, safety, and untagged", () => {
  assert.deepEqual(levelOf("core+harm"), { level: "core", harm: true });
  assert.deepEqual(levelOf(" likely + harm "), { level: "likely", harm: true });
  assert.deepEqual(levelOf(""), { level: "", harm: false });
  assert.equal(levelOf("important"), null);
  const row = (kind, more) => ({ kind, ...more });
  assert.deepEqual([row("check", { level: "core" }), row("check", { level: "rare", harm: true }), row("check", { level: "likely" }), row("check", { level: "" }), row("rule", { type: "product" }), row("rule", { type: "safety" }), row("rule", { type: "craft" }), row("rule", { type: "saftey" })].map(forOwner), [true, true, false, true, true, true, false, true], "a mistyped Type stays the owner's");
  for (const [text, jargon] of [["The list stays up-to-date after a restart", false], ["A letter dated 2026-11-14 is kept", false], ["Shown in `gmail-ready`", true], ["The downlink-gb-in-flight request waits", true], ["No DLCANARY-D23-1 reaches the log", true], ["APPMARK-3 stays out", true]]) assert.equal(isJargon(text), jargon, text);
});

test("doc:check fails a Level or Type off the list; a rule's category gives its Type where it can, and the rest warn, or fail when the project says so", () => {
  const texts = { [`${DIR}/x.md`]: [CHECKS, "| C-GM-01 | Shown in `gmail-ready` | | GM-07 | | core | |", "| C-GM-02 | Plain | | GM-07 | | urgent | |", "| C-GM-03 | No level | | GM-07 | | | |", "", RULES, "| R-GM-01 | Time | odd | A rule | GM-07 | 2026-11-14 |", "| R-GM-02 | Stand-ins | product | Fake domains | GM-07 | 2026-11-14 |", "| R-GM-03 | Data markers | | Emails on example.com | GM-07 | 2026-11-14 |", "| R-GM-04 | Never sent or stored | | No real name | GM-07 | 2026-11-14 |", "| R-GM-05 | State | | Kept on restart | GM-07 | 2026-11-14 |"].join("\n") };
  const found = testdataProblems(context(config(), texts)).filter((p) => /Level|Type|plain words/.test(p));
  assert.deepEqual(found.map((p) => p.replace(/^.*?: /, "").slice(0, 22)).sort(), ['C-GM-02 Level "urgent"', 'R-GM-01 Type "odd" is '], "a check row is from before acceptance lines, so only a Level off the list fails");
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

test("tags add Setup, Level, and Type columns, rewrite a check in plain words, and keep every row", () => {
  const old = { [`${DIR}/x.md`]: "| ID | Check | Stories | Rules | By |\n| --- | --- | --- | --- | --- |\n| C-GM-01 | In `gmail-ready`, nothing is deleted until Confirm | GM-07 | | |\n| C-GM-02 | Kept | GM-07 | | walk |\n\n| ID | Category | Rule | Stories | Accepted |\n| --- | --- | --- | --- | --- |\n| R-GM-01 | State | Undo goes back once | GM-07 | 2026-11-14 |\n" };
  const tags = "| ID | Level or Type | Plain Check | Setup |\n| --- | --- | --- | --- |\n| C-GM-01 | core+harm | Nothing is deleted until you confirm | `gmail-ready` |\n| R-GM-01 | product | | |\n| C-GM-99 | core | | |";
  const area = (texts) => areaSpec(config(), Object.keys(texts), "uplink");
  const found = applyTags(area(old), tags, (p) => old[p] ?? "");
  assert.deepEqual(found.problems, []);
  assert.equal(found.tagged, 2);
  assert.deepEqual(found.unknown, ["C-GM-99"]);
  assert.deepEqual(found.untouched, ["C-GM-02"]);
  assert.deepEqual(found.moves, [], "core+harm and product stay the owner's");
  assert.equal(found.texts.get(`${DIR}/x.md`), "| ID | Check | Setup | Stories | Rules | Level | By |\n| --- | --- | --- | --- | --- | --- | --- |\n| C-GM-01 | Nothing is deleted until you confirm | `gmail-ready` | GM-07 | | core+harm | |\n| C-GM-02 | Kept | | GM-07 | | | walk |\n\n| ID | Category | Type | Rule | Stories | Accepted |\n| --- | --- | --- | --- | --- | --- |\n| R-GM-01 | State | product | Undo goes back once | GM-07 | 2026-11-14 |\n");
  assert.match(applyTags(area(old), "| ID | Level or Type |\n| --- | --- |\n| C-GM-01 | urgent |", (p) => old[p] ?? "").problems[0], /"urgent" is not a Level/);
  const demote = applyTags(area(old), "| ID | Level or Type |\n| --- | --- |\n| C-GM-02 | rare |\n| R-GM-01 | craft |", (p) => old[p] ?? "");
  assert.deepEqual(demote.moves.map((m) => `${m.id} ${m.tag}`), ["C-GM-02 rare", "R-GM-01 craft"]);
  const piped = { [`${DIR}/x.md`]: "| ID | Check | Stories |\n| --- | --- | --- |\n| C-GM-01 | a | b | GM-07 |\n" };
  assert.match(applyTags(area(piped), "| ID | Level or Type |\n| --- | --- |\n| C-GM-01 | core |", (p) => piped[p] ?? "").problems[0], /has 4 cells and its header 3/, "a row it cannot keep whole stops the write");
});

test("the tag and review commands: no write while there are problems, a chunk's stories, an empty flag refused, and a page past its cap split by stories", async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { runReview, runTag } = await import("../lib/testdata-cli.mjs");
  const root = mkdtempSync(join(tmpdir(), "wf-owner-"));
  const texts = { ...SPEC, "docs/log/build-order.md": "## Chunks\n\n| Chunk | Status | Stories |\n| --- | --- | --- |\n| 37d. Move | In progress | GM-07 |\n" };
  for (const [path, text] of Object.entries(texts)) { mkdirSync(join(root, path, ".."), { recursive: true }); writeFileSync(join(root, path), text); }
  const ctx = { config: config({ buildOrder: { file: "docs/log/build-order.md", done: "docs/log/chunks-done.md" } }), tracked: Object.keys(texts), files: (p) => readFileSync(join(root, p), "utf8") };
  const run = (fn, args) => { const out = []; return { code: fn(root, ctx, args, (line) => out.push(line)), out: out.join("\n") }; };
  writeFileSync(join(root, "tags.md"), "| ID | Level or Type |\n| --- | --- |\n| C-GM-05 | urgent |\n| C-GM-01 | likely |");
  const bad = run(runTag, ["uplink", "tags.md", "--write"]);
  assert.equal(bad.code, 1);
  assert.match(bad.out, /Nothing written: fix the tags/);
  assert.match(readFileSync(join(root, `${DIR}/flow.md`), "utf8"), /\| C-GM-05 \| An untagged check \|/, "the file is as it was");
  assert.match(run(runTag, ["uplink", "nope.md"]).out, /No tags file at nope.md/);
  writeFileSync(join(root, "tags.md"), "| ID | Level or Type |\n| --- | --- |\n| R-GM-01 | craft |");
  assert.match(run(runTag, ["uplink", "tags.md", "--write"]).out, /1 of them move off the owner's side/);
  assert.ok(existsSync(join(root, ".cache/testdata/moved-uplink.md")));
  ctx.files = (p) => readFileSync(join(root, p), "utf8");
  const page = JSON.parse(run(runReview, ["uplink", "--chunk", "37d"]).out);
  assert.equal(page.id, "uplink-owner-review-37d");
  assert.ok(page.tables.some((t) => t.id === "moved"), "the move is on the owner's next page");
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
