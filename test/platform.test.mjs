import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { processRunner, runnerKind, timeLimit } from "../lib/app/runner.mjs";
import { merge } from "../lib/config/config.mjs";
import { DEFAULTS } from "../lib/config/defaults.mjs";
import { browserFor, fontArgs, fontFor } from "../lib/config/platform.mjs";

const config = (extra = {}) => merge(DEFAULTS, extra);

test("the browser is design.browser, else one on the PATH, else a macOS app bundle, else a clear error", () => {
  assert.equal(browserFor(config({ design: { browser: "/opt/chrome" } })), "/opt/chrome");
  assert.equal(browserFor(config(), { which: (name) => name === "google-chrome", exists: () => false }), "google-chrome");
  assert.equal(browserFor(config(), { platform: "darwin", which: () => false, exists: (p) => p.includes("Google Chrome.app") }), "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
  assert.throws(() => browserFor(config(), { platform: "darwin", which: () => false, exists: () => false }), /no Chromium or Chrome found.*design.browser/);
});

test("the font is design.font when it is here, else a bold font found here, else none", () => {
  assert.equal(fontFor(config(), (p) => p === DEFAULTS.design.font), DEFAULTS.design.font);
  assert.equal(fontFor(config(), (p) => p.includes("Arial Bold")), "/System/Library/Fonts/Supplemental/Arial Bold.ttf");
  assert.equal(fontFor(config(), () => false), "");
  assert.deepEqual(fontArgs(""), []);
  assert.deepEqual(fontArgs("/f.ttf"), ["-font", "/f.ttf"]);
});

test("auto picks systemd only where it works, and the time limit comes from the systemd limits", () => {
  assert.equal(runnerKind(config(), () => true), "systemd");
  assert.equal(runnerKind(config(), () => false), "process");
  assert.equal(runnerKind(config({ app: { runner: "process" } }), () => true), "process");
  assert.equal(timeLimit(["-p", "MemoryMax=1500M", "-p", "RuntimeMaxSec=900"]), 900);
  assert.equal(timeLimit([]), null);
});

test("the process runner starts a group, logs it, reads its memory, and stops it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wf-runner-"));
  const runner = processRunner(dir);
  runner.run("demo", ["sh", "-c", "echo started; sleep 31"], { cwd: tmpdir(), env: { WF_TEST: "1" }, limits: ["-p", "RuntimeMaxSec=60"] });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(runner.active("demo"), true);
  assert.equal(runner.log("demo"), "started");
  assert.ok(runner.memoryMb("demo") >= 0);
  const started = Date.now();
  runner.stop("demo");
  assert.ok(Date.now() - started < 2000, "stop returns once the group has exited, not after its full wait");
  assert.equal(spawnSync("sh", ["-c", "pgrep -f 'sleep 3[1]'"]).status, 1, "the whole group is gone once stop returns");
  assert.equal(runner.active("demo"), false);
  assert.equal(spawnSync("sh", ["-c", "pgrep -f 'sleep 6[0]; kill -TERM'"]).status, 1, "the watchdog is stopped too");
  assert.throws(() => runner.run("ghost", ["/no/such/program"], { cwd: tmpdir() }));
});

test("the process runner signals only a group it leads, never a stale or reused pid", () => {
  const dir = mkdtempSync(join(tmpdir(), "wf-runner-"));
  mkdirSync(join(dir, "units"));
  const runner = processRunner(dir);
  // A live process that leads no group of its own stands for a reused pid.
  const other = spawn("sleep", ["30"], { stdio: "ignore" });
  try {
    for (const text of [String(other.pid), "-5", "abc", "1"]) {
      writeFileSync(join(dir, "units", "x.pid"), text);
      assert.equal(runner.active("x"), false, text);
      runner.stop("x");
    }
    process.kill(other.pid, 0);
  } finally {
    other.kill();
  }
});
