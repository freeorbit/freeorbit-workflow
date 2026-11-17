// Loads a project's .workflow/config.json over the kit's defaults, and finds
// the project from where the agent or person runs, never from the kit's own
// location (K0: an installed kit lives elsewhere).

import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { join, sep } from "node:path";

import { DEFAULTS } from "./defaults.mjs";
import { git, readJsonFile } from "../process.mjs";
import { OPEN_CHOICES } from "../view/harness.mjs";

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
export const OPEN = new Set(["decisions", "docs.words", "testdata.commands", "testdata.limits.allow", "design.kinds", "app.databases", "app.web.sizes", "screens.stress", "release.commands"]);

/** Keys a kit version took out. A project that still sets one keeps working; the key does nothing. */
export const RETIRED = new Set(["testdata.limits.checks", "screens.headless", "screens.jobsMax", "screens.display"]);

/** Where a screen run's apps show, each word and what it means. */
const SHOW = {
  screen: "one app, on the person's screen, to watch",
  virtual: "each app on its own KWin virtual display, off the person's screen",
  headless: "a web app's browser with no window",
  auto: "headless for a web app, virtual for any other",
};

/** The values a setting takes, where it is one of a few words, each with what it means. */
export const CHOICES = {
  "screens.runs.review.show": SHOW,
  "screens.runs.build.show": SHOW,
  "ask.open": OPEN_CHOICES,
  "logs.ledgerClosedPeriod": {
    week: "one file per ISO week a finding closed in, such as 2026-W46.md",
    month: "one file per month, such as 2026-11.md, for a project that closes few",
  },
  "review.performance": {
    deep: "every deep run, and a light run whose changes touch a hot path's files",
    always: "every run, light or deep",
    off: "never; the security and structure passes only",
  },
};

/**
 * Values the kit cannot use: a word not among a setting's choices, a window
 * shown headless, or jobs that are not a whole number from 1 to 16, or more
 * than one with "screen", which is always one. `given` is the project's own
 * file, so a default is never blamed.
 */
export function valueProblems(config, given = config) {
  const at = (obj, path) => path.split(".").reduce((value, key) => value?.[key], obj);
  const problems = [];
  for (const [path, meanings] of Object.entries(CHOICES)) {
    const words = Object.keys(meanings);
    const value = at(config, path);
    if (!words.includes(value)) problems.push(`${path} is ${words.join(", ")}, not ${JSON.stringify(value)}`);
  }
  for (const kind of ["review", "build"]) {
    const run = config.screens?.runs?.[kind] ?? {};
    if (run.show === "headless" && config.app?.kind !== "web") problems.push(`screens.runs.${kind}.show is headless, which is for a web app's browser; an app's window is screen or virtual`);
    if (!Number.isInteger(run.jobs) || run.jobs < 1 || run.jobs > 16) problems.push(`screens.runs.${kind}.jobs is a whole number from 1 to 16, not ${JSON.stringify(run.jobs)}`);
    else if (run.show === "screen" && at(given, `screens.runs.${kind}.jobs`) > 1) problems.push(`screens.runs.${kind}.jobs is ${run.jobs}, but show is screen, which is always one app; leave jobs out`);
  }
  return problems;
}

/** Keys in `given` that the defaults do not know, as dotted paths, so a typo is not silently ignored. */
export function unknownKeys(given, known = DEFAULTS, prefix = "") {
  if (!isObject(given)) return [];
  return Object.entries(given).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    // The schema link an editor reads is not a setting.
    if (!prefix && key === "$schema") return [];
    if (!(key in known)) return OPEN.has(prefix) || RETIRED.has(path) ? [] : [path];
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
  const given = existsSync(path) ? readJsonFile(path, CONFIG_PATH) : {};
  const unknown = unknownKeys(given);
  if (unknown.length) throw new Error(`${CONFIG_PATH}: unknown key ${unknown.join(", ")}`);
  const config = merge(DEFAULTS, given);
  const problems = valueProblems(config, given);
  if (problems.length) throw new Error(`${CONFIG_PATH}: ${problems.join("; ")}`);
  return config;
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

/**
 * Everything a script needs about the project: its root, config, files, and a
 * cached reader. A file deleted but not yet staged is left out, since git
 * still lists it, and so is a submodule. `links` holds the files that are symbolic links, which a
 * step that writes must leave alone: one can point outside the project.
 */
export function project(cwd = process.cwd()) {
  const root = projectRoot(cwd);
  const config = loadConfig(root);
  const links = new Set();
  const real = realpathSync(root);
  // A link that leads out of the project is left out, so no reader takes text from outside it.
  const inside = (path) => {
    const to = realpathSync(join(root, path));
    return to === real || to.startsWith(real + sep);
  };
  const tracked = git(root, ["ls-files", "--cached", "--others", "--exclude-standard"])
    .split("\n")
    .filter((path) => {
      if (!path) return false;
      try {
        const stat = lstatSync(join(root, path));
        // Every link is named, so a step that writes leaves it alone; one that leads out is not listed to read.
        if (stat.isSymbolicLink()) {
          links.add(path);
          if (!inside(path)) return false;
        }
        // A submodule is listed as a folder, which holds no text of its own.
        return stat.isFile() || stat.isSymbolicLink();
      } catch {
        return false;
      }
    });
  const cache = new Map();
  const files = (path) => {
    if (!cache.has(path)) {
      if (!inside(path)) throw new Error(`${path} leads out of the project, so the kit does not read it`);
      cache.set(path, readFileSync(join(root, path), "utf8"));
    }
    return cache.get(path);
  };
  return { root, config, tracked, files, links };
}

/** The screens.* keys before v0.87.0, which screens.runs replaced; a project still setting one is told what to write. */
export function retiredRuns(config) {
  const old = config.screens ?? {};
  if (old.headless === undefined && old.jobsMax === undefined && old.display === undefined) return null;
  const web = config.app?.kind === "web";
  const runs = {};
  for (const kind of ["review", "build"]) {
    const headless = old.headless?.[kind] ?? (web ? config.app.web.headless : null);
    // false always meant "on the person's screen"; true is headless for a browser, a virtual display for a window.
    let show = old.headless?.[kind] === false ? "screen" : web && headless ? "headless" : "virtual";
    if (show === "virtual" && old.display === "none") show = "screen";
    runs[kind] = show === "screen" ? { show } : { show, jobs: old.jobsMax ?? 8 };
  }
  return runs;
}
