// The Claude Code plugins installed for a project, against the kit's pinned
// tag. The committed .claude/settings.json only says what should load; what
// does load is in Claude Code's own files, under its config folder
// (CLAUDE_CONFIG_DIR, else ~/.claude):
//
//   plugins/installed_plugins.json   { version: 2, plugins: { "<name>@<marketplace>": [entry, ...] } },
//                                    each entry { scope, projectPath?, version, ... }; version 1 held
//                                    one entry object per plugin, with no scope, installed for the user
//   plugins/known_marketplaces.json  { "<marketplace>": { source: { source, repo, ref? }, ... } }
//
// In Atlas NX on 2026-11-12, settings named v0.46.0 while its plugins were
// 0.27.0, and release and e2e were not installed at all, so /release was missing.

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

import { KIT_REPO } from "./init.mjs";

export const MARKETPLACE = "freeorbit-workflow";

/** Claude Code's config folder. */
export function claudeDir(env = process.env) {
  return env.CLAUDE_CONFIG_DIR || path.join(homedir(), ".claude");
}

/** A JSON file, or null when it is missing or unreadable. */
function readJson(file) {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

const real = (dir) => {
  try {
    return realpathSync(dir);
  } catch {
    return path.resolve(dir);
  }
};

/** Each install entry of a plugin, in either file shape: an array of entries, or one entry object. */
export function entriesOf(value) {
  const list = Array.isArray(value) ? value : value && typeof value === "object" ? [value] : [];
  return list.filter((entry) => entry && typeof entry === "object").map((entry) => ({ ...entry, scope: entry.scope ?? "user" }));
}

/**
 * The install that loads in this project for one plugin, or null: a project or
 * local one for this path wins over a user one, since Claude Code loads the
 * narrower scope.
 */
export function installFor(installed, id, root) {
  const plugins = installed?.plugins ?? installed ?? {};
  const here = real(root);
  const entries = entriesOf(plugins[id]);
  const mine = entries.filter((entry) => ["project", "local"].includes(entry.scope) && entry.projectPath && real(entry.projectPath) === here);
  return mine[0] ?? entries.find((entry) => entry.scope === "user") ?? null;
}

/** The kit's plugins the committed settings turn on, by short name, such as "core". */
export function enabledKitPlugins(settings) {
  return Object.entries(settings?.enabledPlugins ?? {})
    .filter(([id, on]) => on && id.endsWith(`@${MARKETPLACE}`))
    .map(([id]) => id.slice(0, -`@${MARKETPLACE}`.length));
}

/**
 * What is wrong with the installed plugins, as { problems, notes }, each line
 * with the command that fixes it; or { skip } when there is nothing to read.
 */
export function pluginReport({ root, tag, settings, installed, known }) {
  const wanted = enabledKitPlugins(settings);
  if (!wanted.length) return { skip: "no kit plugin is turned on in .claude/settings.json" };
  if (!tag) return { skip: "package.json pins no tag to compare with" };
  if (!installed) return { skip: "no plugins/installed_plugins.json in Claude Code's config folder, as in CI or with OpenCode only" };
  const version = tag.replace(/^v/, "");
  const add = `claude plugin marketplace add "${KIT_REPO}#${tag}" --scope project`;
  const ref = known?.[MARKETPLACE]?.source?.ref ?? null;
  const notes = [];
  if (known && ref !== tag) notes.push(`the ${MARKETPLACE} marketplace Claude Code knows is at ${ref ?? "no ref"}, the pin is ${tag}: ${add}`);
  const problems = [];
  for (const name of wanted) {
    const id = `${name}@${MARKETPLACE}`;
    const entry = installFor(installed, id, root);
    if (!entry) problems.push(`${id} is turned on but not installed: claude plugin install ${id} --scope project`);
    else if (entry.version !== version) problems.push(`${id} is ${entry.version ?? "of no version"} (${entry.scope} scope), the pin is ${tag}: claude plugin update ${id} --scope ${entry.scope}`);
  }
  // An update installs what the marketplace has, so the marketplace moves to the pin first.
  if (problems.length && ref !== tag) problems.unshift(`first, the marketplace: ${add}`);
  return { problems, notes };
}

/** Read Claude Code's files and report; `dir` swaps the config folder for tests. */
export function installedPlugins(root, tag, settings, dir = claudeDir()) {
  return pluginReport({
    root,
    tag,
    settings,
    installed: readJson(path.join(dir, "plugins", "installed_plugins.json")),
    known: readJson(path.join(dir, "plugins", "known_marketplaces.json")),
  });
}
