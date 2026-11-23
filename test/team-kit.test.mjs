// The kit with a team server: wf ask page publishes, wait waits on the
// server and keeps a copy of the answers, and more, reply, and live go to it.
// A project with no `teamServer.url` works alone, as before.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { runAsk } from "../lib/ask/index.mjs";
import { teamFor } from "../lib/team/client.mjs";
import { teamServe } from "../lib/team/server.mjs";

process.env.WF_ASK_NO_SERVER = "1";
process.env.WF_STATE_DIR = mkdtempSync(join(tmpdir(), "wf-team-kit-state-"));
const ADMIN = "b".repeat(40);
const opt = (id) => ({ id, label: id.toUpperCase(), why: `${id}, as it says.` });
const page = (id, extra = {}) => ({ id, title: id, questions: [{ id: "q1", text: "Pick?", type: "one", options: [opt("a"), opt("b")], recommended: "a", why: "w" }], ...extra });

/** A port free now, so the server's public address can name it before it starts. */
const freePort = () => new Promise((done) => { const s = createServer(); s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => done(port)); }); });
function call(port, path, { method = "GET", headers = {}, body } = {}) {
  return new Promise((done, fail) => {
    const req = httpRequest({ host: "127.0.0.1", port, path, method, headers: { ...headers, ...(body ? { "Content-Type": "application/json" } : {}) } }, (res) => {
      let text = "";
      res.on("data", (c) => (text += c));
      res.on("end", () => done({ status: res.statusCode, headers: res.headers, text, json: () => JSON.parse(text) }));
    });
    req.on("error", fail);
    req.end(body ? JSON.stringify(body) : undefined);
  });
}

test("a project turns the team server on with its config; with none, it works alone", () => {
  assert.equal(teamFor({ teamServer: { url: "", project: "", tokenEnv: "WF_TEAM_TOKEN" } }, {}), null);
  assert.throws(() => teamFor({ teamServer: { url: "https://asks.example.com", project: "atlas", tokenEnv: "WF_TEAM_TOKEN" } }, {}), /WF_TEAM_TOKEN is not set/);
  assert.throws(() => teamFor({ teamServer: { url: "http://asks.example.com", project: "atlas", tokenEnv: "T" } }, { T: "x".repeat(40) }), /https:/);
  assert.deepEqual(teamFor({ teamServer: { url: "https://asks.example.com/", project: "atlas", tokenEnv: "T" } }, { T: "x".repeat(40) }), { server: "https://asks.example.com", project: "atlas", token: "x".repeat(40) });
  assert.equal(teamFor({ teamServer: { url: "http://127.0.0.1:9", project: "atlas", tokenEnv: "T" } }, { T: "x".repeat(40) }).server, "http://127.0.0.1:9", "plain http only on this machine, for a try");
});

test("with a team server: page publishes, wait wakes on an ask and on answers, and more, reply, and live go there", async () => {
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const s = await teamServe({ dir: mkdtempSync(join(tmpdir(), "wf-team-srv-")), origin, port, host: "127.0.0.1", adminToken: ADMIN, secureCookie: false, log: () => {} });
  const headers = (extra) => ({ Host: `127.0.0.1:${port}`, Origin: origin, ...extra });
  const enroll = async (what) => {
    const { link } = (await call(port, "/__team/invite", { method: "POST", headers: headers({ Authorization: `Bearer ${ADMIN}` }), body: what })).json();
    const res = await call(port, "/__team/join", { method: "POST", headers: headers(), body: { code: link.split("#")[1] } });
    return { cookie: res.headers["set-cookie"][0].split(";")[0], token: res.json().token };
  };
  const sam = await enroll({ name: "sam", role: "developer", projects: ["atlas"] });
  const glen = await enroll({ name: "glen", client: true, projects: ["atlas"] });
  const root = mkdtempSync(join(tmpdir(), "wf-team-proj-"));
  mkdirSync(join(root, ".workflow"));
  writeFileSync(join(root, ".workflow/config.json"), JSON.stringify({ teamServer: { url: origin, project: "atlas", tokenEnv: "WF_TEAM_TOKEN_TEST" } }));
  writeFileSync(join(root, "package.json"), "{}");
  spawnSync("git", ["init", "-q"], { cwd: root });
  process.env.WF_TEAM_TOKEN_TEST = sam.token;
  const cwd = process.cwd();
  process.chdir(root);
  try {
    const out = [];
    const log = (line) => out.push(line);
    writeFileSync(join(root, "p.json"), JSON.stringify(page("for-glen", { for: ["client"], live: true })));
    assert.equal(await runAsk(["page", "p.json"], log), 0);
    assert.match(out.join("\n"), new RegExp(`Team: ${origin}/atlas/ask/for-glen/`));
    // The client sees it, as the server drew it.
    const html = await call(port, "/atlas/ask/for-glen/", { headers: headers({ Cookie: glen.cookie }) });
    assert.equal(html.status, 200);
    const pageToken = html.text.match(/name="wf-token" content="([^"]+)"/)[1];
    const spec = JSON.parse(readFileSync(join(root, ".cache/view/ask/for-glen/spec.json"), "utf8"));
    // An ask for more wakes the wait, once.
    out.length = 0;
    const asked = runAsk(["wait", "for-glen", "--timeout", "8"], log);
    await new Promise((r) => setTimeout(r, 300));
    const items = (await call(port, "/__hub/inbox", { headers: headers({ Cookie: glen.cookie }) })).json().items;
    assert.ok(items[0].waitingSince, "the client's inbox says the agent waits");
    await call(port, "/__ask/atlas/more/for-glen", { method: "POST", headers: headers({ Cookie: glen.cookie, "X-WF-Token": pageToken }), body: { question: "q1", text: "Why a?" } });
    assert.equal(await asked, 0);
    assert.match(out.join("\n"), /More asked on the page for-glen, while the person answers:\n- q1 \(Pick\?\): “Why a\?”/);
    assert.equal(await runAsk(["more", "for-glen", "q1", "--text", "Because", "it", "reads", "best."], log), 0);
    const state = (await call(port, "/__team/api/atlas/for-glen", { headers: headers({ Authorization: `Bearer ${sam.token}` }) })).json();
    assert.equal(state.more.replies.q1[0].blocks[0].source, "Because it reads best.");
    assert.deepEqual(state.untold, [], "told once");
    assert.equal(await runAsk(["reply", "for-glen", "q1", "Is", "a", "fine?"], log), 0);
    assert.equal(await runAsk(["live", "for-glen", "--step", "Flow 2", "--progress", "2/5"], log), 0);
    const after = (await call(port, "/__team/api/atlas/for-glen", { headers: headers({ Authorization: `Bearer ${sam.token}` }) })).json();
    assert.equal(after.replies.q1[0].text, "Is a fine?");
    assert.equal((await call(port, "/__ask/atlas/live/for-glen", { headers: headers({ Cookie: glen.cookie }) })).json().live.step, "Flow 2");
    // The client answers; wait brings the answers down and keeps a copy.
    out.length = 0;
    const answered = runAsk(["wait", "for-glen", "--timeout", "8"], log);
    await new Promise((r) => setTimeout(r, 300));
    const sent = await call(port, "/__ask/atlas/answers/for-glen", { method: "POST", headers: headers({ Cookie: glen.cookie, "X-WF-Token": pageToken }), body: { id: "for-glen", hash: spec.hash, answers: { q1: { choice: "b", reply: "Yes" } } } });
    assert.equal(sent.status, 200);
    assert.equal(await answered, 0);
    assert.match(out.join("\n"), /\*\*q1\*\* Pick\?: \*\*b\*\* B/);
    assert.ok(existsSync(join(root, ".cache/view/answers/for-glen.json")), "a copy is kept");
    out.length = 0;
    assert.equal(await runAsk(["answers", "for-glen"], log), 0);
    assert.match(out.join("\n"), /\*\*b\*\* B/);
    // Without the token, the kit says so before it tries.
    delete process.env.WF_TEAM_TOKEN_TEST;
    await assert.rejects(runAsk(["page", "p.json"], log), /WF_TEAM_TOKEN_TEST is not set/);
  } finally {
    process.chdir(cwd);
    await s.close();
  }
});

test("wf team: an admin invites and revokes from their kit; serve starts from the host's settings", async () => {
  const { runTeam, serveSettings } = await import("../lib/team/command.mjs");
  assert.throws(() => serveSettings({}), /WF_TEAM_ORIGIN/);
  assert.throws(() => serveSettings({ WF_TEAM_ORIGIN: "https://asks.example.com" }), /WF_TEAM_ADMIN_TOKEN/);
  assert.deepEqual(serveSettings({ WF_TEAM_ORIGIN: "https://asks.example.com", WF_TEAM_ADMIN_TOKEN: "c".repeat(40), PORT: "9000" }), { origin: "https://asks.example.com", dir: "/data", port: 9000, adminToken: "c".repeat(40) });
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const s = await teamServe({ dir: mkdtempSync(join(tmpdir(), "wf-team-cmd-")), origin, port, host: "127.0.0.1", adminToken: ADMIN, secureCookie: false, log: () => {} });
  const root = mkdtempSync(join(tmpdir(), "wf-team-cmd-proj-"));
  mkdirSync(join(root, ".workflow"));
  writeFileSync(join(root, ".workflow/config.json"), JSON.stringify({ teamServer: { url: origin, project: "atlas", tokenEnv: "WF_TEAM_ADMIN_TEST" } }));
  writeFileSync(join(root, "package.json"), "{}");
  spawnSync("git", ["init", "-q"], { cwd: root });
  process.env.WF_TEAM_ADMIN_TEST = ADMIN;
  const cwd = process.cwd();
  process.chdir(root);
  try {
    const out = [];
    const log = (line) => out.push(line);
    assert.equal(await runTeam(["invite", "ana", "--role", "designer"], log), 0);
    assert.match(out.join("\n"), new RegExp(`ana, designer on atlas: ${origin}/__team/join#\\S{40,}`));
    assert.equal(await runTeam(["invite", "glen", "--client", "--days", "14"], log), 0);
    assert.match(out.join("\n"), /glen, the client, on atlas for 14 days:/);
    assert.equal(await runTeam(["invite", "x"], log), 2, "a role, or --client");
    assert.equal(await runTeam(["members"], log), 0);
    assert.match(out.at(-1), /No one has joined yet/);
    assert.equal(await runTeam(["revoke", "ana"], log), 0);
    await assert.rejects(runTeam(["revoke", "nobody"], log), /nobody is not a member/);
  } finally {
    process.chdir(cwd);
    delete process.env.WF_TEAM_ADMIN_TEST;
    await s.close();
  }
});

test("a question left for later goes to the team server; its role answers it there, and pull brings the answer to the log", async () => {
  const { DEFAULTS } = await import("../lib/config/defaults.mjs");
  const { emptyOpen, emptyResolved } = await import("../lib/logs/questions.mjs");
  const { runTeamQuestion } = await import("../lib/team/questions.mjs");
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const s = await teamServe({ dir: mkdtempSync(join(tmpdir(), "wf-team-q-")), origin, port, host: "127.0.0.1", adminToken: ADMIN, secureCookie: false, log: () => {} });
  const headers = (extra) => ({ Host: `127.0.0.1:${port}`, Origin: origin, ...extra });
  const enroll = async (what) => {
    const { link } = (await call(port, "/__team/invite", { method: "POST", headers: headers({ Authorization: `Bearer ${ADMIN}` }), body: what })).json();
    const res = await call(port, "/__team/join", { method: "POST", headers: headers(), body: { code: link.split("#")[1] } });
    return { cookie: res.headers["set-cookie"][0].split(";")[0], token: res.json().token };
  };
  const dev = await enroll({ name: "dev", role: "developer", projects: ["atlas"] });
  const ana = await enroll({ name: "ana", role: "designer", projects: ["atlas"] });
  const root = mkdtempSync(join(tmpdir(), "wf-team-q-proj-"));
  mkdirSync(join(root, ".workflow"));
  mkdirSync(join(root, "docs/log"), { recursive: true });
  writeFileSync(join(root, DEFAULTS.logs.openQuestions), emptyOpen({ decisions: "decisions", resolved: "questions-resolved.md" }));
  writeFileSync(join(root, DEFAULTS.logs.questionsResolved), emptyResolved({ decisions: "decisions", open: "open-questions.md" }));
  writeFileSync(join(root, ".workflow/config.json"), JSON.stringify({ teamServer: { url: origin, project: "atlas", tokenEnv: "WF_TEAM_Q_TEST" } }));
  writeFileSync(join(root, "package.json"), "{}");
  spawnSync("git", ["init", "-q"], { cwd: root });
  const cwd = process.cwd();
  process.chdir(root);
  try {
    const out = [];
    const log = (line) => out.push(line);
    process.env.WF_TEAM_Q_TEST = dev.token;
    writeFileSync(join(root, "p.json"), JSON.stringify(page("layout")));
    assert.equal(await runAsk(["page", "p.json"], log), 0);
    const spec = JSON.parse(readFileSync(join(root, ".cache/view/ask/layout/spec.json"), "utf8"));
    writeFileSync(join(root, "back.json"), JSON.stringify({ id: "layout", hash: spec.hash, answers: { q1: { decide: "later", for: "designer", note: "Ask Ana" } } }));
    assert.equal(await runAsk(["import", "back.json"], log), 0);
    out.length = 0;
    assert.equal(await runAsk(["record", "layout"], log), 0);
    assert.match(out.join("\n"), /q1: open question Q-001, for designer/);
    assert.match(out.join("\n"), new RegExp(`Q-001: on the team server for designer, at ${origin}/atlas/ask/oq-q-001/`));
    // The designer sees it at once, merged or not.
    process.env.WF_TEAM_Q_TEST = ana.token;
    out.length = 0;
    assert.equal(await runTeamQuestion(["inbox"], log), 0);
    assert.match(out.join("\n"), /Q-001: Pick\? .*oq-q-001/);
    const html = await call(port, "/atlas/ask/oq-q-001/", { headers: headers({ Cookie: ana.cookie }) });
    const pageToken = html.text.match(/name="wf-token" content="([^"]+)"/)[1];
    const oq = JSON.parse(readFileSync(join(root, ".cache/view/ask/oq-q-001/spec.json"), "utf8"));
    assert.equal((await call(port, "/__ask/atlas/answers/oq-q-001", { method: "POST", headers: headers({ Cookie: ana.cookie, "X-WF-Token": pageToken }), body: { id: "oq-q-001", hash: oq.hash, answers: { answer: { text: "Tabs, as in the frame." } } } })).status, 200);
    // The asker pulls the answer into the log on their branch.
    process.env.WF_TEAM_Q_TEST = dev.token;
    out.length = 0;
    assert.equal(await runTeamQuestion(["pull"], log), 0);
    assert.match(out.join("\n"), /Q-001: ana answered: “Tabs, as in the frame\.”/);
    assert.match(readFileSync(join(root, DEFAULTS.logs.openQuestions), "utf8"), /- \*\*Q-001\.\*\* Revisit when: the next ask about layout\n {2}- Note: Ask Ana\n {2}- Answer \(ana, on the team server, \d{4}-\d{2}-\d{2}\): Tabs, as in the frame\./);
    out.length = 0;
    assert.equal(await runTeamQuestion(["pull"], log), 0);
    assert.match(out.join("\n"), /No new answers/, "an answer is brought in once");
  } finally {
    process.chdir(cwd);
    delete process.env.WF_TEAM_Q_TEST;
    await s.close();
  }
});

test("an unreachable team server says what to check, and wait stops on a page published from elsewhere", async () => {
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const root = mkdtempSync(join(tmpdir(), "wf-team-down-"));
  mkdirSync(join(root, ".workflow"));
  writeFileSync(join(root, ".workflow/config.json"), JSON.stringify({ teamServer: { url: origin, project: "atlas", tokenEnv: "WF_TEAM_DOWN_TEST" } }));
  writeFileSync(join(root, "package.json"), "{}");
  spawnSync("git", ["init", "-q"], { cwd: root });
  process.env.WF_TEAM_DOWN_TEST = "d".repeat(40);
  const cwd = process.cwd();
  process.chdir(root);
  try {
    const log = () => {};
    writeFileSync(join(root, "p.json"), JSON.stringify(page("down")));
    await assert.rejects(runAsk(["page", "p.json"], log), /did not answer .*check teamServer\.url and your connection/);
    // Up now, with another page of the same id published: wait says so and stops.
    const s = await teamServe({ dir: mkdtempSync(join(tmpdir(), "wf-team-up-")), origin, port, host: "127.0.0.1", adminToken: ADMIN, secureCookie: false, log: () => {} });
    try {
      process.env.WF_TEAM_DOWN_TEST = ADMIN;
      writeFileSync(join(root, "q.json"), JSON.stringify(page("down", { title: "Another" })));
      await runAsk(["page", "q.json"], log);
      writeFileSync(join(root, "p.json"), JSON.stringify(page("down")));
      const { buildPage } = await import("../lib/ask/page.mjs");
      const { KIT_KINDS } = await import("../lib/design/annotate.mjs");
      buildPage(root, join(root, ".cache/view"), page("down"), KIT_KINDS);
      const out = [];
      assert.equal(await runAsk(["wait", "down", "--timeout", "3"], (l) => out.push(l)), 1);
      assert.match(out.join("\n"), /on the team server is another one/);
    } finally {
      await s.close();
    }
  } finally {
    process.chdir(cwd);
    delete process.env.WF_TEAM_DOWN_TEST;
  }
});
