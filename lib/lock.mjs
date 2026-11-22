// A lock that processes share: the screen review's record and the app starts
// take theirs here, each with its own stale age, wait, and message.
//
// It is a folder holding one token, a file with a name of its own for each
// holder, holding that holder's pid. A taker claims the name by making the
// empty folder, which an older kit's mkdir reads as held, then renames one
// made apart, with its token, over it; a rename cannot replace a folder that has a token. Taking over and
// letting go each remove the token they saw, by that name, and then the
// folder only if it is empty, so neither can remove a lock made since. An
// empty folder is a claim, an older kit's lock, or one a process died taking
// or letting go. A file or a link in the lock's place is removed once stale,
// as itself. Only the lock's own name is guarded so: the folder it is in is
// the caller's to keep its own. A process killed taking a lock can leave an
// empty claim, which goes stale, or a `<lock>.XXXXXX` folder, which is inert.

import { randomBytes } from "node:crypto";
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const TOKEN = /^held-[0-9a-f]{16}$/;
/** What renaming a folder into the lock's place says when something is there. */
const TAKEN = ["ENOTEMPTY", "EEXIST", "ENOTDIR"];

/** Run a file call, or null when what it works on is gone or is not what it expects. */
function unless(codes, call) {
  try {
    return call();
  } catch (error) {
    if (codes.includes(error.code)) return null;
    throw error;
  }
}

/** Remove a folder only while it is empty; whether it did. */
const removeEmpty = (path) => Boolean(unless(["ENOENT", "ENOTEMPTY", "EEXIST", "ENOTDIR"], () => (rmdirSync(path), true)));

/** What is at `path`, a link as itself, or null when nothing is. */
const statOf = (path) => unless(["ENOENT", "ENOTDIR"], () => lstatSync(path));

/** The token of what holds the lock at `path`, as a path, or null: none, empty, or not to be read. */
export function tokenIn(path) {
  if (!statOf(path)?.isDirectory()) return null;
  const name = unless(["ENOENT", "ENOTDIR", "EACCES"], () => readdirSync(path))?.find((each) => TOKEN.test(each));
  return name ? join(path, name) : null;
}

/** Remove what `stale` says is stale at `path`; whether it removed anything. */
function takeOver(path, stale) {
  const isStale = (of, token = null) => Boolean(of) && stale(Date.now() - of.mtimeMs, token && { path: token, mtimeMs: of.mtimeMs });
  const stat = statOf(path);
  if (!stat) return false;
  if (!stat.isDirectory()) {
    if (!isStale(stat)) return false;
    try {
      unlinkSync(path);
      return true;
    } catch (error) {
      if (error.code === "ENOENT" || error.code === "EISDIR") return false;
      // A Mac says EPERM of a folder, a lock made since; of a file, it is no permission.
      if (error.code === "EPERM" && (statOf(path)?.isDirectory() ?? true)) return false;
      throw error;
    }
  }
  // One that cannot be read is held: the caller's wait says what to remove.
  const inside = unless(["ENOENT", "ENOTDIR", "EACCES"], () => readdirSync(path));
  if (!inside) return false;
  // Its age is read after the folder was, so an empty lock made meanwhile reads as new.
  if (!inside.length) return isStale(statOf(path)) && removeEmpty(path);
  let removed = false;
  for (const name of inside.filter((each) => TOKEN.test(each))) {
    const token = join(path, name);
    const held = statOf(token);
    if (!held || held.isDirectory() || !isStale(held, token) || !unless(["ENOENT"], () => (unlinkSync(token), true))) continue;
    removeEmpty(path);
    removed = true;
  }
  return removed;
}

/** Take the lock if nothing is there: its token's path, else null. */
function take(path) {
  if (!unless(["EEXIST"], () => (mkdirSync(path, { mode: 0o700 }), true))) return null;
  const name = `held-${randomBytes(8).toString("hex")}`;
  let made;
  try {
    made = mkdtempSync(`${path}.`);
    writeFileSync(join(made, name), String(process.pid), { flag: "wx" });
    renameSync(made, path);
    return join(path, name);
  } catch (error) {
    if (made) rmSync(made, { recursive: true, force: true });
    removeEmpty(path);
    if (TAKEN.includes(error.code)) return null;
    throw error;
  }
}

/**
 * Take the lock at `path`, whose folder is there already, now or not at all:
 * null while it is held, and one the caller's `stale` says is stale, of its
 * age in milliseconds (under zero when dated ahead of the clock) and, for a
 * holder's token, of that token as { path, mtimeMs }, is taken over. The
 * caller does the waiting, in its own way. The lock it gives is { token,
 * held, release }: `token` is its file, `held()` says whether it is still
 * this one's, and `release()` lets go of this one's only, however often it
 * is called.
 */
export function tryLock(path, stale) {
  for (;;) {
    const token = take(path);
    if (token) {
      return {
        token,
        held: () => Boolean(statOf(token)),
        release() {
          if (unless(["ENOENT", "ENOTDIR"], () => (unlinkSync(token), true))) removeEmpty(path);
        },
      };
    }
    if (!takeOver(path, stale)) return null;
  }
}
