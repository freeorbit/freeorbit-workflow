import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { merge } from "../lib/config/config.mjs";
import { DEFAULTS } from "../lib/config/defaults.mjs";
import { findId } from "../lib/idfind.mjs";
import { idKinds, kindOf, qualify, within } from "../lib/ids.mjs";
import { testdataProblems } from "../lib/testdata.mjs";
import { areaOfPath, renameIds } from "../lib/testdata-rename.mjs";

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
