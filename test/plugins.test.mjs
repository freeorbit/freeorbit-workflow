import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { merge } from "../lib/config/config.mjs";
import { DEFAULTS } from "../lib/config/defaults.mjs";
import { doctorSteps } from "../lib/setup/doctor.mjs";
import { enabledKitPlugins, entriesOf, installedPlugins, pluginReport } from "../lib/setup/plugins.mjs";

const fixtures = new URL("./fixtures/claude/", import.meta.url).pathname;
const on = (...names) => ({ enabledPlugins: Object.fromEntries([...names.map((n) => [`${n}@freeorbit-workflow`, true]), ["other@elsewhere", true]]) });

test("each plugin's installs are read from an array or a single entry, a missing scope being the user's", () => {
  assert.deepEqual(entriesOf([{ scope: "project", version: "1" }]), [{ scope: "project", version: "1" }]);
  assert.deepEqual(entriesOf({ version: "1" }), [{ version: "1", scope: "user" }]);
  assert.deepEqual(entriesOf(undefined), []);
  assert.deepEqual(enabledKitPlugins({ enabledPlugins: { "core@freeorbit-workflow": true, "e2e@freeorbit-workflow": false, "x@y": true } }), ["core"]);
});

test("a plugin that is missing, or at another version than the pin, is named with the command that fixes it", () => {
  const report = installedPlugins("/projects/atlas", "v0.46.0", on("core", "review", "design", "e2e", "release"), join(fixtures, "v2"));
  assert.deepEqual(report.problems, [
    'first, the marketplace: claude plugin marketplace add "freeorbit/freeorbit-workflow#v0.46.0" --scope project',
    "core@freeorbit-workflow is 0.27.0 (project scope), the pin is v0.46.0: claude plugin update core@freeorbit-workflow --scope project",
    "design@freeorbit-workflow is 0.41.0 (local scope), the pin is v0.46.0: claude plugin update design@freeorbit-workflow --scope local",
    "e2e@freeorbit-workflow is turned on but not installed: claude plugin install e2e@freeorbit-workflow --scope project",
    "release@freeorbit-workflow is turned on but not installed: claude plugin install release@freeorbit-workflow --scope project",
  ]);
  assert.match(report.notes[0], /marketplace Claude Code knows is at v0\.41\.0, the pin is v0\.46\.0/);
});

test("the older file shape, one entry per plugin, counts as installed for the user", () => {
  const report = installedPlugins("/projects/atlas", "v0.46.0", on("core", "release"), join(fixtures, "v1"));
  assert.deepEqual(report, { problems: [], notes: [] });
});

test("with nothing to read, the check is skipped with the reason", () => {
  const empty = mkdtempSync(join(tmpdir(), "wf-claude-"));
  assert.match(installedPlugins("/p", "v0.46.0", on("core"), empty).skip, /no plugins\/installed_plugins.json/);
  assert.match(pluginReport({ root: "/p", tag: "v1.0.0", settings: null, installed: {} }).skip, /no kit plugin is turned on/);
  assert.match(pluginReport({ root: "/p", tag: null, settings: on("core"), installed: {} }).skip, /pins no tag/);
});

test("the doctor fails on wrong installs and lists each fix under its line, and skips without Claude Code", async () => {
  const root = mkdtempSync(join(tmpdir(), "wf-doctor-plugins-"));
  const { writeFileSync, mkdirSync } = await import("node:fs");
  mkdirSync(join(root, ".claude"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ devDependencies: { "freeorbit-workflow": "git+https://github.com/freeorbit/freeorbit-workflow.git#v0.46.0" } }));
  writeFileSync(join(root, ".claude/settings.json"), JSON.stringify(on("e2e")));
  const project = { root, config: merge(DEFAULTS, {}), tracked: [], files: () => "" };
  const step = (dir, config = project.config) => doctorSteps(root, { ...project, config }, { claudeDir: dir }).find(([label]) => label.startsWith("Claude Code has"))[1]();
  const failed = step(join(fixtures, "v2"));
  assert.equal(failed.status, "FAIL");
  assert.equal(failed.note, "1 to install or update");
  assert.ok(failed.lines.some((line) => line.includes("claude plugin install e2e@freeorbit-workflow --scope project")));
  assert.equal(step(mkdtempSync(join(tmpdir(), "wf-none-"))).status, "SKIP");
  assert.equal(step(join(fixtures, "v2"), merge(DEFAULTS, { ai: { tools: ["opencode"] } })).note, "ai.tools has no claude");
});
