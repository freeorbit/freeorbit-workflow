import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { merge } from "../lib/config/config.mjs";
import { DEFAULTS } from "../lib/config/defaults.mjs";
import { changedFiles, chunkRow, outsideQuick, runTrack } from "../lib/tracks.mjs";

const LEDGER = "Last reviewed: abc1234 on 2026-11-09\n";

// Every outside call is a stand-in: commands pass unless named in `failing`.
function io({ branch = "core/x", head = "abc1234", files = [], failing = [], texts = {} } = {}) {
  const ran = [];
  const result = (cmd) => {
    ran.push(cmd);
    return { status: failing.some((part) => cmd.includes(part)) ? 1 : 0 };
  };
  return { ran, sh: result, wf: (args) => result(`npx wf ${args.join(" ")}`), read: (path) => texts[path] ?? "", branch: () => branch, head: () => head, files: () => files };
}

function run(config, phase, args, stub) {
  const out = [];
  const code = runTrack("/nowhere", config, phase, args, stub, (line) => out.push(line));
  return { code, out };
}

test("a quick change outside the quick paths is a chunk", () => {
  const config = merge(DEFAULTS, {});
  assert.deepEqual(outsideQuick(["docs/a.md", "README.md", "plugins/p/README.md", "tools/x.mjs", "src/main.rs", "plugins/p/ui/App.svelte"], config), ["src/main.rs", "plugins/p/ui/App.svelte"]);
});

test("wf done quick fails on the base branch and on app code, and skips an unset check", () => {
  const config = merge(DEFAULTS, {});
  const { code, out } = run(config, "done", ["quick"], io({ branch: "main", files: ["src/main.rs"] }));
  assert.equal(code, 1);
  assert.match(out[0], /^FAIL on a work branch/);
  assert.match(out[1], /^FAIL .*src\/main\.rs: use the chunk track/);
  assert.match(out[2], /^SKIP the project's quick check/);
  assert.match(out.at(-1), /^2 to fix/);
});

test("wf done quick passes and runs the project's quick check", () => {
  const config = merge(DEFAULTS, { tracks: { check: "pnpm check" } });
  const stub = io({ files: ["docs/a.md"] });
  const { code, out } = run(config, "done", ["quick"], stub);
  assert.equal(code, 0);
  assert.ok(stub.ran.includes("pnpm check"));
  assert.ok(out.every((line) => !line.startsWith("FAIL")));
});

test("wf ready chunk finds the row, and says when the chunk is already done", () => {
  const config = merge(DEFAULTS, {});
  const head = "| Chunk | Title | Who | Status |\n| --- | --- | --- | --- |\n";
  const texts = { [config.buildOrder.file]: `${head}| 35i | Ask the assistant | developer:frontend | Not started |\n`, [config.buildOrder.done]: `${head}| 35h | Steps | developer | Done |\n` };
  assert.equal(chunkRow([texts[config.buildOrder.file]], "35i").title, "Ask the assistant");
  assert.equal(chunkRow([texts[config.buildOrder.file]], "35i").who, "developer:frontend");
  assert.equal(run(config, "ready", ["chunk", "35i"], io({ texts })).code, 0);
  const done = run(config, "ready", ["chunk", "35h"], io({ texts }));
  assert.equal(done.code, 1);
  assert.ok(done.out.some((line) => line.includes("35h is already done")));
  const unnamed = run(config, "ready", ["chunk"], io({ texts }));
  assert.ok(unnamed.out.some((line) => line.startsWith("FAIL the chunk is named")));
  assert.ok(unnamed.out.some((line) => line.startsWith("ASK ")));
});

test("wf done chunk needs the review at HEAD, the full check, and the screen gate when there is a screen list", () => {
  const config = merge(DEFAULTS, { tracks: { fullCheck: "pnpm check --all" }, screens: { scope: "tools/design/screen-scope.mjs" } });
  const texts = { [config.logs.ledger]: LEDGER };
  const stub = io({ texts });
  assert.equal(run(config, "done", ["chunk", "35i"], stub).code, 0);
  assert.ok(stub.ran.includes("pnpm check --all"));
  assert.ok(stub.ran.includes("npx wf screens --gate 35i"));
  const stale = run(config, "done", ["chunk", "35i"], io({ texts, head: "def5678" }));
  assert.ok(stale.out.some((line) => line.startsWith("FAIL the code review covers HEAD")));
  const gate = run(config, "done", ["chunk", "35i"], io({ texts, failing: ["--gate"] }));
  assert.equal(gate.code, 1);
});

test("an unknown track prints the usage", () => {
  assert.equal(run(merge(DEFAULTS, {}), "ready", ["huge"], io()).code, 2);
});

test("an unsafe chunk argument is refused before anything runs", () => {
  const stub = io();
  assert.equal(run(merge(DEFAULTS, {}), "done", ["chunk", "35i; rm -rf ~"], stub).code, 2);
  assert.deepEqual(stub.ran, []);
});

test("the area track asks its questions and checks the docs when done", () => {
  const stub = io();
  const ready = run(merge(DEFAULTS, {}), "ready", ["area"], stub);
  assert.equal(ready.code, 0);
  assert.equal(ready.out.filter((line) => line.startsWith("ASK ")).length, 2);
  run(merge(DEFAULTS, {}), "done", ["area"], stub);
  assert.deepEqual(stub.ran, ["npx wf doc:check"]);
});

test("changed files are the branch's commits and untracked files, and null with no base", () => {
  const root = mkdtempSync(join(tmpdir(), "wf-tracks-"));
  const git = (...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.test", ...args], { cwd: root, stdio: "pipe" });
  git("init", "-q", "-b", "main");
  writeFileSync(join(root, "a.md"), "a\n");
  git("add", "."); git("commit", "-qm", "base");
  git("checkout", "-qb", "core/x");
  writeFileSync(join(root, "app.rs"), "fn main() {}\n");
  git("add", "."); git("commit", "-qm", "change");
  writeFileSync(join(root, "new.md"), "n\n");
  assert.deepEqual(changedFiles(root, "main").sort(), ["app.rs", "new.md"]);
  assert.equal(changedFiles(root, "trunk"), null);
  const out = [];
  runTrack(root, merge(DEFAULTS, { design: { base: "trunk" } }), "done", ["quick"], { wf: () => ({ status: 0 }) }, (line) => out.push(line));
  assert.ok(out.some((line) => line.includes("cannot find the merge base")));
});

test("a detached HEAD is not a work branch", () => {
  const { out } = run(merge(DEFAULTS, {}), "ready", ["quick"], io({ branch: "" }));
  assert.match(out[0], /^FAIL on a work branch, not the base: not on a branch/);
});

test("a test-data spec or a story file is not a quick change, though it is under docs", async () => {
  const { outsideQuick } = await import("../lib/tracks.mjs");
  const config = merge(DEFAULTS, { stories: { files: ["docs/app/user-stories.md"] } });
  assert.deepEqual(outsideQuick(["docs/workflow/x.md", "docs/plugins/downlink/test-data/prepare.md", "docs/app/user-stories.md", "README.md"], config), ["docs/plugins/downlink/test-data/prepare.md", "docs/app/user-stories.md"]);
});
