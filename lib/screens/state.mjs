// Where the screen review stands, kept on this computer in the main
// checkout's .cache/screens/state.json, which every worktree of it shares:
//
//   version   2
//   marks     each screen's pictures, by name, to the commit each was last
//             accepted at: { "gm-accounts": { "wide-default": "95a6c8c..." } }.
//             A picture is due when a change that reaches its screen landed
//             after its own mark, so an accepted run moves what it took and the
//             screens it could not reach: a light run, one area, a chunk, or
//             some screens. A picture nothing has reached since its mark moves
//             with it, when its mark is on the run's history. A picture
//             whose mark was lost, its commit gone, keeps null: due until an
//             accept takes it. A screen never accepted is due until then too
//             (due.mjs), however long ago origin/main took it. Each mark's
//             commit has a local ref (pinMarks), so git's cleanup keeps it.
//   pending   screens left out of an accept, or that did not shoot, and those a
//             partial accept left open before marks: each due until an accept
//             takes it, whatever changed since. Every worktree shares the list,
//             so a name one checkout does not list stays, and is due only where
//             it is listed
//   last      the commit the last chunk-end run (light or deep) was shot at
//   deferred  how many chunk ends deferred the review since one ran, and the last
//
// A run shot with uncommitted changes is shot at a snapshot of the working
// tree, a local commit whose parent is HEAD (shotCommit), so its marks count
// from what the pictures show. Once those changes are committed as they were,
// nothing has changed since the mark, and the screens are not due again.
//
// A state from before version 2 kept one mark for every screen (last and
// deep), the light runs since the last deep one, and the screens a partial
// accept left open; fromV1 turns it into marks.

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { writeWhole } from "../files.mjs";
import { isSecret } from "../../plugins/core/hooks/guard.mjs";

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

/** The longest one git call made holding the record's lock may take: a change makes five at most, so it normally ends before its lock looks stale; lock.mjs's check covers one that does not. */
const LOCKED_GIT = 10_000;

/** Where the state is kept in a project. */
export const statePath = (root) => join(recordDir(root), "state.json");

/** Write a record whole, through a file beside it, so a reader in another worktree never sees half of it. */
export function writeRecord(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeWhole(path, text, 0o644);
}

/** A picture's name, the only key a lost mark is kept under. */
const PICTURE = /^(wide|narrow)-(default|stress)$/;

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
  // A partial clone would fetch each id it lacks: this asks only what is here. It reads, so a hung one is killed outright.
  const res = spawnSync("git", ["cat-file", "--batch-check"], { cwd: root, encoding: "utf8", timeout: LOCKED_GIT, killSignal: "SIGKILL", env: { ...process.env, GIT_NO_LAZY_FETCH: "1" }, input: `${asked.map((sha) => `${sha}^{commit}`).join("\n")}\n` });
  const lines = res.status === 0 ? res.stdout.replace(/\n$/, "").split("\n") : [];
  // A git that fails, or answers for fewer than it was asked, says nothing about the marks: the record is kept as it is.
  if (res.status !== 0 || lines.length !== asked.length) throw new Error(`git could not check the screen record's commits: ${(res.stderr || res.error?.message || "it answered for fewer than it was asked").trim()}`);
  return new Set(asked.filter((sha, at) => / commit \d+$/.test(lines[at])));
}

/** Whether each of these commits is on the history of `at`, asked once each; a mark on another branch, or past `at`, is not. */
export function ancestorsOf(root, commits, at) {
  return new Set([...new Set(commits)].filter((sha) => spawnSync("git", ["merge-base", "--is-ancestor", "--end-of-options", sha, at], { cwd: root }).status === 0));
}

const isMark = (sha) => typeof sha === "string" && MARK.test(sha);

/**
 * The state as kept: a version 2 state, a version 1 one as it was, or a fresh
 * version 2 one. A value that is not what the record holds is dropped: a mark
 * or a last run that is not a commit id, a pending list that is not names, a
 * deferral that is not a count. A picture's mark that is no commit id, or
 * with `root` one at a commit since removed, such as a deleted worktree's
 * branch, becomes null: lost, so its picture is due until an accept takes it,
 * after the record is written back as well. In a version 1 record a deep
 * mark lost that way sets `lostDeep`, which fromV1 reads.
 */
export function readState(path, base = "origin/main", root = null) {
  const state = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : { version: 2, marks: {}, last: null, deferred: { count: 0, at: null } };
  const deferred = state.deferred;
  state.deferred = deferred && typeof deferred === "object" && Number.isInteger(deferred.count) ? { count: deferred.count, at: typeof deferred.at === "string" ? deferred.at : null } : { count: 0, at: null };
  if (state.version !== 2) {
    state.open = state.open && typeof state.open === "object" ? state.open : {};
    const here = root ? knownCommits(root, [state.last, state.deep].filter(isMark)) : null;
    if (isMark(state.deep) && here && !here.has(state.deep)) state.lostDeep = true;
    for (const key of ["last", "deep"]) if (state[key] !== base && (!isMark(state[key]) || (here && !here.has(state[key])))) state[key] = base;
    return state;
  }
  state.last = isMark(state.last) ? state.last : null;
  state.pending = Array.isArray(state.pending) ? state.pending.filter((name) => typeof name === "string") : [];
  if (!state.pending.length) delete state.pending;
  state.marks = state.marks && typeof state.marks === "object" && !Array.isArray(state.marks) ? state.marks : {};
  const all = Object.values(state.marks).flatMap((marks) => (marks && typeof marks === "object" ? Object.values(marks) : []));
  const here = root ? knownCommits(root, all.filter(isMark)) : null;
  for (const [name, marks] of Object.entries(state.marks)) {
    if (!marks || typeof marks !== "object" || Array.isArray(marks)) {
      delete state.marks[name];
      continue;
    }
    for (const [shot, sha] of Object.entries(marks)) {
      if (isMark(sha) && (!here || here.has(sha))) continue;
      if (PICTURE.test(shot)) marks[shot] = null;
      else delete marks[shot];
    }
  }
  return state;
}

/**
 * A version 1 state as marks, for each screen named. One on the old deep
 * list keeps the deep mark, since a light run may not have read it; any
 * other the last mark. Each picture a screen has accepted gets that mark;
 * a mark that was the base, not a commit, is left out, so the screen is due
 * until an accept takes it. With the deep mark lost, which screens kept it
 * cannot be told, so every mark is lost. A screen a partial accept left open was left at a
 * commit past what it still shows, so it is pending: due until an accept
 * takes it.
 */
export function fromV1(state, oldDeep, names, accepted = {}) {
  const marks = {};
  for (const name of names) {
    const at = oldDeep.has(name) ? state.deep : state.last;
    const shots = Object.keys(accepted[name] ?? {}).filter((key) => key !== "frame");
    const all = (mark) => Object.fromEntries((shots.length ? shots : ["wide-default"]).map((shot) => [shot, mark]));
    marks[name] = state.lostDeep ? all(null) : isMark(at) ? all(at) : {};
  }
  const pending = Object.keys(state.open ?? {}).sort();
  return { version: 2, marks, ...(pending.length ? { pending } : {}), last: isMark(state.last) ? state.last : null, deferred: state.deferred ?? { count: 0, at: null } };
}

/** The commit what changed for a screen's picture is counted from: its mark, or `base` when it has none. Having none can make it due by itself (untilAccepted). */
export const markOf = (state, name, shot, base = "origin/main") => state.marks?.[name]?.[shot] ?? base;

/** Write the screen-review state to its file, making the folder first. */
export function writeState(state, path) {
  writeRecord(path, `${JSON.stringify(state, null, 1)}\n`);
}

/**
 * The state after an accept: each screen taken has the pictures it was shot
 * with marked at `at`, the commit the run was shot at. Each picture
 * `settled`, as [screen, picture], one nothing has reached since its mark,
 * moves to `at` too, so the marks stay a few commits and not one for every
 * run. Each screen `held`, a changed one left out or one that did not shoot,
 * is pending: due until an accept takes it. A chunk-end run, light or deep,
 * also becomes the last run and clears any deferral. A pending screen goes
 * only when an accept takes its Default: not when this checkout does not
 * list it, could not reach it (`unreached`, marked as looked at), or took
 * only its other pictures, since another worktree's branch may hold its fault.
 */
export function afterAccept(state, taken, at, chunkEnd = false, { settled = [], held = [], unreached = [] } = {}) {
  const marks = Object.fromEntries(Object.entries(state.marks ?? {}).map(([name, kept]) => [name, { ...kept }]));
  for (const [name, shot] of settled) marks[name] = { ...marks[name], [shot]: at };
  for (const [name, shots] of Object.entries(taken)) marks[name] = { ...marks[name], ...Object.fromEntries(shots.map((shot) => [shot, at])) };
  const { pending: before = [], ...rest } = state;
  const pending = [...new Set([...before, ...held])].filter((name) => !Object.hasOwn(taken, name) || unreached.includes(name) || !taken[name].includes("wide-default")).sort();
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

/**
 * Where the snapshots of what a run shot are kept, one ref each, so git's
 * cleanup keeps each while a mark may name it. A plain push sends branches
 * only, so they stay on this computer; a mirror push, or a refspec of
 * refs/*, would send them too.
 */
export const SNAPSHOT_REFS = "refs/wf/screens/";
/** How long a snapshot no mark names is kept, for a run in another worktree not accepted yet. */
export const SNAPSHOT_DAYS = 14;
/** The largest untracked file a snapshot takes; a bigger one, such as stray build output, is left out and named. */
export const SNAPSHOT_FILE_MAX = 5_000_000;
const SNAPSHOT_GIT = { GIT_AUTHOR_NAME: "wf screens", GIT_AUTHOR_EMAIL: "wf-screens@localhost", GIT_COMMITTER_NAME: "wf screens", GIT_COMMITTER_EMAIL: "wf-screens@localhost" };

/**
 * The commit a run is shot at, as { at, dirty, snapshot, left, problem }:
 * HEAD, or with uncommitted changes a snapshot of the working tree, made as a
 * commit whose parent is HEAD. It starts from a copy of the person's own
 * index, so their staging is left alone and only changed files are hashed.
 * An untracked file whose name may hold a secret (the guard's SECRET_GLOBS),
 * or one over SNAPSHOT_FILE_MAX, is left out, and `left` names it. When the
 * snapshot cannot be made, the run is shot at HEAD, as before, and `problem`
 * says why.
 */
export function shotCommit(root, tmpDir) {
  const head = headCommit(root);
  const index = join(tmpDir, `snapshot-index-${process.pid}`);
  const git = (args, input) => spawnSync("git", args, { cwd: root, encoding: "utf8", input, env: { ...process.env, ...SNAPSHOT_GIT, GIT_INDEX_FILE: index } });
  const failed = (step, res) => ({ at: head, dirty: true, snapshot: false, left: [], problem: `git ${step} failed: ${String(res.stderr ?? res.error?.message ?? "").trim()}` });
  try {
    mkdirSync(tmpDir, { recursive: true });
  } catch (error) {
    return failed("index", { stderr: `no folder for its index: ${error.message}` });
  }
  try {
    const own = spawnSync("git", ["rev-parse", "--path-format=absolute", "--git-path", "index"], { cwd: root, encoding: "utf8" }).stdout.trim();
    if (own && existsSync(own)) copyFileSync(own, index);
    else {
      const read = git(["read-tree", head]);
      if (read.status !== 0) return failed("read-tree", read);
    }
    const tracked = git(["add", "-u"]);
    if (tracked.status !== 0) return failed("add", tracked);
    const others = git(["ls-files", "-z", "--others", "--exclude-standard"]);
    if (others.status !== 0) return failed("ls-files", others);
    const left = [];
    const taken = others.stdout.split("\0").filter(Boolean).filter((path) => {
      const big = (statSync(join(root, path), { throwIfNoEntry: false })?.size ?? 0) > SNAPSHOT_FILE_MAX;
      if (isSecret(path) || big) left.push(path);
      return !isSecret(path) && !big;
    });
    if (taken.length) {
      const added = git(["add", "--pathspec-from-file=-", "--pathspec-file-nul"], `${taken.join("\0")}\0`);
      if (added.status !== 0) return failed("add", added);
    }
    const tree = git(["write-tree"]);
    if (tree.status !== 0) return failed("write-tree", tree);
    // The tree as HEAD has it: nothing but what was left out differs, so the run is at HEAD.
    if (tree.stdout.trim() === git(["rev-parse", `${head}^{tree}`]).stdout.trim()) return { at: head, dirty: left.length > 0, snapshot: false, left };
    const made = git(["commit-tree", "--no-gpg-sign", tree.stdout.trim(), "-p", head, "-m", "wf screens: the working tree a run shot, with uncommitted changes"]);
    const at = made.stdout.trim();
    if (made.status !== 0 || !/^[0-9a-f]{40,64}$/.test(at)) return failed("commit-tree", made);
    const ref = git(["update-ref", `${SNAPSHOT_REFS}${at}`, at]);
    if (ref.status !== 0) return failed("update-ref", ref);
    return { at, dirty: true, snapshot: true, left };
  } finally {
    rmSync(index, { force: true });
  }
}

/**
 * Where each mark's commit is kept alive, one ref each in the project
 * folder's own space: a branch squash-merged and deleted would leave the
 * commit to git's cleanup, and every screen marked there lost. Apart from the
 * snapshots, which onHistory reads by their parent.
 */
export const MARK_REFS = "refs/wf/marks/";

/**
 * Keep a ref on each commit the marks name, and drop those no mark names, in
 * one git call. Call it holding the record's lock, with the record just
 * written. Returns what went wrong, or null.
 */
export function pinMarks(root, state) {
  if (state.version !== 2) return null;
  const git = (args, input) => spawnSync("git", args, { cwd: root, encoding: "utf8", input, timeout: LOCKED_GIT });
  const failed = (res) => res.stderr?.trim() || res.error?.message || `git exited with ${res.status ?? res.signal}`;
  const prefix = git(["rev-parse", "--show-prefix"]);
  if (prefix.status !== 0) return failed(prefix);
  const space = `${MARK_REFS}${createHash("sha256").update(prefix.stdout.trim()).digest("hex").slice(0, 12)}/`;
  let named;
  try {
    named = knownCommits(root, Object.values(state.marks).flatMap((kept) => Object.values(kept)).filter(isMark));
  } catch (error) {
    // The record is written by now, so this is said, never thrown.
    return error.message;
  }
  const listed = git(["for-each-ref", "--format=%(refname)", space]);
  if (listed.status !== 0) return failed(listed);
  const have = new Set(listed.stdout.split("\n").filter(Boolean));
  const wanted = new Map([...named].map((sha) => [`${space}${sha}`, sha]));
  const lines = [
    ...[...wanted].filter(([ref]) => !have.has(ref)).map(([ref, sha]) => `update ${ref} ${sha}\n`),
    ...[...have].filter((ref) => !wanted.has(ref)).map((ref) => `delete ${ref}\n`),
  ];
  if (!lines.length) return null;
  const done = git(["update-ref", "--stdin"], lines.join(""));
  return done.status === 0 ? null : failed(done);
}

/** The snapshots this repository keeps, by commit id, each with when it was made, in milliseconds. */
function snapshotRefs(root) {
  const refs = spawnSync("git", ["for-each-ref", "--format=%(objectname) %(committerdate:unix) %(refname)", SNAPSHOT_REFS], { cwd: root, encoding: "utf8" });
  if (refs.status !== 0) return new Map();
  return new Map(
    refs.stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split(" "))
      .map(([sha, when, ref]) => [sha, { when: Number(when) * 1000, ref }]),
  );
}

/**
 * Drop each snapshot ref no mark and no last run names, once it is
 * SNAPSHOT_DAYS old, in one git call, so the snapshots stay as few as the
 * marks. A snapshot gone is a mark git no longer has, which readState makes
 * a lost one.
 */
export function pruneSnapshots(root, state, now = Date.now()) {
  const named = new Set([...Object.values(state.marks ?? {}).flatMap((kept) => Object.values(kept)), state.last].filter(Boolean));
  const old = [...snapshotRefs(root)].filter(([sha, { when }]) => !named.has(sha) && now - when >= SNAPSHOT_DAYS * 86_400_000).map(([, { ref }]) => ref);
  if (!old.length) return 0;
  return spawnSync("git", ["update-ref", "--stdin"], { cwd: root, input: old.map((ref) => `delete ${ref}\n`).join("") }).status === 0 ? old.length : 0;
}

/**
 * Which of these marks are on the history of `at`: an ancestor of it, or a
 * snapshot whose parent is. A snapshot is a side commit, so nothing descends
 * from it; once its changes are committed, its parent is on the history, and
 * dueLists says whether anything reached the picture since.
 */
export function onHistory(root, commits, at) {
  const snapshots = snapshotRefs(root);
  const parent = (sha) => (snapshots.has(sha) ? spawnSync("git", ["rev-parse", "--verify", "--quiet", "--end-of-options", `${sha}^`], { cwd: root, encoding: "utf8" }).stdout.trim() : "");
  const byParent = new Map([...new Set(commits)].map((sha) => [sha, parent(sha) || sha]));
  const ancestors = ancestorsOf(root, [...byParent.values()], at);
  return new Set([...byParent].filter(([, on]) => ancestors.has(on)).map(([sha]) => sha));
}
