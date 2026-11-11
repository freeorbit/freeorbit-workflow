// `wf testdata`: the project's test-data commands, named in `testdata.commands`
// in its config, run with the rest of the arguments after them. The kit knows
// no generator; it only gives each project the same names for the same steps.

import { spawnSync } from "node:child_process";

import { projectCommand } from "./process.mjs";

/** The shell command for one test-data step, or null when the project has none. */
export const commandFor = (config, name, args) => projectCommand(config.testdata.commands, name, args);

/** Run a step; `refresh-close <area> <ids>` runs covered, then index. Returns the exit code. */
export function runTestdata(root, config, name, args) {
  const steps = name === "refresh-close" ? [["covered", args], ["index", args.slice(0, 1)]] : [[name, args]];
  for (const [step, stepArgs] of steps) {
    const command = commandFor(config, step, stepArgs);
    if (!command) {
      console.error(`testdata.commands has no ${step}; add it to .workflow/config.json`);
      return 2;
    }
    const { status } = spawnSync("sh", ["-c", command], { cwd: root, stdio: "inherit" });
    if (status !== 0) return status ?? 1;
  }
  return 0;
}
