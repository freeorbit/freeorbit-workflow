// The IDs a branch adds, checked against main and every open branch, on real
// repositories: an origin, a main, and branches made side by side.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { merge } from "../lib/config/config.mjs";
import { DEFAULTS } from "../lib/config/defaults.mjs";
import { clashLines, definedIn, idClashes } from "../lib/idclash.mjs";

const config = merge(DEFAULTS, { areas: [{ id: "uplink", prefix: "GM", docs: "docs/uplink" }] });
const DECISIONS = "docs/log/decisions/uplink.md";
const LEDGER = "docs/log/review/findings.md";
const head = "| ID | Decision | Why | Date |\n| --- | --- | --- | --- |\n";
const row = (id, by = "main") => `| ${id} | Something ${by} decided | Because | 2026-11-21 |\n`;

/** An origin, and a clone of it on main with a decisions file and a ledger. */
function repos() {
  const top = mkdtempSync(join(tmpdir(), "wf-idclash-"));
  const git = (cwd, ...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, encoding: "utf8" }).trim();
  const origin = join(top, "origin.git");
  git(top, "init", "-q", "--bare", "-b", "main", origin);
  const work = join(top, "work");
  git(top, "clone", "-q", origin, work);
  const write = (path, text) => {
    mkdirSync(join(work, path, ".."), { recursive: true });
    writeFileSync(join(work, path), text);
  };
  write(DECISIONS, head + row("D-GM-155"));
  write(LEDGER, "## Open\n\n| ID | Severity | Status | Title | Where |\n| --- | --- | --- | --- | --- |\n| [MOD-231](#mod-231) | Low | proposed | One | `a.rs:1` |\n\n## Fixed\n\nNone.\n");
  git(work, "add", ".");
  git(work, "commit", "-qm", "main");
  git(work, "push", "-q", "origin", "main");
  /** A branch from main with these lines added to the decisions file, pushed when `push`. */
  const branch = (name, ids, { push = true, from = "origin/main" } = {}) => {
    git(work, "checkout", "-q", "-b", name, from);
    write(DECISIONS, `${execFileSync("git", ["show", `${from}:${DECISIONS}`], { cwd: work, encoding: "utf8" })}${ids.map((id) => row(id, name)).join("")}`);
    git(work, "commit", "-qam", name);
    if (push) git(work, "push", "-q", "origin", name);
  };
  return { work, git, write, branch };
}

test("an ID is defined by a table's first cell or a heading, of a kind a branch numbers", () => {
  const ids = definedIn(["| D-GM-156 | x |", "| [SEC-012](#sec-012) | High |", "| CH-30. Search | x |", "### GM-07. Title", "### DS-GM-27. Mail", "| Q-113 | y |", "See D-GM-200 in a sentence", "| GM-07.3 | an acceptance line |", "| fixture-name | x |"], config);
  assert.deepEqual([...ids.keys()].sort(), ["CH-30", "D-GM-156", "DS-GM-27", "GM-07", "Q-113", "SEC-012"]);
});

test("a branch's new IDs clash with an open branch's and main's, not with a branch it is built on", () => {
  const { work, git, branch, write } = repos();
  branch("uplink/37s", ["D-GM-156", "D-GM-157"]);
  branch("uplink/37q", ["D-GM-158"]);
  branch("uplink/37o", ["D-GM-156", "D-GM-158", "D-GM-159"], { push: false });
  const clashes = idClashes(work, config, { fetch: false });
  assert.deepEqual(clashes, [{ id: "D-GM-156", refs: ["origin/uplink/37s"] }, { id: "D-GM-158", refs: ["origin/uplink/37q"] }]);
  assert.match(clashLines(clashes).join("\n"), /D-GM-156: also new on origin\/uplink\/37s\nD-GM-158: also new on origin\/uplink\/37q\n2 IDs clash: renumber them/);
  // Uncommitted changes count: a finding added to the ledger and not yet committed.
  git(work, "checkout", "-q", "-b", "app/38a", "origin/uplink/37s");
  write(DECISIONS, `${head}${row("D-GM-155")}${row("D-GM-156", "uplink/37s")}${row("D-GM-157", "uplink/37s")}${row("D-GM-160")}`);
  assert.deepEqual(idClashes(work, config, { fetch: false }), [], "built on 37s, its IDs are this branch's own");
  // Main takes D-GM-160 after this branch started: a clash with main.
  git(work, "stash", "-q");
  git(work, "checkout", "-q", "main");
  write(DECISIONS, `${head}${row("D-GM-155")}${row("D-GM-160")}`);
  git(work, "commit", "-qam", "main takes 160");
  git(work, "push", "-q", "origin", "main");
  git(work, "checkout", "-q", "app/38a");
  git(work, "stash", "pop", "-q");
  assert.deepEqual(idClashes(work, config, { fetch: false }), [], "main took D-GM-160 by the same row: one definition");
  git(work, "stash", "-q");
  git(work, "checkout", "-q", "main");
  write(DECISIONS, `${head}${row("D-GM-155")}${"| D-GM-161 | Another | Reason | 2026-11-22 |\n"}`);
  git(work, "commit", "-qam", "main takes 161 for something else");
  git(work, "push", "-q", "origin", "main");
  git(work, "checkout", "-q", "app/38a");
  git(work, "stash", "drop", "-q");
  write(DECISIONS, `${head}${row("D-GM-155")}${row("D-GM-156", "uplink/37s")}${row("D-GM-157", "uplink/37s")}${row("D-GM-161")}`);
  assert.deepEqual(idClashes(work, config, { fetch: false }), [{ id: "D-GM-161", refs: ["origin/main"] }], "main took D-GM-161 for a different decision");
});

test("a row that only moves, such as a finding closing, is not a new ID", () => {
  const { work, git, write } = repos();
  for (const name of ["review/a", "review/b"]) {
    git(work, "checkout", "-q", "-b", name, "origin/main");
    write(LEDGER, "## Open\n\nNone.\n\n## Fixed\n\n| ID | Severity | Status | Title | Where |\n| --- | --- | --- | --- | --- |\n| [MOD-231](#mod-231) | Low | fixed | One | `a.rs:1` |\n");
    git(work, "commit", "-qam", name);
    git(work, "push", "-q", "origin", name);
  }
  assert.deepEqual(idClashes(work, config, { fetch: false }), []);
});

test("with no remote, or no origin main yet, there is nothing to check against, and it says so", () => {
  const top = mkdtempSync(join(tmpdir(), "wf-idclash-none-"));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: top });
  const said = [];
  assert.deepEqual(idClashes(top, config, { fetch: false, log: (line) => said.push(line) }), []);
  execFileSync("git", ["remote", "add", "origin", join(top, "nowhere.git")], { cwd: top });
  assert.deepEqual(idClashes(top, config, { fetch: false, log: (line) => said.push(line) }), []);
  assert.deepEqual(said, ["No origin remote, so no other branch to check against.", "No origin/main yet, so no other branch to check against."]);
});
