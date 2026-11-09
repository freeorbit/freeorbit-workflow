// The git hooks that hold branches.md: nothing is committed or pushed to a
// protected branch (the base, or a release line), and a pushed branch is named
// <scope>/<slug>, with its scope from `scopes` or an area's id.
//
//   wf hooks install      write the shims to .workflow/hooks/ and point this clone at them
//   wf hooks pre-commit   run by the shim
//   wf hooks pre-push     run by the shim, with git's ref lines on stdin

import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const HOOKS_PATH = ".workflow/hooks";
export const HOOKS = ["pre-commit", "pre-push"];

/** A hook's shim: it runs the kit from the project's own install, so it needs no network. */
export function shim(hook) {
  return [
    "#!/bin/sh",
    "# Holds the branch rules in branches.md through the workflow kit. Written by wf hooks install.",
    'wf="$(git rev-parse --show-toplevel)/node_modules/.bin/wf"',
    'if [ ! -x "$wf" ]; then echo "Branch rules: the workflow kit is not installed; run the package install first." >&2; exit 1; fi',
    `exec "$wf" hooks ${hook}`,
    "",
  ].join("\n");
}

/** The scopes a branch may start with: the config's scopes and every area id. */
export function scopesOf(config) {
  return [...new Set([...config.scopes, ...config.areas.map((area) => area.id)])];
}

/** True for a branch nothing is committed or pushed to directly. */
export function isProtected(branch, config) {
  return config.branches.protected.some((pattern) => {
    let match;
    try {
      match = new RegExp(`^(?:${pattern})$`);
    } catch {
      throw new Error(`branches.protected has ${JSON.stringify(pattern)}, which is not a valid pattern`);
    }
    return match.test(branch);
  });
}

/** Why a branch name breaks the rules, or "" when it keeps them. */
export function nameProblem(branch, config) {
  if (isProtected(branch, config)) return "";
  const known = scopesOf(config);
  const [scope, slug, ...rest] = branch.split("/");
  if (rest.length || slug === undefined) return `"${branch}" is not <scope>/<slug>, such as workflow/branch-rules.`;
  if (!known.includes(scope)) return `"${scope}" is not a scope. Use one of: ${known.join(", ")}.`;
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return `"${slug}" is not lowercase words joined by hyphens.`;
  if (slug.length > config.branches.slugMax) return `"${slug}" is longer than ${config.branches.slugMax} characters.`;
  return "";
}

/** The problems with a push, from the lines git gives pre-push: `<local ref> <sha> <remote ref> <sha>`. */
export function pushProblems(lines, config) {
  return lines
    .map((line) => line.split(" ")[2] ?? "")
    .filter((ref) => ref.startsWith("refs/heads/"))
    .map((ref) => ref.slice("refs/heads/".length))
    .map((branch) => (isProtected(branch, config) ? `${branch} takes changes only through a pull request.` : nameProblem(branch, config)))
    .filter(Boolean);
}

/** A line when this clone does not run the hooks, or "". */
export function hooksLine(hooksPath) {
  return hooksPath === HOOKS_PATH ? "" : "branch hooks off: run npx wf hooks install. See branches.md.";
}

/** This clone's core.hooksPath, or "". */
export function hooksPathOf(root) {
  try {
    return execFileSync("git", ["config", "core.hooksPath"], { cwd: root, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

/** Write the shims and point this clone at them; returns what it did. */
export function install(root, git = (args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })) {
  // An install outside a clone, such as a packed copy or a container build, has no hooks to set.
  try {
    git(["rev-parse", "--git-dir"]);
  } catch {
    return ["not a git clone: hooks not installed"];
  }
  mkdirSync(join(root, HOOKS_PATH), { recursive: true });
  for (const hook of HOOKS) {
    const file = join(root, HOOKS_PATH, hook);
    writeFileSync(file, shim(hook));
    chmodSync(file, 0o755);
  }
  // A failed config write leaves the hooks off but must not fail the package install; wf tools reports it.
  try {
    git(["config", "core.hooksPath", HOOKS_PATH]);
  } catch {
    return [`${HOOKS_PATH}: written`, "core.hooksPath could not be set: hooks are off; run git config core.hooksPath " + HOOKS_PATH];
  }
  return [`${HOOKS_PATH}/${HOOKS.join(`, ${HOOKS_PATH}/`)}: written`, `core.hooksPath: ${HOOKS_PATH}`];
}

/** Run one hook; returns its exit code and the lines to print on stderr. */
export function runHook(root, config, hook, { branch, input } = {}) {
  const problems =
    hook === "pre-commit"
      ? (() => {
          const current = branch ?? execFileSync("git", ["branch", "--show-current"], { cwd: root, encoding: "utf8" }).trim();
          return isProtected(current, config) ? [`do not commit on ${current}. Start a branch: git switch -c <scope>/<slug>.`] : [];
        })()
      : pushProblems((input ?? readFileSync(0, "utf8")).split("\n").filter(Boolean), config);
  if (!problems.length) return { code: 0, lines: [] };
  return { code: 1, lines: [...problems.map((problem) => `Branch rules: ${problem}`), "See branches.md."] };
}
