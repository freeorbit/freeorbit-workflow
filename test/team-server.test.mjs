// The team server: a team and its client sign in by invite links, see the
// pages they may, answer them each as themselves, and nothing is lost when
// the server starts again (docs/design/team-server.md).

import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request as httpRequest } from "node:http";
import { test } from "node:test";

import { buildPage } from "../lib/ask/page.mjs";
import { KIT_KINDS } from "../lib/design/annotate.mjs";
import { teamServe } from "../lib/team/server.mjs";
import { maySee, openTeam, waitsOn } from "../lib/team/store.mjs";

const ADMIN = "a".repeat(40);
const opt = (id) => ({ id, label: id.toUpperCase(), why: `${id}, as it says.` });
const page = (id, extra = {}) => ({ id, title: id, questions: [{ id: "q1", text: "Pick?", type: "one", options: [opt("a"), opt("b")], recommended: "a", why: "w" }, { id: "q2", text: "And?", type: "one", options: [opt("a"), opt("b")], recommended: "a", why: "w", role: "designer" }], ...extra });

const PASSWORD = "correct horse battery";

test("an invite works once, sets who it names a password, and no secret or password is kept", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wf-team-store-"));
  let now = Date.parse("2026-11-23T00:00:00Z");
  const team = openTeam(dir, { adminToken: ADMIN, now: () => now });
  assert.equal(team.who(ADMIN).admin, true, "the host's admin token signs in the first admin");
  const code = team.invite({ name: "sam", role: "designer", projects: ["atlas"] }, "admin");
  const { member, token: secret, session } = await team.redeem(code, PASSWORD);
  assert.deepEqual([member.name, member.role, member.client], ["sam", "designer", false]);
  await assert.rejects(team.redeem(code, PASSWORD), /used, or is out of date/);
  assert.equal(team.who(secret).name, "sam", "the kit's token");
  assert.equal(team.session(session).name, "sam", "the browser's session");
  assert.equal(team.who(session), null, "a session is no kit token");
  assert.equal(team.who("x".repeat(40)), null);
  for (const name of ["members.json", "invites.json", "sessions.json"]) {
    const text = readFileSync(join(dir, "team", name), "utf8");
    assert.ok(![secret, code, session, PASSWORD].some((x) => text.includes(x)), `${name} keeps hashes only`);
  }
  // Any browser signs in with the name and the password, each its own session.
  const other = await team.login("sam", PASSWORD);
  assert.equal(team.session(other).name, "sam");
  assert.equal(team.session(session).name, "sam", "the first browser stays signed in");
  await assert.rejects(team.login("sam", "wrong password!!"), /name or password is not right/);
  await assert.rejects(team.login("nobody", PASSWORD), /name or password is not right/, "the same words, so a name is not told");
  team.logout(other);
  assert.equal(team.session(other), null, "signed out of that browser only");
  assert.equal(team.session(session).name, "sam");
  // A new kit token replaces the old one.
  const next = team.newToken("sam");
  assert.equal(team.who(secret), null);
  assert.equal(team.who(next).name, "sam");
  await assert.rejects(team.redeem(team.invite({ name: "short", projects: ["atlas"] }, "admin"), "short"), /at least 12 characters/);
  // A client's link opens only its projects, and ends.
  const client = await team.redeem(team.invite({ name: "glen", client: true, projects: ["atlas"], days: 2 }, "admin"), PASSWORD);
  assert.equal(client.member.role, "client");
  assert.equal(client.token, undefined, "a client has no kit token");
  now += 3 * 86_400_000;
  assert.equal(team.session(client.session), null, "out of date");
  await assert.rejects(team.login("glen", PASSWORD), /name or password is not right/);
  await assert.rejects(team.redeem(team.invite({ name: "late", projects: ["atlas"] }, "admin") + "x", PASSWORD), /used, or is out of date/);
  const old = team.invite({ name: "slow", projects: ["atlas"] }, "admin");
  now += 8 * 86_400_000;
  await assert.rejects(team.redeem(old, PASSWORD), /out of date/, "an invite lasts a week");
  team.revoke("sam", "admin");
  assert.equal(team.who(next), null, "revoked");
  assert.equal(team.session(session), null, "and every browser of theirs");
  assert.throws(() => team.invite({ name: "glen", client: true, projects: ["*"] }, "admin"), /client's link names its projects/);
  assert.throws(() => team.invite({ name: "x y", projects: ["a"] }, "admin"), /a name is/);
  assert.throws(() => team.invite({ name: "admin", projects: ["a"] }, "admin"), /admin token's own name/);
  const logs = readdirSync(join(dir, "team")).filter((f) => f.startsWith("log-"));
  const lines = logs.flatMap((f) => readFileSync(join(dir, "team", f), "utf8").trim().split("\n")).map((l) => JSON.parse(l).what);
  assert.deepEqual(lines.filter((w) => !["invite", "sign-in", "sign-in refused", "sign-out", "sign-out everywhere", "token"].includes(w)), ["join", "join", "revoke"]);
});

test("a client sees only the pages for the client; the team sees every page of its projects", () => {
  const spec = { questions: [{ role: "designer" }], for: ["client"] };
  const member = { name: "sam", role: "designer", client: false, projects: ["atlas"] };
  const client = { name: "glen", role: "client", client: true, projects: ["atlas"] };
  assert.equal(maySee(member, "atlas", { questions: [] }), true);
  assert.equal(maySee(member, "other", spec), false);
  assert.equal(maySee(client, "atlas", { questions: [] }), false);
  assert.equal(maySee(client, "atlas", spec), true);
  assert.equal(waitsOn(member, spec), true);
  assert.equal(waitsOn(client, spec), true);
});


/** A request with the Host given, as a browser reaching the server's public address sends it; fetch will not set Host. */
function request(port, path, { method, headers, body }) {
  return new Promise((done, fail) => {
    const req = httpRequest({ host: "127.0.0.1", port, path, method, headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        done({ status: res.statusCode, headers: { get: (name) => [].concat(res.headers[name.toLowerCase()] ?? []).join(", ") || null }, text: async () => text, json: async () => JSON.parse(text) });
      });
    });
    req.on("error", fail);
    req.end(body);
  });
}

/** A team server on a fresh folder, with helpers to call it as the kit or a browser. */
async function server(dir = mkdtempSync(join(tmpdir(), "wf-team-"))) {
  const origin = "http://asks.test";
  const s = await teamServe({ dir, origin, port: 0, host: "127.0.0.1", adminToken: ADMIN, secureCookie: false, log: () => {} });
  const call = (path, { method = "GET", token, cookie, body, from = origin, host = "asks.test", headers = {} } = {}) => request(s.port, path, {
    method,
    headers: { Host: host, ...(from ? { Origin: from } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(body != null ? { "Content-Type": "application/json" } : {}), ...headers },
    body: body == null ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  /** Invite someone as the admin, and use the link: their cookie and their kit's token. */
  const enroll = async (what) => {
    const { link } = await (await call("/__team/invite", { method: "POST", token: ADMIN, body: what })).json();
    const res = await call("/__team/join", { method: "POST", body: { code: link.split("#")[1], password: PASSWORD } });
    const got = await res.json();
    return { cookie: res.headers.get("set-cookie").split(";")[0], token: got.token, got, setCookie: res.headers.get("set-cookie") };
  };
  /** Publish a page as a member's kit would. */
  const publish = async (token, raw, key = "atlas") => {
    const root = mkdtempSync(join(tmpdir(), "wf-team-kit-"));
    const { spec } = buildPage(root, join(root, ".cache/view"), raw, KIT_KINDS);
    await call(`/__team/api/${key}`, { method: "PUT", token, body: { name: "Atlas", kinds: KIT_KINDS } });
    return call(`/__team/api/${key}/${spec.id}`, { method: "PUT", token, body: { spec, pictures: {} } });
  };
  return { ...s, dir, call, enroll, publish };
}

test("the team server: nothing without signing in, an invite link signs a browser in, and the kit publishes", async () => {
  const s = await server();
  try {
    assert.equal((await s.call("/")).status, 401);
    assert.equal((await s.call("/__hub/inbox")).status, 401);
    assert.equal((await s.call("/__team/join")).status, 200, "the invite link's page is open to all");
    assert.equal((await s.call("/__team/health")).status, 200, "and the host's probe");
    assert.equal((await s.call("/__team/me", { host: "evil.test" })).status, 403, "only its own address");
    // The host's probe reaches the replica by its own address, so the health route answers any Host, and says nothing more.
    const probe = await s.call("/__team/health", { host: "10.0.0.7:8080", from: null });
    assert.deepEqual([probe.status, await probe.json()], [200, { ok: true }]);
    assert.equal((await s.call("/__team/join", { host: "10.0.0.7:8080", from: null })).status, 403, "only the probe");
    assert.equal((await s.call("/__team/health", { method: "HEAD", host: "10.0.0.7:8080", from: null })).status, 200);
    assert.equal((await s.call("/__team/health", { method: "POST", host: "10.0.0.7:8080", from: null, body: {} })).status, 403, "and only to look");
    const sam = await s.enroll({ name: "sam", role: "designer", projects: ["atlas"] });
    assert.match(sam.setCookie, /HttpOnly; SameSite=Lax/);
    assert.equal(sam.got.name, "sam");
    assert.equal((await s.call("/__team/me", { cookie: sam.cookie })).status, 200);
    assert.equal((await s.call("/__team/invite", { method: "POST", token: sam.token, body: { name: "x", projects: ["atlas"] } })).status, 403, "only an admin invites");
    const res = await s.publish(sam.token, page("pick"));
    assert.equal(res.status, 200);
    assert.match((await res.json()).address, /^http:\/\/asks\.test\/atlas\/ask\/pick\/$/);
    assert.equal((await s.call("/__team/api/atlas/pick", { cookie: sam.cookie })).status, 401, "the kit's routes take its token, never a cookie");
    const html = await s.call("/atlas/ask/pick/", { cookie: sam.cookie });
    assert.equal(html.status, 200);
    assert.match(await html.text(), /<meta name="wf-token" content="[0-9a-f]{20,}">/);
    const items = (await (await s.call("/__hub/inbox", { cookie: sam.cookie })).json()).items;
    assert.deepEqual(items.map((i) => i.id), ["pick"]);
  } finally {
    await s.close();
  }
});

test("a client sees and answers only the pages for them; answers keep who gave them, and outlast a restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wf-team-"));
  let s = await server(dir);
  let sam;
  let glen;
  try {
    sam = await s.enroll({ name: "sam", role: "designer", projects: ["atlas"] });
    glen = await s.enroll({ name: "glen", client: true, projects: ["atlas"] });
    assert.equal(glen.got.token, undefined, "a client has no kit token");
    await s.publish(sam.token, page("team-only"));
    await s.publish(sam.token, page("for-glen", { for: ["client"] }));
    const seen = (await (await s.call("/__hub/inbox", { cookie: glen.cookie })).json()).items;
    assert.deepEqual(seen.map((i) => [i.id, i.forYou]), [["for-glen", true]]);
    const team = (await (await s.call("/__hub/inbox", { cookie: sam.cookie })).json()).items;
    assert.deepEqual(team.map((i) => [i.id, i.forYou]).sort(), [["for-glen", true], ["team-only", true]], "a question for the designer is for sam");
    assert.equal((await s.call("/atlas/ask/team-only/", { cookie: glen.cookie })).status, 404, "not there for the client");
    // A client's browser session, used as the kit's token, opens none of the kit's routes.
    assert.equal((await s.call("/__team/api/atlas/for-glen", { token: decodeURIComponent(glen.cookie.split("=")[1]) })).status, 401);
    // Answers, each from a page with its token, as each person.
    const tokenOf = async (cookie, id) => (await (await s.call(`/atlas/ask/${id}/`, { cookie })).text()).match(/name="wf-token" content="([^"]+)"/)[1];
    const state = await (await s.call("/__team/api/atlas/for-glen", { token: sam.token })).json();
    const send = async (cookie, answers) => s.call("/__ask/atlas/answers/for-glen", { method: "POST", cookie, headers: { "X-WF-Token": await tokenOf(cookie, "for-glen") }, body: { id: "for-glen", hash: state.hash, answers } });
    assert.equal((await send(glen.cookie, { q1: { choice: "b" } })).status, 200);
    assert.equal((await send(sam.cookie, { q2: { choice: "a" } })).status, 200);
    const cross = await s.call("/__ask/atlas/answers/for-glen", { method: "POST", cookie: glen.cookie, from: "https://evil.test", headers: { "X-WF-Token": "x" }, body: {} });
    assert.equal(cross.status, 403, "another site's page cannot send as them");
  } finally {
    await s.close();
  }
  s = await server(dir);
  try {
    const after = await (await s.call("/__team/api/atlas/for-glen", { token: sam.token })).json();
    assert.equal(after.state, "answered");
    assert.deepEqual(after.answers.by, { q1: "glen", q2: "sam" });
    assert.equal((await s.call("/__team/me", { cookie: glen.cookie })).status, 200, "sign-ins outlast a restart");
    assert.equal((await s.call("/__team/revoke", { method: "POST", token: ADMIN, body: { name: "glen" } })).status, 200);
    assert.equal((await s.call("/__team/me", { cookie: glen.cookie })).status, 401);
  } finally {
    await s.close();
  }
});

test("the agent's wait and replies go through the kit's routes; invite codes are rate limited", async () => {
  const s = await server();
  try {
    const sam = await s.enroll({ name: "sam", role: "designer", projects: ["atlas"] });
    await s.publish(sam.token, page("live-one", { live: true }));
    assert.equal((await s.call("/__team/api/atlas/live-one/waiting", { method: "POST", token: sam.token, body: { on: true } })).status, 200);
    const items = (await (await s.call("/__hub/inbox", { cookie: sam.cookie })).json()).items;
    assert.ok(items[0].waitingSince, "the page says an agent waits");
    assert.equal((await s.call("/__team/api/atlas/live-one/live", { method: "POST", token: sam.token, body: { live: { state: "running", step: "Flow 1" } } })).status, 200);
    assert.equal((await s.call("/__team/api/atlas/live-one/live", { method: "POST", token: sam.token, body: { live: { state: "exploded" } } })).status, 422);
    assert.equal((await s.call("/__team/api/atlas/live-one/reply", { method: "POST", token: sam.token, body: { question: "q1", text: "Why a?" } })).status, 200);
    assert.equal((await s.call("/__team/api/atlas/live-one/more", { method: "POST", token: sam.token, body: { question: "q1", blocks: [{ type: "text", title: "", note: "", id: "", source: "More." }] } })).status, 200);
    assert.equal((await s.call("/__team/api/atlas/live-one/more", { method: "POST", token: sam.token, body: { question: "q1", blocks: [{ type: "questions" }] } })).status, 422);
    const got = await (await s.call("/__team/api/atlas/live-one", { token: sam.token })).json();
    assert.equal(got.replies.q1[0].text, "Why a?");
    assert.equal(got.more.replies.q1[0].blocks[0].source, "More.");
    assert.equal((await s.call("/__team/api/other/live-one", { token: sam.token })).status, 404, "not their project");
    let last;
    for (let i = 0; i < 12; i++) last = await s.call("/__team/join", { method: "POST", body: { code: `wrong-${i}`, password: PASSWORD } });
    assert.equal(last.status, 429);
  } finally {
    await s.close();
  }
});

test("what a member's kit sends is checked: a hash that names a file, a broken spec, odd kinds, and a client's archive are refused", async () => {
  const { limiter, cookieName } = await import("../lib/team/server.mjs");
  const s = await server();
  try {
    const sam = await s.enroll({ name: "sam", role: "designer", projects: ["atlas"] });
    const glen = await s.enroll({ name: "glen", client: true, projects: ["atlas"] });
    assert.equal((await s.publish(sam.token, page("good", { for: ["client"] }))).status, 200);
    const root = mkdtempSync(join(tmpdir(), "wf-team-bad-"));
    const { spec } = buildPage(root, join(root, ".cache/view"), page("bad"), KIT_KINDS);
    const put = (body) => s.call("/__team/api/atlas/bad", { method: "PUT", token: sam.token, body });
    for (const [what, bad] of [
      ["a hash that names a file", { ...spec, hash: "/../../../../team/members" }],
      ["a question that is not one", { ...spec, questions: [null] }],
      ["a block the page does not draw", { ...spec, sections: [{ blocks: [{ type: "script" }] }] }],
      ["a picture outside the page", { ...spec, questions: [{ ...spec.questions[0], pictures: [{ src: "../../team/members.json" }] }] }],
    ]) assert.equal((await put({ spec: bad, pictures: {} })).status, 422, what);
    assert.equal((await s.call("/__team/api/atlas", { method: "PUT", token: sam.token, body: { name: "x", kinds: { bug: { color: "red; background:url(x)", word: "bug" } } } })).status, 422, "a colour is a colour");
    assert.equal((await s.call("/__hub/inbox", { cookie: sam.cookie })).status, 200, "the inbox still works for everyone");
    // A client answers; they do not archive an ask for the whole team.
    const inboxToken = (await (await s.call("/", { cookie: glen.cookie })).text()).match(/name="wf-token" content="([^"]+)"/)?.[1] ?? "";
    const item = (await (await s.call("/__hub/inbox", { cookie: glen.cookie })).json()).items[0];
    assert.equal((await s.call("/__hub/archive", { method: "POST", cookie: glen.cookie, headers: { "X-WF-Token": inboxToken }, body: { key: "atlas", id: "good", archived: true, asked: item.asked } })).status, 403);
    // The join page waits for a press, so a link scanner that opens it does not use it up.
    assert.match(await (await s.call("/__team/join")).text(), /Choose a password[\s\S]*<button>Join<\/button>/);
  } finally {
    await s.close();
  }
  let now = 0;
  const allow = limiter(() => now);
  assert.deepEqual(Array.from({ length: 4 }, () => allow("a", 3)), [true, true, true, false]);
  now += 61_000;
  assert.equal(allow("a", 3), true, "a new minute");
  assert.equal(cookieName(true), "__Host-wf_team", "on HTTPS, no other site on a parent domain can set it");
});


test("a person signs in from any browser with their name and password, and out of one", async () => {
  const s = await server();
  try {
    const sam = await s.enroll({ name: "sam", role: "designer", projects: ["atlas"] });
    await s.publish(sam.token, page("pick"));
    // Another browser: no cookie, so the page offers to sign in.
    const signIn = await s.call("/atlas/ask/pick/");
    assert.equal(signIn.status, 401);
    assert.match(await signIn.text(), /name=password type=password/, "the page signs in, in place");
    assert.equal((await s.call("/__team/login", { method: "POST", body: { name: "sam", password: "not the one!!" } })).status, 403);
    const res = await s.call("/__team/login", { method: "POST", body: { name: "sam", password: PASSWORD } });
    assert.equal(res.status, 200);
    const other = res.headers.get("set-cookie").split(";")[0];
    assert.notEqual(other, sam.cookie, "a session of its own");
    assert.equal((await s.call("/atlas/ask/pick/", { cookie: other })).status, 200);
    assert.equal((await s.call("/__team/login", { method: "POST", from: "https://evil.test", body: { name: "sam", password: PASSWORD } })).status, 403, "only from its own pages");
    // Signing out ends that browser's session alone, and a dead cookie is cleared.
    const third = (await s.call("/__team/login", { method: "POST", body: { name: "sam", password: PASSWORD } })).headers.get("set-cookie").split(";")[0];
    assert.equal((await s.call("/__team/logout", { method: "POST", cookie: third, body: {} })).status, 200);
    const dead = await s.call("/atlas/ask/pick/", { cookie: third });
    assert.equal(dead.status, 401);
    assert.match(dead.headers.get("set-cookie") ?? "", /Max-Age=0/);
    assert.equal((await s.call("/atlas/ask/pick/", { cookie: sam.cookie })).status, 200);
    // A new kit token needs the password again; the old token stops, and every other browser is signed out.
    assert.equal((await s.call("/__team/token", { method: "POST", cookie: other, body: { password: "not the one!!" } })).status, 403);
    const made = await s.call("/__team/token", { method: "POST", cookie: other, body: { password: PASSWORD } });
    const { token } = await made.json();
    const again = made.headers.get("set-cookie").split(";")[0];
    assert.equal((await s.call("/__team/api/atlas/pick", { token: sam.token })).status, 401);
    assert.equal((await s.call("/__team/api/atlas/pick", { token })).status, 200);
    assert.equal((await s.call("/atlas/ask/pick/", { cookie: sam.cookie })).status, 401, "the other browsers are out");
    assert.equal((await s.call("/__team/account", { cookie: again })).status, 200, "this one signed in again");
    // Signing out of every browser.
    assert.equal((await s.call("/__team/logout", { method: "POST", cookie: again, body: { all: true } })).status, 200);
    assert.equal((await s.call("/atlas/ask/pick/", { cookie: again })).status, 401);
    let last;
    for (let i = 0; i < 12; i++) last = await s.call("/__team/login", { method: "POST", body: { name: "sam", password: `wrong ${i} password` } });
    assert.equal(last.status, 429, "tries are limited");
    const refused = readdirSync(join(s.dir, "team")).filter((f) => f.startsWith("log-")).flatMap((f) => readFileSync(join(s.dir, "team", f), "utf8").trim().split("\n")).map((l) => JSON.parse(l)).filter((l) => l.what === "sign-in refused");
    assert.ok(refused.length >= 5 && refused.every((l) => l.name === "sam" && !JSON.stringify(l).includes("wrong")), "failed tries are logged, never the password");
  } finally {
    await s.close();
  }
});

test("a sign-in in flight when a new password is set does not survive it, and the limiter keeps a key in its minute", async () => {
  const { limiter } = await import("../lib/team/server.mjs");
  const dir = mkdtempSync(join(tmpdir(), "wf-team-race-"));
  const team = openTeam(dir, { adminToken: ADMIN });
  await team.redeem(team.invite({ name: "sam", projects: ["atlas"] }, "admin"), "the old password!");
  const reset = team.invite({ name: "sam", projects: ["atlas"] }, "admin");
  // Whichever finishes its scrypt first, the old password's sign-in does not outlast the new one.
  for (let i = 0; i < 2; i++) {
    const before = i === 0 ? team.login("sam", i ? "the new password!" : "the old password!") : null;
    const old = i === 1 ? team.login("sam", "the new password!") : before;
    await team.redeem(i === 0 ? reset : team.invite({ name: "sam", projects: ["atlas"] }, "admin"), i === 0 ? "the new password!" : "another password!");
    const session = await old.catch(() => null);
    assert.equal(session && team.session(session), null, "no session from the password before");
  }
  await assert.rejects(team.login("sam", "the old password!"), /name or password is not right/);
  let now = 0;
  const allow = limiter(() => now);
  for (let i = 0; i < 3; i++) allow("n:sam", 3);
  assert.equal(allow("n:sam", 3), false);
  for (let i = 0; i < 6000; i++) allow(`k${i}`, 3);
  assert.equal(allow("n:sam", 3), false, "a flood of other keys does not reset one in its minute");
});
