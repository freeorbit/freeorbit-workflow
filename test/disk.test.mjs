import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { merge } from "../lib/config/config.mjs";
import { DEFAULTS } from "../lib/config/defaults.mjs";
import { diskCheck, staleFiles } from "../lib/disk.mjs";

/** A run with a stand-in disk: each remove frees `gain` GB. */
function run({ free = 2, gain = 0, busy = false, ignored = () => true, dryRun = false, app = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), "wf-disk-"));
  for (const path of [".cache/view/a.png", "target/tmp/x", "target/debug/incremental/y", "keep/z"]) {
    mkdirSync(join(root, path, ".."), { recursive: true });
    writeFileSync(join(root, path), "data");
  }
  const config = merge(DEFAULTS, { app, disk: { leftovers: [".cache/view", "target/tmp", "keep"], stale: { dirs: [] } } });
  const lines = [];
  const removed = [];
  let gb = free;
  const io = {
    free: () => gb,
    busy: () => busy,
    ignored,
    appRunning: () => false,
    remove: (path) => {
      removed.push(path.replace(root, "").replace(/^\//, ""));
      gb += gain;
    },
  };
  const code = diskCheck(root, config, { dryRun, minimum: 10, log: (line) => lines.push(line), io });
  return { code, lines, removed };
}

test("enough space does nothing", () => {
  const { code, removed, lines } = run({ free: 50 });
  assert.equal(code, 0);
  assert.deepEqual(removed, []);
  assert.deepEqual(lines, ["50 GB free, need 10 GB."]);
});

test("each step stops once enough is free, and a path git does not ignore is skipped", () => {
  const { code, removed, lines } = run({ gain: 4, ignored: (path) => path !== "keep" });
  assert.equal(code, 0);
  assert.deepEqual(removed, [".cache/view", "target/tmp"], "two leftovers freed enough, so step 2 never ran");
  assert.ok(lines.includes("skip keep: not ignored by git"));
});

test("a running build holds back steps 2 and 3", () => {
  const { code, removed, lines } = run({ busy: true });
  assert.equal(code, 1);
  assert.ok(!removed.includes("target/debug/incremental"));
  assert.ok(lines.some((line) => line.startsWith("A build is running")));
});

test("a dry run removes nothing and says what it would", () => {
  const { removed, lines } = run({ dryRun: true });
  assert.deepEqual(removed, []);
  assert.ok(lines.some((line) => /^would remove \.cache\/view \(/.test(line)));
  assert.ok(lines.some((line) => /^would remove target\/debug\/incremental/.test(line)));
});

test("stale files are those untouched for the given days", () => {
  const dir = mkdtempSync(join(tmpdir(), "wf-stale-"));
  writeFileSync(join(dir, "old"), "");
  writeFileSync(join(dir, "new"), "");
  const old = (Date.now() - 8 * 86_400_000) / 1000;
  utimesSync(join(dir, "old"), old, old);
  assert.deepEqual(staleFiles(dir, 7).map((path) => path.slice(dir.length + 1)), ["old"]);
  assert.deepEqual(staleFiles(join(dir, "none"), 7), []);
});
