// Where an annotated sheet is served from, so it opens in a browser pane beside
// the question: the `question-pictures` preview server in .claude/launch.json,
// serving .cache/view on loopback. `wf init` writes the server for a project
// with the design plugin; `wf design annotate` prints each sheet's address.

import path from "node:path";

export const VIEW_DIR = ".cache/view";
export const VIEW_PORT = 8765;
export const SERVER = {
  name: "question-pictures",
  runtimeExecutable: "python3",
  runtimeArgs: ["-m", "http.server", String(VIEW_PORT), "--bind", "127.0.0.1", "--directory", VIEW_DIR],
  port: VIEW_PORT,
};

/** .claude/launch.json with the question-pictures server, keeping the project's own configurations. */
export function withViewServer(text) {
  const launch = text ? JSON.parse(text) : { version: "0.0.1", configurations: [] };
  if (!launch || typeof launch !== "object" || Array.isArray(launch) || (launch.configurations && !Array.isArray(launch.configurations))) {
    throw new Error(".claude/launch.json is not an object with a configurations list; fix it, then run init again");
  }
  launch.version ??= "0.0.1";
  launch.configurations ??= [];
  if (!launch.configurations.some((entry) => entry.name === SERVER.name)) launch.configurations.push(SERVER);
  return `${JSON.stringify(launch, null, 2)}\n`;
}

/** A sheet page's address on the server, or null when it is not under the served folder. */
export function viewAddress(root, page) {
  const inside = path.relative(path.join(root, VIEW_DIR), path.resolve(root, page));
  if (!inside || inside.startsWith("..") || path.isAbsolute(inside)) return null;
  return `http://127.0.0.1:${VIEW_PORT}/${inside.split(path.sep).map(encodeURIComponent).join("/")}`;
}
