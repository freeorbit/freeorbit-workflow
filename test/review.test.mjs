import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { merge } from "../lib/config/config.mjs";
import { DEFAULTS } from "../lib/config/defaults.mjs";
import { didNotRun, inScope, ledger, scan, touchesDeps } from "../lib/review.mjs";

test("scope leaves out excluded folders and files that are gone", () => {
  const exists = (p) => p !== "gone.ts";
  const paths = ["src/a.ts", "docs/x.md", "docsy/b.ts", "gone.ts", "src/a.ts", "web/pnpm-lock.yaml", "src/bindings.ts"];
  assert.deepEqual(inScope(paths, ["docs/**", "**/pnpm-lock.yaml", "**/bindings.ts"], exists), ["docsy/b.ts", "src/a.ts"]);
});

test("a dependency file anywhere, by name, triggers the deps scans", () => {
  assert.equal(touchesDeps(["apps/web/package.json"], ["package.json"]), true);
  assert.equal(touchesDeps(["src/package.ts"], ["package.json"]), false);
});

test("a diff scan writes the scope, runs the scans in order, and writes the diff with new files", async () => {
  const root = mkdtempSync(join(tmpdir(), "wf-scan-"));
  const sh = (...args) => execFileSync("git", args, { cwd: root });
  sh("init", "-q");
  sh("config", "user.email", "t@example.test");
  sh("config", "user.name", "t");
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src/a.ts"), "one\n");
  sh("add", ".");
  sh("commit", "-qm", "base");
  writeFileSync(join(root, "src/a.ts"), "two\n");
  writeFileSync(join(root, "src/new.ts"), "new\n");
  writeFileSync(join(root, "package.json"), "{}\n");
  writeFileSync(join(root, "pnpm-lock.yaml"), "lock\n");
  const config = merge(DEFAULTS, {
    review: {
      scans: {
        every: [{ name: "every", run: 'echo every > "$SCAN/every.txt"' }],
        deps: [{ name: "deps", run: 'echo deps > "$SCAN/deps.txt"' }],
        full: [{ name: "full", run: 'echo full > "$SCAN/full.txt"' }],
        structure: [{ name: "structure", run: 'cp "$FILES" "$SCAN/structure.txt"' }],
      },
    },
  });
  const result = await scan(root, config, { mode: "diff", since: "HEAD", light: true });
  const out = (f) => join(root, ".cache/review-scan", f);
  assert.deepEqual(result.scope, ["package.json", "src/a.ts", "src/new.ts"]);
  assert.deepEqual(result.ran, [["every", 0], ["deps", 0], ["structure", 0]]);
  assert.equal(existsSync(out("full.txt")), false);
  assert.equal(readFileSync(out("structure.txt"), "utf8"), "package.json\nsrc/a.ts\nsrc/new.ts\n");
  const diff = readFileSync(out("changes.diff"), "utf8");
  assert.match(diff, /\+two/);
  assert.match(diff, /\+new/);
  assert.match(diff, /package\.json/);
  assert.doesNotMatch(diff, /pnpm-lock/);
});

/** A throwaway git repo with one commit. */
function repo() {
  const root = mkdtempSync(join(tmpdir(), "wf-scan-"));
  const sh = (...args) => execFileSync("git", args, { cwd: root });
  sh("init", "-q");
  sh("config", "user.email", "t@example.test");
  sh("config", "user.name", "t");
  writeFileSync(join(root, "a.txt"), "a\n");
  sh("add", ".");
  sh("commit", "-qm", "base");
  return root;
}

test("a missing scanner is reported as one that did not run, and full mode runs the full scans with no scope file", async () => {
  const root = repo();
  const config = merge(DEFAULTS, {
    review: {
      scans: {
        every: [{ name: "missing", run: "no-such-scanner-here --json" }, { name: "found", run: "exit 1" }],
        full: [{ name: "full", run: 'printf "%s" "$FILES" > "$SCAN/files.txt"' }],
      },
    },
  });
  const { ran } = await scan(root, config, { mode: "full" });
  assert.deepEqual(ran, [["missing", 127], ["found", 1], ["full", 0]]);
  assert.equal(didNotRun(127), true);
  assert.equal(didNotRun(1), false);
  assert.equal(didNotRun("SIGKILL"), true);
  assert.equal(readFileSync(join(root, ".cache/review-scan/files.txt"), "utf8"), "");
});

test("a diff scan from something that is not a commit fails before it empties the last run's output", async () => {
  const root = repo();
  mkdirSync(join(root, ".cache/review-scan"), { recursive: true });
  writeFileSync(join(root, ".cache/review-scan/old.txt"), "keep\n");
  for (const since of ["--light", "no-such-ref"]) {
    await assert.rejects(scan(root, merge(DEFAULTS, {}), { mode: "diff", since }), /is not a commit/);
  }
  assert.equal(readFileSync(join(root, ".cache/review-scan/old.txt"), "utf8"), "keep\n");
});

test("ledger runs ledger.py on the config's ledger files", () => {
  assert.equal(ledger(repo(), merge(DEFAULTS, {}), ["--help"]), 0);
});
