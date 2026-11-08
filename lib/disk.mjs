// `wf disk [--dry-run] [minimum GB]`: check free disk space, and when it is
// low, clean only leftovers named in `disk` in the config, cheapest first.
// Each step runs only if the disk is still short. Nothing it removes needs a
// download afterward: it never touches what git tracks, and a path git does
// not ignore is skipped.
//
//   1. leftovers   test output, and the app driver's state folders when its app is stopped
//   2. incremental incremental build data; the next build is slower
//   3. stale       files in the stale folders untouched for `stale.days`
//
// Steps 2 and 3 wait while a build process in `busy` runs.

import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readdirSync, rmSync, statfsSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";

/** Whole gigabytes free for this user on the disk that holds `path`. */
export function freeGb(path) {
  const { bavail, bsize } = statfsSync(path);
  return Math.floor((bavail * bsize) / 2 ** 30);
}

/** Bytes under a path: du -sk where it runs (POSIX), else a walk that does not follow links. */
export function sizeOf(path) {
  const du = spawnSync("du", ["-sk", path], { encoding: "utf8" });
  if (du.status === 0) return Number(du.stdout.split(/\s/)[0]) * 1024;
  const stat = lstatSync(path);
  if (!stat.isDirectory()) return stat.size;
  let total = 0;
  for (const entry of readdirSync(path)) total += sizeOf(join(path, entry));
  return total;
}

const human = (bytes) => (bytes >= 2 ** 30 ? `${(bytes / 2 ** 30).toFixed(1)}G` : `${Math.round(bytes / 2 ** 20)}M`);

/** Files under a folder last changed more than `days` ago. */
export function staleFiles(dir, days, now = Date.now()) {
  const out = [];
  const walk = (path) => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const full = join(path, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && now - statSync(full).mtimeMs > days * 86_400_000) out.push(full);
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}

const running = (names) => names.some((name) => spawnSync("pgrep", ["-x", name], { stdio: "ignore" }).status === 0);
const ignored = (root, path) => spawnSync("git", ["check-ignore", "-q", path], { cwd: root }).status === 0;
const unitActive = (unit) => spawnSync("systemctl", ["--user", "-q", "is-active", unit], { stdio: "ignore" }).status === 0;

/**
 * Run the check. `io` holds what touches the machine, so a test can stand in
 * for it: free(), busy(), ignored(path), appRunning(), remove(path).
 * Resolves to the exit code: 0 when enough is free, 1 when still short or a
 * build was running.
 */
export function diskCheck(root, config, { dryRun = false, minimum = config.disk.minimumGb, log = console.log, io = {} } = {}) {
  const { disk, app } = config;
  const free = io.free ?? (() => freeGb(root));
  const busy = io.busy ?? (() => running(disk.busy));
  const isIgnored = io.ignored ?? ((path) => ignored(root, path));
  const appRunning = io.appRunning ?? (() => Boolean(app.name) && unitActive(`${app.name}-agent-app.service`));
  const remove = io.remove ?? ((path) => rmSync(path, { recursive: true, force: true }));
  const enough = () => free() >= minimum;
  const report = () => log(`${free()} GB free, need ${minimum} GB.`);
  const at = (path) => (isAbsolute(path) ? path : join(root, path));

  const clear = (path) => {
    const full = at(path);
    if (!existsSync(full)) return;
    if (!isIgnored(path)) {
      log(`skip ${path}: not ignored by git`);
      return;
    }
    const size = human(sizeOf(full));
    if (dryRun) log(`would remove ${path} (${size})`);
    else {
      remove(full);
      log(`removed ${path} (${size})`);
    }
  };
  const done = () => {
    if (dryRun || !enough()) return false;
    report();
    return true;
  };

  report();
  if (enough()) return 0;

  // Step 1: leftovers from testing. Nothing uses these again.
  for (const path of disk.leftovers) clear(path);
  if (!dryRun) for (const path of disk.recreate) mkdirSync(at(path), { recursive: true });
  // The app driver's state folders, outside the repo, only while its app is stopped.
  if (app.name && !appRunning()) {
    const state = `/tmp/${app.name}-agent`;
    if (existsSync(state)) {
      if (dryRun) log(`would remove ${state}`);
      else {
        remove(state);
        log(`removed ${state}`);
      }
    }
  }
  if (done()) return 0;

  // The next steps change what a running build needs, so wait for it to finish.
  if (busy()) {
    log("A build is running, so build output was left alone. Run this again when it ends.");
    report();
    return 1;
  }

  // Step 2: incremental build data. The next build is slower, and nothing downloads.
  for (const path of disk.incremental) clear(path);
  if (done()) return 0;

  // Step 3: build output untouched for a while, mostly from old dependency versions.
  for (const dir of disk.stale.dirs) {
    const files = staleFiles(at(dir), disk.stale.days);
    if (dryRun) log(`would remove ${files.length} stale files from ${dir}`);
    else {
      for (const file of files) remove(file);
      log(`removed ${files.length} stale files from ${dir}`);
    }
  }

  report();
  if (!dryRun && !enough()) {
    log("Still short. What is left is in use, so ask the owner. Largest here:");
    const sizes = disk.report.filter((path) => existsSync(at(path))).map((path) => [sizeOf(at(path)), path]);
    for (const [bytes, path] of sizes.sort((a, b) => b[0] - a[0])) log(`${human(bytes)}\t${path}`);
    return 1;
  }
  return 0;
}
