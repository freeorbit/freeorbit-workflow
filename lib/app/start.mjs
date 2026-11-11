// How `wf app` starts the app safely: the web kind's shared servers and this
// instance's Chromium, or the tauri kind's shared Vite and debug binary,
// each as a unit under the memory cap and time limit, then waiting for a
// page that has rendered and stays. Instances share a server through a lock
// folder; the project's prepare hook runs first.

import { chmodSync, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

import { chromiumArgs, headlessFor, viewport } from "./appsettings.mjs";
import { PAGE_TEXT } from "./page.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Run `work` while holding a lock folder other instances share. mkdir is atomic,
 * so one holder at a time; a lock older than staleMs, left by a run that was
 * killed, is taken over.
 */
export async function withLock(dir, work, { waitMs = 60_000, staleMs = 120_000, pause = sleep } = {}) {
  mkdirSync(dirname(dir), { recursive: true, mode: 0o700 });
  const end = Date.now() + waitMs;
  for (;;) {
    try {
      mkdirSync(dir, { mode: 0o700 });
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (Date.now() - (statSync(dir, { throwIfNoEntry: false })?.mtimeMs ?? Date.now()) > staleMs) {
        rmSync(dir, { recursive: true, force: true });
        continue;
      }
      if (Date.now() > end) throw new Error(`${dir} is held by another start; remove it if nothing is starting`);
      await pause(100);
    }
  }
  try {
    return await work();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Start a server unit the instances share. A parallel screen run starts its
 * apps at once, so each may find the server down and start the same unit; the
 * one that loses finds it active and waits for it like the others.
 */
export function startShared(runner, unit, start) {
  if (runner.active(unit)) return;
  try {
    start();
  } catch (error) {
    if (!runner.active(unit)) throw error;
  }
}

/**
 * The starts for one app and instance. `d` is the driver's wiring: the
 * settings, hooks, runner and its unit helpers, the state file, and the page
 * tools a start waits on.
 */
export function starter(d) {
  const { s, hooks, runner, runUnit, stopUnit, unitActive, journal, saveState, viteUp, webProcessRssMb, withPage, printPage, reachable, sh, caps, serverUnits } = d;

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
      // One instance at a time checks, starts, and waits for each shared server, since starting a unit first stops it.
      await withLock(join(s.locks, unit), async () => {
        if (server.url && (await reachable(server.url))) return;
        startShared(runner, unit, () => runUnit(unit, server.command, { cwd: join(s.root, server.cwd ?? "."), env: { PATH: process.env.PATH, ...(ready.env ?? {}), ...(server.env ?? {}) }, limits: caps }));
        if (!server.url) return;
        for (let i = 0; i < 120 && !(await reachable(server.url)); i++) await sleep(250);
        if (!(await reachable(server.url))) throw new Error(`${server.name} did not answer at ${server.url}:\n${journal(unit)}`);
      });
    }
    const sizeAt = args.indexOf("--size");
    const size = sizeAt >= 0 ? viewport(s.app, args[sizeAt + 1]) : s.size;
    const env = {};
    for (const key of ["WAYLAND_DISPLAY", "DISPLAY", "XDG_RUNTIME_DIR"]) if (process.env[key]) env[key] = process.env[key];
    const headless = headlessFor(s.app, args);
    if (!headless && !env.DISPLAY && !env.WAYLAND_DISPLAY) throw new Error("this start is headed (app.web.headless off, or --headed), but there is no DISPLAY or WAYLAND_DISPLAY");
    runUnit(s.units.app, chromiumArgs(s, size, headless), { env, limits: caps });
    saveState({ kind: "web", size, ...(ready.state ?? {}), startedAt: new Date().toISOString() });
    let last = null;
    for (let i = 0; i < 60; i++) {
      await sleep(500);
      if (!unitActive(s.units.app)) throw new Error(`Chromium exited:\n${journal(s.units.app)}`);
      try {
        const page = await withPage((p) => p.evaluate(PAGE_TEXT).then(JSON.parse));
        if (page.text.trim() && last && page.text === last.text && page.url === last.url) {
          console.log(`started (${headless ? "headless" : "on your screen"}, ${size.join("x")}${ready.note ? `, ${ready.note}` : ""})`);
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


  /** Start the shared Vite if it is not up, so parallel instances do not each start it. */
  async function vite() {
    if (!(await viteUp())) {
      runUnit(s.units.vite, s.app.vite.command, { cwd: join(s.root, s.app.vite.cwd), env: { PATH: process.env.PATH } });
      for (let i = 0; i < 40 && !(await viteUp()); i++) await sleep(250);
      if (!(await viteUp())) throw new Error(`Vite did not start:\n${journal(s.units.vite)}`);
    }
  }

  /** The tauri kind's start: the shared Vite, then this instance's debug binary on a throwaway data folder. */
  async function startTauri(args) {
    const fresh = args.includes("--fresh");
    const real = args.includes("--real");
    if (!existsSync(s.binary)) throw new Error(`no app binary at ${s.binary}; build it first`);

    const dataHome = real ? null : s.data;
    if (fresh && dataHome) rmSync(dataHome, { recursive: true, force: true });
    if (dataHome) mkdirSync(dataHome, { recursive: true });

    const env = { WEBKIT_INSPECTOR_HTTP_SERVER: s.inspector, RUST_BACKTRACE: "1" };
    const ready = hooks.prepare ? ((await hooks.prepare(context({ args, fresh, real, dataHome, env: process.env }))) ?? {}) : {};

    await vite();

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
  }

  return { vite, startWeb, startTauri, lockSeenData, context };
}
