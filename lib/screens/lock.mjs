// The lock on the screen review's record, which every worktree of a
// repository shares: a folder holding one token, a file with a name of its
// own for each holder. It is made apart and renamed into place, so it is
// never there without its token. Taking over and letting go each remove the
// token they saw, by that name, and then the folder only if it is empty, so
// neither can remove a lock made since. An empty folder is an older kit's
// lock, or one a process died letting go.

import { randomBytes } from "node:crypto";
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmdirSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** How old a lock is before it counts as left by a process that died. */
const STALE = 60_000;
/** The longest wait: long enough for a lock just left to turn stale and be taken over. */
const WAIT = STALE + 10_000;
/** How long a wait is before it is said. */
const SAY = 2000;
const TOKEN = /^held-[0-9a-f]{16}$/;

/** Run a file call, or null when what it works on is gone or is not what it expects. */
function unless(codes, call) {
  try {
    return call();
  } catch (error) {
    if (codes.includes(error.code)) return null;
    throw error;
  }
}

/** Remove a folder only while it is empty. */
const removeEmpty = (path) => unless(["ENOENT", "ENOTEMPTY", "EEXIST", "ENOTDIR"], () => rmdirSync(path));

/** Whether a token, or an empty lock, is over a minute from now, either way, as after the clock was set back. */
function isStale(path) {
  const stat = statSync(path, { throwIfNoEntry: false });
  return Boolean(stat) && Math.abs(Date.now() - stat.mtimeMs) > STALE;
}

/** Remove the lock at `path` if what holds it is stale. */
function takeOver(path) {
  const inside = unless(["ENOENT", "ENOTDIR"], () => readdirSync(path));
  if (!inside) return;
  if (!inside.length) {
    if (isStale(path)) removeEmpty(path);
    return;
  }
  for (const token of inside.filter((name) => TOKEN.test(name))) {
    if (!isStale(join(path, token))) continue;
    unless(["ENOENT"], () => unlinkSync(join(path, token)));
    removeEmpty(path);
  }
}

/** Take the lock if nothing is there: its token's path, else null. */
function take(path) {
  if (lstatSync(path, { throwIfNoEntry: false })) return null;
  const made = mkdtempSync(`${path}.`);
  const token = `held-${randomBytes(8).toString("hex")}`;
  try {
    writeFileSync(join(made, token), "");
    renameSync(made, path);
    return join(path, token);
  } catch (error) {
    rmSync(made, { recursive: true, force: true });
    if (["ENOTEMPTY", "EEXIST", "ENOTDIR"].includes(error.code)) return null;
    throw error;
  }
}

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
  let token;
  while (!(token = take(path))) {
    takeOver(path);
    const waited = performance.now() - started;
    if (waited > wait) throw new Error(`the screen record is still locked after ${Math.round(waited / 1000)} seconds, by ${path}. Nothing was written. Run this again; if it says so again and no other wf screens is running, remove that path`);
    if (!said && waited > SAY) {
      console.error("Waiting for the screen record's lock: another wf screens holds it, or one that died left it, which is taken over once a minute old.");
      said = true;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  }
  const check = () => {
    if (!statSync(token, { throwIfNoEntry: false })) throw new Error("the screen record's lock was taken over while this worked, as it took over a minute. Nothing was written; run this again");
  };
  try {
    return change(check);
  } finally {
    const gone = unless(["ENOENT", "ENOTDIR"], () => (unlinkSync(token), true));
    if (gone) removeEmpty(path);
  }
}
