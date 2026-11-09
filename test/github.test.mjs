import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { merge } from "../lib/config.mjs";
import { DEFAULTS } from "../lib/defaults.mjs";
import { ecosystems, holders, ruleset, rulesetBlocked, syncGithub } from "../lib/github.mjs";
import { openNeeds, signoffs } from "../lib/signoffs.mjs";

const PEOPLE = [
  { name: "Ana", handle: "ana", roles: ["owner", "reviewer"] },
  { name: "Bo", handle: "bo", roles: ["designer", "developer:frontend"] },
];
const config = (github = {}, more = {}) => merge(DEFAULTS, { people: PEOPLE, team: "team", github, ...more });

test("sync writes only the files switched on, check finds drift, and a switch turned off removes its file", () => {
  const root = mkdtempSync(join(tmpdir(), "wf-github-"));
  writeFileSync(join(root, "package.json"), "{}");
  const on = config({ prTemplate: true, codeowners: true, dependabot: true });
  assert.deepEqual(syncGithub(root, on).problems.sort(), [
    ".github/CODEOWNERS: missing, run wf github sync",
    ".github/dependabot.yml: missing, run wf github sync",
    ".github/pull_request_template.md: missing, run wf github sync",
  ]);
  assert.equal(syncGithub(root, on, { write: true }).changed, 3);
  assert.deepEqual(syncGithub(root, on).problems, []);
  assert.match(readFileSync(join(root, ".github/CODEOWNERS"), "utf8"), /^\* @ana$/m);
  assert.match(readFileSync(join(root, ".github/CODEOWNERS"), "utf8"), /^\/docs\/design\/frames\/ @bo$/m);
  assert.match(readFileSync(join(root, ".github/pull_request_template.md"), "utf8"), /needs designer/);
  assert.match(readFileSync(join(root, ".github/dependabot.yml"), "utf8"), /package-ecosystem: npm/);
  const off = config({ prTemplate: true });
  assert.deepEqual(syncGithub(root, off).problems.sort(), [
    ".github/CODEOWNERS: its github switch is off, run wf github sync to remove it",
    ".github/dependabot.yml: its github switch is off, run wf github sync to remove it",
  ]);
  syncGithub(root, off, { write: true });
  assert.equal(existsSync(join(root, ".github/CODEOWNERS")), false);
  assert.equal(existsSync(join(root, ".github/pull_request_template.md")), true);
});

test("a hand-written file is never overwritten, and the check workflow needs its command", () => {
  const root = mkdtempSync(join(tmpdir(), "wf-github-"));
  mkdirSync(join(root, ".github"), { recursive: true });
  writeFileSync(join(root, ".github/pull_request_template.md"), "mine");
  assert.deepEqual(syncGithub(root, config({ prTemplate: true }), { write: true }).problems, [".github/pull_request_template.md: hand-written; delete it or turn its github switch off"]);
  assert.equal(readFileSync(join(root, ".github/pull_request_template.md"), "utf8"), "mine");
  assert.match(syncGithub(root, config({ checkWorkflow: true })).problems[0], /needs the command/);
  syncGithub(root, config({ checkWorkflow: true, check: { command: "npm test", setup: ["npm ci"] } }), { write: true });
  assert.match(readFileSync(join(root, ".github/workflows/check.yml"), "utf8"), /- run: npm ci\n {6}- run: npm test\n$/);
});

test("the ruleset follows the team and the switches, and a free private repository gets none", () => {
  assert.match(rulesetBlocked(config()), /no rulesets/);
  assert.equal(rulesetBlocked(config({ public: true })), null);
  assert.equal(rulesetBlocked(config({ plan: "team" })), null);
  const team = ruleset(config({ plan: "team", codeowners: true, checkWorkflow: true }));
  assert.equal(team.rules.find((rule) => rule.type === "pull_request").parameters.required_approving_review_count, 1);
  assert.equal(team.rules.find((rule) => rule.type === "pull_request").parameters.require_code_owner_review, true);
  assert.ok(team.rules.some((rule) => rule.type === "required_status_checks"));
  assert.equal(ruleset(config({}, { team: "solo" })).rules.find((rule) => rule.type === "pull_request").parameters.required_approving_review_count, 0);
  assert.deepEqual(holders(config(), "developer"), ["@bo"]);
});

test("Dependabot covers the ecosystems the project holds", () => {
  const root = mkdtempSync(join(tmpdir(), "wf-github-"));
  for (const file of ["package.json", "Cargo.toml"]) writeFileSync(join(root, file), "");
  mkdirSync(join(root, ".github/workflows"), { recursive: true });
  assert.deepEqual(ecosystems(root), ["npm", "cargo", "github-actions"]);
});

test("signoffs list the open needs lines with who holds each role, and solo has none", () => {
  const text = "- [ ] needs designer: Is the empty state a frame?\n- [x] needs owner: Ship it?\n- [ ] needs developer:backend: Which store?\nnot a needs line";
  assert.deepEqual(openNeeds(text, "q.md").map((need) => need.role), ["designer", "developer:backend"]);
  const { lines, code } = signoffs(config(), [["q.md", text]]);
  assert.equal(code, 1);
  assert.match(lines[0], /needs designer \(Bo\): Is the empty state a frame\?/);
  assert.match(lines[1], /needs developer:backend \(nobody holds it\)/);
  assert.equal(signoffs(config({}, { team: "solo" }), [["q.md", text]]).code, 0);
  assert.deepEqual(signoffs(config(), [["q.md", "- [x] needs owner: done"]]), { lines: ["No open sign-offs."], code: 0 });
});
