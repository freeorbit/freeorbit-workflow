// Where the screen review stands, kept on this computer in the main
// checkout's .cache/screens/state.json, which every worktree of it shares:
//
//   last       the commit the last light or deep run was accepted at
//   deep       the commit the last deep run was accepted at
//   lightRuns  the ranges light runs covered since the last deep run
//   deferred   how many chunk ends deferred the review, and the last one

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

/**
 * Where the review's record is kept, the accepted pictures and the state: the
 * main checkout's .cache/screens, so an accept in a worktree outlives it and
 * every worktree reads the same record. Outside git, the project's own.
 */
export function recordDir(root) {
  const res = spawnSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: root, encoding: "utf8" });
  const common = res.status === 0 ? res.stdout.trim() : "";
  if (!common) return join(root, ".cache/screens");
  return basename(common) === ".git" ? join(dirname(common), ".cache/screens") : join(common, "wf-screens");
}

/** Where the state is kept in a project. */
export const statePath = (root) => join(recordDir(root), "state.json");

/** Write a record whole, through a file beside it, so a reader in another worktree never sees half of it. */
export function writeRecord(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  const part = `${path}.${process.pid}.part`;
  writeFileSync(part, text);
  renameSync(part, path);
}

/** Whether `sha` names a commit this repository has. */
const known = (root, sha) => spawnSync("git", ["cat-file", "-e", `${sha}^{commit}`], { cwd: root }).status === 0;

function head(repo) {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
}

/**
 * The state, or a fresh one starting from the base branch on the remote. With
 * `root`, a run recorded at a commit since removed, such as a deleted
 * worktree's branch, counts from the base instead.
 */
export function readState(path, base = "origin/main", root = null) {
  const state = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : { last: base, deep: base, lightRuns: [], deferred: { count: 0, at: null } };
  if (root) for (const key of ["last", "deep"]) if (state[key] !== base && !known(root, state[key])) state[key] = base;
  return state;
}

/** Write the screen-review state to its file, making the folder first. */
export function writeState(state, path) {
  writeRecord(path, `${JSON.stringify(state, null, 1)}\n`);
}

/** The state after an accepted run. A deep run clears the light runs and any deferral. */
export function afterRun(state, mode, at) {
  if (mode === "deep") return { last: at, deep: at, lightRuns: [], deferred: { count: 0, at: null } };
  const range = `${state.last.slice(0, 7)}..${at.slice(0, 7)}`;
  return { ...state, last: at, lightRuns: [...state.lightRuns, range], deferred: { count: 0, at: null } };
}

/** The state after a chunk end deferred the review. Nothing else moves. */
export function afterDefer(state, at) {
  return { ...state, deferred: { count: state.deferred.count + 1, at: at.slice(0, 7) } };
}

/** The repository's HEAD commit, the point a run or a deferral is recorded at. */
export function headCommit(repo) {
  return head(repo);
}
