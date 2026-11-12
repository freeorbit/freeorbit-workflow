import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { chosen, line, logName, passed, runChecks, skipReason } from "../lib/checks.mjs";
import { merge } from "../lib/config/config.mjs";
import { DEFAULTS } from "../lib/config/defaults.mjs";
import { hooksLine, HOOKS_PATH, install, isProtected, nameProblem, pushProblems, runHook, scopesOf, shim } from "../lib/setup/hooks.mjs";
import { report, runTools, toolRows } from "../lib/setup/tools.mjs";

const config = merge(DEFAULTS, { scopes: ["app", "release", "workflow"], areas: [{ id: "uplink", prefix: "GM", docs: "docs/plugins/uplink" }] });

test("cargo's and node's test counts are read, and no count is null", () => {
  assert.equal(passed("test result: ok. 3 passed; 0 failed\ntest result: ok. 4 passed; 0 failed\n"), 7);
  assert.equal(passed("ℹ pass 26\nℹ fail 0\n"), 26);
  assert.equal(passed("# pass 5\n"), 5);
  assert.equal(passed("Finished dev"), null);
});

test("the quick run leaves out the slow steps, and a line says what happened", () => {
  const steps = [{ name: "lint", command: "x" }, { name: "rust tests", command: "y", slow: true }];
  assert.deepEqual(chosen(steps, []).map((s) => s.name), ["lint"]);
  assert.equal(chosen(steps, ["--all"]).length, 2);
  assert.equal(line("build", true, 4, null), "ok   build (4s)");
  assert.equal(line("rust tests", false, 90, 12), "FAIL rust tests (90s, 12 passed)");
  assert.equal(logName("rust tests"), "rust-tests.log");
});

test("wf check runs each step, saves its output, and fails with the failing step's tail", () => {
  const root = mkdtempSync(join(tmpdir(), "wf-check-"));
  const steps = [{ name: "lint", command: "ok" }, { name: "ui tests", command: "bad" }, { name: "slow one", command: "slow", slow: true }];
  const out = [];
  const run = (command) => (command === "bad" ? { status: 1, stdout: "line 1\nboom\n" } : { status: 0, stdout: "ℹ pass 3\n" });
  const code = runChecks(root, merge(DEFAULTS, { check: { steps } }), [], (l) => out.push(l), run);
  assert.equal(code, 1);
  assert.match(out[0], /^ok {3}lint \(\d+s, 3 passed\)$/);
  assert.match(out[1], /^FAIL ui tests/);
  assert.ok(out.includes("line 1\nboom"));
  assert.ok(out.includes("skip slow one: run npx wf check --all at chunk end"));
  assert.equal(out.at(-1), "Failed: ui tests.");
  assert.equal(readFileSync(join(root, ".cache/check/ui-tests.log"), "utf8"), "line 1\nboom\n");
  assert.equal(runChecks(root, merge(DEFAULTS, {}), [], () => {}), 2);
});

const TABLE = [
  "| Tool | What it is for | Need | Runs on | Without it |",
  "| --- | --- | --- | --- | --- |",
  "| `cargo` | Builds it. | required | all | Nothing builds. |",
  "| `gh` | Pull requests. | optional | all | Use the website. |",
  "| `Xvfb` | A hidden display. | optional | linux | The window shows. |",
  "",
  "| Tool | What it is for | Need | Runs on | Without it |",
  "| --- | --- | --- | --- | --- |",
  "| `gh` | Again. | optional | all | Use the website. |",
].join("\n");

test("every table's tools are read once, and only a required tool fails", () => {
  const rows = toolRows(TABLE);
  assert.deepEqual(rows.map((row) => row.name), ["cargo", "gh", "Xvfb"]);
  assert.equal(report(rows, (name) => name === "cargo", "linux").failed, false);
  assert.equal(report(rows, () => false, "linux").failed, true);
  assert.deepEqual(report(rows, (name) => name !== "Xvfb", "darwin").lines, []);
  assert.equal(hooksLine(HOOKS_PATH), "");
  assert.match(hooksLine(""), /npx wf hooks install/);
});

test("the base and release lines are protected, and a branch is a scope and a hyphenated slug", () => {
  assert.deepEqual(scopesOf(config), ["app", "release", "workflow", "uplink"]);
  assert.equal(isProtected("main", config), true);
  assert.equal(isProtected("release/0.2", config), true);
  assert.equal(isProtected("release/feed-notes", config), false);
  assert.equal(isProtected("mainline", config), false);
  assert.equal(nameProblem("uplink/chunk-21-scan", config), "");
  assert.match(nameProblem("downlink-frames", config), /not <scope>\/<slug>/);
  assert.match(nameProblem("claude/fix", config), /not a scope/);
  assert.match(nameProblem("app/Fix_Thing", config), /lowercase/);
  assert.match(nameProblem(`app/${"a".repeat(41)}`, config), /longer than 40/);
});

test("a push to the base is refused, a tag push is not, and a commit on the base is refused", () => {
  const sha = "0".repeat(40);
  const lines = [`refs/heads/main ${sha} refs/heads/main ${sha}`, `refs/tags/v0.2.0 ${sha} refs/tags/v0.2.0 ${sha}`, `refs/heads/x ${sha} refs/heads/workflow/rules ${sha}`, `refs/heads/y ${sha} refs/heads/temp ${sha}`];
  const problems = pushProblems(lines, config);
  assert.equal(problems.length, 2);
  assert.match(problems[0], /main takes changes only through a pull request/);
  assert.equal(runHook("/nowhere", config, "pre-commit", { branch: "main" }).code, 1);
  assert.equal(runHook("/nowhere", config, "pre-commit", { branch: "app/x" }).code, 0);
  assert.equal(runHook("/nowhere", config, "pre-push", { input: lines.join("\n") }).lines.length, 3);
});

test("install writes runnable shims and points the clone at them", () => {
  const root = mkdtempSync(join(tmpdir(), "wf-hooks-"));
  execFileSync("git", ["init", "-q"], { cwd: root });
  install(root);
  assert.equal(execFileSync("git", ["config", "core.hooksPath"], { cwd: root, encoding: "utf8" }).trim(), HOOKS_PATH);
  assert.equal(readFileSync(join(root, HOOKS_PATH, "pre-push"), "utf8"), shim("pre-push"));
  assert.ok(statSync(join(root, HOOKS_PATH, "pre-commit")).mode & 0o100);
  assert.match(shim("pre-commit"), /exec "\$wf" hooks pre-commit/);
  assert.deepEqual(install(mkdtempSync(join(tmpdir(), "wf-nogit-")), () => { throw new Error("not a repo"); }), ["not a git clone: hooks not installed"]);
});

test("the shim runs the project's own wf from a path with spaces, and fails closed without it", () => {
  const root = mkdtempSync(join(tmpdir(), "wf shim "));
  execFileSync("git", ["init", "-q"], { cwd: root });
  install(root);
  const hook = join(root, HOOKS_PATH, "pre-commit");
  const missing = spawnSync(hook, { cwd: root, encoding: "utf8" });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /the workflow kit is not installed/);
  mkdirSync(join(root, "node_modules/.bin"), { recursive: true });
  const bin = join(root, "node_modules/.bin/wf");
  writeFileSync(bin, '#!/bin/sh\necho "ran $*"\nexit 3\n');
  chmodSync(bin, 0o755);
  const ran = spawnSync(hook, { cwd: root, encoding: "utf8" });
  assert.equal(ran.stdout, "ran hooks pre-commit\n");
  assert.equal(ran.status, 3);
});

test("a hooks path git will not set leaves the hooks off without failing the install", () => {
  const root = mkdtempSync(join(tmpdir(), "wf-hooks-ro-"));
  const git = (args) => {
    if (args[0] === "config") throw new Error("could not lock config file");
    return "";
  };
  assert.match(install(root, git).at(-1), /core.hooksPath could not be set: hooks are off/);
});

test("a bad protected pattern names itself", () => {
  assert.throws(() => isProtected("main", merge(DEFAULTS, { branches: { protected: ["release/("] } })), /branches.protected has "release\/\(", which is not a valid pattern/);
});

test("wf tools fails with no list, and with a list that yields no tools", () => {
  const root = mkdtempSync(join(tmpdir(), "wf-tools-"));
  const out = [];
  assert.equal(runTools(root, merge(DEFAULTS, {}), (l) => out.push(l)), 1);
  assert.match(out[0], /tools.md is missing/);
  mkdirSync(join(root, "docs/workflow"), { recursive: true });
  writeFileSync(join(root, "docs/workflow/tools.md"), "# Tools\n\n| Tool | Use |\n| --- | --- |\n| node | x |\n");
  assert.equal(runTools(root, merge(DEFAULTS, {}), (l) => out.push(l)), 1);
  assert.match(out.at(-1), /no tools found/);
});

test("check logs must stay inside the project", () => {
  const out = [];
  const steps = [{ name: "a", command: "x" }];
  assert.equal(runChecks("/tmp/p", merge(DEFAULTS, { check: { steps, logs: "../elsewhere" } }), [], (l) => out.push(l), () => ({ status: 0 })), 2);
  assert.match(out[0], /not a folder inside the project/);
  assert.equal(runChecks("/tmp/p", merge(DEFAULTS, { check: { steps, logs: "/var/tmp/x" } }), [], () => {}, () => ({ status: 0 })), 2);
});

test("wf hooks with an unknown hook prints its usage and exits 2", () => {
  const result = spawnSync(process.execPath, [new URL("../bin/wf.mjs", import.meta.url).pathname, "hooks", "post-merge"], { encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.match(result.stdout, /Usage: wf hooks <install \| pre-commit \| pre-push>/);
});

test("a step with paths runs only when the branch changes a matching file, or with --all", () => {
  const step = { name: "release tests", command: "r", paths: ["scripts/release/**", "release.config.json"] };
  assert.equal(skipReason(step, [], ["scripts/release/check.mjs"]), null);
  assert.equal(skipReason(step, [], ["src/app.ts"]), "no change to scripts/release/**, release.config.json");
  assert.equal(skipReason(step, ["--all"], ["src/app.ts"]), null);
  assert.equal(skipReason(step, [], null), null);
  assert.equal(skipReason({ name: "lint", command: "l" }, [], []), null);
});

test("wf check prints a skipped path step as SKIP, and runs it when the base is unknown", () => {
  const root = mkdtempSync(join(tmpdir(), "wf-check-paths-"));
  const steps = [{ name: "lint", command: "lint" }, { name: "infra", command: "infra", paths: ["infra/**"] }];
  const config = merge(DEFAULTS, { check: { steps } });
  const ran = [];
  const run = (command) => (ran.push(command), { status: 0, stdout: "" });
  const out = [];
  assert.equal(runChecks(root, config, [], (l) => out.push(l), run, () => ["src/a.ts"]), 0);
  assert.deepEqual(ran, ["lint"]);
  assert.ok(out.includes("SKIP infra: no change to infra/**"));
  ran.length = 0;
  out.length = 0;
  runChecks(root, config, [], (l) => out.push(l), run, () => null);
  assert.deepEqual(ran, ["lint", "infra"]);
  assert.ok(out.some((l) => /^infra: runs, since the base main cannot be found/.test(l)));
  ran.length = 0;
  let looked = false;
  runChecks(root, config, ["--all"], () => {}, run, () => ((looked = true), []));
  assert.deepEqual(ran, ["lint", "infra"]);
  assert.equal(looked, false);
});
