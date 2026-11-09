import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { merge } from "../lib/config.mjs";
import { DEFAULTS } from "../lib/defaults.mjs";
import { docProblems, fill, fromDisk, kitDocs, parts, placeOf, planDocs, render, slots, syncDocs, withoutRoles } from "../lib/docsync.mjs";
import { indexProblems, logRows, SUMMARIES, table, withIndex } from "../lib/index.mjs";

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
  mkdirSync(join(kit, "workflow"), { recursive: true });
  writeFileSync(join(kit, "workflow", "steps.md"), KIT);
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

test("a root doc lands at the project's root, with config values and the Who decides block filled", () => {
  const { root, kit } = fixture();
  mkdirSync(join(kit, "root"));
  writeFileSync(join(kit, "root", "AGENTS.md"), "# {{project}}\n\n<!-- wf:roles -->\nold\n<!-- /wf:roles -->\n\nData from `{{testdata.dir}}`.\n<!-- wf:local notes -->\n");
  const config = merge(DEFAULTS, { project: "Demo", team: "solo", people: [{ name: "Ana", roles: ["owner"] }], docs: { synced: ["root/AGENTS"] } });
  assert.equal(placeOf(config, "root/AGENTS", kit).file, "AGENTS.md");
  writeFileSync(join(root, "AGENTS.md"), "<!-- wf:local notes -->\nOur note.\n<!-- /wf:local notes -->\n");
  syncDocs(root, config, kit);
  const text = readFileSync(join(root, "AGENTS.md"), "utf8");
  assert.match(text, /^<!-- From the freeorbit-workflow kit's docs\/root\/AGENTS\.md\./);
  assert.match(text, /# Demo\n/);
  assert.match(text, /<!-- wf:roles -->\n## Who decides\n\nSolo: Ana holds every role/);
  assert.ok(!text.includes("\nold\n"));
  assert.match(text, /Data from `tools\/testdata`\./);
  assert.match(text, /<!-- wf:local notes -->\nOur note\.\n<!-- \/wf:local notes -->/);
  assert.deepEqual(docProblems(config, fromDisk(root), kit), []);
  assert.throws(() => fill("{{nope.key}}", config), /names \{\{nope\.key\}\}/);
});

test("the index's kit tables are written from the synced docs and the logs that exist, and checked", () => {
  const config = merge(DEFAULTS, {
    areas: [{ id: "app", prefix: "APP", docs: "docs/app" }],
    docs: { words: { Journey: "One user's path." } },
  });
  const files = {
    "docs/README.md": "# Docs\n\n<!-- wf:index words -->\n<!-- /wf:index words -->\n\n<!-- wf:index workflow -->\n<!-- /wf:index workflow -->\n\n<!-- wf:index logs -->\n<!-- /wf:index logs -->\n",
    "docs/workflow/four-steps.md": "x",
    "docs/log/build-order.md": "x",
    "docs/log/build-order/app.md": "x",
    "docs/log/decisions/app.md": "x",
    "docs/log/decisions/workflow.md": "x",
  };
  const read = (file) => files[file] ?? null;
  const places = kitDocs().map((name) => placeOf(config, name));
  const text = withIndex(files["docs/README.md"], config, read, places);
  assert.match(text, /\| Journey \| One user's path\. \|/);
  assert.match(text, /\| \[workflow\/four-steps\.md\]\(workflow\/four-steps\.md\) \| The four steps/);
  assert.ok(!text.includes("asking.md"));
  assert.match(text, /\| \[log\/build-order\/app\.md\]\(log\/build-order\/app\.md\) \| The app area's build order/);
  assert.match(text, /`D-APP-`/);
  assert.match(text, /`D-WF-`/);
  assert.ok(!text.includes("troubleshooting"));
  assert.deepEqual(indexProblems(config, read, places).length, 3);
  files["docs/README.md"] = text;
  assert.deepEqual(indexProblems(config, read, places), []);
  files["docs/README.md"] = text + "\n<!-- wf:index nope -->\n<!-- /wf:index nope -->\n";
  assert.match(indexProblems(config, read, places)[0], /no kit table is called nope/);
});

test("every kit doc has a summary for the index", () => {
  for (const name of kitDocs()) assert.ok(name in SUMMARIES, `${name} has no summary in lib/index.mjs`);
});

test("a config value must be a set, one-line string under a plain key", () => {
  const config = merge(DEFAULTS, { project: "Demo", docs: { words: {} } });
  assert.equal(fill("{{project}} and {{docs.workflow}}", config), "Demo and docs/workflow");
  assert.throws(() => fill("{{2fa}}", config), /not a config key/);
  assert.throws(() => fill("{{ project }}", config), /not a config key/);
  assert.throws(() => fill("{{project}}", merge(DEFAULTS, { project: "Demo\n<!-- wf:local x -->" })), /holds a line break/);
});

test("a kit doc whose value is unset, and a missing root doc, are listed and stop sync", () => {
  const { root, kit } = fixture();
  mkdirSync(join(kit, "root"));
  writeFileSync(join(kit, "root", "AGENTS.md"), "# {{project}}\n");
  const config = merge(DEFAULTS, { docs: { synced: ["root/AGENTS", "root/NOPE"] } });
  const { unknown } = planDocs(config, fromDisk(root), kit);
  assert.deepEqual(unknown, [
    "docs/root/AGENTS.md: the kit doc names {{project}}, which the config does not set",
    ".workflow/config.json: docs.synced names root/NOPE, which the kit does not ship",
  ]);
  assert.throws(() => syncDocs(root, config, kit), /does not set/);
});

test("the roles block is cut to its start marker, and one with no end is refused", () => {
  assert.equal(withoutRoles("a\n<!-- wf:roles -->\nold\n<!-- /wf:roles -->\nb"), "a\n<!-- wf:roles -->\nb");
  assert.equal(withoutRoles("plain"), "plain");
  assert.throws(() => withoutRoles("<!-- wf:roles -->\nold"), /no <!-- \/wf:roles -->/);
});

test("the logs table lists each kit log that exists, and words are escaped", () => {
  const config = merge(DEFAULTS, { areas: [], docs: { words: { "A | B": "one\ntwo" } } });
  const has = (file) => [config.logs.e2eRuns, config.logs.questionsResolved, config.buildOrder.done, `${config.logs.decisions}/stack.md`].includes(file);
  const rows = logRows(config, has).map(([file]) => file);
  assert.deepEqual(rows, [config.logs.questionsResolved, config.buildOrder.done, config.logs.e2eRuns, `${config.logs.decisions}/stack.md`]);
  assert.match(logRows(config, has).at(-1)[1], /in `log\/decisions-closed\/`/);
  assert.ok(table("words", config, () => null, []).includes("| A \\| B | one two |"));
});

test("an unclosed or misnamed index block is a problem", () => {
  const config = merge(DEFAULTS, {});
  const read = (file) => (file === config.docs.index ? "<!-- wf:index logs -->\nno end\n<!-- wf:index Logs -->\n<!-- /wf:index Logs -->\n" : null);
  assert.match(indexProblems(config, read, [])[0], /no matching end, or its name is not lowercase/);
});
