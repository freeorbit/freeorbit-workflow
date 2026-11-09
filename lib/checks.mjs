// `wf check [--all]`: the project's checks from `check.steps`, in order, one
// line each. A failure's output is saved under `check.logs`, and its last lines
// are shown. Without --all, the steps marked slow are left out, for use while
// working; --all runs them too, at chunk end, before a pull request, and before
// a release tag.

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const TAIL_LINES = 30;

/** How many tests passed, from Cargo's or Node's output, plain or TAP. Null when it names none. */
export function passed(output) {
  const cargo = [...output.matchAll(/test result: \w+\. (\d+) passed/g)];
  if (cargo.length > 0) return cargo.reduce((sum, match) => sum + Number(match[1]), 0);
  const node = output.match(/^ℹ pass (\d+)/m) ?? output.match(/^# pass (\d+)/m);
  return node ? Number(node[1]) : null;
}

/** One finished step as a line. */
export function line(name, ok, seconds, count) {
  const tests = count === null ? "" : `, ${count} passed`;
  return `${ok ? "ok  " : "FAIL"} ${name} (${seconds}s${tests})`;
}

/** The steps to run: all of them with --all, or else the quick ones. */
export function chosen(steps, args) {
  return args.includes("--all") ? steps : steps.filter((step) => !step.slow);
}

/** A log file's name for a step. */
export const logName = (name) => `${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.log`;

/** Run the checks; `run` swaps the shell for tests. Returns the exit code. */
export function runChecks(root, config, args, log = console.log, run = null) {
  const { steps } = config.check;
  if (!steps.length) {
    log("No checks: list them in check.steps in .workflow/config.json, each { name, command, slow? }.");
    return 2;
  }
  const logs = resolve(root, config.check.logs);
  const inside = relative(resolve(root), logs);
  if (!inside || inside.startsWith("..") || resolve(inside) === inside) {
    log(`check.logs is ${config.check.logs}, which is not a folder inside the project.`);
    return 2;
  }
  mkdirSync(logs, { recursive: true });
  const exec = run ?? ((command) => spawnSync(command, { cwd: root, shell: true, encoding: "utf8", maxBuffer: 1 << 30 }));
  const failed = [];
  for (const step of chosen(steps, args)) {
    const started = Date.now();
    const result = exec(step.command);
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    writeFileSync(join(logs, logName(step.name)), output);
    const ok = result.status === 0;
    log(line(step.name, ok, Math.round((Date.now() - started) / 1000), passed(output)));
    if (!ok) {
      failed.push(step.name);
      log(output.trimEnd().split("\n").slice(-TAIL_LINES).join("\n"));
    }
  }
  const all = args.includes("--all");
  const skipped = steps.filter((step) => step.slow).map((step) => step.name);
  if (!all && skipped.length) log(`skip ${skipped.join(", ")}: run npx wf check --all at chunk end`);
  log(failed.length === 0 ? (all ? "All checks passed." : "Quick checks passed.") : `Failed: ${failed.join(", ")}.`);
  return failed.length === 0 ? 0 : 1;
}
