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

test("a Level reads with +harm; the owner's rows are core, +harm, product, safety, and untagged", () => {
  assert.deepEqual(levelOf("core+harm"), { level: "core", harm: true });
  assert.deepEqual(levelOf(" likely + harm "), { level: "likely", harm: true });
  assert.deepEqual(levelOf(""), { level: "", harm: false });
  assert.equal(levelOf("important"), null);
  const row = (kind, more) => ({ kind, ...more });
  assert.deepEqual([row("check", { level: "core" }), row("check", { level: "rare", harm: true }), row("check", { level: "likely" }), row("check", { level: "" }), row("rule", { type: "product" }), row("rule", { type: "safety" }), row("rule", { type: "craft" }), row("rule", { type: "saftey" })].map(forOwner), [true, true, false, true, true, true, false, true], "a mistyped Type stays the owner's");
  for (const [text, jargon] of [["The list stays up-to-date after a restart", false], ["A letter dated 2026-11-14 is kept", false], ["Shown in `gmail-ready`", true], ["The downlink-gb-in-flight request waits", true], ["No DLCANARY-D23-1 reaches the log", true], ["APPMARK-3 stays out", true]]) assert.equal(isJargon(text), jargon, text);
});

test("doc:check fails a Level or Type off the list, and code names in a core check; untagged rows warn, or fail when the project says so", () => {
  const texts = { [`${DIR}/x.md`]: [CHECKS, "| C-GM-01 | Shown in `gmail-ready` | | GM-07 | | core | |", "| C-GM-02 | Plain | | GM-07 | | urgent | |", "| C-GM-03 | No level | | GM-07 | | | |", "", RULES, "| R-GM-01 | Time | odd | A rule | GM-07 | 2026-11-14 |", "| R-GM-02 | Stand-ins | product | Fake domains | GM-07 | 2026-11-14 |"].join("\n") };
  const found = testdataProblems(context(config(), texts)).filter((p) => /Level|Type|plain words|no Level/.test(p));
  assert.equal(found.length, 3, found.join("\n"));
  assert.ok(found.some((p) => /C-GM-01 is the owner's to read/.test(p)) && found.some((p) => /C-GM-02 Level "urgent"/.test(p)) && found.some((p) => /R-GM-01 Type "odd"/.test(p)));
  assert.ok(testdataProblems(context(config({ testdata: { untagged: "fail" } }), texts)).some((p) => /C-GM-03 has no Level/.test(p)));
  const warned = testdataWarnings(context(config(), texts));
  assert.ok(warned.some((w) => /1 row has no Level or Type yet/.test(w)), warned.join("\n"));
  assert.ok(warned.some((w) => /R-GM-02 is Stand-ins, how test data is built, so its Type is craft/.test(w)));
});

test("budgets count by Level, and a rare check on a story that is not high-risk warns", () => {
  const rows = (level, n) => Array.from({ length: n }, (_, i) => `| C-GM-${level[0]}${i} | ${level} ${i} | | GM-07 | | ${level} | |`);
  const texts = { [`${DIR}/x.md`]: [CHECKS, ...rows("core", 4), ...rows("likely", 5), ...rows("rare", 1)].join("\n"), "docs/plugins/uplink/user-stories.md": "### GM-07. Move\n\nAcceptance:\n- x\n" };
  const found = testdataWarnings(context(config(), texts));
  assert.ok(found.some((w) => /story GM-07 has 4 core checks, over 3/.test(w)), found.join("\n"));
  assert.ok(!found.some((w) => /likely checks, over/.test(w)));
  assert.ok(found.some((w) => /GM-07 has 1 rare check but no Risk: high line/.test(w)));
});

test("at chunk end only the owner's rows fail; likely warns; rare and craft are the team's; polish is walked", () => {
  const found = chunkChecks(context(config(), SPEC), "37d", ["GM-07"], { open: ["37d"], done: [] });
  const ids = (list) => list.map((each) => each.id).sort();
  assert.deepEqual(ids(found.unproven), ["C-GM-01", "C-GM-05", "R-GM-01", "R-GM-02"]);
  assert.deepEqual(ids(found.likely), ["C-GM-02"]);
  assert.deepEqual(ids(found.ungated), ["C-GM-03", "R-GM-03"]);
  assert.deepEqual(ids(found.walk), ["C-GM-04"]);
});

test("the owner's page holds their rows by story, plain, recommended Fine, with the glossary; the team's holds the rest", () => {
  const owner = reviewSpec(context(config(), SPEC), "uplink", { chunk: "37d", stories: ["GM-07"] });
  assert.equal(owner.template, "testdata");
  assert.deepEqual(owner.tables.map((t) => [t.title, t.rows.map((r) => r.id)]), [["GM-07: Move mail", ["C-GM-01", "C-GM-05"]], ["How the app behaves: product rules", ["R-GM-01"]], ["Promises about privacy and safety: one list", ["R-GM-02"]]]);
  assert.deepEqual(owner.tables[0].rows[0], { id: "C-GM-01", cells: ["Nothing is deleted until you confirm", "core+harm"], recommended: "ok" });
  assert.match(owner.blocks[0].text, /The team handles 4 more \(1 likely, 1 rare, 1 polish, 1 craft rules\)/);
  assert.deepEqual(owner.blocks[1].rows, [["Erasure", "Asking a company to delete what it holds about you"]]);
  const team = reviewSpec(context(config(), SPEC), "uplink", { team: true });
  assert.deepEqual(team.tables.map((t) => t.id), ["likely", "rare", "polish", "craft-stand-ins"], "craft rules a category at a time");
  const moved = reviewSpec(context(config(), SPEC), "uplink", { moves: "| ID | Was | Tag | Plain |\n| --- | --- | --- | --- |\n| C-GM-02 | In `gmail-partial`, Retry … | likely | Retry goes only to the failed contacts |" });
  assert.deepEqual(moved.tables.at(-1).rows, [{ id: "C-GM-02", cells: ["In `gmail-partial`, Retry …", "Retry goes only to the failed contacts", "likely"], recommended: "ok" }], "the owner sees each row the tags took from them, once");
  assert.deepEqual(team.tables[0].rows[0].cells, ["Retry goes only to the contacts that failed", "`gmail-partial`", "GM-07"]);
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
  writeFileSync(join(root, "tags.md"), "| ID | Level or Type |\n| --- | --- |\n| C-GM-05 | likely |");
  assert.match(run(runTag, ["uplink", "tags.md", "--write"]).out, /1 of them move off the owner's side/);
  assert.ok(existsSync(join(root, ".cache/testdata/moved-uplink.md")));
  ctx.files = (p) => readFileSync(join(root, p), "utf8");
  const page = JSON.parse(run(runReview, ["uplink", "--chunk", "37d"]).out);
  assert.equal(page.id, "uplink-owner-review-37d");
  assert.ok(page.tables.some((t) => t.id === "moved"), "the move is on the owner's next page");
  assert.throws(() => run(runReview, ["uplink", "--chunk"]), /--chunk needs a value/);
  assert.match(run(runReview, ["uplink", "--chunk", "99z"]).out, /No row for 99z/);
});

test("a product rule in code words warns; the gate carries a likely warning into wf done; the trace names likely and team rows", async () => {
  const texts = { [`${DIR}/x.md`]: `${RULES}\n| R-GM-01 | State | product | Undo in \`gmail-ready\` goes back once | GM-07 | 2026-11-14 |` };
  assert.ok(testdataWarnings(context(config(), texts)).some((w) => /R-GM-01 is the owner's to read; say it in plain words/.test(w)));
  const { steps } = await import("../lib/tracks.mjs");
  const io = { read: (p) => (p.endsWith("test-data/README.md") ? "# Spec" : ""), wf: () => ({ status: 0, stdout: "  likely checks proven by nothing, a warning: C-GM-02\n" }) };
  const step = steps("/nowhere", config(), "chunk", "done", "37d", io).find((s) => Array.isArray(s) && s[0].startsWith("every check and rule"));
  assert.deepEqual(step[1](), { status: "OK", note: "likely checks proven by nothing, a warning: C-GM-02" });
  const { chunkLines } = await import("../lib/testdata-trace.mjs");
  const lines = chunkLines(chunkChecks(context(config(), SPEC), "37d", ["GM-07"], { open: ["37d"], done: [] })).join("\n");
  assert.match(lines, /likely checks proven by nothing, a warning: C-GM-02/);
  assert.match(lines, /rare checks and craft rules no test cites yet, the team's, not gated: 2/);
});
