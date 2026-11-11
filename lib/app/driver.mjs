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

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { reachable, sh, sleep } from "../process.mjs";
import { appSettings, databasePath, psqlCall, shotPath } from "./appsettings.mjs";
import { clickTarget } from "./clickTarget.mjs";
import { goBack, pages } from "./inspector.mjs";
import { FIND, PAGE_TEXT, SET } from "./page.mjs";
import { runnerFor } from "./runner.mjs";
import { starter } from "./start.mjs";
import { runSteps, USAGE } from "./steps.mjs";

/**
 * The driver's commands for one app and instance. This wires the runner, the
 * state file, the page tools (inspector.mjs), the starts (start.mjs), and the
 * run interpreter (steps.mjs) together; each command is short.
 */
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

  const { connect, withPage, capture, settle, navigate } = pages(s, loadState);
  const printPage = (page) => console.log(`url: ${page.url}\n---\n${page.text}`);
  const caps = ["-p", `MemoryMax=${s.app.memoryMax}`, "-p", "MemorySwapMax=0", "-p", `RuntimeMaxSec=${s.app.runtimeMaxSec}`];
  const serverUnits = () => Object.entries(s.units).filter(([name]) => name.startsWith("server:")).map(([, unit]) => unit);

  const d = { s, hooks, runner, runUnit, stopUnit, unitActive, journal, saveState, loadState, viteUp, webProcessRssMb, connect, withPage, capture, settle, navigate, printPage, caps, serverUnits };
  const { vite, startWeb, startTauri, context } = starter(d);
  const STATE = s.state;

  const commands = {
    /** Start the shared Vite if it is not up, so parallel instances do not each start it. */
    vite,

    async start(args) {
      return s.web ? startWeb(args) : startTauri(args);
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

    async back() {
      printPage(await withPage((p) => goBack(p, settle)));
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
      if (steps.length === 0) throw new Error(USAGE);
      await withPage((p) => runSteps(p, steps, d));
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

    async screenshot([path = join(STATE, "screenshot.png")]) {
      const out = shotPath(s, path);
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
