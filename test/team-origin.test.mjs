// Where an ask came from, on a team server: who asked it, stamped by the
// server from the publisher's token; the work it came from, its repository,
// branch, commit, and pull request, from their kit; and the pull request's
// state as their kit last saw it (docs/design/team-server.md, "Where an ask
// came from").

import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { buildPage, exportHtml } from "../lib/ask/page.mjs";
import { KIT_KINDS } from "../lib/design/annotate.mjs";
import { prFor, prsByBranch } from "../lib/team/origin.mjs";
import { teamServe } from "../lib/team/server.mjs";

const ADMIN = "e".repeat(40);
const PASSWORD = "correct horse battery";
const ORIGIN = "http://asks.test";
const opt = (id) => ({ id, label: id.toUpperCase(), why: `${id}, as it says.` });
const raw = (id, more = {}) => ({ id, title: `Page ${id}`, questions: [{ id: "q1", text: "First?", options: [opt("a"), opt("b")], recommended: "a", why: "w" }], ...more });
const ASKER = { project: "atlas-nx", branch: "feat/login", worktree: "", session: "s1", commit: "1a2b3c4", repo: "https://github.com/acme/atlas-nx" };

function call(port, path, { method = "GET", headers = {}, body } = {}) {
  return new Promise((done, fail) => {
    const req = httpRequest({ host: "127.0.0.1", port, path, method, headers: { Host: "asks.test", Origin: ORIGIN, ...(body != null ? { "Content-Type": "application/json" } : {}), ...headers } }, (res) => {
      let text = "";
      res.on("data", (c) => (text += c));
      res.on("end", () => done({ status: res.statusCode, headers: res.headers, text, json: () => JSON.parse(text) }));
    });
    req.on("error", fail);
    req.end(body == null ? undefined : JSON.stringify(body));
  });
}
const dataOf = (html) => JSON.parse(html.match(/<script type="application\/json" id="ask-data">([\s\S]*?)<\/script>/)[1]);

async function team() {
  const s = await teamServe({ dir: mkdtempSync(join(tmpdir(), "wf-origin-")), origin: ORIGIN, port: 0, host: "127.0.0.1", adminToken: ADMIN, secureCookie: false, log: () => {} });
  const enroll = async (what) => {
    const { link } = (await call(s.port, "/__team/invite", { method: "POST", headers: { Authorization: `Bearer ${ADMIN}` }, body: what })).json();
    const res = await call(s.port, "/__team/join", { method: "POST", body: { code: link.split("#")[1], password: PASSWORD } });
    return { name: what.name, cookie: res.headers["set-cookie"][0].split(";")[0], token: res.json().token };
  };
  const ken = await enroll({ name: "ken", role: "developer", projects: ["atlas"] });
  const ana = await enroll({ name: "ana", role: "designer", projects: ["atlas"] });
  await call(s.port, "/__team/api/atlas", { method: "PUT", headers: { Authorization: `Bearer ${ken.token}` }, body: { name: "Atlas", kinds: KIT_KINDS } });
  const root = mkdtempSync(join(tmpdir(), "wf-origin-proj-"));
  const publish = (who, page, asker = ASKER, origin = undefined) => {
    const { spec } = buildPage(root, join(root, ".cache/view"), page, KIT_KINDS, {}, { asker });
    return call(s.port, `/__team/api/atlas/${spec.id}`, { method: "PUT", headers: { Authorization: `Bearer ${who.token}` }, body: { spec, pictures: {}, ...(origin ? { origin } : {}) } });
  };
  const inbox = async (who) => (await call(s.port, "/__hub/inbox", { headers: { Authorization: `Bearer ${who.token}` } })).json().items;
  return { s, ken, ana, publish, inbox };
}

test("the server says who asked each page, from the publisher's token, in the inbox and on the page", async () => {
  const { s, ken, ana, publish, inbox } = await team();
  try {
    // What the spec says of who asks does not name the person: their token does.
    assert.equal((await publish(ken, raw("one"), { ...ASKER, by: "ana" })).status, 422, "who asks is the kit's fields only");
    assert.equal((await publish(ken, raw("one"))).status, 200);
    const kens = await inbox(ken);
    assert.deepEqual([kens[0].askedBy, kens[0].mine], ["ken", true]);
    const anas = await inbox(ana);
    assert.deepEqual([anas[0].askedBy, anas[0].mine], ["ken", false]);
    // Published again by another member, the page is theirs to have asked.
    await publish(ana, raw("one"));
    assert.equal((await inbox(ken))[0].askedBy, "ana");
    const html = (await call(s.port, "/atlas/ask/one/", { headers: { Cookie: ken.cookie } })).text;
    assert.deepEqual(dataOf(html).origin, { by: "ana", role: "designer" });
  } finally {
    await s.close();
  }
});

test("the work an ask came from: its repository, branch, commit, and pull request, with the pull request's state kept up to date by the kit", async () => {
  const { s, ken, ana, publish, inbox } = await team();
  try {
    assert.equal((await publish(ken, raw("two"), ASKER, { pr: "41", prState: "open" })).status, 200);
    let item = (await inbox(ana))[0];
    assert.deepEqual([item.asker.branch, item.asker.commit, item.asker.repo, item.origin.pr, item.origin.prState], ["feat/login", "1a2b3c4", "https://github.com/acme/atlas-nx", "41", "open"]);
    // The kit says the state again when it waits, or lists its asks.
    const update = (who, body) => call(s.port, "/__team/api/atlas/two/origin", { method: "POST", headers: { Authorization: `Bearer ${who.token}` }, body });
    assert.equal((await update(ken, { pr: "41", prState: "merged" })).status, 200);
    item = (await inbox(ana))[0];
    assert.equal(item.origin.prState, "merged");
    const shown = dataOf((await call(s.port, "/atlas/ask/two/", { headers: { Cookie: ana.cookie } })).text).origin;
    assert.equal(shown.prState, "merged");
    assert.ok(shown.checked, "the page says when the kit last looked");
    // The same state again moves only when it was looked at, so no open inbox draws again.
    assert.equal((await update(ken, { pr: "41", prState: "merged" })).status, 200);
    assert.deepEqual((await inbox(ana))[0].origin, { pr: "41", prState: "merged" });
    // Only a pull request's number and one of its states; only from a kit.
    assert.equal((await update(ken, { pr: "41; rm", prState: "merged" })).status, 422);
    assert.equal((await update(ken, { pr: "41", prState: "<b>" })).status, 422);
    assert.equal((await call(s.port, "/__team/api/atlas/two/origin", { method: "POST", headers: { Cookie: ana.cookie }, body: { pr: "41", prState: "closed" } })).status, 401);
    assert.equal((await update(ana, { pr: "41", prState: "closed" })).status, 403, "only the kit of whoever asked it");
    // Published again, the page keeps who asked and its pull request's state unless the kit says new ones.
    await publish(ken, raw("two"));
    assert.equal((await inbox(ana))[0].origin.prState, "merged");
    // From another branch, or by another person, it has none until their kit says one.
    await publish(ken, raw("two"), { ...ASKER, branch: "feat/next" });
    assert.equal((await inbox(ana))[0].origin, undefined);
    await publish(ken, raw("two"), ASKER, { pr: "41", prState: "merged" });
    await publish(ana, raw("two"));
    assert.deepEqual([(await inbox(ken))[0].askedBy, (await inbox(ken))[0].origin], ["ana", undefined]);
  } finally {
    await s.close();
  }
});

test("a repository link is an https address, and a commit is hex, or the page is not published", async () => {
  const { s, ken, publish } = await team();
  try {
    for (const bad of [{ repo: "javascript:alert(1)" }, { repo: "http://github.com/acme/x" }, { repo: "https://github.com/acme/x\" onmouseover=\"x" }, { commit: "zzz" }]) {
      assert.equal((await publish(ken, raw("bad"), { ...ASKER, ...bad })).status, 422, JSON.stringify(bad));
    }
    assert.equal((await publish(ken, raw("bad"), { ...ASKER, repo: "", commit: "" })).status, 200, "a project with no remote names none");
  } finally {
    await s.close();
  }
});

test("a client's page names who asked it", async () => {
  const { s, ken, publish } = await team();
  try {
    await publish(ken, raw("forc", { for: ["client"] }), ASKER, { pr: "9", prState: "open" });
    const { link } = (await call(s.port, "/__team/invite", { method: "POST", headers: { Authorization: `Bearer ${ADMIN}` }, body: { name: "cleo", client: true, projects: ["atlas"] } })).json();
    const joined = await call(s.port, "/__team/join", { method: "POST", body: { code: link.split("#")[1], password: PASSWORD } });
    const cleo = joined.headers["set-cookie"][0].split(";")[0];
    const data = dataOf((await call(s.port, "/atlas/ask/forc/", { headers: { Cookie: cleo } })).text);
    assert.deepEqual(data.origin, { by: "ken" }, "a client sees who asked it, not the team's pull request");
    assert.deepEqual(data.spec.asker, { project: "atlas-nx" }, "nor its repository, branch, or commit");
    const line = (await call(s.port, "/__hub/inbox", { headers: { Cookie: cleo } })).json().items.find((i) => i.id === "forc");
    assert.deepEqual([line.askedBy, line.asker, line.origin, line.waitingBy], ["ken", { project: "atlas-nx" }, undefined, undefined]);
    assert.deepEqual(data.collab.people.map((p) => p.name).sort(), ["cleo", "ken"]);
  } finally {
    await s.close();
  }
});

test("the kit reads a branch's pull request and its state from gh, and says nothing when gh cannot", async () => {
  const run = (out, status = 0) => async () => ({ status, stdout: out });
  assert.deepEqual(await prFor("/x", "feat/login", run(JSON.stringify({ number: 41, state: "OPEN", isDraft: false }))), { pr: "41", prState: "open" });
  assert.deepEqual(await prFor("/x", "feat/login", run(JSON.stringify({ number: 41, state: "OPEN", isDraft: true }))), { pr: "41", prState: "draft" });
  assert.deepEqual(await prFor("/x", "feat/login", run(JSON.stringify({ number: 7, state: "MERGED", isDraft: false }))), { pr: "7", prState: "merged" });
  assert.equal(await prFor("/x", "feat/login", run("", 1)), null, "no pull request for the branch");
  assert.equal(await prFor("/x", "feat/login", run("not json")), null);
  assert.equal(await prFor("/x", "", run("{}")), null, "no branch, nothing to ask");
  // All of a person's branches in one call, each branch's newest pull request.
  const list = [{ headRefName: "feat/a", number: 9, state: "OPEN", isDraft: false }, { headRefName: "feat/b", number: 8, state: "MERGED", isDraft: false }, { headRefName: "feat/a", number: 3, state: "CLOSED", isDraft: false }];
  assert.deepEqual([...(await prsByBranch("/x", run(JSON.stringify(list))))], [["feat/a", { pr: "9", prState: "open" }], ["feat/b", { pr: "8", prState: "merged" }]]);
  assert.equal((await prsByBranch("/x", run("", 1))).size, 0);
});

test("a page sent with wf ask export names its project, not the team's repository, branch, or commit", () => {
  const root = mkdtempSync(join(tmpdir(), "wf-origin-export-"));
  const view = join(root, ".cache/view");
  const { spec } = buildPage(root, view, raw("out"), KIT_KINDS, {}, { asker: ASKER });
  const data = dataOf(exportHtml(view, spec, KIT_KINDS, null));
  assert.deepEqual(data.spec.asker, { project: "atlas-nx" });
});
