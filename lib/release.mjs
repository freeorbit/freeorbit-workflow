// `wf release <step> ...`: the project's release commands, named in
// `release.commands` in its config, run with the rest of the arguments after
// them. The kit knows no build system; it gives each project the same names
// for the same steps, so the release skill can name one command for each.

import { spawnSync } from "node:child_process";

import { projectCommand } from "./process.mjs";

/** The steps the release skill runs, each with what it does. */
export const STEPS = {
  next: "the versions that may come next, from the tags",
  check: "the release checks for a version: OK, WARN, or FAIL for each fact",
  set: "write a version into every place a build reads one",
  verify: "fail when a copy of the version, or the tag being built, disagrees",
};

/** The shell command for one release step, or null when the project has none. */
export const releaseCommand = (config, name, args) => projectCommand(config.release.commands, name, args);

/** Run a step; returns the exit code. */
export function runRelease(root, config, name, args) {
  const command = releaseCommand(config, name, args);
  if (!command) {
    console.error(`release.commands has no ${name}; add it to .workflow/config.json (${STEPS[name] ?? "a step of the project's own"})`);
    return 2;
  }
  return spawnSync("sh", ["-c", command], { cwd: root, stdio: "inherit" }).status ?? 1;
}
