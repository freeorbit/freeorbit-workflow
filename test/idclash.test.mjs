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
import { kindOf } from "../lib/ids.mjs";
import { clashLines, definedIn, idClashes, sameDefinition } from "../lib/idclash.mjs";

const config = merge(DEFAULTS, { areas: [{ id: "uplink", prefix: "GM", docs: "docs/uplink" }] });
const DECISIONS = "docs/log/decisions/uplink.md";
const LEDGER = "docs/log/review/findings.md";
const head = "| ID | Decision | Why | Date |\n| --- | --- | --- | --- |\n";
const row = (id, by = "main") => `| ${id} | Something ${by} decided | Because | 2026-11-21 |\n`;
const ledgerRow = (id, status, title) => `| [${id}](#${id.toLowerCase()}) | Low | ${status} | ${title} | \`a.rs:1\` |\n`;

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
  write(LEDGER, `## Open\n\n| ID | Severity | Status | Title | Where |\n| --- | --- | --- | --- | --- |\n${ledgerRow("MOD-231", "proposed", "The first finding")}\n`);
  git(work, "add", ".");
  git(work, "commit", "-qm", "main");
  git(work, "push", "-q", "origin", "main");
  /** A branch from `from` with these decisions added, pushed when `push`. */
  const branch = (name, ids, { push = true, from = "origin/main" } = {}) => {
    git(work, "checkout", "-q", "-b", name, from);
    write(DECISIONS, `${execFileSync("git", ["show", `${from}:${DECISIONS}`], { cwd: work, encoding: "utf8" })}${ids.map((id) => row(id, name)).join("")}`);
    git(work, "commit", "-qam", name);
    if (push) git(work, "push", "-q", "origin", name);
  };
  const clashes = () => idClashes(work, config, { fetch: false }).clashes;
  return { work, git, write, branch, clashes };
}

test("an ID is defined by a table's first cell or a heading, of a kind a branch numbers, in the file its kind lives in", () => {
  const at = (path, line) => ({ path, line });
  const ids = definedIn(
    [
      at(DECISIONS, "| D-GM-156 | x |"),
      at(LEDGER, "| [SEC-012](#sec-012) | High | proposed | A title | x |"),
      at("docs/log/build-order.md", "| 37n. Hands-on fixes | x |"),
      at("docs/log/build-order.md", "| CH-30. Search | x |"),
      at("docs/app/user-stories.md", "### GM-07. Title"),
      at("docs/uplink/test-data/move.md", "### DS-GM-27. Mail"),
      at("docs/log/open-questions.md", "| Q-113 | y |"),
      at(DECISIONS, "See D-GM-200 in a sentence"),
      at("docs/app/user-stories.md", "| GM-07.3 | an acceptance line |"),
      at("docs/uplink/story-changes.md", "| GM-42 | added | 2026-11-22 |"),
      at("docs/workflow/notes.md", "| SHA-256 | a hash |"),
      at("docs/workflow/notes.md", "## UTF-8 handling"),
      at("docs/workflow/notes.md", "| 38y. Not a chunk here | x |"),
    ],
    config,
  );
  assert.deepEqual([...ids.keys()].sort(), ["37n", "CH-30", "D-GM-156", "DS-GM-27", "GM-07", "Q-113", "SEC-012"].map((id) => (id === "CH-30" ? "ch-30" : id)).sort());
  assert.deepEqual([...ids.get("SEC-012")], ["\nhigh\nproposed\na title\nx"], "no title beside the ID, then the row's cells in order");
  assert.deepEqual([...ids.get("37n")], ["hands-on fixes\nx"]);
  assert.deepEqual([...ids.get("GM-07")], ["title"]);
  assert.ok(sameDefinition("bulk add\nGM-41\nthe first words", "bulk add\nGM-41\nwords edited since\n2026-11-22"), "a chunk moved to the done list and edited");
  assert.ok(!sameDefinition("bulk add\nGM-41", "search\nGM-41"), "another chunk");
  assert.ok(sameDefinition("\nlow\nproposed\nthe ledger loses a row\n`a.rs:1`", "\nlow\nfixed\nthe ledger loses a row\n`a.rs:1`"), "a status changed");
  assert.ok(sameDefinition("\nlow\nproposed\nthe ledger loses a row\n`a.rs:1`", "\nthe ledger loses a row\n`a.rs:1`\n2026-11-22"), "moved to the closed log, its columns other");
  assert.ok(!sameDefinition("\nlow\nproposed\none\n`a.rs:1`", "\nlow\nproposed\ntwo\n`b.rs:2`"), "two findings, short titles");
  assert.ok(!sameDefinition("\nsomething main decided\nbecause\n2026-11-21", "\nsomething 37s decided\nbecause\n2026-11-21"), "another decision, the rest alike");
});

test("a branch's new IDs clash with an open branch's and main's, not with a branch it is built on", () => {
  const { work, git, branch, write, clashes } = repos();
  branch("uplink/37s", ["D-GM-156", "D-GM-157"]);
  branch("uplink/37q", ["D-GM-158"]);
  branch("uplink/37o", ["D-GM-156", "D-GM-158", "D-GM-159"], { push: false });
  const found = idClashes(work, config, { fetch: false });
  assert.deepEqual(found.clashes, [{ id: "D-GM-156", refs: ["origin/uplink/37s"] }, { id: "D-GM-158", refs: ["origin/uplink/37q"] }]);
  assert.match(clashLines(found).join("\n"), /D-GM-156: also new on origin\/uplink\/37s\nD-GM-158: also new on origin\/uplink\/37q\n2 IDs clash: renumber them/);
  // Built on 37s, with an uncommitted decision: 37s's IDs are this branch's own, even after 37s changes one.
  git(work, "checkout", "-q", "-b", "app/38a", "origin/uplink/37s");
  write(DECISIONS, `${head}${row("D-GM-155")}${row("D-GM-156", "uplink/37s")}${row("D-GM-157", "uplink/37s")}${row("D-GM-160", "app/38a")}`);
  assert.deepEqual(clashes(), [], "built on 37s");
  // An untracked file counts too.
  write("docs/log/decisions/new-topic.md", `${head}${row("D-GM-158", "app/38a")}`);
  assert.deepEqual(clashes(), [{ id: "D-GM-158", refs: ["origin/uplink/37q"] }], "an untracked file's decision");
});

test("work merged since, or a row whose status changed, is one definition; another decision under the same ID is a clash", () => {
  const { work, git, write, clashes } = repos();
  // A branch adds a finding and a decision; main squash-merges them and later closes the finding.
  git(work, "checkout", "-q", "-b", "review/a", "origin/main");
  write(LEDGER, `## Open\n\n| ID | Severity | Status | Title | Where |\n| --- | --- | --- | --- | --- |\n${ledgerRow("MOD-231", "proposed", "The first finding")}${ledgerRow("MOD-232", "proposed", "The second finding")}\n`);
  write(DECISIONS, `${head}${row("D-GM-155")}${row("D-GM-161", "review/a")}`);
  git(work, "commit", "-qam", "a");
  git(work, "checkout", "-q", "main");
  write(LEDGER, `## Open\n\n| ID | Severity | Status | Title | Where |\n| --- | --- | --- | --- | --- |\n${ledgerRow("MOD-231", "proposed", "The first finding")}${ledgerRow("MOD-232", "fixed", "The second finding")}\n`);
  write(DECISIONS, `${head}${row("D-GM-155")}${row("D-GM-161", "review/a")}`);
  git(work, "commit", "-qam", "squash of a, then MOD-232 fixed");
  git(work, "push", "-q", "origin", "main");
  git(work, "checkout", "-q", "review/a");
  assert.deepEqual(clashes(), [], "the same words: one definition");
  git(work, "checkout", "-q", "main");
  write(DECISIONS, `${head}${row("D-GM-155")}${row("D-GM-161", "review/a")}${row("D-GM-162", "main")}`);
  git(work, "commit", "-qam", "main takes 162");
  git(work, "push", "-q", "origin", "main");
  git(work, "checkout", "-q", "review/a");
  write(DECISIONS, `${head}${row("D-GM-155")}${row("D-GM-161", "review/a")}${row("D-GM-162", "review/a")}`);
  assert.deepEqual(clashes(), [{ id: "D-GM-162", refs: ["origin/main"] }], "main took 162 for another decision");
});

test("a branch with no history in common is skipped with a note; with no remote, or no origin main, there is nothing to check", () => {
  const { work, git, branch } = repos();
  git(work, "checkout", "-q", "--orphan", "gh-pages");
  git(work, "rm", "-rqf", ".");
  writeFileSync(join(work, "index.md"), "| D-GM-156 | Pages | x | y |\n");
  git(work, "add", ".");
  git(work, "commit", "-qm", "pages");
  git(work, "push", "-q", "origin", "gh-pages");
  branch("uplink/37x", ["D-GM-156"], { push: false });
  const found = idClashes(work, config, { fetch: false });
  assert.deepEqual(found.clashes, []);
  assert.deepEqual(found.notes, ["origin/gh-pages shares no history with this branch, so it was skipped."]);
  const top = mkdtempSync(join(tmpdir(), "wf-idclash-none-"));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: top });
  assert.deepEqual(idClashes(top, config, { fetch: false }).notes, ["No origin remote, so no other branch to check against."]);
  execFileSync("git", ["remote", "add", "origin", join(top, "nowhere.git")], { cwd: top });
  assert.deepEqual(idClashes(top, config, { fetch: false }).notes, ["No origin/main yet, so no other branch to check against."]);
  assert.deepEqual(idClashes(top, config, { fetch: true }).notes, ["Could not fetch origin, so this checked the branches as last fetched.", "No origin/main yet, so no other branch to check against."]);
});

test("this branch's own upstream is not another branch, whatever its name", () => {
  const { work, git, branch, clashes } = repos();
  branch("uplink/37s", ["D-GM-156"], { push: false });
  git(work, "push", "-q", "-u", "origin", "uplink/37s:ken/37s-wip");
  assert.deepEqual(clashes(), []);
});

test("a chunk-like ID of many letters is read at once, not by trying every way to split it", () => {
  const started = Date.now();
  assert.equal(kindOf(`CH-1${"a".repeat(5000)}!`, merge(DEFAULTS, {})), null);
  assert.ok(Date.now() - started < 500, `took ${Date.now() - started} ms`);
});
