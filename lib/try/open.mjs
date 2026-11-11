// How `wf try` opens the app for a person, by `app.kind`, in the foreground,
// until they close it:
//
//   tauri  the project's dev command (`app.try.command`), with the throwaway
//          folder as its data home (XDG_DATA_HOME), so hot reload works as usual
//   web    the project's servers (`app.web.servers`) with the scenario's
//          settings, then a browser window on a profile of its own in the
//          folder, so the scenario's cookies and sign-ins never meet the
//          person's own browser
//
// Ctrl-C, or closing the window, stops everything it started.

import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { browserFor } from "../platform.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const reachable = async (url) => {
  try {
    await fetch(url);
    return true;
  } catch {
    return false;
  }
};

/** The browser window's arguments: visible, on its own profile, at the window size. */
export function browserArgs(s, browser, home) {
  return [
    browser,
    ...(s.app.web.sandbox ? [] : ["--no-sandbox"]),
    "--no-first-run",
    "--no-default-browser-check",
    `--user-data-dir=${join(home, "browser")}`,
    `--window-size=${s.size.join(",")}`,
    "--new-window",
    s.app.web.url,
  ];
}

/** The steps that open the app, to print beside the project's own. */
export function openSteps(s, home) {
  if (!s.web) return [`XDG_DATA_HOME=${home} ${s.app.try.command.join(" ")}`];
  return [...s.app.web.servers.map((server) => `(cd ${server.cwd ?? "."} && ${server.command.join(" ")})`), `<browser> --user-data-dir=${join(home, "browser")} ${s.app.web.url}`];
}

const SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"];

/** Wait for a child to exit; Ctrl-C, or the terminal closing, passes to it. Resolves with its exit code. */
function foreground(child, stopAll) {
  return new Promise((done) => {
    const onSignal = (signal) => stopAll(signal);
    for (const signal of SIGNALS) process.on(signal, onSignal);
    const finish = (code) => {
      for (const signal of SIGNALS) process.off(signal, onSignal);
      done(code);
    };
    child.on("error", (error) => {
      console.error(`error: ${error.message}`);
      finish(1);
    });
    child.on("exit", (code) => finish(code ?? 0));
  });
}

const running = (child) => Boolean(child.pid) && child.exitCode === null && child.signalCode == null;

/** Signal a detached child's whole group: a dev server's own children too. */
function signalGroup(child, signal) {
  if (!running(child)) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    // Already gone.
  }
}

/** Stop each group, and kill what is still running after a grace period. */
export async function stopGroups(children, graceMs = 3000) {
  for (const child of children) signalGroup(child, "SIGTERM");
  for (let waited = 0; waited < graceMs && children.some(running); waited += 100) await sleep(100);
  for (const child of children) signalGroup(child, "SIGKILL");
}

/**
 * Open the app for a person in the foreground, by app.kind, with the
 * scenario's settings, and stop all it started when they close it. Resolves
 * with the exit code.
 */
export async function openApp(s, config, home, ready, log, { launch = spawn, cancelled = () => false } = {}) {
  const env = { ...process.env, ...(ready.env ?? {}) };
  if (!s.web) {
    log("\nStarting the app. Your real data folder is not used. Close the window to stop.\n");
    const app = launch(s.app.try.command[0], s.app.try.command.slice(1), { cwd: s.root, stdio: "inherit", env: { ...env, XDG_DATA_HOME: home } });
    return foreground(app, (signal) => app.kill(signal));
  }

  const logs = join(home, "logs");
  mkdirSync(logs, { recursive: true });
  const started = [];
  const stopAll = () => {
    for (const child of started) signalGroup(child, "SIGTERM");
  };
  try {
    for (const server of s.app.web.servers) {
      if (server.url && (await reachable(server.url))) {
        log(`${server.name} already answers at ${server.url}; it was not started with this scenario's settings.`);
        continue;
      }
      const file = join(logs, `${server.name}.log`);
      const out = openSync(file, "w");
      const child = launch(server.command[0], server.command.slice(1), { cwd: join(s.root, server.cwd ?? "."), env: { ...env, ...(server.env ?? {}) }, stdio: ["ignore", out, out], detached: true });
      closeSync(out);
      let failed = null;
      child.on("error", (error) => (failed = error));
      started.push(child);
      log(`${server.name}: started, its output in ${file}`);
      // A missing program fails on the next turn, url or not.
      await sleep(100);
      if (failed) throw new Error(`${server.name} could not start: ${failed.message}`);
      if (!server.url) continue;
      for (let i = 0; i < 120 && child.exitCode === null && !cancelled() && !(await reachable(server.url)); i++) await sleep(250);
      if (cancelled()) throw new Error("stopped before the app opened");
      if (failed) throw new Error(`${server.name} could not start: ${failed.message}`);
      if (!(await reachable(server.url))) throw new Error(`${server.name} did not answer at ${server.url}:\n${readFileSync(file, "utf8").split("\n").slice(-20).join("\n")}`);
    }
    const args = browserArgs(s, browserFor(config), home);
    const out = openSync(join(logs, "browser.log"), "w");
    const browser = launch(args[0], args.slice(1), { env, stdio: ["ignore", out, out], detached: true });
    closeSync(out);
    started.push(browser);
    log(`\nOpened ${s.app.web.url} in a browser window of its own. Your own browser's data is not used. Quit that browser, or press Ctrl-C here, to stop.\n`);
    return await foreground(browser, stopAll);
  } finally {
    await stopGroups(started);
  }
}
