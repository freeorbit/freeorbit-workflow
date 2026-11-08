import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { merge } from "../lib/config.mjs";
import { DEFAULTS } from "../lib/defaults.mjs";
import { commandFor, runTestdata } from "../lib/testdata.mjs";

test("a step's command is the project's prefix with the arguments, quoted when they need it", () => {
  const config = merge(DEFAULTS, { testdata: { commands: { route: "gen route" } } });
  assert.equal(commandFor(config, "route", ["uplink", "GM-01,GM-02"]), "gen route uplink GM-01,GM-02");
  assert.equal(commandFor(config, "route", ["a b; rm"]), "gen route 'a b; rm'");
  assert.equal(commandFor(config, "stale", []), null);
});

test("refresh-close runs covered, then index on the area alone, and a missing step is named", () => {
  const root = mkdtempSync(join(tmpdir(), "wf-td-"));
  const config = merge(DEFAULTS, { testdata: { commands: { covered: "echo covered >> log.txt; echo", index: "echo index >> log.txt; echo" } } });
  assert.equal(runTestdata(root, config, "refresh-close", ["uplink", "GM-01"]), 0);
  assert.equal(readFileSync(join(root, "log.txt"), "utf8"), "covered\nindex\n");
  assert.equal(runTestdata(root, config, "journeys", ["uplink"]), 2);
});
