// `wf id --clashes`: the IDs this branch defines that main, or another open
// branch, defines too. Each branch takes "the next free one in its checkout",
// so two branches made side by side take the same decision, finding, or
// question numbers, and the second merge renumbers them by hand (Freeorbit,
// 2026-11-19 and 2026-11-21). Fetching main cannot see a branch not yet
// merged, so every open remote branch is read too.
//
// An ID is defined where doc:check and `wf id` say it is: the first cell of a
// table row, or a heading. It is new on a branch when a line the branch adds
// defines it and the commit the branch started from defines it nowhere, so a
// ledger row moving between groups, or a question moving to the resolved log,
// is not new.

import { spawnSync } from "node:child_process";

import { git } from "./process.mjs";
import { kindOf } from "./ids.mjs";

/** The kinds a branch numbers for itself, so two branches can take the same one. */
export const CLASH_KINDS = new Set(["decision", "question", "chunk", "finding", "rule", "check", "gap", "dataset", "story", "work"]);

/** An ID at a definition's place in a line: a table's first cell, such as `| [SEC-012](#sec-012) |` or `| CH-30. Title |`, or a heading. */
const AT_DEFINITION = /^(?:\|\s*`?\[?|#{2,4}\s+`?\[?)([A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)+)/;

/** The IDs these lines define, of the kinds a branch numbers, each with the line that defines it. */
export function definedIn(lines, config) {
  const ids = new Map();
  for (const line of lines) {
    const id = line.match(AT_DEFINITION)?.[1]?.replace(/\.$/, "");
    if (id && CLASH_KINDS.has(kindOf(id, config)) && !ids.has(id)) ids.set(id, line.trim());
  }
  return ids;
}

const run = (root, args) => spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });

/** The IDs among `ids` that the Markdown at `commit` already defines. */
function definedAt(root, commit, ids, config) {
  if (!ids.size) return new Set();
  const res = run(root, ["grep", "-h", "-F", ...[...ids].flatMap((id) => ["-e", id]), commit, "--", "*.md"]);
  // 1 is no match; anything else is git failing, which is said.
  if (res.status > 1) throw new Error(`git grep failed: ${res.stderr.trim()}`);
  return definedIn(res.stdout.split("\n"), config);
}

/** The IDs a change from `base` defines anew: to `ref`, or with no ref to the working tree, uncommitted changes included. */
export function newIds(root, config, base, ref = null) {
  const diff = git(root, ["diff", "-U0", "--no-color", base, ...(ref ? [ref] : []), "--", "*.md"]);
  const added = diff.split("\n").filter((line) => line.startsWith("+") && !line.startsWith("+++")).map((line) => line.slice(1));
  const found = definedIn(added, config);
  const before = definedAt(root, base, new Set(found.keys()), config);
  return new Map([...found].filter(([id]) => !before.has(id)));
}

/**
 * Each ID this branch defines anew that main, since this branch started, or
 * an open remote branch defines anew too, by a different line, as [{ id,
 * refs }]; the same line on both, such as work squash-merged into main
 * already, is one definition. A branch this one
 * is built on is left out, since its IDs are this branch's own. Fetches first
 * unless `fetch` is false; offline, it reads the remote branches it has.
 */
export function idClashes(root, config, { fetch = true, log = () => {} } = {}) {
  // With no remote yet, or its base not pushed, no other branch can hold an ID: nothing to check.
  if (run(root, ["remote", "get-url", "origin"]).status !== 0) {
    log("No origin remote, so no other branch to check against.");
    return [];
  }
  if (fetch && run(root, ["fetch", "--quiet", "--prune", "origin"]).status !== 0) log("Could not fetch origin; checking against the remote branches already here.");
  const main = `origin/${config.design.base}`;
  if (run(root, ["rev-parse", "--verify", "--quiet", main]).status !== 0) {
    log(`No ${main} yet, so no other branch to check against.`);
    return [];
  }
  const branch = run(root, ["branch", "--show-current"]).stdout.trim();
  const mine = newIds(root, config, git(root, ["merge-base", main, "HEAD"]).trim());
  if (!mine.size) return [];
  const others = [main, ...git(root, ["for-each-ref", "--format=%(refname:short)", "refs/remotes/origin"]).split("\n").filter(Boolean)]
    .filter((ref, at, all) => all.indexOf(ref) === at && ref !== "origin/HEAD" && ref !== "origin" && ref !== `origin/${branch}`);
  const clashes = new Map();
  for (const ref of others) {
    if (ref !== main && run(root, ["merge-base", "--is-ancestor", ref, "HEAD"]).status === 0) continue;
    const base = git(root, ["merge-base", ref === main ? "HEAD" : main, ref]).trim();
    if (git(root, ["rev-parse", ref]).trim() === base) continue;
    // The same row on both, such as this branch's work already squash-merged into main, is one definition, not two.
    for (const [id, line] of newIds(root, config, base, ref)) if (mine.has(id) && mine.get(id) !== line) clashes.set(id, [...(clashes.get(id) ?? []), ref]);
  }
  return [...clashes].map(([id, refs]) => ({ id, refs })).sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
}

/** The clashes as lines to print, and what to do. */
export function clashLines(clashes) {
  if (!clashes.length) return ["No ID this branch adds is taken on main or on an open branch."];
  return [
    ...clashes.map(({ id, refs }) => `${id}: also new on ${refs.join(", ")}`),
    `${clashes.length} ${clashes.length === 1 ? "ID clashes" : "IDs clash"}: renumber them here to the next ones free on every branch, then run this again.`,
  ];
}
