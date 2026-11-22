// How `wf app` starts the app safely: the web kind's shared servers and this
// instance's Chromium, or the tauri kind's shared Vite and debug binary,
// each as a unit under the memory cap and time limit, then waiting for a
// page that has rendered and stays. Instances share a server through a lock
// folder; the project's prepare hook runs first.

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

import { waitForStablePage } from "../browser/settle.mjs";
import { tryLock } from "../lock.mjs";
import { ANSWER_MS, askServer, ownFolder, sleep, waitUntilReachable } from "../process.mjs";
import { chromiumArgs, headlessFor, hookContext, viewport } from "./appsettings.mjs";
import { PAGE_TEXT } from "./page.mjs";
import { exitCause } from "./cause.mjs";
import { BEAT_MS, beat, deadHolder, holderOf, STALE_MS } from "./holder.mjs";

/** How long a wait is before it is said. */
const SAY_MS = 10_000;
/** The longest wait for one holder of a shared server's lock: past a stale one's takeover, and past the longest start. */
export const START_WAIT_MS = 150_000;
/** The longest wait for one holder of the shared data path: as long as a build may take, app.build's included. */
export const DATA_WAIT_MS = 30 * 60_000;
/** The most one look adds to a wait, so time the computer slept, or a clock set on, is not waited. */
const LOOK_MS = 1000;

/**
 * Take a lock folder other instances share (lib/lock.mjs), and resolve with
 * its release, which frees this holder's lock only. The holder beats
 * (holder.mjs), so one still working keeps it however long that takes; one
 * older than staleMs that does not beat, as left by a run that was killed, is
 * taken over, and a lock dated ahead of the clock is waited for. waitMs is
 * for each holder, so a queue that moves is waited out. A wait of a while
 * says so. Any error but "it is held", such as no permission, is thrown at
 * once.
 */
export async function acquireLock(dir, { waitMs = START_WAIT_MS, staleMs = STALE_MS, beatMs = BEAT_MS, sayMs = SAY_MS, pause = sleep, held = `${dir} is held by another start; remove it if nothing is starting` } = {}) {
  mkdirSync(dirname(dir), { recursive: true, mode: 0o700 });
  const dead = deadHolder(staleMs, beatMs);
  let looked = performance.now();
  let waited = 0;
  let inAll = 0;
  let said = false;
  let holder = null;
  for (;;) {
    const lock = tryLock(dir, dead);
    if (lock) return holding(dir, lock, beatMs);
    const now = holderOf(dir);
    if (now && now.token !== holder?.token) {
      if (holder) waited = 0;
      holder = now;
    }
    const since = Math.min(performance.now() - looked, LOOK_MS);
    looked = performance.now();
    waited += since;
    inAll += since;
    if (waited > waitMs) {
      if (!now?.pid) throw new Error(held);
      throw new Error(`${dir} stayed locked: it is held by another start, pid ${now.pid}, which is still running. If that hangs, stop it; do not remove the lock while it works`);
    }
    if (!said && inAll > sayMs) {
      console.error(`Waiting for ${dir}, held by ${now?.pid ? `pid ${now.pid}, which runs` : "a start that may have died"}: up to ${Math.ceil(waitMs / 60_000)} min for each holder.`);
      said = true;
    }
    await pause(100);
  }
}

/** A lock just taken, kept fresh until the release it resolves with. */
function holding(dir, lock, beatMs) {
  let stop;
  try {
    stop = beat(dir, lock.token, beatMs);
  } catch (error) {
    lock.release();
    throw error;
  }
  let done = false;
  return () => {
    if (done) return;
    done = true;
    stop();
    if (!lock.held()) console.error(`${dir} was removed or taken over while this worked, so another start may have worked beside it.`);
    lock.release();
  };
}

/** Run `work` while holding a lock folder other instances share (acquireLock). */
export async function withLock(dir, work, options) {
  const release = await acquireLock(dir, options);
  try {
    return await work();
  } finally {
    release();
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
  const { s, hooks, runner, runUnit, stopUnit, unitActive, journal, saveState, webProcessRssMb, withPage, printPage, caps, serverUnits, answerMs = ANSWER_MS } = d;
  const readPage = () => withPage((p) => p.evaluate(PAGE_TEXT).then(JSON.parse));

  /** The web kind's start: the project's servers, shared by every instance, then this instance's Chromium. */
  async function startWeb(args) {
    const fresh = args.includes("--fresh");
    stopUnit(s.units.app);
    // Something else on the debugging port, such as the person's own Chromium, is never driven.
    // A browser too busy to answer is there as much as one that answers.
    if ((await askServer(`http://127.0.0.1:${s.debugPort}/json/version`, { timeout: answerMs })) !== "down") throw new Error(`something already listens on port ${s.debugPort}, and it is not this run's browser; stop it, or set app.web.debugPort`);
    if (fresh) rmSync(s.profile, { recursive: true, force: true });
    // The profile sits in /tmp, so it is the user's own and no one else's.
    ownFolder(s.state);
    ownFolder(s.profile);
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
    // The locks sit in /tmp too, so their folder is the user's own before one is taken.
    ownFolder(s.locks);
    for (const server of s.app.web.servers) {
      const unit = s.units[`server:${server.name}`];
      // One instance at a time checks, starts, and waits for each shared server, since starting a unit first stops it.
      await withLock(join(s.locks, unit), async () => {
        const found = server.url ? await askServer(server.url, { timeout: answerMs }) : "down";
        if (found === "up") return;
        // Something slow is there: it is waited for, and never stopped or started beside.
        if (found === "silent") {
          if (await waitUntilReachable(server.url)) return;
          throw new Error(`${server.name} takes connections at ${server.url} and did not answer; it was not started again. Stop what listens there if it hangs`);
        }
        startShared(runner, unit, () => runUnit(unit, server.command, { cwd: join(s.root, server.cwd ?? "."), env: { PATH: process.env.PATH, ...(ready.env ?? {}), ...(server.env ?? {}) }, limits: caps }));
        if (!server.url) return;
        if (!(await waitUntilReachable(server.url))) throw new Error(`${server.name} did not answer at ${server.url}:\n${journal(unit)}`);
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
    const page = await waitForStablePage(readPage, {
      alive: () => {
        if (!unitActive(s.units.app)) throw new Error(exited("Chromium", s.units.app));
      },
    });
    if (page) {
      console.log(`started (${headless ? "headless" : "on your screen"}, ${size.join("x")}${ready.note ? `, ${ready.note}` : ""})`);
      printPage(page);
      return;
    }
    throw new Error(`the page did not settle in 30s (Chromium ${webProcessRssMb()} MB):\n${journal(s.units.app)}`);
  }

  /**
   * Hold the shared data path while a second instance builds data there.
   * Resolves with the release. It waits as long as a build may take, since
   * the holder keeps it while it works. The first instance's folder may not exist yet,
   * such as after a reboot when only second instances run, so it is made
   * here, and refused when it is a link or another account's.
   */
  async function lockSeenData() {
    ownFolder(dirname(s.seenData));
    const lock = `${s.seenData}.lock`;
    return acquireLock(lock, { waitMs: DATA_WAIT_MS, held: `the shared data path stayed locked; remove ${lock} if no run is going` });
  }

  const context = (extra) => hookContext(s, { lockSeenData, ...extra });

  /** Start the shared Vite if it is not up, so parallel instances do not each start it. */
  async function vite() {
    const found = await askServer(s.viteUrl, { timeout: answerMs, ok: true });
    if (found === "up") return;
    if (found === "down") {
      runUnit(s.units.vite, s.app.vite.command, { cwd: join(s.root, s.app.vite.cwd), env: { PATH: process.env.PATH } });
    }
    if (!(await waitUntilReachable(s.viteUrl, { tries: 40, ok: true }))) throw new Error(`Vite did not start:\n${journal(s.units.vite)}`);
  }

  /**
   * A unit that exited during start: its cause first, read from enough of its
   * log to reach a panic under a backtrace, then its last lines.
   */
  const exited = (what, unit) => `${what} exited: ${exitCause(journal(unit, 400))}\n${journal(unit)}`;

  /** The tauri kind's start: the shared Vite, then this instance's debug binary on a throwaway data folder. */
  async function startTauri(args) {
    const fresh = args.includes("--fresh");
    const real = args.includes("--real");
    if (!existsSync(s.binary)) throw new Error(`no app binary at ${s.binary}; build it first`);

    const dataHome = real ? null : s.data;
    // The state folder sits in /tmp, so it is made this user's alone first.
    ownFolder(s.state);
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
    if (s.instance) {
      ownFolder(dirname(s.seenData));
      mkdirSync(s.seenData, { recursive: true });
    }
    runUnit(s.units.app, [s.binary], {
      env,
      limits: [...caps, ...s.mount],
    });
    saveState({ dataHome, ...(ready.state ?? {}), startedAt: new Date().toISOString() });

    // A debug build may rewrite generated code at launch, which makes Vite
    // reload the page once. Wait for a page that has rendered and stays.
    const page = await waitForStablePage(readPage, {
      alive: () => {
        if (!unitActive(s.units.app)) throw new Error(exited("the app", s.units.app));
      },
    });
    if (page) {
      console.log(`started (on your screen${ready.note ? `, ${ready.note}` : ""}, data: ${dataHome ?? "real data folder"})`);
      printPage(page);
      return;
    }
    const log = journal(s.units.app);
    // A failed start leaves nothing running, as startWeb's does (TA-8).
    stopUnit(s.units.app);
    throw new Error(`the page did not settle in 30s (web process ${webProcessRssMb()} MB):\n${log}`);
  }

  return { vite, startWeb, startTauri, lockSeenData, context };
}
