import assert from "node:assert/strict";
import { test } from "node:test";

import { appPage, appSettings, chromiumArgs, databasePath, goScript, psqlCall, startShared, viewport } from "../lib/app/driver.mjs";
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

test("the web kind needs a name and an address, and gives each server and instance its own unit and port", () => {
  const web = (app = {}) => merge(DEFAULTS, { app: { kind: "web", name: "atlas", web: { url: "http://127.0.0.1:5173/", servers: [{ name: "api", command: ["pnpm", "api"] }, { name: "web", command: ["pnpm", "dev"] }] }, ...app } });
  const first = appSettings("/p", web(), {});
  assert.equal(first.web, true);
  assert.deepEqual(first.units, { app: "atlas-agent-app", "server:api": "atlas-agent-api", "server:web": "atlas-agent-web" });
  assert.equal(first.debugPort, 9444);
  assert.equal(first.profile, "/tmp/atlas-agent/chromium");
  const second = appSettings("/p", web(), { WF_APP_INSTANCE: "2" });
  assert.equal(second.debugPort, 9446);
  assert.equal(second.units.app, "atlas-agent-app-2");
  assert.equal(second.units["server:api"], "atlas-agent-api");
  assert.throws(() => appSettings("/p", merge(DEFAULTS, { app: { kind: "web", name: "atlas" } }), {}), /app\.web\.url is not set/);
  assert.equal(appSettings("/p", config(), {}).units.vite, "demo-agent-vite");
});

test("Chromium starts headless on a throwaway profile at the window size, and go takes a hash or a path", () => {
  const s = appSettings("/p", merge(DEFAULTS, { design: { browser: "chromium" }, app: { kind: "web", name: "atlas", web: { url: "http://127.0.0.1:5173/" } } }), {});
  const args = chromiumArgs(s, [1280, 800]);
  assert.equal(args[0], "chromium");
  assert.ok(!args.includes("--no-sandbox"));
  assert.ok(chromiumArgs({ ...s, app: { ...s.app, web: { ...s.app.web, sandbox: false } } }, [1280, 800]).includes("--no-sandbox"));
  assert.ok(args.includes("--headless"));
  assert.ok(args.includes("--user-data-dir=/tmp/atlas-agent/chromium"));
  assert.ok(args.includes("--remote-debugging-port=9444"));
  assert.ok(args.includes("--window-size=1280,800"));
  assert.equal(args.at(-1), "http://127.0.0.1:5173/");
  assert.ok(!chromiumArgs({ ...s, app: { ...s.app, web: { ...s.app.web, headless: false } } }, [800, 560]).includes("--headless"));
  assert.equal(goScript("#/reviews"), 'location.hash = "#/reviews"');
  assert.equal(goScript("/reviews/1"), 'location.assign("/reviews/1")');
  assert.throws(() => goScript("reviews"), /go takes/);
});

test("a website opens at the frame size unless set, and a viewport is a name or WxH", () => {
  const web = (extra = {}) => merge(DEFAULTS, { design: { size: [1440, 960] }, app: { kind: "web", name: "atlas", web: { url: "http://127.0.0.1:5173/", ...extra } } });
  assert.deepEqual(appSettings("/p", web(), {}).size, [1440, 960]);
  assert.deepEqual(appSettings("/p", web({ size: [1366, 768] }), {}).size, [1366, 768]);
  const app = web({ sizes: { ...DEFAULTS.app.web.sizes, phone: [360, 780] } }).app;
  assert.deepEqual(viewport(app, "mobile"), [390, 844]);
  assert.deepEqual(viewport(app, "phone"), [360, 780]);
  assert.deepEqual(viewport(app, "800x560"), [800, 560]);
  assert.throws(() => viewport(app, "big"), /a size is WxH or one of desktop, tablet, mobile, phone/);
});

test("the app's page is the one on exactly its origin, never a lookalike or another site", () => {
  const targets = [
    { type: "background_page", url: "chrome-extension://abc/background.html" },
    { type: "page", url: "http://localhost:51730/other" },
    { type: "page", url: "https://example.com/" },
    { type: "page", url: "http://localhost:5173/reviews" },
  ];
  assert.equal(appPage(targets, "http://localhost:5173/").url, "http://localhost:5173/reviews");
  assert.equal(appPage(targets.slice(0, 3), "http://localhost:5173/"), null);
});

test("db runs SQL read-only, refuses psql's backslash commands, and keeps the address out of argv", () => {
  const call = psqlCall("postgresql://atlas:secret@127.0.0.1/atlas", "SELECT 1");
  assert.ok(!call.args.join(" ").includes("secret"));
  assert.equal(call.env.PGDATABASE, "postgresql://atlas:secret@127.0.0.1/atlas");
  assert.match(call.env.PGOPTIONS, /default_transaction_read_only=on/);
  assert.ok(call.args.includes("-X"));
  assert.throws(() => psqlCall("x", "\\! id"), /SQL only/);
  assert.throws(() => psqlCall("x", "SELECT 1;\n  \\! id"), /SQL only/);
  assert.match(psqlCall("x").args.at(-1), /information_schema\.tables/);
});

test("Chromium's debugging port listens on loopback only", () => {
  const s = appSettings("/p", merge(DEFAULTS, { app: { kind: "web", name: "atlas", web: { url: "http://127.0.0.1:5173/" } } }), {});
  assert.ok(chromiumArgs(s, [1280, 800]).includes("--remote-debugging-address=127.0.0.1"));
});

test("startShared: a server another instance started a moment before counts as started", () => {
  const active = new Set();
  const runner = { active: (unit) => active.has(unit) };
  const started = [];
  const start = (unit) => () => {
    if (active.has(unit)) throw new Error(`could not start ${unit}: Unit ${unit}.service was already loaded`);
    active.add(unit);
    started.push(unit);
  };
  startShared(runner, "atlas-agent-mock", start("atlas-agent-mock"));
  // A second instance that checked before the first started, then lost the race.
  const late = { active: () => false };
  let checks = 0;
  const racing = { active: (unit) => (checks++ === 0 ? late.active(unit) : runner.active(unit)) };
  startShared(racing, "atlas-agent-mock", start("atlas-agent-mock"));
  // One already active is not started again.
  startShared(runner, "atlas-agent-mock", start("atlas-agent-mock"));
  assert.deepEqual(started, ["atlas-agent-mock"]);
});

test("startShared: a start that fails with nothing running still fails", () => {
  const runner = { active: () => false };
  assert.throws(() => startShared(runner, "atlas-agent-web", () => { throw new Error("no pnpm"); }), /no pnpm/);
});
