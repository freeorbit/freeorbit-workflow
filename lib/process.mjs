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

/** Whether anything answers at the address, whatever its status. */
export async function reachable(url) {
  try {
    await fetch(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ask `check` up to `tries` times, `every` ms apart, until it says yes or
 * `stop` does. Resolves with check's last answer.
 */
export async function waitFor(check, { tries, every, stop = () => false }) {
  for (let i = 0; i < tries && !stop(); i++) {
    if (await check()) return true;
    await sleep(every);
  }
  return check();
}

/** Wait for a server to answer at the address: 120 tries 250 ms apart, 30 s in all, unless `stop` says to give up. */
export const waitUntilReachable = (url, { tries = 120, every = 250, stop } = {}) => waitFor(() => reachable(url), { tries, every, stop });

/** An argument quoted for sh, unless it is plainly safe. */
export const quote = (arg) => (/^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replaceAll("'", "'\\''")}'`);

/** The shell command for one of the project's named steps, such as testdata.commands.index, or null when it has none. */
export function projectCommand(commands, name, args) {
  const base = commands[name];
  return base ? [base, ...args.map(quote)].join(" ") : null;
}
