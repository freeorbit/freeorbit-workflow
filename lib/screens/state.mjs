// Where the screen review stands, kept on this computer in
// .cache/screens/state.json, as the code review keeps its own:
//
//   last       the commit the last light or deep run was accepted at
//   deep       the commit the last deep run was accepted at
//   lightRuns  the ranges light runs covered since the last deep run
//   deferred   how many chunk ends deferred the review, and the last one

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Where the state is kept in a project. */
export const statePath = (root) => join(root, ".cache/screens/state.json");

function head(repo) {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
}

/** The state, or a fresh one starting from the base branch on the remote. */
export function readState(path, base = "origin/main") {
  if (existsSync(path)) return JSON.parse(readFileSync(path, "utf8"));
  const from = base;
  return { last: from, deep: from, lightRuns: [], deferred: { count: 0, at: null } };
}

/** Write the screen-review state to its file, making the folder first. */
export function writeState(state, path) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, null, 1)}\n`);
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
