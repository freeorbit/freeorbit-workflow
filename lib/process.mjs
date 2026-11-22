// Running things from the kit: the project's own commands, quoted for sh, a
// program's output, and waiting for a server or a page to come up. wf app,
// wf try, wf design, wf testdata, and wf release share these.

import { spawnSync } from "node:child_process";
import { chmodSync, lstatSync, mkdirSync, readFileSync } from "node:fs";

/**
 * Make a folder this user's alone, or refuse it: one in a shared place such
 * as /tmp that another account made first, or a link, could be read or
 * written by them. Resolves to the folder.
 */
export function ownFolder(dir) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stat = lstatSync(dir);
  if (!stat.isDirectory()) throw new Error(`${dir} is a link or a file, not a folder; remove it`);
  if (typeof process.getuid === "function" && stat.uid !== process.getuid()) throw new Error(`${dir} belongs to another user; remove it`);
  if (stat.mode & 0o077) chmodSync(dir, 0o700);
  return dir;
}

// A large project lists more paths than Node's 1 MiB default output, so git's is 64 MiB (TB-2).
const GIT_OUTPUT = 64 * 1024 * 1024;

/**
 * Run git in `root` and give its output. A failure throws with git's own
 * message; with `quiet`, it gives "" instead, for a question whose answer
 * may be none, such as the branch of a detached HEAD.
 */
export function git(root, args, { quiet = false } = {}) {
  const res = spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: GIT_OUTPUT });
  if (res.status === 0) return res.stdout;
  if (quiet) return "";
  throw new Error(`git ${args[0]} failed: ${String(res.stderr || res.error?.message || `exit ${res.status}`).trim()}`);
}

/** A flag's value, or null when it is not given; a flag with no value after it is an error that says so (TB-7). */
export function flagValue(args, name) {
  const at = args.indexOf(name);
  if (at < 0) return null;
  const value = args[at + 1];
  if (value == null || value === "" || value.startsWith("--")) throw new Error(`${name} needs a value`);
  return value;
}

/** A JSON file's value; a file that is not JSON throws a sentence that names it and says what to do (TB-11). */
export function readJsonFile(path, shown = path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if (error.code) throw error;
    throw new Error(`${shown} is not valid JSON (${error.message}); fix it, then run the command again`);
  }
}

/** Resolve after ms. */
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Run a program and wait: whether it exited 0, and its output and errors together. */
export function sh(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { encoding: "utf8", ...opts });
  return { ok: res.status === 0, out: (res.stdout ?? "") + (res.stderr ?? "") };
}

/** Whether a process is running, by its id. */
export function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: it runs, as another user.
    return error.code === "EPERM";
  }
}

/** The longest a check waits for a server's answer. A server that takes longer is silent, not down. */
export const ANSWER_MS = 15_000;
/** The longest one ask waits while a server comes up, before it is asked again. */
const ASK_MS = 30_000;
/** The longest wait for a server that listens and has not answered yet, such as through its first compile. */
export const SILENT_MS = 90_000;

/**
 * Ask a server once: "up" when it answers, whatever its status, or with `ok`
 * only a good one; "silent" when something took the ask and had not answered
 * in `timeout`, or `stop` said to give up first; "down" otherwise, such as a
 * refused connection. A silent server is there: nothing starts in its place.
 */
export async function askServer(url, { timeout = ANSWER_MS, ok = false, stop = () => false } = {}) {
  const ask = new AbortController();
  const over = setTimeout(() => ask.abort(), timeout);
  const stopped = setInterval(() => stop() && ask.abort(), 250);
  try {
    const response = await fetch(url, { signal: ask.signal });
    response.body?.cancel().catch(() => {});
    return !ok || response.ok ? "up" : "down";
  } catch {
    return ask.signal.aborted ? "silent" : "down";
  } finally {
    clearTimeout(over);
    clearInterval(stopped);
  }
}

/** Whether anything answers at the address within `timeout`, whatever its status. */
export async function reachable(url, timeout = ANSWER_MS) {
  return (await askServer(url, { timeout })) === "up";
}

/**
 * Wait for a server to answer at the address: 30 seconds while nothing is
 * there (`tries`, `every` ms apart), and `silentMs` in all while it listens
 * without answering. With `ok`, only a good answer counts. When `stop` says
 * to give up it asks once more, for a second, since a launcher may end once
 * its server is up.
 */
export async function waitUntilReachable(url, { tries = 120, every = 250, silentMs = SILENT_MS, ok = false, stop = () => false } = {}) {
  const began = performance.now();
  const spent = () => performance.now() - began;
  for (;;) {
    if (stop()) return (await askServer(url, { timeout: 1000, ok })) === "up";
    const left = silentMs - spent();
    if (left <= 0) return false;
    const got = await askServer(url, { timeout: Math.min(ASK_MS, left), ok, stop });
    if (got === "up") return true;
    if (stop()) continue;
    if (got === "down" && spent() > tries * every) return false;
    await sleep(every);
  }
}

/** An argument quoted for sh, unless it is plainly safe. */
export const quote = (arg) => (/^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", "'\\''")}'`);

/** The shell command for one of the project's named steps, such as testdata.commands.index, or null when it has none. */
export function projectCommand(commands, name, args) {
  const base = commands[name];
  return base ? [base, ...args.map(quote)].join(" ") : null;
}
