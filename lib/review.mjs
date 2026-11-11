// The review module's scripts. `scan` runs the scanners a project lists in its
// config into .cache/review-scan, works out the files in scope, and writes the
// diff the reviewer starts from. `ledger` runs ledger.py on the config's ledger
// files. Nothing here knows a language: the commands come from the config.

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { KIT_ROOT } from "./setup/ai.mjs";
import { matcher } from "./config/config.mjs";

export const SCAN_DIR = ".cache/review-scan";
export const SCRIPTS = path.join(KIT_ROOT, "plugins", "review", "scripts");

const git = (root, args) => execFileSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

/** The changed paths a review looks at: none that an exclude glob matches, and none that no longer exist. */
export function inScope(paths, exclude, exists) {
  const skip = matcher(exclude);
  return [...new Set(paths)].filter((p) => p && !skip(p) && exists(p)).sort();
}

/** The files changed since `since`, committed or not, untracked included. */
export function changedFiles(root, since) {
  const committed = git(root, ["diff", "--name-only", `${since}..HEAD`]).split("\n");
  const working = git(root, ["status", "--porcelain", "--untracked-files=all"])
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(3).split(" -> ").pop());
  return [...committed, ...working];
}

/** Whether a change touches a dependency manifest or lockfile, by its name. */
export const touchesDeps = (paths, depFiles) => paths.some((p) => depFiles.includes(path.basename(p)));

/** The diff the reviewer starts from: tracked changes since `since`, plus each untracked file in scope as new. */
function writeDiff(root, since, scope, review) {
  const leaveOut = review.diffExclude.map((glob) => `:(exclude,glob)${glob}`);
  let diff = git(root, ["diff", since, "--", ".", ...leaveOut]);
  const untracked = new Set(git(root, ["ls-files", "--others", "--exclude-standard"]).split("\n").filter(Boolean));
  for (const file of scope.filter((p) => untracked.has(p))) {
    diff += spawnSync("git", ["diff", "--no-index", "--", "/dev/null", file], { cwd: root, encoding: "utf8" }).stdout;
  }
  writeFileSync(path.join(root, SCAN_DIR, "changes.diff"), diff);
}

/** Run each scan's shell command at once, with SCAN, FILES, and KIT set; resolves to [name, exit code] pairs. */
function runAll(root, scans, env) {
  return Promise.all(
    scans.map(
      (scan) =>
        new Promise((resolve) => {
          const child = spawn("sh", ["-c", scan.run], { cwd: root, env: { ...process.env, ...env }, stdio: "ignore" });
          // A signal leaves no code; report it as the signal so it reads as "did not finish".
          child.on("close", (code, signal) => resolve([scan.name, code ?? signal]));
        }),
    ),
  );
}

/**
 * A review's scans. `mode` is "full" or "diff"; a diff run needs `since`, and `light` also writes changes.diff.
 * Returns { scope, ran: [[name, code]], deps } and leaves every output in .cache/review-scan.
 */
export async function scan(root, config, { mode, since, light = false }) {
  const review = config.review;
  if (mode === "diff") {
    // Check the commit before emptying the folder, so a bad one keeps the last run's output.
    const ok = !since.startsWith("-") && spawnSync("git", ["rev-parse", "--verify", "--quiet", `${since}^{commit}`], { cwd: root }).status === 0;
    if (!ok) throw new Error(`${since} is not a commit; give the commit to review from, such as the ledger's Last reviewed`);
  }
  const dir = path.join(root, SCAN_DIR);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  let scope = [];
  let deps = mode === "full";
  if (mode === "diff") {
    const changed = changedFiles(root, since);
    deps = touchesDeps(changed, review.depFiles);
    scope = inScope(changed, review.diffExclude, (p) => existsSync(path.join(root, p)));
    writeFileSync(path.join(dir, "scope.txt"), scope.length ? `${scope.join("\n")}\n` : "");
  }
  const env = { SCAN: SCAN_DIR, FILES: mode === "diff" ? path.join(SCAN_DIR, "scope.txt") : "", KIT: KIT_ROOT };
  const groups = [...review.scans.every, ...(deps ? review.scans.deps : []), ...(mode === "full" ? review.scans.full : [])];
  const ran = await runAll(root, groups, env);
  ran.push(...(await runAll(root, review.scans.structure, env)));
  if (mode === "diff" && light) writeDiff(root, since, scope, review);
  return { scope, ran, deps };
}

/** Whether a scan's result means it never ran or never finished: a missing command (127), one it could not run (126), or a signal. */
export const didNotRun = (code) => code === 127 || code === 126 || typeof code === "string";

/** Run ledger.py on the config's ledger files with the given arguments; returns its exit code. */
export function ledger(root, config, args) {
  const result = spawnSync(
    "python3",
    ["-I", path.join(SCRIPTS, "ledger.py"), "--ledger", config.logs.ledger, "--closed", config.logs.ledgerClosed, ...args],
    { cwd: root, stdio: "inherit" },
  );
  return result.status ?? 1;
}
