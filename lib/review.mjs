// The review module's scripts. `scan` runs the scanners a project lists in its
// config into .cache/review-scan, works out the files in scope, and writes the
// diff the reviewer starts from. `ledger` runs ledger.py on the config's ledger
// files. Nothing here knows a language: the commands come from the config.

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { KIT_ROOT } from "./setup/ai.mjs";
import { matcher } from "./config/config.mjs";

export const SCAN_DIR = ".cache/review-scan";
export const SCRIPTS = path.join(KIT_ROOT, "plugins", "review", "scripts");

import { git } from "./process.mjs";

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

/** The hot paths a hot-paths doc lists, each { name, files }: its Hot paths table's Path cell, and the globs in code spans in its Files cell. */
export function hotPaths(text) {
  const body = text.split(/^## Hot paths[ \t]*$/m)[1]?.split(/^## /m)[0] ?? "";
  const rows = body.split("\n").filter((line) => line.trim().startsWith("|"));
  const cells = (line) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split(/(?<!\\)\|/).map((cell) => cell.trim());
  const head = rows.length ? cells(rows[0]) : [];
  const [name, files] = [head.indexOf("Path"), head.indexOf("Files")];
  if (name < 0 || files < 0) return [];
  return rows
    .slice(1)
    .map(cells)
    .filter((row) => !/^-+$/.test(row[0] ?? ""))
    .map((row) => ({ name: row[name], files: [...(row[files] ?? "").matchAll(/`([^`]+)`/g)].map((match) => match[1]) }))
    .filter((path) => path.name && path.files.length);
}

/**
 * Whether the performance pass runs, and the hot paths it walks. A full run
 * walks them all; a diff run walks those whose files the scope touches. With
 * "deep", a light run with none touched skips the pass.
 */
export function performancePass(setting, { mode, light, scope, paths }) {
  const touched = paths.filter((path) => mode === "full" || scope.some(matcher(path.files))).map((path) => path.name);
  const runs = setting === "always" || (setting === "deep" && (mode === "full" || !light || touched.length > 0));
  return { runs, touched };
}

/** One line on whether the performance pass runs, and why. */
export function performanceLine(review, { runs, touched }) {
  if (review.performance === "off") return "Performance pass: off.";
  if (!runs) return "Performance pass: skipped; this light run touches no hot path's files.";
  const walk = touched.length ? `walk ${touched.join(", ")}, in .cache/review-scan/hot-paths.txt` : review.hotPaths ? "the changes touch no hot path, so it walks the PERF rules on the scope" : "review.hotPaths is not set, so it walks the PERF rules on the scope";
  return `Performance pass: runs; ${walk}.`;
}

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
 * Returns { scope, ran: [[name, code]], deps, performance: { runs, touched } } and leaves every
 * output in .cache/review-scan, with hot-paths.txt naming the hot paths the performance pass walks.
 */
export async function scan(root, config, { mode, since, light = false, performance: override = null }) {
  // --performance on or off overrides review.performance for this run.
  const review = override ? { ...config.review, performance: override === "on" ? "always" : "off" } : config.review;
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
  const doc = review.hotPaths && existsSync(path.join(root, review.hotPaths)) ? readFileSync(path.join(root, review.hotPaths), "utf8") : "";
  const performance = performancePass(review.performance, { mode, light, scope, paths: hotPaths(doc) });
  if (performance.runs) {
    writeFileSync(path.join(dir, "hot-paths.txt"), performance.touched.length ? `${performance.touched.join("\n")}\n` : "");
    ran.push(...(await runAll(root, review.scans.perf, env)));
  }
  if (mode === "diff" && light) writeDiff(root, since, scope, review);
  return { scope, ran, deps, performance };
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

/**
 * Whether the code review ledger has reviewed or deferred at this commit, so a
 * chunk-end screen review shoots the code the review left. Both are short
 * hashes, of any length. A named commit also covers HEAD when `ledgerOnlyAfter`
 * says every commit after it changes only the ledger, since the ledger edit is
 * committed after the commit it names.
 */
export function reviewCovers(ledger, head, ledgerOnlyAfter = () => false) {
  const at = (pattern) => ledger.match(pattern)?.[1] ?? "";
  const covers = (commit) => commit.length >= 7 && (head.startsWith(commit) || commit.startsWith(head) || ledgerOnlyAfter(commit));
  return covers(at(/^Last reviewed: ([0-9a-f]+)/m)) || covers(at(/^Deferred: .*last at ([0-9a-f]+)/m));
}

/**
 * Whether a commit is on HEAD's history and each commit after it changes only
 * the ledger files, in the git repository at `root`.
 */
export function ledgerOnlyAfter(root, ledgerFiles) {
  return (commit) => {
    const git = (...args) => spawnSync("git", args, { cwd: root, encoding: "utf8" });
    if (git("merge-base", "--is-ancestor", commit, "HEAD").status !== 0) return false;
    // -m lists a merge's files too, and --no-renames both names of a move.
    const log = git("log", "-m", "--no-renames", "--format=", "--name-only", `${commit}..HEAD`);
    if (log.status !== 0) return false;
    return log.stdout.split("\n").filter(Boolean).every((file) => ledgerFiles.includes(file));
  };
}

/** The ledger and its closed file, which a review or deferral writes. */
export const ledgerFiles = (config) => [config.logs.ledger, config.logs.ledgerClosed].filter(Boolean);

/**
 * Whether the code review covers HEAD in the project at `root`: the one
 * question the screen review, the track gates, and the choice page ask (TB-3).
 * Gives { covers, head }, head as a short commit.
 */
export function reviewCoversHead(root, config) {
  const head = git(root, ["rev-parse", "--short", "HEAD"]).trim();
  const file = path.join(root, config.logs.ledger);
  const covers = existsSync(file) && reviewCovers(readFileSync(file, "utf8"), head, ledgerOnlyAfter(root, ledgerFiles(config)));
  return { covers, head };
}
