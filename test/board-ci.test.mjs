import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { merge } from "../lib/config.mjs";
import { DEFAULTS } from "../lib/defaults.mjs";
import { githubFiles, syncGithub } from "../lib/github.mjs";
import { plan, wanted } from "../lib/board/index.mjs";
import { chunkPrs, prNumber, repoUrl, runGit, storyPr } from "../lib/board/prs.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(join(here, "fixtures/board", name), "utf8");
const config = (board = {}, more = {}) =>
  merge(DEFAULTS, { areas: [{ id: "app", prefix: "APP", docs: "docs/app" }], stories: { files: ["docs/app/user-stories.md"] }, board: { boardId: "42", ...board }, ...more });
const DONE = "docs/log/chunks-done.md";

/** A real git repository whose done list grows one squash-merged chunk at a time. */
function repo() {
  const root = mkdtempSync(join(tmpdir(), "wf-board-ci-"));
  const git = (...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.test", ...args], { cwd: root, encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("remote", "add", "origin", "git@github.com:acme/field-app.git");
  mkdirSync(join(root, "docs/log"), { recursive: true });
  const [head, ...rows] = fixture("chunks-done.md").trimEnd().split("\n");
  const header = rows.slice(0, 3);
  const chunks = rows.slice(3);
  const commits = [
    [chunks[0], "app: build the sign-in screen (#8)"],
    [chunks[1], "app: build the sign-in service (#9)"],
    [chunks[2], "app: write the jobs contract"],
  ];
  writeFileSync(join(root, DONE), `${[head, ...header].join("\n")}\n`);
  git("add", "-A");
  git("commit", "-q", "-m", "workflow: start the done list");
  let date = 1_800_000_000;
  for (const [row, subject] of commits) {
    writeFileSync(join(root, DONE), `${readFileSync(join(root, DONE), "utf8")}${row}\n`);
    git("add", "-A");
    date += 60;
    execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.test", "commit", "-q", "-m", subject], { cwd: root, env: { ...process.env, GIT_COMMITTER_DATE: `${date} +0000`, GIT_AUTHOR_DATE: `${date} +0000` } });
  }
  return root;
}

test("a pull request number comes from a squash or a merge commit's subject", () => {
  assert.equal(prNumber("app: build the sign-in screen (#8)"), 8);
  assert.equal(prNumber("Merge pull request #37 from acme/design/parallel"), 37);
  assert.equal(prNumber("app: write the jobs contract"), null);
  assert.equal(prNumber("app: fix (#12) in the middle"), null);
});

test("each done chunk's pull request is the commit that added its row; a rebase merge has none", () => {
  const root = repo();
  const prs = chunkPrs(runGit(root), DONE, ["CH-01-fe", "CH-01-be", "CH-02-contract", "CH-09"]);
  assert.deepEqual([...prs].map(([chunk, pr]) => `${chunk} #${pr.number}`), ["CH-01-fe #8", "CH-01-be #9"]);
  assert.ok(prs.get("CH-01-be").at > prs.get("CH-01-fe").at);
  assert.equal(repoUrl(runGit(root), {}), "https://github.com/acme/field-app");
});

test("a story shows the pull request of its lane finished last, once any lane is done", () => {
  const prs = new Map([
    ["CH-01-fe", { number: 8, at: 100 }],
    ["CH-01-be", { number: 9, at: 200 }],
  ]);
  const lane = (chunk, state) => ({ chunk, state });
  assert.equal(storyPr([lane("CH-01-fe", "done"), lane("CH-01-be", "done")], prs).number, 9);
  assert.equal(storyPr([lane("CH-01-fe", "done"), lane("CH-01-be", "In progress")], prs).number, 8);
  assert.equal(storyPr([lane("CH-01-be", "Waiting")], prs), null);
  assert.equal(storyPr([], prs), null);
});

test("the repository address comes from Actions' variables in CI, else the origin remote", () => {
  const git = (remote) => () => remote;
  assert.equal(repoUrl(git(""), { GITHUB_SERVER_URL: "https://github.com", GITHUB_REPOSITORY: "acme/field-app" }), "https://github.com/acme/field-app");
  assert.equal(repoUrl(git("https://github.com/acme/field-app.git\n"), {}), "https://github.com/acme/field-app");
  assert.equal(repoUrl(git("https://user:tok@github.com/acme/field-app\n"), {}), "https://github.com/acme/field-app", "a token in a remote URL never reaches a link");
  assert.equal(repoUrl(git(""), {}), null);
});

test("sync links each story's pull request, never clears one, and shows the change in plan", () => {
  const root = repo();
  const all = {
    "docs/app/user-stories.md": fixture("user-stories.md"),
    "docs/log/build-order.md": fixture("build-order.md"),
    [DONE]: readFileSync(join(root, DONE), "utf8"),
  };
  const context = { root, config: config(), tracked: Object.keys(all), files: (path) => all[path] };
  const want = wanted(context, { git: runGit(root), env: {} });
  assert.deepEqual(want.map((story) => `${story.id} ${story.pr?.text ?? "-"}`), ["APP-01 #9", "APP-02 -", "APP-03 -", "APP-04 -"]);
  assert.equal(want[0].pr.url, "https://github.com/acme/field-app/pull/9");
  const column = (id, text) => ({ id, text });
  const board = (prText) => ({
    columns: Object.entries({ story_id: "text", area: "text", wf_status: "status", chunk: "text", story: "long_text", pr: "link", owner: "people" }).map(([id, type]) => ({ id, type, settings_str: type === "status" ? JSON.stringify({ labels: { 0: "Drafting", 1: "Backlog", 2: "Planned", 3: "In progress", 4: "Checking", 6: "Done" } }) : "{}" })),
    views: [{ name: "Kanban" }],
    groups: [],
    items: want
      .filter((story) => !story.removed)
      .map((story, i) => ({
        id: String(i + 1),
        name: story.name,
        group: { title: story.group },
        column_values: [column("story_id", story.id), column("area", "app"), column("wf_status", story.values.status), column("chunk", story.values.chunk), column("story", story.values.story), column("pr", story.id === "APP-02" ? "#3 - https://github.com/acme/field-app/pull/3" : prText)],
        updates: [{ id: `u${i}`, creator_id: "7", text_body: story.comment.replace(/<\/(p|li)>/g, "\n").replace(/<[^>]+>/g, "") }],
      })),
  });
  const fresh = plan(config(), want, board(""), "7");
  assert.deepEqual(fresh.changes.map((change) => `${change.id} ${change.diffs?.map(([field, from, to]) => `${field}:${from}→${to}`).join(",")}`), ["APP-01 PR:→#9"]);
  assert.deepEqual(fresh.changes[0].values.pr, { url: "https://github.com/acme/field-app/pull/9", text: "#9" });
  assert.equal(plan(config(), want, board("#9 - https://github.com/acme/field-app/pull/9"), "7").changes.length, 0, "in step");
});

test("wf github writes the board-sync workflow only while the board is set up", () => {
  const off = githubFiles("/nowhere", config({ boardId: "" })).find(([path]) => path.endsWith("board-sync.yml"));
  assert.equal(off[1], false);
  const [path, on, text] = githubFiles("/nowhere", config()).find(([file]) => file.endsWith("board-sync.yml"));
  assert.equal(path, ".github/workflows/board-sync.yml");
  assert.equal(on, true);
  const yaml = text();
  for (const line of [
    "  push:\n    branches: [\"main\"]",
    "  workflow_dispatch:",
    "permissions:\n  contents: read\n",
    "concurrency:\n  group: board-sync\n  cancel-in-progress: false",
    "    environment: board",
    "          fetch-depth: 0",
    "      - run: npm install",
    "          MONDAY_API_TOKEN: ${{ secrets.MONDAY_API_TOKEN }}",
    'test -n "$MONDAY_API_TOKEN" || { echo "::error::Add MONDAY_API_TOKEN to the board environment (Settings → Environments), with its deployment branches limited to main"; exit 1; }',
    "          npx wf board sync",
  ]) {
    assert.ok(yaml.includes(line), `missing:\n${line}\nin:\n${yaml}`);
  }
  assert.equal(yaml.split("secrets.").length - 1, 1, "the secret reaches one step only");
  assert.ok(yaml.indexOf("secrets.") > yaml.indexOf("- name: Sync the stories to the board"));
  assert.doesNotMatch(yaml, /pull_request/, "no run on pull requests, where a branch could read the token");
});

test("the workflow takes the project's branch, environment, token name, and setup steps", () => {
  const yaml = githubFiles("/nowhere", config({ branch: "trunk", environment: "client-board", tokenEnv: "BOARD_TOKEN" }, { github: { check: { command: "", setup: ["corepack enable", "pnpm install --frozen-lockfile"] } } }))
    .find(([file]) => file.endsWith("board-sync.yml"))[2]();
  assert.match(yaml, /branches: \["trunk"\]/);
  assert.match(yaml, /environment: client-board/);
  assert.match(yaml, /BOARD_TOKEN: \$\{\{ secrets\.BOARD_TOKEN \}\}/);
  assert.match(yaml, /Add BOARD_TOKEN to the client-board environment .* limited to trunk/);
  assert.match(yaml, /- run: corepack enable\n {6}- run: pnpm install --frozen-lockfile\n/);
  assert.doesNotMatch(yaml, /npm ci/);
});

test("wf github sync writes the workflow, then removes it when the board is turned off", () => {
  const root = mkdtempSync(join(tmpdir(), "wf-board-gh-"));
  const file = join(root, ".github/workflows/board-sync.yml");
  assert.deepEqual(syncGithub(root, config(), { write: false }).problems, [".github/workflows/board-sync.yml: missing, run wf github sync"]);
  syncGithub(root, config(), { write: true });
  assert.ok(existsSync(file));
  assert.deepEqual(syncGithub(root, config(), { write: false }).problems, []);
  syncGithub(root, config({ boardId: "" }), { write: true });
  assert.ok(!existsSync(file));
});
