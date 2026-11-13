// Where question sheets and ask pages are served from, so they open in a
// browser pane beside the question: the `question-pictures` preview server in
// .claude/launch.json, `wf view serve`, serving .cache/view on loopback and
// taking an ask page's answers. `wf init` and `wf view setup` write it.

import path from "node:path";

export const VIEW_DIR = ".cache/view";
export const VIEW_PORT = 8765;
export const SERVER = {
  name: "question-pictures",
  runtimeExecutable: "npx",
  runtimeArgs: ["wf", "view", "serve"],
  port: VIEW_PORT,
};

/** The entry the kit wrote before v0.49.0, python's file server, which cannot take answers. */
const OLD = (entry) => entry?.name === SERVER.name && entry.runtimeExecutable === "python3" && (entry.runtimeArgs ?? []).includes("http.server");

/** .claude/launch.json with the question-pictures server, keeping the project's own configurations. The kit's old python entry is replaced. */
export function withViewServer(text) {
  const launch = text ? JSON.parse(text) : { version: "0.0.1", configurations: [] };
  if (!launch || typeof launch !== "object" || Array.isArray(launch) || (launch.configurations && !Array.isArray(launch.configurations))) {
    throw new Error(".claude/launch.json is not an object with a configurations list; fix it, then run init again");
  }
  launch.version ??= "0.0.1";
  launch.configurations ??= [];
  const old = launch.configurations.findIndex(OLD);
  if (old >= 0) launch.configurations[old] = SERVER;
  else if (!launch.configurations.some((entry) => entry.name === SERVER.name)) launch.configurations.push(SERVER);
  return `${JSON.stringify(launch, null, 2)}\n`;
}

/** A sheet page's address on the server, or null when it is not under the served folder. */
export function viewAddress(root, page) {
  const inside = path.relative(path.join(root, VIEW_DIR), path.resolve(root, page));
  if (!inside || inside.startsWith("..") || path.isAbsolute(inside)) return null;
  return `http://127.0.0.1:${VIEW_PORT}/${inside.split(path.sep).map(encodeURIComponent).join("/")}`;
}
