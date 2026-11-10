// `wf app`: drives the project's app for an agent on Linux. It starts the app
// safely, as systemd user units under a memory cap and a time limit, reads and
// acts on the page, then stops it. `app.kind` picks how:
//
//   tauri  the debug binary and Vite; the page through WebKit's remote inspector
//   web    the project's servers, then Chromium; the page through its debugging protocol
//
// What the app is comes from `app` in the project's config; what a project
// adds before a start, such as building a test-data scenario, comes from its
// hooks module (`app.hooks`):
//
//   export async function prepare(ctx)  -> { env?, state?, note? }   before the app starts
//   export async function stop(ctx)                                  after the app stops
//
// ctx is { root, args, fresh, real, instance, dataHome, appData, seenData,
// lockSeenData, sh, env }. `appData(base)` is the app's own folder under a
// data home, `seenData` the first instance's data path, and `lockSeenData()`
// holds that path while a second instance builds data there.

import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { clickTarget } from "./clickTarget.mjs";
import { runnerFor } from "./runner.mjs";
import { browserFor } from "../platform.mjs";
import { FIND, FITS, PAGE_TEXT, QUIET, SCROLLER, SCROLL_TO, SET, words } from "./page.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Everything a run needs to know about the app, from the config and the instance number. */
export function appSettings(root, config, env = process.env) {
  const app = config.app;
  const web = app.kind === "web";
  const needs = web ? ["name"] : ["name", "binary", "bundleId"];
  for (const key of needs) {
    if (!app[key]) throw new Error(`app.${key} is not set in .workflow/config.json; wf app needs ${needs.join(", ")}`);
  }
  if (web && !app.web.url) throw new Error("app.web.url is not set in .workflow/config.json; wf app needs the address the app opens at");
  const raw = env[app.instanceEnv] ?? "0";
  const instance = Number(raw);
  if (!Number.isInteger(instance) || instance < 0 || instance > 32) throw new Error(`${app.instanceEnv} is a number from 0 to 32`);
  const base = `/tmp/${app.name}-agent`;
  const state = instance ? `${base}-${instance}` : base;
  const data = join(state, "data");
  // A second instance keeps its data in its own folder, but the app and the
  // project's tools see it at the first instance's path, through a private
  // mount, so a screen shows the same path whichever app shot it.
  const seenData = join(base, "data");
  return {
    root,
    app,
    instance,
    state,
    data,
    seenData,
    mount: instance ? ["-p", "PrivateUsers=yes", "-p", `BindPaths=${data}:${seenData}`] : [],
    appData: (home) => join(home, app.bundleId),
    binary: join(root, app.binary),
    inspector: `127.0.0.1:${app.inspectorPort + instance}`,
    viteUrl: app.vite.url,
    web,
    browser: web ? browserFor(config) : null,
    // A website has no fixed window: it opens at the project's frame size unless app.web.size says otherwise.
    size: app.web.size ?? config.design.size,
    debugPort: app.web.debugPort + instance,
    profile: join(state, "chromium"),
    units: {
      ...(web ? {} : { vite: `${app.name}-agent-vite` }),
      app: instance ? `${app.name}-agent-app-${instance}` : `${app.name}-agent-app`,
      ...Object.fromEntries((web ? app.web.servers : []).map((server) => [`server:${server.name}`, `${app.name}-agent-${server.name}`])),
    },
  };
}

/** Chromium's arguments for the web kind: a throwaway profile, the debugging port, and the window size. */
export function chromiumArgs(s, size) {
  const [width, height] = size;
  return [
    s.browser,
    ...(s.app.web.headless ? ["--headless"] : []),
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    `--user-data-dir=${s.profile}`,
    "--remote-debugging-address=127.0.0.1",
    `--remote-debugging-port=${s.debugPort}`,
    `--window-size=${width},${height}`,
    s.app.web.url,
  ];
}

/** The app's page among Chromium's targets: the one on exactly the app's origin, or null. */
export function appPage(targets, url) {
  const origin = new URL(url).origin;
  const on = (target) => {
    try {
      return new URL(target.url).origin === origin;
    } catch {
      return false;
    }
  };
  return targets.find((target) => target.type === "page" && on(target)) ?? null;
}

/** psql's arguments and environment for one query: read-only, no backslash commands, and the address kept out of the process list. */
export function psqlCall(url, sql) {
  const query = sql ?? "SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog', 'information_schema') ORDER BY 1, 2";
  // A backslash command such as \! runs a shell, so only SQL is passed.
  if (/^\s*\\/.test(query) || /(^|\n)\s*\\/.test(query)) throw new Error("db takes SQL only, not psql's backslash commands");
  return {
    args: ["-X", "--no-psqlrc", "-v", "ON_ERROR_STOP=1", "-c", query],
    env: { PGDATABASE: url, PGOPTIONS: "-c default_transaction_read_only=on" },
  };
}

/** A web viewport: a name from app.web.sizes, such as mobile, or WxH. */
export function viewport(app, value) {
  if (app.web.sizes[value]) return app.web.sizes[value];
  const size = String(value ?? "").split("x").map(Number);
  if (size.length !== 2 || size.some((n) => !Number.isInteger(n) || n < 1)) throw new Error(`a size is WxH or one of ${Object.keys(app.web.sizes).join(", ")}, not ${JSON.stringify(value)}`);
  return size;
}

/** The script that sends the page to an address: a hash change in place, or a path that loads. */
export function goScript(where) {
  if (where.startsWith("#")) return `location.hash = ${JSON.stringify(where)}`;
  if (where.startsWith("/")) return `location.assign(${JSON.stringify(where)})`;
  throw new Error(`go takes "#/route" or "/path", not ${JSON.stringify(where)}`);
}

/** The database file `db <name>` reads, from `app.databases`; `*` in a pattern stands for the name. */
export function databasePath(databases, appData, name) {
  const names = Object.keys(databases);
  if (names.length === 0) throw new Error("app.databases names no database");
  const which = name ?? names[0];
  const pattern = databases[which] ?? databases["*"]?.replaceAll("*", which);
  if (!pattern) throw new Error(`no database named ${which} in app.databases (${names.join(", ")})`);
  return join(appData, pattern);
}

function sh(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { encoding: "utf8", ...opts });
  return { ok: res.status === 0, out: (res.stdout ?? "") + (res.stderr ?? "") };
}

/** The driver's commands for one app and instance. */
export function driver(s, hooks = {}, runner = runnerFor({ app: s.app }, s.state)) {
  const unitActive = (unit) => runner.active(unit);
  const stopUnit = (unit) => runner.stop(unit);
  const runUnit = (unit, args, { env = {}, cwd = s.root, limits = [] } = {}) => runner.run(unit, args, { env, cwd, limits });
  const journal = (unit, lines = 40) => runner.log(unit, lines);
  const saveState = (state) => {
    mkdirSync(s.state, { recursive: true });
    writeFileSync(join(s.state, "state.json"), JSON.stringify(state, null, 2));
  };
  const loadState = () => {
    const file = join(s.state, "state.json");
    return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  };
  const viteUp = async () => {
    try {
      return (await fetch(s.viteUrl)).ok;
    } catch {
      return false;
    }
  };
  const webProcessRssMb = () => {
    // The web kind's browser is the unit's own processes; another Chromium on the machine is not ours.
    if (s.web || runner.kind === "process") return runner.memoryMb(s.units.app);
    const out = sh("ps", ["-C", "WebKitWebProcess", "-o", "rss="]).out;
    return Math.round(out.split(/\s+/).filter(Boolean).reduce((sum, n) => sum + Number(n), 0) / 1024);
  };

  // --- WebKit remote inspector --------------------------------------------

  async function socketPath() {
    const html = await (await fetch(`http://${s.inspector}/`)).text();
    const match = html.match(/\/socket\/\d+\/\d+\/WebPage/);
    if (!match) throw new Error("the app has no inspectable page yet");
    return match[0];
  }

  /** One connection to Chromium's page, for the web kind: the protocol directly, no target wrapper. */
  async function connectChromium() {
    const targets = await (await fetch(`http://127.0.0.1:${s.debugPort}/json/list`)).json();
    // Chromium can open pages of its own, such as a component's, so the app's page is the one on its exact origin.
    const page = appPage(targets, s.app.web.url);
    if (!page) throw new Error(`Chromium has no page open at ${new URL(s.app.web.url).origin}`);
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    let nextId = 0;
    const pending = new Map();
    const listeners = [];
    await Promise.race([
      new Promise((resolveOpen, rejectOpen) => {
        ws.onopen = resolveOpen;
        ws.onerror = () => rejectOpen(new Error("debugging connection failed"));
      }),
      sleep(5000).then(() => { throw new Error("Chromium did not answer; the page may be hung (check mem)"); }),
    ]);
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      } else if (msg.method) listeners.forEach((fn) => fn(msg));
    };
    function call(method, params = {}, timeout = 10000) {
      const id = ++nextId;
      ws.send(JSON.stringify({ id, method, params }));
      return Promise.race([
        new Promise((r) => pending.set(id, r)),
        sleep(timeout).then(() => { throw new Error(`${method} timed out; the page may be hung (check mem)`); }),
      ]).then((reply) => {
        if (reply.error) throw new Error(`${method}: ${reply.error.message}`);
        return reply.result;
      });
    }
    // The window's frame takes part of Chromium's window size, so the page is set to the exact size each time.
    const [width, height] = loadState().size ?? s.size;
    await call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 768 });
    async function evaluate(expression) {
      const result = await call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
      if (result.exceptionDetails) throw new Error(`page threw: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`);
      return result.result?.value;
    }
    return { call, evaluate, on: (fn) => listeners.push(fn), close: () => ws.close() };
  }

  /** A picture of the window as PNG bytes, from whichever engine drives the page. */
  async function capture(p, width, height) {
    if (s.web) return Buffer.from((await p.call("Page.captureScreenshot", { format: "png" })).data, "base64");
    const { dataURL } = await p.call("Page.snapshotRect", { x: 0, y: 0, width, height, coordinateSystem: "Viewport" });
    return Buffer.from(dataURL.split(",")[1], "base64");
  }

  /** One connection to the page. Messages go through Target.sendMessageToTarget. */
  async function connect() {
    if (s.web) return connectChromium();
    const ws = new WebSocket(`ws://${s.inspector}${await socketPath()}`);
    let nextId = 0;
    let target = null;
    const pending = new Map();
    const listeners = [];
    const ready = new Promise((resolveReady, rejectReady) => {
      ws.onerror = () => rejectReady(new Error("inspector connection failed"));
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.method === "Target.targetCreated" && !target) {
          target = msg.params.targetInfo.targetId;
          resolveReady();
        } else if (msg.method === "Target.dispatchMessageFromTarget") {
          const inner = JSON.parse(msg.params.message);
          if (inner.id && pending.has(inner.id)) {
            pending.get(inner.id)(inner);
            pending.delete(inner.id);
          } else if (inner.method) {
            listeners.forEach((fn) => fn(inner));
          }
        }
      };
    });
    await Promise.race([ready, sleep(5000).then(() => { throw new Error("inspector did not answer; the page may be hung (check mem)"); })]);

    function call(method, params = {}, timeout = 10000) {
      const id = ++nextId;
      ws.send(JSON.stringify({
        id: ++nextId, method: "Target.sendMessageToTarget",
        params: { targetId: target, message: JSON.stringify({ id, method, params }) },
      }));
      return Promise.race([
        new Promise((r) => pending.set(id, r)),
        sleep(timeout).then(() => { throw new Error(`${method} timed out; the page may be hung (check mem)`); }),
      ]).then((reply) => {
        if (reply.error) throw new Error(`${method}: ${reply.error.message}`);
        return reply.result;
      });
    }

    async function evaluate(expression) {
      const result = await call("Runtime.evaluate", { expression, returnByValue: true });
      if (result.wasThrown) throw new Error(`page threw: ${result.result?.description ?? JSON.stringify(result.result)}`);
      return result.result?.value;
    }

    return { call, evaluate, on: (fn) => listeners.push(fn), close: () => ws.close() };
  }

  async function withPage(fn) {
    const page = await connect();
    try {
      return await fn(page);
    } finally {
      page.close();
    }
  }

  // Wait until the page has not changed for 150 ms, after at least 250 ms so a
  // backend reply has time to land. At most 3 s.
  async function settle(page, max = 3000) {
    const began = Date.now();
    await page.evaluate(QUIET);
    await sleep(250);
    while (Date.now() - began < max) {
      if ((await page.evaluate(QUIET)) >= 150) break;
      await sleep(50);
    }
    return JSON.parse(await page.evaluate(PAGE_TEXT));
  }

  const printPage = (page) => console.log(`url: ${page.url}\n---\n${page.text}`);

  /** Send the page to a route: the Tauri kind changes the hash; the web kind also loads a path. */
  async function navigate(p, where) {
    if (!s.web) return p.evaluate(`location.hash = ${JSON.stringify(where.replace(/^#?/, "#"))}`);
    if (where.startsWith("#")) return p.evaluate(goScript(where));
    // A path load replaces the page, so the evaluation that started it may not return; a thrown error still counts.
    await p.evaluate(goScript(where)).catch((error) => {
      if (/page threw/.test(error.message)) throw error;
    });
    await sleep(300);
  }

  const reachable = async (url) => {
    try {
      await fetch(url);
      return true;
    } catch {
      return false;
    }
  };
  const caps = ["-p", `MemoryMax=${s.app.memoryMax}`, "-p", "MemorySwapMax=0", "-p", `RuntimeMaxSec=${s.app.runtimeMaxSec}`];
  const serverUnits = () => Object.entries(s.units).filter(([name]) => name.startsWith("server:")).map(([, unit]) => unit);

  /** The web kind's start: the project's servers, shared by every instance, then this instance's Chromium. */
  async function startWeb(args) {
    const fresh = args.includes("--fresh");
    stopUnit(s.units.app);
    // Something else on the debugging port, such as the person's own Chromium, is never driven.
    if (await reachable(`http://127.0.0.1:${s.debugPort}/json/version`)) throw new Error(`something already listens on port ${s.debugPort}, and it is not this run's browser; stop it, or set app.web.debugPort`);
    if (fresh) rmSync(s.profile, { recursive: true, force: true });
    // The profile sits in /tmp, so it is the user's own and no one else's.
    mkdirSync(s.profile, { recursive: true, mode: 0o700 });
    const owner = statSync(s.profile);
    if (owner.uid !== process.getuid()) throw new Error(`${s.profile} belongs to another user; remove it`);
    chmodSync(s.profile, 0o700);
    try {
      await startWebUnits(args);
    } catch (error) {
      // A failed start leaves nothing running.
      stopUnit(s.units.app);
      if (!s.instance) for (const unit of serverUnits()) stopUnit(unit);
      throw error;
    }
  }

  async function startWebUnits(args) {
    const fresh = args.includes("--fresh");
    const ready = hooks.prepare ? ((await hooks.prepare(context({ args, fresh, real: false, dataHome: null, env: process.env }))) ?? {}) : {};
    for (const server of s.app.web.servers) {
      const unit = s.units[`server:${server.name}`];
      if (server.url && (await reachable(server.url))) continue;
      runUnit(unit, server.command, { cwd: join(s.root, server.cwd ?? "."), env: { PATH: process.env.PATH, ...(ready.env ?? {}), ...(server.env ?? {}) }, limits: caps });
      if (!server.url) continue;
      for (let i = 0; i < 120 && !(await reachable(server.url)); i++) await sleep(250);
      if (!(await reachable(server.url))) throw new Error(`${server.name} did not answer at ${server.url}:\n${journal(unit)}`);
    }
    const sizeAt = args.indexOf("--size");
    const size = sizeAt >= 0 ? viewport(s.app, args[sizeAt + 1]) : s.size;
    const env = {};
    for (const key of ["WAYLAND_DISPLAY", "DISPLAY", "XDG_RUNTIME_DIR"]) if (process.env[key]) env[key] = process.env[key];
    if (!s.app.web.headless && !env.DISPLAY && !env.WAYLAND_DISPLAY) throw new Error("app.web.headless is off, but there is no DISPLAY or WAYLAND_DISPLAY");
    runUnit(s.units.app, chromiumArgs(s, size), { env, limits: caps });
    saveState({ kind: "web", size, ...(ready.state ?? {}), startedAt: new Date().toISOString() });
    let last = null;
    for (let i = 0; i < 60; i++) {
      await sleep(500);
      if (!unitActive(s.units.app)) throw new Error(`Chromium exited:\n${journal(s.units.app)}`);
      try {
        const page = await withPage((p) => p.evaluate(PAGE_TEXT).then(JSON.parse));
        if (page.text.trim() && last && page.text === last.text && page.url === last.url) {
          console.log(`started (${s.app.web.headless ? "headless" : "on your screen"}, ${size.join("x")}${ready.note ? `, ${ready.note}` : ""})`);
          printPage(page);
          return;
        }
        last = page;
      } catch {
        last = null;
      }
    }
    throw new Error(`the page did not settle in 30s (Chromium ${webProcessRssMb()} MB):\n${journal(s.units.app)}`);
  }

  /** Hold the shared data path while a second instance builds data there. Returns the release. */
  async function lockSeenData() {
    const lock = `${s.seenData}.lock`;
    // The first instance's folder may not exist yet, such as after a reboot
    // when only second instances run; without it the lock can never be taken.
    mkdirSync(dirname(lock), { recursive: true });
    for (let i = 0; i < 1200; i++) {
      try {
        mkdirSync(lock);
        return () => rmSync(lock, { recursive: true, force: true });
      } catch {
        // A lock older than two minutes is left from a stopped run.
        try {
          if (Date.now() - statSync(lock).mtimeMs > 120_000) rmSync(lock, { recursive: true, force: true });
        } catch {}
        await sleep(100);
      }
    }
    throw new Error(`the shared data path stayed locked; remove ${lock} if no run is going`);
  }

  const context = (extra) => ({ root: s.root, instance: s.instance, appData: s.appData, seenData: s.seenData, lockSeenData, sh, ...extra });

  const STATE = s.state;

  const commands = {
    /** Start the shared Vite if it is not up, so parallel instances do not each start it. */
    async vite() {
      if (!(await viteUp())) {
        runUnit(s.units.vite, s.app.vite.command, { cwd: join(s.root, s.app.vite.cwd), env: { PATH: process.env.PATH } });
        for (let i = 0; i < 40 && !(await viteUp()); i++) await sleep(250);
        if (!(await viteUp())) throw new Error(`Vite did not start:\n${journal(s.units.vite)}`);
      }
    },

    async start(args) {
      if (s.web) return startWeb(args);
      const fresh = args.includes("--fresh");
      const real = args.includes("--real");
      if (!existsSync(s.binary)) throw new Error(`no app binary at ${s.binary}; build it first`);

      const dataHome = real ? null : s.data;
      if (fresh && dataHome) rmSync(dataHome, { recursive: true, force: true });
      if (dataHome) mkdirSync(dataHome, { recursive: true });

      const env = { WEBKIT_INSPECTOR_HTTP_SERVER: s.inspector, RUST_BACKTRACE: "1" };
      const ready = hooks.prepare ? ((await hooks.prepare(context({ args, fresh, real, dataHome, env: process.env }))) ?? {}) : {};

      await commands.vite();

      const sizeAt = args.indexOf("--size");
      if (sizeAt >= 0) {
        const size = args[sizeAt + 1];
        if (!/^\d+x\d+$/.test(size ?? "")) throw new Error("usage: start --size 800x560");
        if (!s.app.sizeEnv) throw new Error("--size needs app.sizeEnv, the variable the app reads its window size from");
        env[s.app.sizeEnv] = size;
      }
      if (dataHome) env.XDG_DATA_HOME = s.instance ? s.seenData : dataHome;
      Object.assign(env, ready.env ?? {});
      for (const key of ["WAYLAND_DISPLAY", "DISPLAY", "XDG_RUNTIME_DIR"]) if (process.env[key]) env[key] = process.env[key];
      if (!env.DISPLAY && !env.WAYLAND_DISPLAY) {
        throw new Error("no DISPLAY or WAYLAND_DISPLAY in the environment; open a desktop session first");
      }

      // The private mount needs its mount point to exist.
      if (s.instance) mkdirSync(s.seenData, { recursive: true });
      runUnit(s.units.app, [s.binary], {
        env,
        limits: ["-p", `MemoryMax=${s.app.memoryMax}`, "-p", "MemorySwapMax=0", "-p", `RuntimeMaxSec=${s.app.runtimeMaxSec}`, ...s.mount],
      });
      saveState({ dataHome, ...(ready.state ?? {}), startedAt: new Date().toISOString() });

      // A debug build may rewrite generated code at launch, which makes Vite
      // reload the page once. Wait for a page that has rendered and stays.
      let last = null;
      for (let i = 0; i < 60; i++) {
        await sleep(500);
        if (!unitActive(s.units.app)) throw new Error(`the app exited:\n${journal(s.units.app)}`);
        try {
          const page = await withPage((p) => p.evaluate(PAGE_TEXT).then(JSON.parse));
          if (page.text.trim() && last && page.text === last.text && page.url === last.url) {
            console.log(`started (on your screen${ready.note ? `, ${ready.note}` : ""}, data: ${dataHome ?? "real data folder"})`);
            printPage(page);
            return;
          }
          last = page;
        } catch {
          last = null;
        }
      }
      throw new Error(`the page did not settle in 30s (web process ${webProcessRssMb()} MB):\n${journal(s.units.app)}`);
    },

    async stop() {
      stopUnit(s.units.app);
      // Other instances may still use Vite and the servers, so only the first one stops them.
      if (!s.instance) for (const unit of s.web ? serverUnits() : [s.units.vite]) stopUnit(unit);
      if (hooks.stop) await hooks.stop(context({ env: process.env }));
      console.log("stopped");
    },

    async status() {
      for (const [name, unit] of Object.entries(s.units)) console.log(`${name}: ${unitActive(unit) ? "running" : "stopped"}`);
      if (s.web) console.log(`app reachable at ${s.app.web.url}: ${await reachable(s.app.web.url)}`);
      else console.log(`vite reachable: ${await viteUp()}`);
      console.log(`web process memory: ${webProcessRssMb()} MB (${runner.kind === "process" ? "no cap without systemd" : `cap ${s.app.memoryMax}`})`);
      console.log(`state: ${JSON.stringify(loadState())}`);
    },

    async text() {
      printPage(await withPage((p) => p.evaluate(PAGE_TEXT).then(JSON.parse)));
    },

    async go([hash]) {
      if (!hash) throw new Error('usage: go "#/catalog"');
      printPage(await withPage(async (p) => {
        await navigate(p, hash);
        return settle(p);
      }));
    },

    async click(args) {
      const { label, within } = clickTarget(args);
      if (!label) throw new Error('usage: click "Continue to the catalog" [in <group>]');
      printPage(await withPage(async (p) => {
        const found = await p.evaluate(`(() => { const n = ${FIND(label, within)}; if (!n) return false; n.click(); return true; })()`);
        if (!found) throw new Error(`nothing clickable with text "${label}"`);
        return settle(p);
      }));
    },

    async type([label, value]) {
      if (!label || value === undefined) throw new Error('usage: type "New address" "me@example.com"');
      printPage(await withPage(async (p) => {
        const found = await p.evaluate(SET(label, value));
        if (!found) throw new Error(`no field labelled "${label}"`);
        return settle(p);
      }));
    },

    // Several steps in one call, on one connection. Each step is one argument:
    //   run 'go #/catalog' 'click "Install"' 'expect Installed' 'shot /tmp/a.png'
    // It prints one line per step and stops at the first failure, with the page
    // text for context. Nothing else is printed unless a step asks for it.
    async run(steps) {
      if (steps.length === 0) throw new Error(`usage: run 'go #/catalog' 'click Install' 'expect Installed'
  steps: go <#hash | /path> · size <name | WxH> · click <label> [in <group>] · type <label> <value> · expect <text> · until <text> · show <text> · absent <text>
         lines <text> · text · url · eval <js> · wait <ms> · shot [file] · page <file> · fits`);
      await withPage(async (p) => {
        let page = null;
        const current = async () => (page ??= JSON.parse(await p.evaluate(PAGE_TEXT)));
        for (const [n, step] of steps.entries()) {
          const [verb, ...rest] = words(step);
          const tag = `${n + 1}. ${step}`;
          try {
            switch (verb) {
              case "go":
                await navigate(p, rest[0] ?? "");
                page = await settle(p);
                break;
              case "click": {
                const { label, within } = clickTarget(rest);
                const found = await p.evaluate(`(() => { const n = ${FIND(label, within)}; if (!n) return false; n.click(); return true; })()`);
                if (!found) throw new Error(`nothing clickable with text "${label}"${within ? ` in ${within}` : ""}`);
                page = await settle(p);
                break;
              }
              case "type":
              case "set": {
                if (!(await p.evaluate(SET(rest[0] ?? "", rest[1] ?? "")))) throw new Error(`no field labelled "${rest[0]}"`);
                page = await settle(p);
                break;
              }
              case "expect": {
                const want = rest.join(" ");
                if (!(await current()).text.includes(want)) throw new Error(`"${want}" is not on the page`);
                break;
              }
              case "until": {
                // Waits up to 10 s for text that comes later, such as a model's answer.
                const want = rest.join(" ");
                const end = Date.now() + 10_000;
                while (!(page = JSON.parse(await p.evaluate(PAGE_TEXT))).text.includes(want)) {
                  if (Date.now() > end) throw new Error(`"${want}" did not show in 10 s`);
                  await sleep(100);
                }
                page = await settle(p);
                break;
              }
              case "show": {
                // Scrolls the first element whose own text is this to the top of its scrolling box.
                const want = rest.join(" ");
                const found = await p.evaluate(`(() => {
                  const want = ${JSON.stringify(want)}.toLowerCase();
                  const reads = (e) => e.textContent.trim().toLowerCase() === want;
                  // The innermost element that reads it, in the page before the sidebar and the panel.
                  const scope = document.querySelector("main") ?? document.body;
                  const hit = [...scope.querySelectorAll("*")].find((e) => reads(e) && ![...e.children].some(reads));
                  if (!hit) return false;
                  hit.scrollIntoView({ block: "start" });
                  return true;
                })()`);
                if (!found) throw new Error(`nothing reads "${want}"`);
                page = await settle(p);
                break;
              }
              case "absent": {
                const want = rest.join(" ");
                if ((await current()).text.includes(want)) throw new Error(`"${want}" is on the page`);
                break;
              }
              case "lines": {
                const want = rest.join(" ").toLowerCase();
                const hits = (await current()).text.split("\n").filter((l) => l.toLowerCase().includes(want));
                console.log(`${tag}\n${hits.map((l) => `   ${l}`).join("\n") || "   (no lines)"}`);
                continue;
              }
              case "text":
                console.log(`${tag}\n${(await current()).text}`);
                continue;
              case "url":
                console.log(`${tag}: ${(await current()).url}`);
                continue;
              case "eval": {
                const value = await p.evaluate(rest.join(" "));
                console.log(`${tag}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
                page = null;
                continue;
              }
              case "wait":
                await sleep(Number(rest[0] ?? 500));
                page = null;
                break;
              case "shot": {
                const out = rest[0] ?? join(STATE, `step-${n + 1}.png`);
                const size = JSON.parse(await p.evaluate("JSON.stringify([innerWidth, innerHeight])"));
                writeFileSync(out, await capture(p, size[0], size[1]));
                console.log(`${tag}: saved ${out} (${size[0]}x${size[1]})`);
                continue;
              }
              case "size": {
                // A website is checked at several widths in one run, such as desktop then mobile.
                if (!s.web) throw new Error("size is for the web kind; start a Tauri app with --size");
                const [width, height] = viewport(s.app, rest[0]);
                await p.call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 768 });
                saveState({ ...loadState(), size: [width, height] });
                page = await settle(p);
                break;
              }
              case "page": {
                if (s.web) {
                  // Chromium draws the whole document at once, beyond the window, so nothing is stitched.
                  const out = rest[0];
                  if (!out) throw new Error("usage: page <file.png>");
                  const { data } = await p.call("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
                  writeFileSync(out, Buffer.from(data, "base64"));
                  console.log(`${tag}: saved ${out} (the whole page)`);
                  page = null;
                  continue;
                }
                // The whole page: the window's tallest scrolling box, shot a window
                // at a time and joined, so what is below the fold is seen too.
                const out = rest[0];
                if (!out) throw new Error("usage: page <file.png>");
                const box = JSON.parse(await p.evaluate(SCROLLER));
                const parts = [];
                let overlap = 0;
                for (let top = 0, i = 0; ; i++) {
                  const at = Math.min(top, box.max);
                  overlap = top - at;
                  await p.evaluate(`(${SCROLL_TO})(${at})`);
                  await sleep(150);
                  const size = JSON.parse(await p.evaluate("JSON.stringify([innerWidth, innerHeight])"));
                  const part = `${out}.part${i}.png`;
                  writeFileSync(part, await capture(p, size[0], size[1]));
                  parts.push(part);
                  if (at >= box.max) break;
                  top += box.step;
                }
                await p.evaluate(`(${SCROLL_TO})(0)`);
                // The first window shows the whole screen down to the box's foot. The rest show
                // only the box, so the sidebar and the status bar are not repeated.
                const scale = readFileSync(parts[0]).readUInt32BE(16) / JSON.parse(await p.evaluate("innerWidth"));
                const [x, y, w, h] = box.box.map((n) => Math.round(n * scale));
                const args = [];
                args.push("(", parts[0], "-gravity", "northwest", "-crop", `${x + w}x${y + h}+0+0`, "+repage", ")");
                for (const [i, part] of parts.slice(1).entries()) {
                  const chop = i === parts.length - 2 ? Math.round(overlap * scale) : 0;
                  args.push("(", part, "-gravity", "northwest", "-crop", `${w}x${h - chop}+${x}+${y + chop}`, "+repage", ")");
                }
                // No date chunks, so the same page always gives the same bytes and the same hash.
                const joined = sh("magick", [...args, "-background", "#000", "-gravity", "east", "-append", "-define", "png:exclude-chunks=date,time", out]);
                for (const part of parts) rmSync(part, { force: true });
                if (!joined.ok) throw new Error(`magick could not join the shots:\n${joined.out}`);
                console.log(`${tag}: saved ${out} (${parts.length} windows)`);
                page = null;
                continue;
              }
              case "fits": {
                const wide = JSON.parse(await p.evaluate(FITS));
                if (wide.length) throw new Error(`wider than the window: ${wide.join("; ")}`);
                break;
              }
              default:
                throw new Error(`no step "${verb}"`);
            }
            console.log(`ok ${tag}`);
          } catch (err) {
            console.log(`FAIL ${tag}: ${err.message}`);
            const now = await current().catch(() => null);
            if (now) console.log(`url: ${now.url}\n---\n${now.text.split("\n").slice(0, 40).join("\n")}`);
            process.exitCode = 1;
            return;
          }
        }
        console.log(`url: ${(await current()).url}`);
      });
    },

    async eval([expression]) {
      if (!expression) throw new Error('usage: eval "document.title"');
      const value = await withPage((p) => p.evaluate(expression));
      console.log(typeof value === "string" ? value : JSON.stringify(value, null, 2));
    },

    async console() {
      if (s.web) {
        await withPage(async (p) => {
          const messages = [];
          p.on((msg) => {
            if (msg.method === "Runtime.consoleAPICalled") messages.push({ level: msg.params.type, text: msg.params.args.map((a) => a.value ?? a.description ?? "").join(" ") });
            if (msg.method === "Log.entryAdded") messages.push({ level: msg.params.entry.level, text: msg.params.entry.text, url: msg.params.entry.url, line: msg.params.entry.lineNumber });
          });
          await p.call("Runtime.enable");
          await p.call("Log.enable");
          await sleep(500);
          if (messages.length === 0) console.log("no console messages");
          for (const m of messages) console.log(`[${m.level}] ${m.text}${m.url ? `  (${m.url}:${m.line})` : ""}`);
        });
        return;
      }
      await withPage(async (p) => {
        const messages = [];
        p.on((msg) => {
          if (msg.method === "Console.messageAdded") messages.push(msg.params.message);
        });
        await p.call("Console.enable");
        await sleep(500);
        if (messages.length === 0) console.log("no console messages");
        for (const m of messages) console.log(`[${m.level}] ${m.text}${m.url ? `  (${m.url}:${m.line})` : ""}`);
      });
    },

    async screenshot([out = join(STATE, "screenshot.png")]) {
      await withPage(async (p) => {
        const size = await p.evaluate("JSON.stringify([innerWidth, innerHeight])").then(JSON.parse);
        writeFileSync(out, await capture(p, size[0], size[1]));
        console.log(`saved ${out} (${size[0]}x${size[1]})`);
      });
    },

    async mem() {
      console.log(`web process memory: ${webProcessRssMb()} MB (${runner.kind === "process" ? "no cap without systemd" : `cap ${s.app.memoryMax}`})`);
    },

    async logs([lines = "60"]) {
      if (s.web) {
        for (const server of s.app.web.servers) console.log(`--- ${server.name}\n${journal(s.units[`server:${server.name}`], Number(lines)) || "no output"}`);
        return;
      }
      console.log(journal(s.units.app, Number(lines)) || "no app output");
    },

    async db([which, sql]) {
      if (s.web) {
        // A web app's database is a server: each app.databases value is a connection address psql reads.
        const names = Object.keys(s.app.databases);
        if (!names.length) throw new Error("app.databases names no database");
        const url = s.app.databases[which ?? names[0]];
        if (!url) throw new Error(`no database named ${which} in app.databases (${names.join(", ")})`);
        const call = psqlCall(url, sql);
        console.log(execFileSync("psql", call.args, { encoding: "utf8", env: { ...process.env, ...call.env } }).trim());
        return;
      }
      const { dataHome } = loadState();
      if (!dataHome) throw new Error("db only reads the throwaway data folder; start without --real");
      const file = databasePath(s.app.databases, s.appData(dataHome), which);
      if (!existsSync(file)) throw new Error(`no database at ${file}`);
      const query = sql ?? "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name";
      console.log(execFileSync("sqlite3", ["-header", "-column", file, query], { encoding: "utf8" }).trim() || "(no rows)");
    },

    async reset() {
      stopUnit(s.units.app);
      if (s.web) {
        rmSync(s.profile, { recursive: true, force: true });
        console.log(`removed ${s.profile}; the project's prepare hook resets the app's own data on start --fresh`);
        return;
      }
      rmSync(s.data, { recursive: true, force: true });
      console.log(`removed ${s.data}; start again to get a fresh install`);
    },
  };
  return commands;
}

/** `wf app <command> [args]`; resolves to the exit code. */
export async function runApp(root, config, [name, ...rest]) {
  const s = appSettings(root, config);
  const hooks = config.app.hooks ? await import(pathToFileURL(join(root, config.app.hooks)).href) : {};
  const commands = driver(s, hooks);
  if (!name || !commands[name]) {
    console.log(`usage: wf app <${Object.keys(commands).join("|")}> [args]`);
    return name ? 1 : 0;
  }
  try {
    await commands[name](rest);
    return process.exitCode ?? 0;
  } catch (err) {
    console.error(`error: ${err.message}`);
    return 1;
  }
}
