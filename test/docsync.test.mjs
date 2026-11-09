import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { merge } from "../lib/config.mjs";
import { DEFAULTS } from "../lib/defaults.mjs";
import { docProblems, fromDisk, kitDocs, parts, planDocs, render, slots, syncDocs } from "../lib/docsync.mjs";

const KIT = "# Steps\n\nGeneric.\n\n<!-- wf:local extra -->\n\n## End\n\n<!-- wf:local empty -->\n\nDone.\n";

test("a doc renders with the project's part in its slot, and an empty pair where it has none", () => {
  const out = render("steps", KIT, new Map([["extra", "Project part."]]));
  assert.deepEqual(slots(KIT), ["extra", "empty"]);
  assert.match(out, /^<!-- From the freeorbit-workflow kit's docs\/workflow\/steps\.md\./);
  assert.match(out, /<!-- wf:local extra -->\nProject part\.\n<!-- \/wf:local extra -->/);
  assert.match(out, /<!-- wf:local empty -->\n<!-- \/wf:local empty -->/);
  assert.deepEqual(parts(out), new Map([["extra", "Project part."], ["empty", ""]]));
});

test("an older opening line with a note after the name is still read as the part", () => {
  assert.deepEqual(parts("<!-- wf:local x: docs/workflow/local/s/x.md -->\nKept.\n<!-- /wf:local x -->\n"), new Map([["x", "Kept."]]));
});

/** A project with one synced doc, and a kit docs folder holding the doc above. */
function fixture() {
  const base = mkdtempSync(join(tmpdir(), "wf-docs-"));
  const kit = join(base, "kit");
  mkdirSync(kit);
  writeFileSync(join(kit, "steps.md"), KIT);
  const root = join(base, "project");
  mkdirSync(join(root, "docs/workflow"), { recursive: true });
  return { root, kit, config: merge(DEFAULTS, { docs: { synced: ["steps"] } }) };
}

test("sync keeps a part edited in place, and check fails an edit outside the parts", () => {
  const { root, kit, config } = fixture();
  const file = join(root, "docs/workflow/steps.md");
  const read = (p) => readFileSync(join(root, p), "utf8");
  syncDocs(root, config, kit);
  writeFileSync(file, read("docs/workflow/steps.md").replace("<!-- wf:local extra -->\n", "<!-- wf:local extra -->\nOurs.\n"));
  assert.deepEqual(docProblems(config, fromDisk(root), kit), []);
  assert.deepEqual(syncDocs(root, config, kit), []);
  assert.match(read("docs/workflow/steps.md"), /<!-- wf:local extra -->\nOurs\.\n/);
  writeFileSync(file, read("docs/workflow/steps.md").replace("Generic.", "Changed here."));
  assert.deepEqual(docProblems(config, fromDisk(root), kit), [
    "docs/workflow/steps.md: differs from the kit outside its wf:local parts; change the kit, or run wf docs sync",
  ]);
});

test("a part whose slot the kit dropped stops sync, so its text is not lost", () => {
  const { root, kit, config } = fixture();
  writeFileSync(join(root, "docs/workflow/steps.md"), "<!-- wf:local gone -->\nKeep me.\n<!-- /wf:local gone -->\n");
  assert.deepEqual(planDocs(config, fromDisk(root), kit).orphans, ["docs/workflow/steps.md: a part for gone, which the kit doc no longer has"]);
  assert.throws(() => syncDocs(root, config, kit), /a part for gone/);
});

test("the kit ships its workflow docs", () => {
  assert.ok(kitDocs().includes("four-steps"));
});

test("a synced doc not yet written, and a synced name the kit lacks, are listed together", () => {
  const { root, kit } = fixture();
  const config = merge(DEFAULTS, { docs: { synced: ["steps", "nope"] } });
  assert.deepEqual(docProblems(config, fromDisk(root), kit), [
    ".workflow/config.json: docs.synced names nope, which the kit does not ship",
    ".gitattributes: its wf:union block is missing or out of date, run wf docs sync",
    "docs/workflow/steps.md: missing, run wf docs sync",
  ]);
  assert.throws(() => syncDocs(root, config, kit), /names nope/);
});
