// Working together on a team server's ask page: one shared answer per
// question, saved as it is made and pushed live to every open page, who is
// on the page and where, threads, assigning, a ready check, who sent it, and
// what happened (docs/design/team-server.md, "Working together").

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { answersMarkdown } from "../lib/ask/answers.mjs";
import { buildPage } from "../lib/ask/page.mjs";
import { KIT_KINDS } from "../lib/design/annotate.mjs";
import { COLLAB_LIMITS } from "../lib/team/collab.mjs";
import { teamServe } from "../lib/team/server.mjs";

const ADMIN = "c".repeat(40);
const PASSWORD = "correct horse battery";
const ORIGIN = "http://asks.test";
const opt = (id) => ({ id, label: id.toUpperCase(), why: `${id}, as it says.` });
const raw = { id: "pick", title: "Pick", questions: [{ id: "q1", text: "First?", options: [opt("a"), opt("b")], recommended: "a", why: "w" }, { id: "q2", text: "Second?", options: [opt("a"), opt("b")], recommended: "a", why: "w" }] };

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

/** An open event stream: its events as they come, and a way to wait for one. */
function stream(port, path, cookie) {
  const events = [];
  let wake = () => {};
  const out = { status: 0, ended: false };
  const req = httpRequest({ host: "127.0.0.1", port, path, headers: { Host: "asks.test", Cookie: cookie, Accept: "text/event-stream" } }, (res) => {
    out.status = res.statusCode;
    res.on("end", () => { out.ended = true; wake(); });
    let buf = "";
    res.on("data", (c) => {
      buf += c;
      let at;
      while ((at = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, at);
        buf = buf.slice(at + 2);
        const type = block.match(/^event: (.+)$/m)?.[1];
        const data = block.match(/^data: (.+)$/m)?.[1];
        if (type) events.push({ type, data: JSON.parse(data) });
        wake();
      }
    });
  });
  req.end();
  const next = async (type, test = () => true, ms = 3000) => {
    const end = Date.now() + ms;
    for (;;) {
      const found = events.find((e) => e.type === type && test(e.data));
      if (found) { events.splice(events.indexOf(found), 1); return found.data; }
      if (Date.now() > end) throw new Error(`no ${type} event; had ${events.map((e) => e.type).join(", ")}`);
      await new Promise((r) => { wake = r; setTimeout(r, 50); });
    }
  };
  const ended = async (ms = 3000) => {
    const end = Date.now() + ms;
    while (!out.ended && Date.now() < end) await new Promise((r) => { wake = r; setTimeout(r, 50); });
    return out.ended;
  };
  return { events, next, ended, out, close: () => req.destroy() };
}

const serveAt = (dir) => teamServe({ dir, origin: ORIGIN, port: 0, host: "127.0.0.1", adminToken: ADMIN, secureCookie: false, log: () => {} });

async function team() {
  const dir = mkdtempSync(join(tmpdir(), "wf-collab-"));
  const s = await teamServe({ dir, origin: ORIGIN, port: 0, host: "127.0.0.1", adminToken: ADMIN, secureCookie: false, log: () => {} });
  const enroll = async (what) => {
    const { link } = (await call(s.port, "/__team/invite", { method: "POST", headers: { Authorization: `Bearer ${ADMIN}` }, body: what })).json();
    const res = await call(s.port, "/__team/join", { method: "POST", body: { code: link.split("#")[1], password: PASSWORD } });
    return { name: what.name, cookie: res.headers["set-cookie"][0].split(";")[0], token: res.json().token };
  };
  const ken = await enroll({ name: "ken", role: "developer", projects: ["atlas"] });
  const ana = await enroll({ name: "ana", role: "designer", projects: ["atlas"] });
  const root = mkdtempSync(join(tmpdir(), "wf-collab-proj-"));
  const { spec } = buildPage(root, join(root, ".cache/view"), raw, KIT_KINDS);
  await call(s.port, "/__team/api/atlas", { method: "PUT", headers: { Authorization: `Bearer ${ken.token}` }, body: { name: "Atlas", kinds: KIT_KINDS } });
  await call(s.port, "/__team/api/atlas/pick", { method: "PUT", headers: { Authorization: `Bearer ${ken.token}` }, body: { spec, pictures: {} } });
  const tokenOf = async (who) => (await call(s.port, "/atlas/ask/pick/", { headers: { Cookie: who.cookie } })).text.match(/name="wf-token" content="([^"]+)"/)[1];
  /** A browser's post to the page's collaboration routes, with its page token. */
  const post = async (who, what, body, conn = "") => call(s.port, `/__ask/atlas/${what}/pick`, { method: "POST", headers: { Cookie: who.cookie, "X-WF-Token": await tokenOf(who), ...(conn ? { "X-WF-Conn": conn } : {}) }, body: { hash: spec.hash, ...body } });
  const state = async () => (await call(s.port, "/__team/api/atlas/pick", { headers: { Authorization: `Bearer ${ken.token}` } })).json();
  return { s, dir, ken, ana, spec, post, state, tokenOf };
}

test("one shared answer per question: saved as it is made, seen by everyone, and the agent's wait wakes only on Send", async () => {
  const { s, ken, ana, spec, post, state } = await team();
  try {
    assert.equal((await post(ken, "answer", { question: "q1", value: { choice: "b" } })).status, 200);
    assert.equal((await post(ana, "answer", { question: "q2", value: { choice: "a", note: "Tabs" } })).status, 200);
    assert.equal((await state()).state, "waiting", "saving an answer is not sending: the agent's wait sleeps on");
    // Everyone's page holds every answer, with who gave it.
    const page = (await call(s.port, "/atlas/ask/pick/", { headers: { Cookie: ana.cookie } })).text;
    const data = JSON.parse(page.match(/<script type="application\/json" id="ask-data">([\s\S]*?)<\/script>/)[1]);
    assert.deepEqual(data.working.answers, { q1: { choice: "b" }, q2: { choice: "a", note: "Tabs" } });
    assert.deepEqual(data.working.by, { q1: "ken", q2: "ana" });
    assert.equal(data.collab.me.name, "ana");
    // The last pick wins, and says who.
    await post(ana, "answer", { question: "q1", value: { choice: "a" } });
    assert.equal((await post(ken, "answer", { question: "q9", value: { choice: "a" } })).status, 422);
    assert.equal((await post(ken, "answer", { question: "q1", value: { choice: "zz" } })).status, 422);
    // Send takes the shared answers, whoever sends, and says who sent them.
    const sent = await call(s.port, "/__ask/atlas/answers/pick", { method: "POST", headers: { Cookie: ken.cookie, "X-WF-Token": await (async () => (await call(s.port, "/atlas/ask/pick/", { headers: { Cookie: ken.cookie } })).text.match(/name="wf-token" content="([^"]+)"/)[1])() }, body: { id: "pick", hash: spec.hash, answers: {} } });
    assert.equal(sent.status, 200);
    const after = await state();
    assert.equal(after.state, "answered");
    assert.deepEqual(after.answers.answers, { q1: { choice: "a" }, q2: { choice: "a", note: "Tabs" } });
    assert.deepEqual([after.answers.by, after.answers.sent.by], [{ q1: "ana", q2: "ana" }, "ken"]);
    const md = answersMarkdown(spec, after.answers);
    assert.match(md, /sent by ken/);
    assert.match(md, /\*\*q1\*\* First\?: \*\*a\*\* A \(recommended\)\. — ana/);
    const inbox = (await call(s.port, "/__hub/inbox", { headers: { Cookie: ana.cookie } })).json().items;
    assert.equal(inbox[0].sentBy, "ken");
  } finally {
    await s.close();
  }
});

test("open pages hear each change, who is on the page and where, and who is typing", async () => {
  const { s, ken, ana, post } = await team();
  const kenLive = stream(s.port, "/__ask/atlas/events/pick?conn=k1", ken.cookie);
  const anaLive = stream(s.port, "/__ask/atlas/events/pick?conn=a1", ana.cookie);
  try {
    const hello = await anaLive.next("hello");
    assert.deepEqual(hello.working.answers, {});
    await anaLive.next("presence", (p) => p.people.some((x) => x.name === "ken"));
    // Ken picks: Ana's page hears it, Ken's own does not hear itself.
    await post(ken, "answer", { question: "q1", value: { choice: "b" } }, "k1");
    const change = await anaLive.next("working", (w) => w.changed === "q1");
    assert.deepEqual([change.changes, change.by.q1, change.who], [{ q1: { choice: "b" } }, "ken", "ken"], "an event says only what changed");
    await assert.rejects(kenLive.next("working", () => true, 400), /no working event/, "a page does not hear its own save back");
    // Where each is, and who types.
    await post(ana, "presence", { question: "q2", typing: true }, "a1");
    const where = await kenLive.next("presence", (p) => p.people.some((x) => x.name === "ana" && x.question === "q2" && x.typing));
    assert.ok(where.people.find((x) => x.name === "ana"));
    anaLive.close();
    await kenLive.next("presence", (p) => !p.people.some((x) => x.name === "ana"), 3000);
  } finally {
    kenLive.close();
    anaLive.close();
    await s.close();
  }
});

test("threads, assigning, the ready check, and what happened, each live", async () => {
  const { s, ken, ana, post } = await team();
  const kenLive = stream(s.port, "/__ask/atlas/events/pick?conn=k1", ken.cookie);
  try {
    await kenLive.next("hello");
    // A thread under a question, with a mention.
    assert.equal((await post(ana, "thread", { question: "q1", text: "@ken which frame is this?" })).status, 200);
    const said = await kenLive.next("thread", (t) => t.question === "q1");
    assert.deepEqual([said.entry.by, said.entry.text], ["ana", "@ken which frame is this?"]);
    assert.equal((await post(ana, "thread", { question: "q1", text: "x".repeat(2001) })).status, 422);
    // Ken assigns q2 to Ana: it is for her in her inbox; when she answers it, Ken is told.
    assert.equal((await post(ken, "assign", { question: "q2", name: "ana" })).status, 200);
    assert.equal((await post(ken, "assign", { question: "q2", name: "nobody" })).status, 422);
    const inbox = (await call(s.port, "/__hub/inbox", { headers: { Cookie: ana.cookie } })).json().items;
    assert.equal(inbox[0].forYou, true);
    await post(ana, "answer", { question: "q2", value: { choice: "b" } });
    const told = await kenLive.next("answered", (a) => a.question === "q2");
    assert.deepEqual([told.by, told.to], ["ana", "ken"]);
    // The ready check: who has marked their part done.
    await post(ana, "done", { done: true });
    const ready = await kenLive.next("done", (d) => d.done.ana);
    assert.ok(ready.done.ana);
    // What happened, newest last.
    const hello = (await call(s.port, "/atlas/ask/pick/", { headers: { Cookie: ken.cookie } })).text;
    const data = JSON.parse(hello.match(/<script type="application\/json" id="ask-data">([\s\S]*?)<\/script>/)[1]);
    assert.deepEqual(data.collab.activity.map((a) => `${a.who} ${a.what} ${a.question ?? ""}`.trim()), ["ana thread q1", "ken assign q2", "ana answer q2", "ana done"]);
    assert.deepEqual(data.collab.people.map((p) => p.name).sort(), ["ana", "ken"], "who can be assigned or mentioned");
    // A client neither assigns nor sees a page not for them.
    assert.equal((await call(s.port, "/__ask/atlas/events/pick", { headers: { Cookie: "wf_team=nope" } })).status, 401);
  } finally {
    kenLive.close();
    await s.close();
  }
});

test("a page answered before the shared answers starts from the answers last sent", async () => {
  const { s, dir, ken, spec } = await team();
  const token = (await call(s.port, "/atlas/ask/pick/", { headers: { Cookie: ken.cookie } })).text.match(/name="wf-token" content="([^"]+)"/)[1];
  await call(s.port, "/__ask/atlas/answers/pick", { method: "POST", headers: { Cookie: ken.cookie, "X-WF-Token": token }, body: { id: "pick", hash: spec.hash, answers: { q1: { choice: "b" } } } });
  await s.close();
  // As a v1.22 server left it: the answers file, and no shared answers.
  const kept = readdirSync(dir, { recursive: true }).map(String).filter((f) => f.endsWith("working.json"));
  assert.equal(kept.length, 1);
  rmSync(join(dir, kept[0]));
  const again = await serveAt(dir);
  try {
    const page = (await call(again.port, "/atlas/ask/pick/", { headers: { Cookie: ken.cookie } })).text;
    const data = JSON.parse(page.match(/<script type="application\/json" id="ask-data">([\s\S]*?)<\/script>/)[1]);
    assert.deepEqual(data.working.answers, { q1: { choice: "b" } });
    assert.deepEqual(data.working.by, { q1: "ken" });
  } finally {
    await again.close();
  }
});

test("an open stream ends when its person is revoked or the page is built for others, and a stale tab writes nothing", async () => {
  const { s, ken, ana, spec, post } = await team();
  const recheck = COLLAB_LIMITS.recheckMs;
  COLLAB_LIMITS.recheckMs = 0;
  try {
    const anaLive = stream(s.port, "/__ask/atlas/events/pick?conn=a1", ana.cookie);
    await anaLive.next("hello");
    await call(s.port, "/__team/revoke", { method: "POST", headers: { Authorization: `Bearer ${ADMIN}` }, body: { name: "ana" } });
    await post(ken, "answer", { question: "q1", value: { choice: "b" } });
    assert.ok(await anaLive.ended(), "a revoked person's stream is closed at the next event");
    const kenLive = stream(s.port, "/__ask/atlas/events/pick?conn=k1", ken.cookie);
    await kenLive.next("hello");
    const tab = await post(ken, "answer", { question: "q1", value: { choice: "a" } });
    assert.equal(tab.status, 200);
    // Built again with other questions: the open pages are told, their streams close, and a save with the old hash is refused.
    const root = mkdtempSync(join(tmpdir(), "wf-collab-proj-"));
    const changed = buildPage(root, join(root, ".cache/view"), { ...raw, questions: [...raw.questions, { id: "q3", text: "Third?", options: [opt("a"), opt("b")], recommended: "a", why: "w" }] }, KIT_KINDS).spec;
    await call(s.port, "/__team/api/atlas/pick", { method: "PUT", headers: { Authorization: `Bearer ${ken.token}` }, body: { spec: changed, pictures: {} } });
    await kenLive.next("replaced");
    assert.ok(await kenLive.ended());
    const stale = await call(s.port, "/__ask/atlas/answer/pick", { method: "POST", headers: { Cookie: ken.cookie, "X-WF-Token": (await call(s.port, "/atlas/ask/pick/", { headers: { Cookie: ken.cookie } })).text.match(/name="wf-token" content="([^"]+)"/)[1] }, body: { hash: spec.hash, question: "q1", value: { choice: "b" } } });
    assert.equal(stale.status, 409);
  } finally {
    COLLAB_LIMITS.recheckMs = recheck;
    await s.close();
  }
});

test("a person holds at most five streams on a page, and a client's page names only who it needs", async () => {
  const { s, ken } = await team();
  const open = [];
  try {
    for (let i = 0; i < 6; i++) open.push(stream(s.port, `/__ask/atlas/events/pick?conn=k${i}`, ken.cookie));
    await open[4].next("hello");
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(open[5].out.status, 503);
    // A client sees themself, who asked the page, and whom a question is assigned to, not the whole team.
    const { link } = (await call(s.port, "/__team/invite", { method: "POST", headers: { Authorization: `Bearer ${ADMIN}` }, body: { name: "cleo", client: true, projects: ["atlas"] } })).json();
    const joined = await call(s.port, "/__team/join", { method: "POST", body: { code: link.split("#")[1], password: PASSWORD } });
    const cleo = joined.headers["set-cookie"][0].split(";")[0];
    const root = mkdtempSync(join(tmpdir(), "wf-collab-proj-"));
    const forClient = buildPage(root, join(root, ".cache/view"), { ...raw, id: "forc", for: ["client"] }, KIT_KINDS).spec;
    assert.equal((await call(s.port, "/__team/api/atlas/forc", { method: "PUT", headers: { Authorization: `Bearer ${ken.token}` }, body: { spec: forClient, pictures: {} } })).status, 200);
    const page = (await call(s.port, "/atlas/ask/forc/", { headers: { Cookie: cleo } })).text;
    const data = JSON.parse(page.match(/<script type="application\/json" id="ask-data">([\s\S]*?)<\/script>/)[1]);
    assert.deepEqual(data.collab.people.map((p) => p.name).sort(), ["cleo", "ken"], "themself, and who asked it");
  } finally {
    for (const o of open) o.close();
    await s.close();
  }
});
