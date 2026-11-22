// The lock on the screen review's record, which every worktree of a
// repository shares: how long it is waited for and what is said. The lock
// itself is lib/lock.mjs's.

import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { tryLock } from "../lock.mjs";

/** How old a lock is before it counts as left by a process that died. */
const STALE = 60_000;
/** A lock dated over a minute ahead is stale too, as after the clock was set back. */
const isStale = (age) => Math.abs(age) > STALE;
/** The longest wait: long enough for a lock just left to turn stale and be taken over. */
const WAIT = STALE + 10_000;
/** How long a wait is before it is said. */
const SAY = 2000;

/**
 * Run `change` holding the record's lock, so two worktrees that read, change,
 * and write it at once do not lose one's change. Only a lock over a minute
 * old is taken over. When the `wait` runs out first it throws, having changed
 * nothing. `change` is given `check`, to call just before it writes: it
 * throws when the lock was taken over meanwhile, such as after this computer
 * slept, so what was read before that is never written over what came after.
 */
export function withRecordLock(dir, change, { wait = WAIT } = {}) {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "record.lock");
  const started = performance.now();
  let said = false;
  let lock;
  while (!(lock = tryLock(path, isStale))) {
    const waited = performance.now() - started;
    if (waited > wait) throw new Error(`the screen record is still locked after ${Math.round(waited / 1000)} seconds, by ${path}. Nothing was written. Run this again; if it says so again and no other wf screens is running, remove that path`);
    if (!said && waited > SAY) {
      console.error("Waiting for the screen record's lock: another wf screens holds it, or one that died left it, which is taken over once a minute old.");
      said = true;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  }
  const check = () => {
    if (!lock.held()) throw new Error("the screen record's lock was taken over while this worked, as it took over a minute. Nothing was written; run this again");
  };
  try {
    return change(check);
  } finally {
    lock.release();
  }
}
