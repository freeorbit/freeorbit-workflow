import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { merge } from "../lib/config.mjs";
import { DEFAULTS } from "../lib/defaults.mjs";
import { ecosystems, holders, ruleset, rulesetBlocked, syncGithub } from "../lib/github.mjs";
import { bypassLine, bypassLines, openNeeds, PR_BODY, signoffs } from "../lib/signoffs.mjs";

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

test("signoffs count each question row under a chunk's heading, and none under Not tied to a chunk yet", () => {
  const head = "| ID | Question | Needs | From | Story | Raised |\n| --- | --- | --- | --- | --- | --- |";
  const text = `## CH-01: Sign-in\n\n${head}\n| Q-001 | Is the empty state a frame? | designer | developer | none | 2026-11-10 |\n\n## Not tied to a chunk yet\n\n${head}\n| Q-002 | Invite users? | owner | client (monday) | none | 2026-11-10 |\n`;
  assert.deepEqual(openNeeds(text, "q.md").map((need) => `${need.role} ${need.question}`), ["designer Q-001 Is the empty state a frame? (CH-01: Sign-in)"]);
  const { lines, code } = signoffs(config(), [["q.md", text]]);
  assert.equal(code, 1);
  assert.match(lines[0], /needs designer \(Bo\): Q-001/);
});

const QHEAD = "| ID | Question | Needs | From | Story | Raised |\n| --- | --- | --- | --- | --- | --- |";
const QLOG = `## CH-01: Sign-in\n\n${QHEAD}\n| Q-001 | Is the empty state a frame? | designer | developer | none | 2026-11-10 |\n| Q-002 | Which store? | owner | developer | none | 2026-11-10 |\n`;
const BYPASS = "- [x] bypassed by @bo on 2026-11-10: the client signed off by phone (Q-001, Q-002)";

/** A fake gh: who is signed in, and who is an admin; `null` is no gh at all. */
function fakeGh({ login = "bo", admins = ["bo"] } = {}, calls = []) {
  return (args) => {
    calls.push(args.join(" "));
    if (login === null) return { error: new Error("spawn gh ENOENT"), status: null, stdout: "" };
    if (args[1] === "user") return { status: 0, stdout: `${login}\n` };
    const handle = args[1].match(/collaborators\/([^/]+)\/permission/)?.[1];
    return { status: 0, stdout: admins.includes(handle) ? "admin\n" : "write\n" };
  };
}

test("a bypass line covers the chunk questions it names while gh confirms its admin", () => {
  assert.deepEqual(bypassLines(`text\n${BYPASS}`).map((line) => `${line.handle} ${line.ids.join(",")}`), ["bo Q-001,Q-002"]);
  const calls = [];
  const { lines, code } = signoffs(config(), [["q.md", QLOG], [PR_BODY, BYPASS]], { gh: fakeGh({}, calls) });
  assert.equal(code, 0, lines.join("\n"));
  assert.equal(lines.filter((line) => line.startsWith("BYPASSED by @bo")).length, 2);
  assert.ok(calls.some((call) => call.includes("collaborators/bo/permission")), "the admin is checked on each read");
});

test("a bypass line does not count with no gh, for a non-admin, or for someone not in people", () => {
  for (const [gh, why] of [
    [fakeGh({ login: null }), /no gh, no sign-in, or not an admin/],
    [fakeGh({ admins: [] }), /not an admin/],
  ]) {
    const { lines, code } = signoffs(config(), [["q.md", QLOG], [PR_BODY, BYPASS]], { gh });
    assert.equal(code, 1);
    assert.ok(lines.some((line) => why.test(line)), lines.join("\n"));
  }
  const stranger = BYPASS.replace("@bo", "@mallory");
  const { lines, code } = signoffs(config(), [["q.md", QLOG], [PR_BODY, stranger]], { gh: fakeGh({ admins: ["mallory"] }) });
  assert.equal(code, 1);
  assert.ok(lines.some((line) => /@mallory is not one of the project's people/.test(line)));
});

test("a stale bypass leaves a question it does not name open, and one in the log itself never counts", () => {
  const stale = "- [x] bypassed by @bo on 2026-11-09: earlier sign-off (Q-001, Q-007)";
  const { lines, code } = signoffs(config(), [["q.md", QLOG], [PR_BODY, stale]], { gh: fakeGh() });
  assert.equal(code, 1);
  assert.ok(lines.some((line) => /needs owner .*Q-002 Which store\?/.test(line)), "Q-002 still blocks");
  assert.ok(lines.some((line) => /names Q-007, which no chunk waits on/.test(line)));
  assert.equal(signoffs(config(), [["q.md", `${QLOG}\n${BYPASS}\n`]], { gh: fakeGh() }).code, 1, "only the pull request's body holds a bypass");
});

test("--bypass writes a line for the signed-in admin, and refuses anyone else", () => {
  const texts = [["q.md", QLOG], [PR_BODY, "Track: chunk"]];
  assert.equal(bypassLine(config(), texts, "the client signed off by phone", "2026-11-10", fakeGh()), BYPASS);
  assert.throws(() => bypassLine(config(), texts, "why", "2026-11-10", fakeGh({ login: null })), /not installed or not signed in/);
  assert.throws(() => bypassLine(config(), texts, "why", "2026-11-10", fakeGh({ admins: [] })), /not an admin/);
  assert.throws(() => bypassLine(config(), texts, "why", "2026-11-10", fakeGh({ login: "mallory", admins: ["mallory"] })), /@mallory is not one of/);
  assert.throws(() => bypassLine(config(), texts, " ", "2026-11-10", fakeGh()), /needs a reason/);
  assert.throws(() => bypassLine(config(), [[PR_BODY, "- [ ] needs owner: ship?"]], "why", "2026-11-10", fakeGh()), /no open chunk question/);
});
