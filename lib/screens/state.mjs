// Where the screen review stands, kept on this computer in the main
// checkout's .cache/screens/state.json, which every worktree of it shares:
//
//   version   2
//   marks     each screen's pictures, by name, to the commit each was last
//             accepted at: { "gm-accounts": { "wide-default": "95a6c8c..." } }.
//             A picture is due when a change that reaches its screen landed
//             after its own mark, so an accepted run moves what it took, the
//             screens it could not reach, and those nothing has reached since
//             their marks: a light run, one area, a chunk, or some screens.
//   pending   screens a partial accept left open before marks, each due until
//             an accept takes it, whatever changed since
//   last      the commit the last chunk-end run (light or deep) was shot at
//   deferred  how many chunk ends deferred the review since one ran, and the last
//
// A state from before version 2 kept one mark for every screen (last and
// deep), the light runs since the last deep one, and the screens a partial
// accept left open; fromV1 turns it into marks.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmdirSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { writeWhole } from "../files.mjs";

/**
 * Where the review's record is kept, the accepted pictures and the state: the
 * main checkout's .cache/screens, so an accept in a worktree outlives it and
 * every worktree reads the same record. A project in a folder of its
 * repository keeps it in that folder of the main checkout. Outside git, the
 * project's own.
 */
export function recordDir(root) {
  const res = spawnSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir", "--show-prefix"], { cwd: root, encoding: "utf8" });
  const [common, prefix = ""] = res.status === 0 ? res.stdout.split("\n").map((line) => line.trim()) : [""];
  if (!common) return join(root, ".cache/screens");
  return basename(common) === ".git" ? join(dirname(common), prefix, ".cache/screens") : join(common, "wf-screens", prefix);
}

/**
 * Run `change` holding the record's lock, so two worktrees that read, change,
 * and write it at once do not lose one's change. A lock older than a minute
 * was left by a process that died, and is taken over.
 */
export function withRecordLock(dir, change) {
  mkdirSync(dir, { recursive: true });
  const lock = join(dir, "record.lock");
  for (let tries = 0; ; tries++) {
    try {
      mkdirSync(lock);
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let age = 0;
      try { age = Date.now() - statSync(lock).mtimeMs; } catch {}
      if (age > 60_000 || tries > 200) { try { rmdirSync(lock); } catch {} continue; }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
    }
  }
  try {
    return change();
  } finally {
    try { rmdirSync(lock); } catch {}
  }
}

/** Where the state is kept in a project. */
export const statePath = (root) => join(recordDir(root), "state.json");

/** Write a record whole, through a file beside it, so a reader in another worktree never sees half of it. */
export function writeRecord(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeWhole(path, text, 0o644);
}

/** A mark as the record keeps it: a commit id, never a branch name or a revision such as HEAD. */
const MARK = /^[0-9a-f]{7,64}$/;

/**
 * Which of these commit ids this repository has, asked of git once for all of
 * them, by `git cat-file --batch-check` on its input, so a record with many
 * marks starts one process, and no id reaches git as an argument.
 */
function knownCommits(root, shas) {
  const asked = [...new Set(shas)];
  if (!asked.length) return new Set();
  const res = spawnSync("git", ["cat-file", "--batch-check"], { cwd: root, encoding: "utf8", input: `${asked.map((sha) => `${sha}^{commit}`).join("\n")}\n` });
  const lines = res.status === 0 ? res.stdout.split("\n") : [];
  return new Set(asked.filter((sha, at) => / commit \d+$/.test(lines[at] ?? "")));
}

/**
 * The state as kept: a version 2 state, a version 1 one as it was, or a fresh
 * version 2 one. A mark that is not a commit id is dropped. With `root`, a
 * mark at a commit since removed, such as a deleted worktree's branch, is
 * dropped too, so its picture counts from `base`; `pruned`, which is not
 * written back, says how many went.
 */
export function readState(path, base = "origin/main", root = null) {
  const state = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : { version: 2, marks: {}, last: null, deferred: { count: 0, at: null } };
  state.deferred ??= { count: 0, at: null };
  if (state.version !== 2) {
    state.open ??= {};
    const here = root ? knownCommits(root, [state.last, state.deep].filter((sha) => MARK.test(sha ?? ""))) : null;
    for (const key of ["last", "deep"]) if (state[key] !== base && (!MARK.test(state[key] ?? "") || (here && !here.has(state[key])))) state[key] = base;
    return state;
  }
  state.marks = state.marks && typeof state.marks === "object" ? state.marks : {};
  const all = Object.values(state.marks).flatMap((marks) => Object.values(marks ?? {}));
  const here = root ? knownCommits(root, all.filter((sha) => typeof sha === "string" && MARK.test(sha))) : null;
  let pruned = 0;
  for (const [name, marks] of Object.entries(state.marks)) {
    if (!marks || typeof marks !== "object") {
      delete state.marks[name];
      continue;
    }
    for (const [shot, sha] of Object.entries(marks)) {
      if (typeof sha === "string" && MARK.test(sha) && (!here || here.has(sha))) continue;
      delete marks[shot];
      pruned += 1;
    }
  }
  Object.defineProperty(state, "pruned", { value: pruned, enumerable: false });
  return state;
}

/**
 * A version 1 state as marks, for each screen named. One on the old deep
 * list keeps the deep mark, since a light run may not have read it; any
 * other the last mark. Each picture a screen has accepted gets that mark. A
 * screen a partial accept left open was left at a commit past what it still
 * shows, so it is pending: due until an accept takes it.
 */
export function fromV1(state, oldDeep, names, accepted = {}) {
  const marks = {};
  for (const name of names) {
    const at = oldDeep.has(name) ? state.deep : state.last;
    const shots = Object.keys(accepted[name] ?? {}).filter((key) => key !== "frame");
    marks[name] = Object.fromEntries((shots.length ? shots : ["wide-default"]).map((shot) => [shot, at]));
  }
  const pending = Object.keys(state.open ?? {}).filter((name) => names.includes(name)).sort();
  return { version: 2, marks, ...(pending.length ? { pending } : {}), last: state.last, deferred: state.deferred ?? { count: 0, at: null } };
}

/** The commit a screen's picture is due from: its mark, or `base` when it has none. */
export const markOf = (state, name, shot, base = "origin/main") => state.marks?.[name]?.[shot] ?? base;

/** Write the screen-review state to its file, making the folder first. */
export function writeState(state, path) {
  writeRecord(path, `${JSON.stringify(state, null, 1)}\n`);
}

/**
 * The state after an accept: each screen taken has the pictures it was shot
 * with marked at `at`, the commit the run was shot at. Each screen `settled`,
 * one nothing has reached since its marks, has them all moved to `at`, so
 * the marks stay a few commits and not one for every run. A chunk-end run,
 * light or deep, also becomes the last run and clears any deferral. A
 * pending screen no longer `listed` goes.
 */
export function afterAccept(state, taken, at, chunkEnd = false, { settled = [], listed = null } = {}) {
  const marks = { ...state.marks };
  for (const name of settled) {
    const shots = Object.keys(marks[name] ?? {});
    marks[name] = Object.fromEntries((shots.length ? shots : ["wide-default"]).map((shot) => [shot, at]));
  }
  for (const [name, shots] of Object.entries(taken)) marks[name] = { ...marks[name], ...Object.fromEntries(shots.map((shot) => [shot, at])) };
  const { pending: before = [], ...rest } = state;
  const pending = before.filter((name) => !(name in taken) && (!listed || listed.includes(name)));
  return { ...rest, version: 2, marks, ...(pending.length ? { pending } : {}), ...(chunkEnd ? { last: at, deferred: { count: 0, at: null } } : {}) };
}

/** The state after a chunk end deferred the review. Nothing else moves. */
export function afterDefer(state, at) {
  return { ...state, deferred: { count: state.deferred.count + 1, at: at.slice(0, 7) } };
}

/** The repository's HEAD commit, the point a run or a deferral is recorded at. */
export function headCommit(repo) {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
}
