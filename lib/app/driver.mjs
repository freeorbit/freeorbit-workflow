// `wf app`: drives a Tauri app for an agent on Linux. It starts the app
// safely, as a systemd user unit under a memory cap and a time limit, reads
// and acts on the page through WebKit's remote inspector, then stops it.
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
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { clickTarget } from "./clickTarget.mjs";
import { FIND, FITS, PAGE_TEXT, QUIET, SCROLLER, SCROLL_TO, SET, words } from "./page.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Everything a run needs to know about the app, from the config and the instance number. */
export function appSettings(root, config, env = process.env) {
  const app = config.app;
  for (const key of ["name", "binary", "bundleId"]) {
    if (!app[key]) throw new Error(`app.${key} is not set in .workflow/config.json; wf app needs name, binary, and bundleId`);
  }
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
    units: {
      vite: `${app.name}-agent-vite`,
      app: instance ? `${app.name}-agent-app-${instance}` : `${app.name}-agent-app`,
    },
  };
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
export function driver(s, hooks = {}) {
  const unitActive = (unit) => sh("systemctl", ["--user", "is-active", "--quiet", unit]).ok;
  const stopUnit = (unit) => {
    sh("systemctl", ["--user", "stop", unit]);
    sh("systemctl", ["--user", "reset-failed", unit]);
  };
  const runUnit = (unit, args, { env = {}, cwd = s.root, limits = [] } = {}) => {
    stopUnit(unit);
    const setenv = Object.entries(env).flatMap(([k, v]) => ["--setenv", `${k}=${v}`]);
    const res = sh("systemd-run", ["--user", `--unit=${unit}`, "--collect", "--quiet", `--working-directory=${cwd}`, ...limits, ...setenv, ...args]);
    if (!res.ok) throw new Error(`could not start ${unit}: ${res.out}`);
  };
  const journal = (unit, lines = 40) => sh("journalctl", ["--user", "-u", unit, "-n", String(lines), "--no-pager", "-o", "cat"]).out.trim();
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

  /** One connection to the page. Messages go through Target.sendMessageToTarget. */
  async function connect() {
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
      // Other instances may still use Vite, so only the first one stops it.
      if (!s.instance) stopUnit(s.units.vite);
      if (hooks.stop) await hooks.stop(context({ env: process.env }));
      console.log("stopped");
    },

    async status() {
      for (const [name, unit] of Object.entries(s.units)) console.log(`${name}: ${unitActive(unit) ? "running" : "stopped"}`);
      console.log(`vite reachable: ${await viteUp()}`);
      console.log(`web process memory: ${webProcessRssMb()} MB (cap ${s.app.memoryMax})`);
      console.log(`state: ${JSON.stringify(loadState())}`);
    },

    async text() {
      printPage(await withPage((p) => p.evaluate(PAGE_TEXT).then(JSON.parse)));
    },

    async go([hash]) {
      if (!hash) throw new Error('usage: go "#/catalog"');
      printPage(await withPage(async (p) => {
        await p.evaluate(`location.hash = ${JSON.stringify(hash.replace(/^#?/, "#"))}`);
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
  steps: go <#hash> · click <label> [in <group>] · type <label> <value> · expect <text> · until <text> · show <text> · absent <text>
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
                await p.evaluate(`location.hash = ${JSON.stringify((rest[0] ?? "").replace(/^#?/, "#"))}`);
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
                const { dataURL } = await p.call("Page.snapshotRect", { x: 0, y: 0, width: size[0], height: size[1], coordinateSystem: "Viewport" });
                writeFileSync(out, Buffer.from(dataURL.split(",")[1], "base64"));
                console.log(`${tag}: saved ${out} (${size[0]}x${size[1]})`);
                continue;
              }
              case "page": {
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
                  const { dataURL } = await p.call("Page.snapshotRect", { x: 0, y: 0, width: size[0], height: size[1], coordinateSystem: "Viewport" });
                  const part = `${out}.part${i}.png`;
                  writeFileSync(part, Buffer.from(dataURL.split(",")[1], "base64"));
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
        const { dataURL } = await p.call("Page.snapshotRect", {
          x: 0, y: 0, width: size[0], height: size[1], coordinateSystem: "Viewport",
        });
        writeFileSync(out, Buffer.from(dataURL.split(",")[1], "base64"));
        console.log(`saved ${out} (${size[0]}x${size[1]})`);
      });
    },

    async mem() {
      console.log(`web process memory: ${webProcessRssMb()} MB (cap ${s.app.memoryMax})`);
    },

    async logs([lines = "60"]) {
      console.log(journal(s.units.app, Number(lines)) || "no app output");
    },

    async db([which, sql]) {
      const { dataHome } = loadState();
      if (!dataHome) throw new Error("db only reads the throwaway data folder; start without --real");
      const file = databasePath(s.app.databases, s.appData(dataHome), which);
      if (!existsSync(file)) throw new Error(`no database at ${file}`);
      const query = sql ?? "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name";
      console.log(execFileSync("sqlite3", ["-header", "-column", file, query], { encoding: "utf8" }).trim() || "(no rows)");
    },

    async reset() {
      stopUnit(s.units.app);
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
