// How `wf app` starts the project's servers and the app, and stops them.
//
//   systemd  each one a systemd user unit, under the memory cap and the time
//            limit, with its output in the journal (Linux)
//   process  each one a detached process group, its pid and output in the
//            state folder, stopped by a watchdog after the time limit; there
//            is no memory cap (macOS, or Linux without a user systemd)
//
// `app.runner` picks one; "auto" uses systemd where `systemd-run --user` works.

import { spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const sh = (cmd, args, opts = {}) => {
  const res = spawnSync(cmd, args, { encoding: "utf8", ...opts });
  return { ok: res.status === 0, out: (res.stdout ?? "") + (res.stderr ?? "") };
};

/** Which runner a config means on this computer. */
// A user manager must be running, not only installed: a container or an ssh
// login without lingering has systemd-run but no bus to reach.
const userSystemd = () => process.platform === "linux" && sh("systemctl", ["--user", "show-environment"]).ok && sh("systemd-run", ["--user", "--version"]).ok;

/** How the app's processes run: app.runner when it names one, else systemd user units where they work, else plain processes. */
export function runnerKind(config, probe = userSystemd) {
  const wanted = config.app.runner;
  if (wanted === "systemd" || wanted === "process") return wanted;
  return probe() ? "systemd" : "process";
}

/** systemd's -p limits as the time limit a process runner can keep, in seconds. */
export function timeLimit(limits) {
  const at = limits.findIndex((part, i) => limits[i - 1] === "-p" && part.startsWith("RuntimeMaxSec="));
  return at >= 0 ? Number(limits[at].split("=")[1]) : null;
}

/** The systemd runner: units, the journal, and the unit's memory. */
export function systemdRunner() {
  const active = (unit) => sh("systemctl", ["--user", "is-active", "--quiet", unit]).ok;
  const stop = (unit) => {
    sh("systemctl", ["--user", "stop", unit]);
    sh("systemctl", ["--user", "reset-failed", unit]);
  };
  return {
    kind: "systemd",
    active,
    stop,
    run(unit, args, { env = {}, cwd, limits = [] } = {}) {
      stop(unit);
      const setenv = Object.entries(env).flatMap(([k, v]) => ["--setenv", `${k}=${v}`]);
      const res = sh("systemd-run", ["--user", `--unit=${unit}`, "--collect", "--quiet", `--working-directory=${cwd}`, ...limits, ...setenv, ...args]);
      if (!res.ok) throw new Error(`could not start ${unit}: ${res.out}`);
    },
    log: (unit, lines = 40) => sh("journalctl", ["--user", "-u", unit, "-n", String(lines), "--no-pager", "-o", "cat"]).out.trim(),
    memoryMb(unit) {
      const bytes = Number(sh("systemctl", ["--user", "show", "-p", "MemoryCurrent", "--value", unit]).out.trim());
      return Number.isFinite(bytes) ? Math.round(bytes / 1048576) : 0;
    },
  };
}

/** The process runner: a detached process group per unit, with its pid and output under `dir`. */
export function processRunner(dir) {
  const units = join(dir, "units");
  const pidFile = (unit) => join(units, `${unit}.pid`);
  const watchFile = (unit) => join(units, `${unit}.watchdog`);
  const logFile = (unit) => join(units, `${unit}.log`);
  // Only a positive pid read from the file; anything else is no process.
  const readPid = (file) => {
    const id = existsSync(file) ? Number(readFileSync(file, "utf8").trim()) : NaN;
    return Number.isInteger(id) && id > 1 ? id : null;
  };
  // A unit is started as its own group's leader. A pid that is no longer a
  // leader of its own group is a stale file or a reused pid: not ours to signal.
  // An exited one this process has not reaped yet (a zombie, state Z) is gone too.
  const leading = (id) => {
    if (id === null) return false;
    const [group, state = ""] = sh("ps", ["-o", "pgid=,stat=", "-p", String(id)]).out.trim().split(/\s+/);
    return Number(group) === id && !state.startsWith("Z");
  };
  const pid = (unit) => readPid(pidFile(unit));
  const signal = (id, sig) => {
    try {
      process.kill(-id, sig);
    } catch {
      // Already gone.
    }
  };
  const sleepMs = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  const stop = (unit) => {
    const id = pid(unit);
    // The group holds the unit and anything it started, such as Chromium's helpers.
    if (leading(id)) {
      signal(id, "SIGTERM");
      // Wait for it to let go of its port and profile, as systemctl stop does, then insist.
      for (let waited = 0; waited < 3000 && leading(id); waited += 100) sleepMs(100);
      if (leading(id)) signal(id, "SIGKILL");
    }
    rmSync(pidFile(unit), { force: true });
    // Its watchdog has nothing left to stop.
    const watchdog = readPid(watchFile(unit));
    if (leading(watchdog)) signal(watchdog, "SIGTERM");
    rmSync(watchFile(unit), { force: true });
  };
  return {
    kind: "process",
    active: (unit) => leading(pid(unit)),
    stop,
    run(unit, args, { env = {}, cwd, limits = [] } = {}) {
      stop(unit);
      mkdirSync(units, { recursive: true });
      const out = openSync(logFile(unit), "w");
      const child = spawn(args[0], args.slice(1), { cwd, env: { ...process.env, ...env }, detached: true, stdio: ["ignore", out, out] });
      closeSync(out);
      // A missing program fails here, by pid, not later as an uncaught error.
      child.on("error", () => {});
      if (!child.pid) throw new Error(`could not start ${unit}: ${args[0]} was not found`);
      child.unref();
      writeFileSync(pidFile(unit), String(child.pid));
      // A turn that leaves the unit running does not leave it for good.
      const seconds = timeLimit(limits);
      if (seconds) {
        const watchdog = spawn("sh", ["-c", `sleep ${seconds}; kill -TERM -${child.pid} 2>/dev/null || kill -TERM ${child.pid} 2>/dev/null`], { detached: true, stdio: "ignore" });
        watchdog.unref();
        writeFileSync(watchFile(unit), String(watchdog.pid));
      }
    },
    log(unit, lines = 40) {
      if (!existsSync(logFile(unit))) return "";
      return readFileSync(logFile(unit), "utf8").trimEnd().split("\n").slice(-lines).join("\n");
    },
    memoryMb(unit) {
      const id = pid(unit);
      if (!leading(id)) return 0;
      // The group's resident memory, from ps, which macOS and Linux both have.
      const rows = sh("ps", ["-o", "pgid=,rss=", "-A"]).out.split("\n").map((line) => line.trim().split(/\s+/).map(Number));
      return Math.round(rows.filter(([group]) => group === id).reduce((sum, [, rss]) => sum + (rss || 0), 0) / 1024);
    },
  };
}

/** The runner for this config and state folder. */
export function runnerFor(config, dir, probe) {
  return runnerKind(config, probe) === "systemd" ? systemdRunner() : processRunner(dir);
}
