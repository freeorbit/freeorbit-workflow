import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { merge, unknownKeys } from "../lib/config/config.mjs";
import { DEFAULTS } from "../lib/config/defaults.mjs";
import { nextVersions, parseTag, releaseCommand, runRelease } from "../lib/release.mjs";

test("a release step is the project's prefix with the version, quoted when it needs it", () => {
  const config = merge(DEFAULTS, { release: { commands: { set: "node tools/version.mjs set" } } });
  assert.equal(releaseCommand(config, "set", ["0.2.0-rc.1"]), "node tools/version.mjs set 0.2.0-rc.1");
  assert.equal(releaseCommand(config, "set", ["1; rm -rf"]), "node tools/version.mjs set '1; rm -rf'");
  assert.equal(releaseCommand(config, "next", []), null);
  assert.deepEqual(unknownKeys({ release: { commands: { mine: "x" }, workflow: {} } }), ["release.workflow"]);
});

test("a step runs in the project root and passes its exit code; a missing one is named", () => {
  const root = mkdtempSync(join(tmpdir(), "wf-release-"));
  const config = merge(DEFAULTS, { release: { commands: { check: "sh -c 'echo checked $1 >> log.txt; exit 3' step" } } });
  assert.equal(runRelease(root, config, "check", ["0.2.0"]), 3);
  assert.equal(readFileSync(join(root, "log.txt"), "utf8"), "checked 0.2.0\n");
  assert.equal(runRelease(root, config, "set", ["0.2.0"]), 2);
});

const release = DEFAULTS.release;
const versions = (tags, settings = release) => nextVersions(tags, settings).map((row) => `${row.kind} ${row.version}`);

test("a release tag is its prefix, three numbers, and maybe a pre-release count; anything else is not one", () => {
  assert.deepEqual(parseTag("v0.2.0-rc.3", release), { base: [0, 2, 0], rc: 3 });
  assert.deepEqual(parseTag("v1.10.2", release), { base: [1, 10, 2], rc: null });
  for (const tag of ["0.2.0", "v0.2", "v0.2.0-beta.1", "v0.2.0-rc.", "v0.2.0-rc.1x", "vx0.2.0"]) assert.equal(parseTag(tag, release), null, tag);
  assert.deepEqual(parseTag("app@0.2.0.pre1", { tagPrefix: "app@", preRelease: ".pre" }), { base: [0, 2, 0], rc: 1 });
});

test("with no tags, next offers only new lines, and no stable version", () => {
  assert.deepEqual(versions([]), ["patch 0.0.1-rc.1", "minor 0.1.0-rc.1", "major 1.0.0-rc.1"]);
});

test("an open line offers its next pre-release and its own stable version first", () => {
  assert.deepEqual(versions(["v0.1.0-rc.1", "v0.1.0-rc.2", "notes-2026", "v0.1.0-rc.10"]), [
    "pre-release 0.1.0-rc.11",
    "stable 0.1.0",
    "patch 0.1.1-rc.1",
    "minor 0.2.0-rc.1",
    "major 1.0.0-rc.1",
  ]);
});

test("a stable version closes its line, and new lines count from the newest tag", () => {
  assert.deepEqual(versions(["v0.1.0-rc.1", "v0.1.0", "v0.1.1-rc.1", "v0.1.1"]), ["patch 0.1.2-rc.1", "minor 0.2.0-rc.1", "major 1.0.0-rc.1"]);
});

test("a pre-release line older than the last stable version is not open", () => {
  assert.deepEqual(versions(["v0.2.0-rc.1", "v0.3.0-rc.1", "v0.3.0", "v0.4.0-rc.2"]), [
    "pre-release 0.4.0-rc.3",
    "stable 0.4.0",
    "patch 0.4.1-rc.1",
    "minor 0.5.0-rc.1",
    "major 1.0.0-rc.1",
  ]);
  assert.deepEqual(versions(["v0.2.0-rc.1", "v0.3.0"]), ["patch 0.3.1-rc.1", "minor 0.4.0-rc.1", "major 1.0.0-rc.1"]);
});

test("next reads the project's own prefix and pre-release marker", () => {
  assert.deepEqual(versions(["web-1.2.0", "web-1.3.0.pre4", "v9.0.0"], { tagPrefix: "web-", preRelease: ".pre" }), [
    "pre-release 1.3.0.pre5",
    "stable 1.3.0",
    "patch 1.3.1.pre1",
    "minor 1.4.0.pre1",
    "major 2.0.0.pre1",
  ]);
});

test("with no next command, wf release next reads the repo's tags; the project's own command wins", () => {
  const root = mkdtempSync(join(tmpdir(), "wf-release-next-"));
  const git = (...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.test", "-c", "commit.gpgSign=false", "-c", "tag.gpgSign=false", ...args], { cwd: root });
  git("init", "-q", "-b", "main");
  git("commit", "-q", "--allow-empty", "-m", "start");
  git("tag", "v0.1.0-rc.1");
  const lines = [];
  const log = console.log;
  console.log = (line) => lines.push(line);
  try {
    assert.equal(runRelease(root, DEFAULTS, "next", []), 0);
  } finally {
    console.log = log;
  }
  assert.match(lines[0], /^pre-release +0\.1\.0-rc\.2 +the next of the open line, after v0\.1\.0-rc\.1$/);
  assert.match(lines[1], /^stable +0\.1\.0 /);
  assert.equal(lines.length, 5);
  const own = merge(DEFAULTS, { release: { commands: { next: "echo mine > next.txt" } } });
  assert.equal(runRelease(root, own, "next", []), 0);
  assert.equal(readFileSync(join(root, "next.txt"), "utf8"), "mine\n");
});

test("both kinds of release are prepared unless the project turns one off", () => {
  assert.deepEqual(DEFAULTS.release.prepare, { preRelease: true, stable: true });
  const config = merge(DEFAULTS, { release: { prepare: { preRelease: false } } });
  assert.deepEqual(config.release.prepare, { preRelease: false, stable: true });
  assert.deepEqual(unknownKeys({ release: { prepare: { preRelease: false, stable: true } } }), []);
  assert.notDeepEqual(unknownKeys({ release: { prepare: { draft: false } } }), []);
});
