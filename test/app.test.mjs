import assert from "node:assert/strict";
import { test } from "node:test";

import { appSettings, databasePath } from "../lib/app/driver.mjs";
import { clickTarget, groupName } from "../lib/app/clickTarget.mjs";
import { words } from "../lib/app/page.mjs";
import { merge } from "../lib/config.mjs";
import { DEFAULTS } from "../lib/defaults.mjs";

const config = (app = {}) => merge(DEFAULTS, { app: { name: "demo", binary: "target/debug/demo", bundleId: "org.demo.app", ...app } });

test("a click can name the group its element sits in", () => {
  assert.deepEqual(clickTarget(["Sage"]), { label: "Sage", within: null });
  assert.deepEqual(clickTarget(["Sage", "in", "Scheme"]), { label: "Sage", within: "Scheme" });
  assert.deepEqual(clickTarget(["Log in"]), { label: "Log in", within: null }, "a label that holds the word in");
  assert.equal(groupName("Scheme: "), "scheme");
});

test("a step splits into words, keeping quoted words together", () => {
  assert.deepEqual(words(`click "I added it" in Forward`), ["click", "I added it", "in", "Forward"]);
  assert.deepEqual(words(`type 'App password' "say \\"hi\\""`), ["type", "App password", 'say "hi"']);
});

test("the first instance and a second get their own state, unit, and port, and share the seen data path", () => {
  const first = appSettings("/p", config(), {});
  assert.equal(first.state, "/tmp/demo-agent");
  assert.equal(first.binary, "/p/target/debug/demo");
  assert.equal(first.inspector, "127.0.0.1:9333");
  assert.deepEqual(first.units, { vite: "demo-agent-vite", app: "demo-agent-app" });
  assert.deepEqual(first.mount, []);
  assert.equal(first.appData("/x"), "/x/org.demo.app");
  const third = appSettings("/p", config({ instanceEnv: "DEMO_INSTANCE" }), { DEMO_INSTANCE: "3" });
  assert.equal(third.state, "/tmp/demo-agent-3");
  assert.equal(third.inspector, "127.0.0.1:9336");
  assert.equal(third.units.app, "demo-agent-app-3");
  assert.equal(third.seenData, "/tmp/demo-agent/data");
  assert.deepEqual(third.mount, ["-p", "PrivateUsers=yes", "-p", "BindPaths=/tmp/demo-agent-3/data:/tmp/demo-agent/data"]);
});

test("the driver names what is missing or wrong in its settings", () => {
  assert.throws(() => appSettings("/p", merge(DEFAULTS, {}), {}), /app\.name is not set/);
  assert.throws(() => appSettings("/p", config(), { WF_APP_INSTANCE: "x" }), /a number from 0 to 32/);
  assert.throws(() => appSettings("/p", config(), { WF_APP_INSTANCE: "33" }), /a number from 0 to 32/);
});

test("db reads a named database, the first by default, and * stands for the name", () => {
  const databases = { app: "app.sqlite", "*": "plugins/*/plugin.sqlite" };
  assert.equal(databasePath(databases, "/d", undefined), "/d/app.sqlite");
  assert.equal(databasePath(databases, "/d", "uplink"), "/d/plugins/uplink/plugin.sqlite");
  assert.throws(() => databasePath({ app: "a.sqlite" }, "/d", "other"), /no database named other/);
  assert.throws(() => databasePath({}, "/d"), /names no database/);
});
