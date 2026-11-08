import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { globRegex, loadConfig, matcher, merge, project, unknownKeys } from "../lib/config.mjs";
import { DEFAULTS, REASONS } from "../lib/defaults.mjs";
import { problems } from "../lib/docs/check.mjs";
import { growth, status } from "../lib/docs/facts.mjs";

test("a project's settings lay over the defaults, objects by key and lists whole", () => {
  const merged = merge(DEFAULTS, { docs: { loose: ["a.md"] }, areas: [{ id: "gmail", prefix: "GM" }] });
  assert.deepEqual(merged.docs.loose, ["a.md"]);
  assert.equal(merged.docs.blockWords, 60);
  assert.deepEqual(merged.areas, [{ id: "gmail", prefix: "GM" }]);
  assert.deepEqual(merged.stories.files, DEFAULTS.stories.files);
});

test("an unknown key is named, so a typo is not silently ignored", () => {
  assert.deepEqual(unknownKeys({ docs: { blockWord: 50 }, extra: 1, team: "solo" }), ["docs.blockWord", "extra"]);
});

test("globs: ** crosses folders, * does not", () => {
  assert.ok(globRegex("docs/**/*.md").test("docs/a.md"));
  assert.ok(globRegex("docs/**/*.md").test("docs/x/y/a.md"));
  assert.ok(!globRegex("docs/*.md").test("docs/x/a.md"));
  assert.ok(matcher([".claude/skills/*/SKILL.md"])(".claude/skills/commit/SKILL.md"));
  assert.ok(globRegex("docs/log/review-findings*").test("docs/log/review-findings-closed.md"));
});

test("every reason names a default that exists", () => {
  for (const key of Object.keys(REASONS)) {
    assert.notEqual(key.split(".").reduce((node, part) => node?.[part], DEFAULTS), undefined, key);
  }
});

/** A throwaway git project with the given files. */
function scratch(files) {
  const root = mkdtempSync(join(tmpdir(), "wf-test-"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

test("a project is found from a folder inside it, not from where the kit lives", () => {
  const root = scratch({ ".workflow/config.json": '{"project":"P"}', "docs/sub/a.md": "# A\n" });
  const context = project(join(root, "docs", "sub"));
  assert.equal(context.config.project, "P");
  assert.ok(context.tracked.includes("docs/sub/a.md"));
});

test("an unknown config key stops the run", () => {
  const root = scratch({ ".workflow/config.json": '{"tema":"solo"}' });
  assert.throws(() => loadConfig(root), /unknown key tema/);
});

test("doc:check finds a broken link, an unindexed doc, a long block, a missing story, and a future date", async () => {
  const words = Array(61).fill("word").join(" ");
  const root = scratch({
    ".workflow/config.json": '{"areas":[{"id":"xy","prefix":"XY"}],"docs":{"synced":[]}}',
    "docs/README.md": "# Index\n\n[a](workflow/a.md)\n",
    "docs/workflow/a.md": `# A\n\n[gone](nope.md) XY-07\n\n${words}\n\n| 2099-01-01 | later |\n`,
    "docs/workflow/b.md": "# B\n",
  });
  const found = await problems(project(root), "2026-11-08");
  assert.deepEqual(found, [
    "docs/workflow/a.md: no file nope.md",
    "docs/README.md: no row for docs/workflow/b.md",
    "docs/workflow/a.md: no story XY-07",
    "docs/workflow/a.md:5: 61 words in one block, over 60",
    "docs/workflow/a.md:7: 2099-01-01 is after today, 2026-11-08",
  ]);
});

test("an extension adds its checks and status lines", async () => {
  const root = scratch({
    ".workflow/config.json": '{"extensions":["ext.mjs"],"docs":{"synced":[]}}',
    "ext.mjs": 'export const checks = () => ["ext: problem"]; export const status = () => ["  Ext: line"];',
  });
  const context = project(root);
  assert.deepEqual(await problems(context, "2026-11-08"), ["ext: problem"]);
  assert.ok((await status(context)).includes("  Ext: line"));
});

test("doc:check flags a Who decides block that no longer matches the config", async () => {
  const root = scratch({
    ".workflow/config.json": '{"people":[{"name":"Ana"}],"docs":{"synced":[]}}',
    "AGENTS.md": "# Rules\n\n<!-- wf:roles -->\nstale\n<!-- /wf:roles -->\n",
  });
  assert.deepEqual(await problems(project(root), "2026-11-08"), ["AGENTS.md: the Who decides block is out of date, run wf roles --write"]);
});

test("a loose doc that no longer exists is named, not a crash", () => {
  const root = scratch({ ".workflow/config.json": '{"docs":{"loose":["docs/gone.md"]}}', "AGENTS.md": "# A\n" });
  assert.ok(growth(project(root)).includes("  Loose doc: docs/gone.md is gone, take it off loose"));
});
