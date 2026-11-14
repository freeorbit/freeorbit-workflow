import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { merge, project } from "../lib/config/config.mjs";
import { DEFAULTS } from "../lib/config/defaults.mjs";
import { storyIds } from "../lib/docs/shape.mjs";
import { findId, idLines } from "../lib/idfind.mjs";
import { idKinds, kindOf, qualify, within } from "../lib/ids.mjs";
import { fillCheckIds, testdataProblems, testdataWarnings } from "../lib/testdata.mjs";
import { areaOfPath, renameIds, textSpans } from "../lib/testdata-rename.mjs";
import { rootOf } from "../plugins/core/hooks/guard.mjs";

const AREAS = [
  { id: "uplink", prefix: "GM", docs: "docs/plugins/uplink" },
  { id: "downlink", prefix: "DR", docs: "docs/plugins/downlink" },
];
const config = merge(DEFAULTS, { areas: AREAS });
const context = (texts) => ({ config, tracked: Object.keys(texts), files: (path) => texts[path] ?? "" });
const rules = (...ids) => ["| ID | Category | Rule |", "| --- | --- | --- |", ...ids.map((id) => `| ${id} | Time | A rule |`)].join("\n");

test("each kind's example is that kind; old IDs and names are told apart from findings", () => {
  for (const each of idKinds(config)) assert.equal(kindOf(each.example, config), each.kind, each.example);
  for (const [id, kind] of [["R-12", "old rule"], ["C-41", "old check"], ["G-03", "old gap"], ["D27", "old dataset"], ["gmail-move-file-saved", "name"], ["R-XX-1", null], ["what?", null]]) assert.equal(kindOf(id, config), kind, id);
  assert.equal(qualify("R-12", "GM"), "R-GM-12");
  assert.equal(qualify("D27", "GM"), "DS-GM-27");
  assert.ok(!within("R-GM-1").test("R-GM-12") && !within("R-12").test("R-GM-12") && within("R-GM-1").test("see R-GM-1."));
});

test("ids.md describes every kind in the table", () => {
  const doc = readFileSync(new URL("../docs/workflow/ids.md", import.meta.url), "utf8");
  for (const each of idKinds(config)) assert.ok(doc.includes(`| ${each.kind} |`) && doc.includes(`\`${each.example}\``), each.kind);
});

test("doc:check fails an ID defined twice in the app, or with another area's prefix", () => {
  const found = testdataProblems(context({
    "docs/plugins/uplink/test-data/rules.md": rules("R-GM-01", "R-DR-02"),
    "docs/plugins/uplink/test-data/move.md": rules("R-GM-01"),
  }));
  assert.ok(found.some((p) => /R-DR-02.*another area's prefix/.test(p)), found.join("\n"));
  assert.ok(found.some((p) => /R-GM-01 is defined already, at docs\/plugins\/uplink\/test-data\/move.md:3|R-GM-01 is defined already, at docs\/plugins\/uplink\/test-data\/rules.md:3/.test(p)), found.join("\n"));
  assert.equal(found.length, 2, found.join("\n"));
});

test("rename-ids qualifies an ID by the one area that defines it, or by the place, and leaves the rest for a person", () => {
  const texts = {
    "docs/plugins/uplink/test-data/rules.md": rules("R-01", "R-02"),
    "docs/plugins/downlink/test-data/rules.md": rules("R-01"),
    "plugins/uplink/src/move.rs": "// R-01 and R-02",
    "docs/log/decisions/downlink.md": "R-01",
    "docs/research/audit.md": "R-01 and R-02, not R-0123",
  };
  assert.equal(areaOfPath("plugins/uplink/src/move.rs", AREAS).id, "uplink");
  assert.equal(areaOfPath("docs/research/audit.md", AREAS), null);
  const found = renameIds(context(texts));
  assert.equal(found.texts.get("docs/plugins/uplink/test-data/rules.md"), rules("R-GM-01", "R-GM-02"));
  assert.equal(found.texts.get("plugins/uplink/src/move.rs"), "// R-GM-01 and R-GM-02");
  assert.equal(found.texts.get("docs/log/decisions/downlink.md"), "R-DR-01");
  assert.equal(found.texts.get("docs/research/audit.md"), "R-01 and R-GM-02, not R-0123");
  assert.deepEqual(found.ambiguous, [{ path: "docs/research/audit.md", line: 1, id: "R-01", areas: ["uplink", "downlink"] }]);
});

test("wf id finds where an ID is defined and each line that cites it, whole IDs only", () => {
  const found = findId(context({
    "docs/plugins/uplink/test-data/rules.md": rules("R-GM-01", "R-GM-012"),
    "plugins/uplink/src/move_test.rs": "// R-GM-01\n// R-GM-012",
    "docs/plugins/uplink/test-data/move.md": "| C-GM-01 | x | GM-01 | R-GM-01 | |",
  }), "R-GM-01");
  assert.equal(found.kind, "rule");
  assert.deepEqual(found.defined.map((d) => `${d.path}:${d.line}`), ["docs/plugins/uplink/test-data/rules.md:3"]);
  assert.deepEqual(found.cited.map((c) => `${c.place} ${c.path}:${c.line}`).sort(), ["spec docs/plugins/uplink/test-data/move.md:1", "tests plugins/uplink/src/move_test.rs:1"]);
});

test("in an area's own docs an old ID is that area's, defined now or retired; in code only comments and strings change; product data and kit docs are left alone", () => {
  const texts = {
    "docs/plugins/uplink/test-data/rules.md": rules("R-01"),
    "docs/app/test-data/data.md": "### D10. Settings",
    "docs/plugins/uplink/test-data/README.md": "The old D10, and D16, became D23 to D26.",
    "tools/testdata/src/uplink/data.rs": 'const D10: u8 = 1; // D10 is the old set\nlet s = "R-01";\nfn f<\'a>() -> D10 { D10.iter() }',
    "plugins/uplink/data/companies.toml": 'runs = ["D10 Club"]',
    "tools/testdata/fixtures/uplink/a.json": '{ "dataset": "D10" }',
    "docs/workflow/test-data-formats.md": "| R-01 | x |",
  };
  const found = renameIds(context(texts));
  assert.equal(found.texts.get("docs/plugins/uplink/test-data/README.md"), "The old DS-GM-10, and DS-GM-16, became DS-GM-23 to DS-GM-26.");
  assert.equal(found.texts.get("tools/testdata/src/uplink/data.rs"), 'const D10: u8 = 1; // DS-GM-10 is the old set\nlet s = "R-GM-01";\nfn f<\'a>() -> D10 { D10.iter() }');
  assert.equal(found.texts.get("tools/testdata/fixtures/uplink/a.json"), '{ "dataset": "DS-GM-10" }');
  assert.ok(!found.texts.has("plugins/uplink/data/companies.toml") && found.skipped.includes("plugins/uplink/data/companies.toml"));
  assert.ok(!found.texts.has("docs/workflow/test-data-formats.md"));
});

test("a story ID inside another ID is not a story", () => {
  assert.deepEqual([...storyIds("GM-49, C-GM-50, R-GM-51, DS-GM-52, D-GM-101", ["GM"])], ["GM-49"]);
});

test("the guard's root is the project or a worktree of it with a workflow config; a parent's or a fixture's config is not", () => {
  const top = realpathSync(mkdtempSync(join(tmpdir(), "wf-root-")));
  const main = join(top, "repo");
  const tree = join(main, ".claude", "worktrees", "chunk");
  const config = (dir) => { mkdirSync(join(dir, ".workflow"), { recursive: true }); writeFileSync(join(dir, ".workflow", "config.json"), "{}"); };
  for (const dir of [top, main, tree, join(tree, "test", "fixture")]) config(dir);
  mkdirSync(join(main, ".git", "worktrees", "chunk"), { recursive: true });
  mkdirSync(join(main, "src"));
  writeFileSync(join(tree, ".git"), `gitdir: ${join(main, ".git", "worktrees", "chunk")}\n`);
  assert.equal(rootOf(join(tree, "test", "fixture"), main), tree, "a fixture's config inside the worktree is passed over");
  assert.equal(rootOf(join(main, "src"), main), main);
  assert.equal(rootOf(top, main), main, "a parent's config never becomes the root");
  rmSync(top, { recursive: true, force: true });
});

test("with no area prefixes there are no area kinds, so a finding is never a story", () => {
  const none = merge(DEFAULTS, { areas: [] });
  for (const [id, kind] of [["SEC-083", "finding"], ["CH-12", "chunk"], ["R-12", "old rule"], ["GM-07", "finding"]]) assert.equal(kindOf(id, none), kind, id);
});

test("comments and strings are the text of code, in each language", () => {
  const spans = (text, path) => textSpans(text, path).map(([a, b]) => text.slice(a, b));
  const rows = [
    ["a.rs", "x /* a /* b */ c */ y", ["/* a /* b */ c */"]],
    ["a.rs", 'r#"D1 "q""# D2', ['r#"D1 "q""#']],
    ["a.rs", "let c = '\"'; // D1", ["// D1"]],
    ["a.ts", "`D1 ${D10} D2` + 'D3'", ["`D1 ", " D2`", "'D3'"]],
    ["a.py", "x = D1  # D2\n'''D3\nD4'''", ["# D2", "'''D3\nD4'''"]],
  ];
  for (const [path, text, want] of rows) assert.deepEqual(spans(text, path), want, text);
});

test("an ID a place's area does not know, which another area defines, is left for a person; a story on the line can name the area", () => {
  const found = renameIds(context({
    "docs/plugins/uplink/test-data/rules.md": rules("R-07"),
    "docs/plugins/downlink/test-data/rules.md": rules("R-09"),
    "plugins/downlink/src/a.rs": "// R-07",
    "docs/log/chunks-done.md": "R-09 and R-07, for DR-03",
  }));
  assert.deepEqual(found.ambiguous, [{ path: "plugins/downlink/src/a.rs", line: 1, id: "R-07", areas: ["uplink", "downlink"] }]);
  assert.equal(found.texts.get("docs/log/chunks-done.md"), "R-DR-09 and R-GM-07, for DR-03");
});

test("doc:check warns for old IDs with an example, and for a name two areas define", () => {
  const found = testdataWarnings(context({
    "docs/plugins/uplink/test-data/rules.md": rules("R-12"),
    "docs/plugins/uplink/test-data/states.md": "| State |\n| --- |\n| `ready` |",
    "docs/plugins/downlink/test-data/states.md": "| State |\n| --- |\n| `ready` |",
  }));
  assert.ok(found.includes("docs/plugins/uplink/test-data/: 1 ID is not area-qualified (R-12); npx wf testdata rename-ids qualifies them, such as R-GM-12"), found.join("\n"));
  assert.ok(found.includes("docs/plugins/downlink/test-data/states.md:3: state ready is also defined at docs/plugins/uplink/test-data/states.md:3; a name is unique across the app"), found.join("\n"));
});

test("a check ID carries the area's prefix, numbered on from old and new IDs alike", () => {
  const text = "| ID | Check | Stories |\n| --- | --- | --- |\n| C-04 | a | GM-01 |\n| C-GM-07 | b | GM-01 |\n|  | c | GM-01 |";
  const { texts } = fillCheckIds(["x.md"], () => text, "GM");
  assert.match(texts.get("x.md"), /\| C-GM-08 \| c \|/);
});

test("wf id's lines: a second definition is flagged, citations past 15 are counted, and terminal escapes are shown, not run", () => {
  const at = (n) => ({ path: "a.rs", line: n, text: `// R-GM-01 \x1b[2J${n}`, place: "code" });
  const lines = idLines({ id: "R-GM-01", kind: "rule", means: "A rule", defined: [at(1), at(2)], cited: Array.from({ length: 16 }, (_, i) => at(i)) });
  assert.ok(lines.some((l) => l.startsWith("Defined 2 times")));
  assert.ok(lines.includes("Cited 16 times: code 16") && lines.includes("  … --all lists every one."));
  assert.ok(!lines.some((l) => l.includes("\x1b")));
});

test("a folder is advised to become one file only when that file fits a page", () => {
  const n = (count) => Array.from({ length: count }, (_, i) => `l${i}`).join("\n");
  const sizes = { "a/README.md": 10, "a/x.md": 80, "b/README.md": 10, "b/x.md": 120 };
  const texts = Object.fromEntries(Object.entries(sizes).map(([path, count]) => [`docs/plugins/uplink/test-data/${path}`, n(count)]));
  const found = testdataWarnings(context(texts));
  assert.ok(found.some((w) => w === "docs/plugins/uplink/test-data/a/: 2 files, 90 lines in all; npx wf testdata merge docs/plugins/uplink/test-data/a/ makes it one file of 91 lines"), found.join("\n"));
  assert.ok(!found.some((w) => w.startsWith("docs/plugins/uplink/test-data/b/: 2 files")));
});

test("the project's files leave out one deleted but not staged, and name each symbolic link", () => {
  const root = mkdtempSync(join(tmpdir(), "wf-files-"));
  const git = (...args) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  git("init", "-q");
  mkdirSync(join(root, ".workflow"));
  writeFileSync(join(root, ".workflow", "config.json"), "{}");
  for (const name of ["a.md", "gone.md"]) writeFileSync(join(root, name), "x");
  symlinkSync("/etc/hostname", join(root, "link.md"));
  git("add", ".");
  rmSync(join(root, "gone.md"));
  const { tracked, links } = project(root);
  assert.deepEqual(tracked.sort(), [".workflow/config.json", "a.md", "link.md"]);
  assert.deepEqual([...links], ["link.md"]);
  rmSync(root, { recursive: true, force: true });
});
