import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { merge } from "../lib/config.mjs";
import { DEFAULTS } from "../lib/defaults.mjs";
import { inScope, scan, touchesDeps } from "../lib/review.mjs";

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
