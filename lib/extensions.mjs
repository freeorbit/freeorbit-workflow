// A project's own checks and facts, loaded from the modules its config lists
// under `extensions`, as paths from the project root. A module may export:
//   checks(context)  -> string[]   problems, after the story check
//   status(context)  -> string[]   status lines, after "Last done"
// `context` is { root, config, tracked, files }.

import { join } from "node:path";
import { pathToFileURL } from "node:url";

export async function loadExtensions({ root, config }) {
  return Promise.all(config.extensions.map((path) => import(pathToFileURL(join(root, path)).href)));
}
