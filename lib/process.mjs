// Running things from the kit: the project's own commands, quoted for sh, a
// program's output, and waiting for a server or a page to come up. wf app,
// wf try, wf design, wf testdata, and wf release share these.

import { spawnSync } from "node:child_process";

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
