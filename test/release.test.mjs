import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { merge, unknownKeys } from "../lib/config/config.mjs";
import { DEFAULTS } from "../lib/config/defaults.mjs";
import { releaseCommand, runRelease } from "../lib/release.mjs";

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
  assert.equal(runRelease(root, config, "next", []), 2);
});
