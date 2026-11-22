// A holder of one of the app's locks that is still working: it beats, and a
// waiter tells it from one that died.
//
// The beat is a thread of its own (beat.mjs), since a hook may hold the lock
// across a synchronous build that blocks this one; a holder killed stops
// beating with its process. A holder whose token is stale but whose process
// is there, as just after the computer slept, gets a few beats to show it
// works. So a pid another process has now costs those beats and no more, and
// a process stopped for good is taken over as a killed one is. A build whose
// wf was killed beats no more, though the build may still run.

import { closeSync, constants, openSync, readSync, statSync } from "node:fs";
import { Worker } from "node:worker_threads";

import { tokenIn } from "../lock.mjs";
import { alive } from "../process.mjs";

/** How old a lock is before it counts as left by a process that died. */
export const STALE_MS = 120_000;
/** How often a holder beats: well inside the stale age. */
export const BEAT_MS = 5000;
/** How many beats a stale holder whose process is there gets to show it works. */
const GRACE_BEATS = 3;
/** The longest wait for the thread to run, on a busy computer. */
const BEAT_START_MS = 10_000;

/**
 * Beat for the lock at `folder` held by `token` until the function returned
 * is called, or this process ends. It returns only once the thread runs, as
 * the caller may block this one at once, and throws when it does not: a lock
 * that cannot beat would be taken over under its holder.
 */
export function beat(folder, token, every = BEAT_MS) {
  const ready = new SharedArrayBuffer(4);
  // Its own, empty environment and flags: a hook's NODE_OPTIONS is for its children.
  const worker = new Worker(new URL("./beat.mjs", import.meta.url), { env: {}, execArgv: [], workerData: { token, folder, every, ready } });
  // Said by the throw below; with the main thread blocked, an error event is heard too late to matter.
  worker.on("error", () => {});
  worker.unref();
  if (Atomics.wait(new Int32Array(ready), 0, 0, BEAT_START_MS) === "timed-out") {
    worker.terminate();
    throw new Error(`${folder} cannot be kept fresh: its thread did not start, such as in a working folder since removed. The lock was let go; run this again from a folder that is there`);
  }
  return () => void worker.terminate();
}

/** The pid a token holds: 0 for none, such as an older kit's empty one; -1 when it cannot be read, so cannot be called dead. */
function pidIn(token) {
  let file;
  try {
    file = openSync(token, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const head = Buffer.alloc(16);
    const text = head.toString("utf8", 0, readSync(file, head, 0, head.length, 0));
    return /^[1-9]\d{0,9}$/.test(text) ? Number(text) : 0;
  } catch (error) {
    return ["ENOENT", "ENOTDIR", "ELOOP", "EISDIR"].includes(error.code) ? 0 : -1;
  } finally {
    if (file !== undefined) closeSync(file);
  }
}

/**
 * Whether what holds a lock is dead, for one waiter, as tryLock asks: stale,
 * and either no process of its pid, or one that did not beat for a few beats
 * since this waiter first saw it stale.
 */
export function deadHolder(staleMs, every = BEAT_MS) {
  const seen = new Map();
  return (age, token) => {
    if (age <= staleMs) return false;
    if (!token) return true;
    const pid = pidIn(token.path);
    if (pid === 0 || (pid > 0 && !alive(pid))) return true;
    const key = `${token.path} ${token.mtimeMs}`;
    if (!seen.has(key)) seen.set(key, performance.now());
    return performance.now() - seen.get(key) > GRACE_BEATS * every;
  };
}

/** Who holds the lock, as { token, pid }, its pid 0 unless that process runs; null when no token is there. */
export function holderOf(folder) {
  const token = tokenIn(folder);
  if (!token) return null;
  const pid = pidIn(token);
  return { token, pid: pid > 0 && alive(pid) ? pid : 0 };
}

/** Whether a lock is there and fresh, as a working holder's is: `wf disk` leaves it be. */
export function heldLately(folder) {
  const stat = statSync(folder, { throwIfNoEntry: false });
  return Boolean(stat) && Date.now() - stat.mtimeMs <= STALE_MS;
}
