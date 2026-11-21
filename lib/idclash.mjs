// `wf id --clashes`: the IDs this branch defines that main, or another open
// branch, defines too, for something else. Each branch takes "the next free
// one in its checkout", so two branches made side by side take the same
// decision, finding, or question numbers, and the second merge renumbers them
// by hand (Freeorbit, 2026-11-19 and 2026-11-21). Fetching main cannot see a
// branch not yet merged, so every open remote branch is read too.
//
// An ID is defined where doc:check and `wf id` say it is: the first cell of a
// table row, or a heading; a finding only in the review ledger, a chunk only
// in the build order, and a story only by its heading. It is new on a branch
// when a line the branch adds defines it and the commit the branch shares with
// this one defines it nowhere, so a ledger row moving between groups, or a
// question moving to the resolved log, is not new. Two branches that define
// one ID by the same title, such as work squash-merged into main already, or a
// row whose status changed since, define one thing.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, posix } from "node:path";

import { idKinds, kindIn } from "./ids.mjs";
import { CHUNK_ID } from "./lanes.mjs";
import { matcher } from "./config/config.mjs";

/** The kinds a branch numbers for itself, so two branches can take the same one. */
export const CLASH_KINDS = new Set(["decision", "question", "chunk", "finding", "rule", "check", "gap", "dataset", "story", "work"]);

// An ID at a definition's place: a table's first cell, such as `| [SEC-012](#sec-012) |` or `| D-GM-156 |`, or a heading. Never an acceptance line, GM-07.3.
const IN_CELL = /^\|\s*`?\[?([A-Za-z0-9]+(?:-[A-Za-z0-9]+)*)(?!\.\d)/;
const IN_HEADING = /^#{2,4}\s+`?\[?([A-Za-z0-9]+(?:-[A-Za-z0-9]+)*)(?!\.\d)/;

/** Where each kind may be defined in a project, so a table that happens to start with `SHA-256` or `UTF-8` defines nothing. */
function places(config) {
  const { ledger, ledgerClosed, ledgerClosedDetails } = config.logs;
  const order = config.buildOrder;
  const finding = matcher([ledger, ledgerClosed, ledgerClosedDetails && `${ledgerClosedDetails}/**`].filter(Boolean));
  const chunk = matcher([order.file, order.done, `${posix.dirname(order.file)}/build-order/**`].filter(Boolean));
  const story = matcher(config.stories.files ?? []);
  return { finding, chunk, story };
}

/**
 * What a definition says, one part a line: the title beside its ID, such as a
 * chunk's `37s. Bulk add` or a heading's words, then a row's other cells in order.
 */
function signature(line, heading, raw) {
  const beside = (text) => text.replace(/^`?\[?/, "").slice(raw.length).replace(/^\]?(\([^)]*\))?`?[.:\s]*/, "").replace(/[.\s]+$/, "").trim().toLowerCase();
  if (heading) return beside(line.replace(/^#+\s+/, ""));
  const [, first = "", ...cells] = line.split("|").map((cell) => cell.trim());
  return [beside(first), ...cells.slice(0, -1).map((cell) => cell.toLowerCase())].join("\n");
}

/**
 * Whether two definitions are one. Two with the same title beside the ID,
 * such as a heading's words or a chunk row's name, are one. Otherwise two
 * rows are one when they share their longest cell and it is long enough to be
 * a title, or when only one cell differs and it is neither row's longest,
 * such as a finding's status changed since. A decision whose words differ is
 * another decision; a short title that cannot tell rows apart is a clash, so
 * a doubt fails safe.
 */
export function sameDefinition(a, b) {
  if (a === b) return true;
  const [[ta, ...A], [tb, ...B]] = [a.split("\n"), b.split("\n")];
  if (ta && ta === tb) return true;
  if (!A.length || !B.length) return false;
  const longest = (cells) => Math.max(...cells.map((cell) => cell.length));
  const [la, lb] = [longest(A), longest(B)];
  const top = (cells, length) => cells.find((cell) => cell.length === length);
  if (la > 10 && top(A, la) === top(B, lb)) return true;
  if (A.length !== B.length) return false;
  const differ = A.map((_, i) => i).filter((i) => A[i] !== B[i]);
  return differ.length === 1 && A[differ[0]].length < la && B[differ[0]].length < lb;
}

/**
 * The IDs these lines define, of the kinds a branch numbers, each with the
 * words of each line that defines it: [{ path, line }] in, a Map of ID to a
 * Set of signatures out. A signature is what a definition says, not its
 * status, so a row whose status changed is the same definition.
 */
export function definedIn(entries, config) {
  const kindOf = kindIn(idKinds(config));
  const where = places(config);
  const ids = new Map();
  for (const { path, line } of entries) {
    const heading = line.match(IN_HEADING);
    const cell = heading ? null : line.match(IN_CELL);
    const raw = (heading ?? cell)?.[1];
    if (!raw) continue;
    let kind = kindOf(raw);
    // A bare chunk id, such as 37n, is a chunk where the build order lists it.
    if (cell && where.chunk(path) && CHUNK_ID.test(raw.toLowerCase())) kind = "chunk";
    if (!CLASH_KINDS.has(kind)) continue;
    if (kind === "finding" && !where.finding(path)) continue;
    if (kind === "chunk" && !where.chunk(path)) continue;
    if (kind === "story" && !(heading && where.story(path))) continue;
    const id = kind === "chunk" ? raw.toLowerCase() : raw;
    if (!ids.has(id)) ids.set(id, new Set());
    ids.get(id).add(signature(line, heading !== null, raw));
  }
  return ids;
}

/** Git, with no prompt for a password and a time limit, so a check never waits on the network for good. */
const run = (root, args, extra = {}) =>
  spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024, timeout: 60_000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }, ...extra });

/** Git's answer, or an error that says what failed. */
function must(root, args) {
  const res = run(root, args);
  if (res.status === 0) return res.stdout;
  throw new Error(`git ${args[0]} failed: ${String(res.stderr || res.error?.message || `exit ${res.status}`).trim()}`);
}

/** The added lines of a diff, each with its file. */
function addedLines(diff) {
  const out = [];
  let path = "";
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) path = line.slice(4).replace(/^b\//, "");
    else if (line.startsWith("+")) out.push({ path, line: line.slice(1) });
  }
  return out;
}

/** The IDs among `ids` that the Markdown at `commit` already defines. */
function definedAt(root, commit, ids, config) {
  if (!ids.size) return new Set();
  // The IDs go in on stdin, so no ID reaches git as an argument, however many there are.
  const res = run(root, ["grep", "-n", "-F", "-f", "-", commit, "--", "*.md"], { input: [...ids].join("\n") });
  if (res.error || (res.status !== 0 && res.status !== 1)) throw new Error(`git grep failed: ${String(res.stderr || res.error?.message || `exit ${res.status}`).trim()}`);
  const entries = res.stdout.split("\n").filter(Boolean).map((hit) => {
    const [, path = "", line = ""] = hit.match(/^[^:]+:([^:]+):\d+:(.*)$/) ?? [];
    return { path, line };
  });
  return new Set(definedIn(entries, config).keys());
}

/**
 * The IDs a change from `base` defines anew, each with its signatures: to
 * `ref`, or with no ref to the working tree, uncommitted and untracked files
 * included. With `only`, just those IDs are looked for at the base.
 */
export function newIds(root, config, base, ref = null, only = null) {
  const lines = addedLines(must(root, ["diff", "-U0", "--no-color", base, ...(ref ? [ref] : []), "--", "*.md"]));
  if (!ref) {
    for (const path of must(root, ["ls-files", "-z", "--others", "--exclude-standard", "--", "*.md"]).split("\0").filter(Boolean)) {
      for (const line of readFileSync(join(root, path), "utf8").split("\n")) lines.push({ path, line });
    }
  }
  const found = definedIn(lines, config);
  if (only) for (const id of [...found.keys()]) if (!only.has(id)) found.delete(id);
  const before = definedAt(root, base, new Set(found.keys()), config);
  return new Map([...found].filter(([id]) => !before.has(id)));
}

/**
 * Each ID this branch defines anew that main, or an open remote branch,
 * defines anew too, by other words, as { clashes: [{ id, refs }], notes }.
 * Each branch is read from where it parts from this one, so a branch this one
 * is built on shares its IDs, and work merged since is the same words. A
 * branch with no history in common is skipped, with a note. Fetches first
 * unless `fetch` is false; offline, it reads the branches already here, and
 * says so.
 */
export function idClashes(root, config, { fetch = true } = {}) {
  const notes = [];
  // With no remote yet, or its base not pushed, no other branch can hold an ID: nothing to check.
  if (run(root, ["remote", "get-url", "origin"]).status !== 0) return { clashes: [], notes: ["No origin remote, so no other branch to check against."] };
  if (fetch && run(root, ["fetch", "--quiet", "origin"]).status !== 0) notes.push("Could not fetch origin, so this checked the branches as last fetched.");
  const main = `origin/${config.design.base}`;
  if (run(root, ["rev-parse", "--verify", "--quiet", main]).status !== 0) return { clashes: [], notes: [...notes, `No ${main} yet, so no other branch to check against.`] };
  const mine = newIds(root, config, must(root, ["merge-base", main, "HEAD"]).trim());
  if (!mine.size) return { clashes: [], notes };
  const own = new Set(["origin/HEAD", "origin", `origin/${run(root, ["branch", "--show-current"]).stdout.trim()}`]);
  const upstream = run(root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]);
  if (upstream.status === 0) own.add(upstream.stdout.trim());
  // Branches whose work HEAD holds already share nothing new with it.
  const refs = must(root, ["for-each-ref", "--no-merged=HEAD", "--format=%(refname:short)", "refs/remotes/origin"]).split("\n").filter((ref) => ref && !own.has(ref));
  const clashes = new Map();
  for (const ref of [...new Set([main, ...refs])]) {
    const base = run(root, ["merge-base", "HEAD", ref]);
    if (base.status !== 0) {
      notes.push(`${ref} shares no history with this branch, so it was skipped.`);
      continue;
    }
    for (const [id, theirs] of newIds(root, config, base.stdout.trim(), ref, new Set(mine.keys()))) {
      const ours = [...mine.get(id)];
      if ([...theirs].some((words) => !ours.some((each) => sameDefinition(each, words)))) clashes.set(id, [...(clashes.get(id) ?? []), ref]);
    }
  }
  return { clashes: [...clashes].map(([id, on]) => ({ id, refs: on })).sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true })), notes };
}

/** The result as lines to print, and what to do. */
export function clashLines({ clashes, notes }) {
  const out = [...notes];
  if (!clashes.length) return [...out, "No ID this branch adds is taken on main or on an open branch."];
  return [
    ...out,
    ...clashes.map(({ id, refs }) => `${id}: also new on ${refs.join(", ")}`),
    `${clashes.length} ${clashes.length === 1 ? "ID clashes" : "IDs clash"}: renumber them here to the next ones free on every branch, then run this again.`,
  ];
}
