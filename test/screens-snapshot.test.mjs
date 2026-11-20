import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { onHistory, pruneSnapshots, shotCommit, SNAPSHOT_DAYS, SNAPSHOT_FILE_MAX, SNAPSHOT_REFS } from "../lib/screens/state.mjs";

const ID = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };

/** A repo with one commit, and a git runner in it. */
function repo() {
  const root = mkdtempSync(join(tmpdir(), "wf-snap-"));
  const git = (...args) => {
    const res = spawnSync("git", args, { cwd: root, encoding: "utf8", env: { ...process.env, ...ID } });
    assert.equal(res.status, 0, `git ${args.join(" ")}: ${res.stderr}`);
    return res.stdout.trim();
  };
  git("init", "-q", "-b", "main");
  writeFileSync(join(root, "app.js"), "one\n");
  writeFileSync(join(root, ".gitignore"), "out/\n");
  git("add", "-A");
  git("commit", "-q", "-m", "first");
  return { root, git, done: () => rmSync(root, { recursive: true, force: true }) };
}

test("a clean tree is shot at HEAD, with no snapshot", () => {
  const { root, git, done } = repo();
  assert.deepEqual(shotCommit(root, join(root, "out")), { at: git("rev-parse", "HEAD"), dirty: false, snapshot: false, left: [] });
  assert.equal(git("for-each-ref", SNAPSHOT_REFS), "");
  done();
});

test("uncommitted changes are shot at a snapshot of them; committed as they were, nothing differs from it", () => {
  const { root, git, done } = repo();
  const head = git("rev-parse", "HEAD");
  writeFileSync(join(root, "app.js"), "two\n");
  writeFileSync(join(root, "new.js"), "new\n");
  writeFileSync(join(root, "staged.js"), "s\n");
  git("add", "staged.js");
  const shot = shotCommit(root, join(root, "out"));
  assert.equal(shot.dirty, true);
  assert.notEqual(shot.at, head);
  assert.equal(git("rev-parse", `${shot.at}^`), head, "its parent is HEAD");
  assert.equal(git("show", `${shot.at}:app.js`), "two");
  assert.equal(git("show", `${shot.at}:new.js`), "new", "an untracked file is in it");
  assert.equal(git("rev-parse", `${SNAPSHOT_REFS}${shot.at}`), shot.at, "a ref keeps it");
  assert.equal(git("diff", "--cached", "--name-only"), "staged.js", "the person's own staging is left alone");
  assert.equal(git("status", "--porcelain", "--", "out"), "", "the temporary index is gone, inside an ignored folder");
  git("add", "-A");
  git("commit", "-q", "-m", "the work");
  // What a project's screens.scope asks: what changed since the mark, the working tree included.
  assert.equal(git("diff", "--name-only", shot.at), "");
  writeFileSync(join(root, "app.js"), "three\n");
  assert.equal(git("diff", "--name-only", shot.at), "app.js", "a later change still shows");
  done();
});

test("a snapshot no mark names is dropped once it is old, and one a mark names is kept", () => {
  const { root, git, done } = repo();
  writeFileSync(join(root, "app.js"), "two\n");
  const kept = shotCommit(root, join(root, "out")).at;
  writeFileSync(join(root, "app.js"), "three\n");
  const loose = shotCommit(root, join(root, "out")).at;
  writeFileSync(join(root, "app.js"), "four\n");
  shotCommit(root, join(root, "out"));
  const state = { marks: { home: { "wide-default": kept } }, last: null };
  assert.equal(pruneSnapshots(root, state), 0, "a new one stays for another worktree's run");
  assert.equal(pruneSnapshots(root, state, Date.now() + (SNAPSHOT_DAYS + 1) * 86_400_000), 2, "both old ones go, in one call");
  assert.equal(git("for-each-ref", "--format=%(objectname)", SNAPSHOT_REFS), kept);
  assert.notEqual(kept, loose);
  done();
});

test("an untracked file that may hold a secret, or one too large, is left out of the snapshot and named", () => {
  const { root, git, done } = repo();
  writeFileSync(join(root, ".env.local"), "TOKEN=secret\n");
  writeFileSync(join(root, "big.bin"), Buffer.alloc(SNAPSHOT_FILE_MAX + 1));
  const only = shotCommit(root, join(root, "out"));
  assert.deepEqual(only, { at: git("rev-parse", "HEAD"), dirty: true, snapshot: false, left: [".env.local", "big.bin"] }, "nothing else changed, so the run is at HEAD");
  writeFileSync(join(root, "app.js"), "two\n");
  const shot = shotCommit(root, join(root, "out"));
  assert.equal(shot.snapshot, true);
  assert.deepEqual(git("ls-tree", "--name-only", shot.at).split("\n").sort(), [".gitignore", "app.js"]);
  done();
});

test("a snapshot that cannot be made leaves the run at HEAD, saying why", () => {
  const { root, git, done } = repo();
  writeFileSync(join(root, "app.js"), "two\n");
  writeFileSync(join(root, "out"), "a file where the folder would go");
  const shot = shotCommit(root, join(root, "out", "snap"));
  assert.equal(shot.at, git("rev-parse", "HEAD"));
  assert.equal(shot.dirty, true);
  assert.match(shot.problem, /no folder for its index/);
  done();
});

test("a snapshot whose changes are committed is on the history, so its pictures can settle forward", () => {
  const { root, git, done } = repo();
  writeFileSync(join(root, "app.js"), "two\n");
  const shot = shotCommit(root, join(root, "out")).at;
  assert.deepEqual([...onHistory(root, [shot], git("rev-parse", "HEAD"))], [shot], "its parent is HEAD");
  git("commit", "-q", "-am", "the work");
  assert.deepEqual([...onHistory(root, [shot], git("rev-parse", "HEAD"))], [shot]);
  git("checkout", "-q", "-b", "other", "HEAD~1");
  git("commit", "-q", "--allow-empty", "-m", "elsewhere");
  git("checkout", "-q", "main");
  const side = git("rev-parse", "other");
  assert.deepEqual([...onHistory(root, [side], git("rev-parse", "HEAD"))], [], "a commit on another branch is not");
  done();
});
