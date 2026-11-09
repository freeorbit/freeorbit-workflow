import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { merge } from "../lib/config.mjs";
import { DEFAULTS } from "../lib/defaults.mjs";
import { pinnedTag, runDoctor } from "../lib/doctor.mjs";
import { answerProblems, configFrom, starterFiles, withIgnore, withPackage, withSettings, writeStarter } from "../lib/init.mjs";

const ANSWERS = {
  project: "Demo",
  team: "team",
  people: [
    { name: "Ana", handle: "ana", email: "ana@example.com", roles: ["owner", "designer", "developer", "reviewer"] },
    { name: "Fen", handle: "fen", email: "fen@example.com", roles: ["developer:frontend"] },
  ],
  areas: [{ id: "app", prefix: "APP", docs: "docs/app" }, { id: "review", prefix: "REV", docs: "docs/review" }],
  plugins: ["core", "review", "design"],
  kit: { tag: "v9.9.9" },
  config: { design: { source: "png" }, ai: { tools: ["claude"] } },
};

test("answers are checked before anything is written", () => {
  assert.deepEqual(answerProblems(ANSWERS), []);
  const bad = answerProblems({ ...ANSWERS, plugins: ["review", "nope"], areas: [{ id: "App", prefix: "a", docs: "x" }], kit: {} });
  assert.ok(bad.includes("answers: no kit plugin nope; one of core, review, testdata, design, e2e, release, stack-tauri-rust, stack-web"));
  assert.ok(bad.includes("answers: plugins must include core"));
  assert.ok(bad.some((line) => line.includes("kit.tag")));
  assert.ok(bad.some((line) => line.includes("story prefix")));
  assert.ok(answerProblems({ ...ANSWERS, config: { nope: 1 } }).includes("answers: config has nope, which the kit does not know"));
});

test("the config carries the areas as scopes and story files, and the starter files fit the kit's checks", () => {
  const config = configFrom(ANSWERS);
  assert.deepEqual(config.scopes, ["app", "review", "workflow"]);
  assert.deepEqual(config.stories.files, ["docs/app/user-stories.md", "docs/review/user-stories.md"]);
  assert.equal(config.review.threatModel, "docs/app/threat-model.md");
  const files = starterFiles(merge(DEFAULTS, config), ANSWERS.plugins, "2026-11-09");
  assert.match(files.get("docs/log/build-order.md"), /\| \[review\]\(build-order\/review\.md\) \| Not started \| Not started \| Not started \| Not started \|/);
  assert.ok(files.has("docs/log/decisions/workflow.md"));
  assert.ok(files.has("docs/review/design/screens.md"));
  assert.ok(!files.has("docs/log/e2e-runs.md"));
  assert.match(files.get("docs/README.md"), /<!-- wf:index logs -->/);
});

test("package.json, settings, and .gitignore keep the project's own entries", () => {
  const pkg = JSON.parse(withPackage('{"name":"x","scripts":{"check":"mine"}}', configFrom(ANSWERS), "v9.9.9"));
  assert.equal(pkg.scripts.check, "mine");
  assert.equal(pkg.scripts.prepare, "wf hooks install");
  assert.equal(pinnedTag(pkg), "v9.9.9");
  const settings = JSON.parse(withSettings('{"enabledPlugins":{"x@y":true}}', ["core"], "v9.9.9"));
  assert.deepEqual(Object.keys(settings.enabledPlugins), ["x@y", "core@freeorbit-workflow"]);
  assert.equal(settings.extraKnownMarketplaces["freeorbit-workflow"].source.ref, "v9.9.9");
  assert.equal(withIgnore("dist/\n"), "dist/\n\n# The workflow kit's working folders.\nnode_modules/\n.cache/\n");
  assert.equal(withIgnore("node_modules/\n.cache/\n"), "node_modules/\n.cache/\n");
});

test("init never overwrites a file the project already has", () => {
  const root = mkdtempSync(join(tmpdir(), "wf-init-"));
  writeFileSync(join(root, "AGENTS.md"), "ours");
  const report = writeStarter(root, ANSWERS, { today: "2026-11-09", template: "TEMPLATE" });
  assert.ok(report.some(([file, what]) => file === ".workflow/config.json" && what === "written"));
  assert.equal(readFileSync(join(root, "docs/app/threat-model.md"), "utf8"), "TEMPLATE");
  const again = writeStarter(root, ANSWERS, { today: "2026-11-10", template: "TEMPLATE" });
  assert.ok(again.some(([file, what]) => file === "docs/log/build-order.md" && what === "kept, already there"));
  assert.equal(readFileSync(join(root, "AGENTS.md"), "utf8"), "ours");
});

test("wf init sets up a project whose docs check passes, and the doctor names what is left", () => {
  const root = mkdtempSync(join(tmpdir(), "wf-init-e2e-"));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: root });
  writeFileSync(join(root, "answers.json"), JSON.stringify(ANSWERS));
  const wf = new URL("../bin/wf.mjs", import.meta.url).pathname;
  execFileSync(process.execPath, [wf, "init", "answers.json"], { cwd: root, encoding: "utf8" });
  assert.ok(existsSync(join(root, "AGENTS.md")) && existsSync(join(root, "CLAUDE.md")));
  assert.ok(!existsSync(join(root, ".opencode")));
  assert.match(execFileSync(process.execPath, [wf, "doc:check"], { cwd: root, encoding: "utf8" }), /Docs are in step/);
});

test("the doctor reports each check", async () => {
  const root = mkdtempSync(join(tmpdir(), "wf-doctor-"));
  const out = [];
  const project = { root, config: merge(DEFAULTS, {}), tracked: [], files: () => "" };
  const code = await runDoctor(root, project, { gh: () => ({ status: 1, stdout: "" }), kitVersion: () => null, hooksPath: "" }, (line) => out.push(line));
  assert.equal(code, 1);
  assert.match(out[0], /^FAIL the config names only known keys: no .workflow\/config.json/);
  assert.ok(out.some((line) => line.startsWith("FAIL the branch hooks are on")));
});

test("answers and config paths outside the project are refused before anything is written", async () => {
  const { inside } = await import("../lib/init.mjs");
  assert.equal(inside("docs/app"), true);
  assert.equal(inside("docs/../../x"), false);
  assert.equal(inside("/etc/x"), false);
  assert.ok(answerProblems({ ...ANSWERS, areas: [{ id: "app", prefix: "APP", docs: "docs/../../x" }] }).some((line) => line.includes("docs folder under docs/")));
  assert.ok(answerProblems({ ...ANSWERS, config: { ...ANSWERS.config, logs: { ledger: "../ledger.md" } } }).includes("answers: ../ledger.md is not a path inside the project"));
  assert.ok(answerProblems({ ...ANSWERS, config: { ai: { tools: ["cursor"] } } }).some((line) => line.includes("ai.tools has cursor")));
});

test("a bad JSON file stops init before the first write, and a kept config wins", () => {
  const root = mkdtempSync(join(tmpdir(), "wf-init-bad-"));
  writeFileSync(join(root, "package.json"), "{ not json");
  assert.throws(() => writeStarter(root, ANSWERS, { today: "2026-11-09", template: "T" }), /package.json is not valid JSON/);
  assert.equal(existsSync(join(root, "docs")), false);
  const again = mkdtempSync(join(tmpdir(), "wf-init-kept-"));
  execFileSync("mkdir", ["-p", join(again, ".workflow")]);
  writeFileSync(join(again, ".workflow/config.json"), JSON.stringify({ ...configFrom(ANSWERS), areas: [{ id: "only", prefix: "ONL", docs: "docs/only" }] }));
  writeFileSync(join(again, "package.json"), '{"name":"x"}');
  const report = writeStarter(again, ANSWERS, { today: "2026-11-09", template: "T" });
  assert.ok(existsSync(join(again, "docs/only/user-stories.md")));
  assert.ok(!existsSync(join(again, "docs/review/user-stories.md")));
  assert.ok(report.some(([file, what]) => file === "package.json" && what === "merged"));
  assert.equal(withIgnore("/node_modules\n.cache\n"), "/node_modules\n.cache\n");
});
