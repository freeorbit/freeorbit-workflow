// `wf tools`: what this computer has of the list in the project's tools.md,
// the kit's table and the project's own. It fails only for a required tool,
// and says when this clone does not run the branch hooks.

import { existsSync, readFileSync } from "node:fs";
import { delimiter, join } from "node:path";

import { hooksLine, hooksPathOf } from "./hooks.mjs";

const ROW = /^\| `([\w.+-]+)` \| (.+?) \| (required|review|optional) \| (all|linux) \|/gm;

/** The tools in every table of the list, each once. */
export function toolRows(text) {
  const rows = [...text.matchAll(ROW)].map(([, name, use, need, runsOn]) => ({ name, use, need, runsOn }));
  return rows.filter((row, i) => rows.findIndex((other) => other.name === row.name) === i);
}

/** True when a command is on this path. */
export function onPath(name, path, extensions = [""]) {
  const folders = path.split(delimiter).filter(Boolean);
  return folders.some((folder) => extensions.some((ending) => existsSync(join(folder, name + ending))));
}

/** The lines to print for each missing tool, and whether a required one is. */
export function report(rows, has, platform) {
  const missing = rows.filter((row) => (row.runsOn === "all" || row.runsOn === platform) && !has(row.name));
  const lines = missing.map((row) => `missing ${row.need}: ${row.name}. ${row.use}`);
  return { lines, failed: missing.some((row) => row.need === "required") };
}

/** Run the check; returns its exit code. */
export function runTools(root, config, log = console.log) {
  const list = `${config.docs.workflow}/tools.md`;
  const path = join(root, list);
  if (!existsSync(path)) {
    log(`${list} is missing; run npx wf docs sync.`);
    return 1;
  }
  const rows = toolRows(readFileSync(path, "utf8"));
  // No rows means the table's format drifted, so the required tools would go unchecked.
  if (rows.length === 0) {
    log(`no tools found in ${list}; each row is | \`name\` | use | required, review, or optional | all or linux | without it |`);
    return 1;
  }
  const extensions = process.platform === "win32" ? ["", ...(process.env.PATHEXT ?? "").split(";")] : [""];
  const { lines, failed } = report(rows, (name) => onPath(name, process.env.PATH ?? "", extensions), process.platform);
  const hooks = hooksLine(hooksPathOf(root));
  for (const line of hooks ? [...lines, hooks] : lines) log(line);
  log(lines.length === 0 ? `All ${rows.length} tools found.` : `How to install them is in ${list}.`);
  return failed ? 1 : 0;
}
