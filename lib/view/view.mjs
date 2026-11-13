// Where question sheets and ask pages are served from, so they open in a
// browser pane beside the question: the `question-pictures` preview server in
// .claude/launch.json, `wf view serve`, serving .cache/view on loopback and
// taking an ask page's answers. `wf init` and `wf view setup` write it.

import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import path from "node:path";

export const VIEW_DIR = ".cache/view";
export const VIEW_PORT = Number(process.env.WF_VIEW_PORT) || 8765;
export const SERVER = {
  name: "question-pictures",
  runtimeExecutable: "npx",
  runtimeArgs: ["wf", "view", "serve"],
  port: VIEW_PORT,
};

/**
 * What a project's question-pictures entry is: the kit's server (`wf view
 * serve`, with any options, through npx or node), the old python file server
 * the kit wrote before v0.49.0, the project's own, or none. Doctor and setup
 * both read it, so a check that fails always has a fix that works.
 */
export function viewEntry(launch) {
  const entry = launch?.configurations?.find?.((each) => each?.name === SERVER.name);
  if (!entry) return { kind: "none", entry: null };
  const words = [entry.runtimeExecutable, ...(entry.runtimeArgs ?? [])].map(String).join(" ");
  if (/(^|\s|\/)wf(\.mjs)?\s+view\s+serve(\s|$)/.test(words)) return { kind: "kit", entry };
  if (entry.runtimeExecutable === "python3" && (entry.runtimeArgs ?? []).includes("http.server")) return { kind: "old", entry };
  return { kind: "own", entry };
}

/** .claude/launch.json with the question-pictures server, keeping the project's own configurations. The kit's old python entry is replaced. */
export function withViewServer(text) {
  const launch = text ? JSON.parse(text) : { version: "0.0.1", configurations: [] };
  if (!launch || typeof launch !== "object" || Array.isArray(launch) || (launch.configurations && !Array.isArray(launch.configurations))) {
    throw new Error(".claude/launch.json is not an object with a configurations list; fix it, then run init again");
  }
  launch.version ??= "0.0.1";
  launch.configurations ??= [];
  const { kind, entry } = viewEntry(launch);
  if (kind === "old") launch.configurations[launch.configurations.indexOf(entry)] = SERVER;
  else if (kind === "none") launch.configurations.push(SERVER);
  return `${JSON.stringify(launch, null, 2)}\n`;
}

/**
 * A project's key on the shared server: its folder's name and a short hash of
 * its real path, so two checkouts or worktrees of one repository differ.
 */
export function projectKey(root) {
  let real = path.resolve(root);
  try {
    real = realpathSync(real);
  } catch {
    // A root that does not exist yet keeps its plain path.
  }
  const name = path.basename(real).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "project";
  return `${name}-${createHash("sha1").update(real).digest("hex").slice(0, 6)}`;
}

/** A sheet or page's address on the shared server, or null when it is not under the served folder. */
export function viewAddress(root, page, port = VIEW_PORT) {
  const inside = path.relative(path.join(root, VIEW_DIR), path.resolve(root, page));
  if (!inside || inside.startsWith("..") || path.isAbsolute(inside)) return null;
  return `http://127.0.0.1:${port}/${projectKey(root)}/${inside.split(path.sep).map(encodeURIComponent).join("/")}`;
}
