import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { processRunner, runnerKind, timeLimit } from "../lib/app/runner.mjs";
import { merge } from "../lib/config.mjs";
import { DEFAULTS } from "../lib/defaults.mjs";
import { browserFor, fontArgs, fontFor } from "../lib/platform.mjs";

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
  const runner = processRunner(mkdtempSync(join(tmpdir(), "wf-runner-")));
  runner.run("demo", ["sh", "-c", "echo started; sleep 30"], { cwd: tmpdir(), env: { WF_TEST: "1" }, limits: ["-p", "RuntimeMaxSec=60"] });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(runner.active("demo"), true);
  assert.equal(runner.log("demo"), "started");
  assert.ok(runner.memoryMb("demo") >= 0);
  runner.stop("demo");
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(runner.active("demo"), false);
  assert.equal(spawnSync("sh", ["-c", "pgrep -f 'sleep 6[0]; kill -TERM'"]).status, 1, "the watchdog is stopped too");
  assert.throws(() => runner.run("ghost", ["/no/such/program"], { cwd: tmpdir() }));
});
