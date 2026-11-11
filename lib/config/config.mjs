// Loads a project's .workflow/config.json over the kit's defaults, and finds
// the project from where the agent or person runs, never from the kit's own
// location (K0: an installed kit lives elsewhere).

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { DEFAULTS } from "./defaults.mjs";

export const CONFIG_PATH = ".workflow/config.json";

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/** `override` laid over `base`: objects merge key by key, anything else replaces. */
export function merge(base, override) {
  if (!isObject(base) || !isObject(override)) return override === undefined ? base : override;
  const out = { ...base };
  for (const [key, value] of Object.entries(override)) out[key] = merge(base[key], value);
  return out;
}

// Maps a project fills with its own names, so their keys are not checked.
export const OPEN = new Set(["decisions", "docs.words", "testdata.commands", "design.kinds", "app.databases", "app.web.sizes", "screens.stress", "release.commands"]);

/** Keys in `given` that the defaults do not know, as dotted paths, so a typo is not silently ignored. */
export function unknownKeys(given, known = DEFAULTS, prefix = "") {
  if (!isObject(given)) return [];
  return Object.entries(given).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    // The schema link an editor reads is not a setting.
    if (!prefix && key === "$schema") return [];
    if (!(key in known)) return OPEN.has(prefix) ? [] : [path];
    return isObject(known[key]) ? unknownKeys(value, known[key], path) : [];
  });
}

/** The top of the git work tree that holds `cwd`. */
export function projectRoot(cwd = process.cwd()) {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8" }).trim();
}

/** The project's config over the defaults. Throws on a key the kit does not know. */
export function loadConfig(root) {
  const path = join(root, CONFIG_PATH);
  const given = existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {};
  const unknown = unknownKeys(given);
  if (unknown.length) throw new Error(`${CONFIG_PATH}: unknown key ${unknown.join(", ")}`);
  return merge(DEFAULTS, given);
}

/** A glob as a RegExp: `**` crosses folders, `*` and `?` do not. */
export function globRegex(glob) {
  let out = "";
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob[i];
    if (char === "*" && glob[i + 1] === "*") {
      out += glob[i + 2] === "/" ? "(?:.*/)?" : ".*";
      i += glob[i + 2] === "/" ? 2 : 1;
    } else if (char === "*") out += "[^/]*";
    else if (char === "?") out += "[^/]";
    else out += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`);
}

/** A test for whether a path matches any of the globs. */
export function matcher(globs) {
  const patterns = globs.map(globRegex);
  return (path) => patterns.some((pattern) => pattern.test(path));
}

/** Everything a script needs about the project: its root, config, files, and a cached reader. */
export function project(cwd = process.cwd()) {
  const root = projectRoot(cwd);
  const config = loadConfig(root);
  const tracked = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8" })
    .split("\n")
    .filter(Boolean);
  const cache = new Map();
  const files = (path) => {
    if (!cache.has(path)) cache.set(path, readFileSync(join(root, path), "utf8"));
    return cache.get(path);
  };
  return { root, config, tracked, files };
}
