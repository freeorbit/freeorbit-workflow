// `wf team serve`: the ask-pages server for a team and its client, reached
// over HTTPS from anywhere. It is the local hub (lib/view/serve.mjs) behind a
// sign-in, serving one folder per project laid out as .cache/view is, with
// the routes the kit uses to publish pages and wait on them. The design is
// docs/design/team-server.md; what it promises is in SECURITY.md.
//
//   GET  /__team/health                  up, for the host's probes: open to all, at any Host (lib/view/serve.mjs)
//   GET  /__team/join                    the invite link's page: Join posts the link's code
//   POST /__team/join                    use a code with a chosen password: signs this browser in, and gives the kit's token once
//   GET  /__team/login                   the sign-in page, also shown in place of a page asked for while signed out
//   POST /__team/login                   a name and a password: signs this browser in, a session of its own
//   POST /__team/logout                  sign this browser out
//   POST /__team/token                   a new token for the kit, shown once, from a signed-in browser
//   GET  /__team/account                 who is signed in, a new kit token, and signing out
//   GET  /__team/me                      who is signed in
//   POST /__team/invite                  an admin's invite: { name, role, client, admin, projects, days }
//   POST /__team/revoke                  an admin's revoke: { name }
//   GET  /__team/members                 an admin's list of members
//   PUT  /__team/api/<project>           a project's name and its comment kinds
//   PUT  /__team/api/<project>/<id>      publish a page: its spec and its pictures; the server draws it
//   GET  /__team/api/<project>/<id>[?since=<n>&waiting=1]   the page's state for the agent's wait
//   POST /__team/api/<project>/<id>/<what>   waiting, told, more, reply, or live, from the agent
//   GET  /<project>/ask/<id>/            the page, drawn for the person signed in
//
// The kit's routes take a bearer token; a browser's, the cookie its invite
// link set, which `SameSite=Lax`, the page's own token, and the server's own
// Origin keep from being used by another site.
//
// The server is the only writer of its folder, so it keeps what every poll
// reads in memory: the members, the projects, each page's spec, and each
// page's inbox line, made again only when a route writes that page. A poll
// then reads no file, which matters on a network share.

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { answersMarkdown, askState, checkAnswers } from "../ask/answers.mjs";
import { BLOCK_LIMITS } from "../ask/blocks.mjs";
import { addReply, keepRound, LIVE_LIMITS, LIVE_STATES, readLive, readReplies, rounds, writeLive } from "../ask/live.mjs";
import { addAsk, addMore, markTold, moreOf, untoldAsks, withMore } from "../ask/more.mjs";
import { pageHtml } from "../ask/page.mjs";
import { answersPath, archivedAsked, askDir, DROPPED_ON_CHANGE, ID, readSpec } from "../ask/store.mjs";
import { writeWhole } from "../files.mjs";
import { ANSWERED_DAYS, PAGE_CSP, serve } from "../view/serve.mjs";
import { SETTINGS_MARK, settingsScript } from "../view/settings.mjs";
import { SEEN_MS } from "../view/waiting.mjs";
import { cleanKinds, drawableBlocks, specProblem } from "./check.mjs";
import { inProject, maySee, openTeam, PROJECT, TEAM_LIMITS, waitsOn } from "./store.mjs";
import { openCollab } from "./collab.mjs";

const PICTURES = 24 * 1024 * 1024;
const PICTURE = /^p\/\d{1,3}\.(png|jpe?g|gif|webp|svg)$/;
// Writes a person may make a minute, and invite codes a caller may try a minute; where they are on a page, more often.
const RATE = { presence: 300, saves: 240, streams: 30, writes: 120, joins: 10, nameAll: 60 };

/** The cookie a browser signs in with: `__Host-` on HTTPS, so no other site on a parent domain can set it. */
export const cookieName = (secure) => (secure ? "__Host-wf_team" : "wf_team");

/** The secret a request signs in with: a bearer token from the kit, or the browser's cookie. */
export function secretOf(req, cookie = cookieName(true)) {
  const auth = String(req.headers.authorization ?? "");
  if (auth.startsWith("Bearer ")) return { secret: auth.slice(7).trim(), bearer: true };
  const found = String(req.headers.cookie ?? "").split(/;\s*/).find((c) => c.startsWith(`${cookie}=`));
  return { secret: found ? decodeURIComponent(found.slice(cookie.length + 1)) : "", bearer: false };
}

/** A count of each key's requests in the last minute, kept in memory, its old keys dropped as it goes. */
export function limiter(now = () => Date.now()) {
  const seen = new Map();
  return (key, most) => {
    const at = now();
    const was = seen.get(key);
    const hit = was && at - was.start < 60_000 ? was : { start: at, n: 0 };
    hit.n = Math.min(hit.n + 1, most + 1);
    seen.delete(key);
    seen.set(key, hit);
    // The oldest keys come first; ones whose minute is over go. A key still in its minute is never dropped,
    // so no flood of other keys resets one; past 5,000 live keys, a new one is refused.
    for (const [k, v] of seen) {
      if (at - v.start < 60_000) break;
      seen.delete(k);
    }
    if (!was && seen.size > 5_000) {
      seen.delete(key);
      return false;
    }
    return hit.n <= most;
  };
}

// The team server's own small pages: each its own inline script, posting to the server, under a CSP of its own.
export const PAGES_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'";
const STYLE = `<style>body{font:16px system-ui;max-width:34em;margin:12vh auto;padding:0 16px}label{display:block;margin:12px 0 4px}input{font:inherit;width:100%;box-sizing:border-box;padding:6px 8px}button{font:inherit;padding:6px 16px;margin-top:16px}label.show{display:flex;gap:6px;align-items:center;margin-top:8px}label.show input{width:auto}pre{white-space:pre-wrap;background:#eee;padding:12px}#say{min-height:1.4em}</style>`;
// A box that shows the page's passwords as text, so a person sees what they typed.
const SHOW = `<label class=show><input type=checkbox id=show> Show password</label>`;
const page = (title, body, script) => `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width"><title>${title}</title>${STYLE}<body>${body}<script>(() => {
  const say = (t) => { document.getElementById("say").textContent = t; };
  const post = async (path, body) => { const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); return { ok: res.ok, body: await res.json().catch(() => ({})) }; };
  // Show password: every password field shows what it holds, such as a character a keyboard's dead key changed.
  const show = document.getElementById("show");
  if (show) show.onchange = () => document.querySelectorAll("input[data-pw]").forEach((i) => { i.type = show.checked ? "text" : "password"; });
${script}
})();</script>`;

/** The invite link's page: the person chooses a password, and joins when they press Join, so a mail scanner that opens the link does not use it up. */
const JOIN_PAGE = page("Join", `<h1>Join the asks</h1><p>Choose a password. You sign in with your name and it, from any browser.</p>
<form id=f><label for=pw>Password, at least 12 characters</label><input id=pw name=password type=password data-pw autocomplete=new-password minlength=12 required>
<label for=pw2>The same again</label><input id=pw2 type=password data-pw autocomplete=new-password required>${SHOW}<button>Join</button></form><p id=say></p><pre id=kit hidden></pre>`, `
  const code = location.hash.slice(1); history.replaceState(null, "", location.pathname);
  const f = document.getElementById("f");
  if (!code) { f.hidden = true; return say("This link has no code. Open the whole link you were sent."); }
  f.onsubmit = async (e) => {
    e.preventDefault();
    const pw = document.getElementById("pw").value;
    if (pw !== document.getElementById("pw2").value) return say("The two passwords differ.");
    const { ok, body } = await post("/__team/join", { code, password: pw });
    if (!ok) return say(body.error || "That did not work. Ask for a new link.");
    f.hidden = true;
    document.querySelector("h1").textContent = "You are in, " + body.name;
    if (body.client) { say("Sign in again from any browser with your name, " + body.name + ", and your password."); return setTimeout(() => location.assign("/"), 1500); }
    say("Sign in from any browser with your name, " + body.name + ", and your password. For your kit, keep this token in the variable your project's teamServer.tokenEnv names (WF_TEAM_TOKEN), such as in a gitignored .env. It is shown once; your account page makes a new one.");
    const kit = document.getElementById("kit"); kit.hidden = false; kit.textContent = body.token;
    const asks = document.createElement("a"); asks.href = "/"; asks.textContent = "Go to your asks"; document.body.append(asks);
  };`);

/** The sign-in page, shown in place of any page asked for while signed out; it goes on to that page once signed in. */
export const SIGN_IN_PAGE = page("Sign in", `<h1>Sign in</h1><form id=f><label for=n>Name</label><input id=n name=name autocomplete=username required>
<label for=pw>Password</label><input id=pw name=password type=password data-pw autocomplete=current-password required>${SHOW}<button>Sign in</button></form><p id=say></p>
<p style="color:#666">New here? Open the invite link you were sent. Forgot your password? Ask an admin for a new link.</p>`, `
  document.getElementById("f").onsubmit = async (e) => {
    e.preventDefault();
    const { ok, body } = await post("/__team/login", { name: document.getElementById("n").value.trim(), password: document.getElementById("pw").value });
    if (!ok) return say(body.error || "That did not work.");
    location.reload();
  };`);

/** A person's account: who they are, a new kit token, and signing this browser out. */
const accountPage = (who) => page("Account", `<h1>${who.name.replace(/[^A-Za-z0-9._-]/g, "")}</h1><p>${who.client ? "client" : who.role.replace(/[^a-z-]/g, "")}</p>
${who.client ? "" : `<form id=tok><label for=pw>A new kit token: your password</label><input id=pw type=password data-pw autocomplete=current-password required>${SHOW}<button>Make a new kit token</button></form><pre id=kit hidden></pre>`}<p id=say></p>
<button id=out>Sign out of this browser</button> <button id=all>Sign out of every browser</button> <a href="/">Your asks</a>`, `
  const tok = document.getElementById("tok");
  if (tok) tok.onsubmit = async (e) => {
    e.preventDefault();
    const { ok, body } = await post("/__team/token", { password: document.getElementById("pw").value });
    if (!ok) return say(body.error || "That did not work.");
    tok.hidden = true;
    const kit = document.getElementById("kit"); kit.hidden = false; kit.textContent = body.token;
    say("Put it in your WF_TEAM_TOKEN. It is shown once. The token before stops, and every other browser of yours is signed out.");
  };
  document.getElementById("out").onclick = async () => { await post("/__team/logout", {}); location.assign("/"); };
  document.getElementById("all").onclick = async () => { await post("/__team/logout", { all: true }); location.assign("/"); };`);

/**
 * Start the team server on `dir`, its data folder. `origin` is its public
 * address (https://…), the only Host and Origin it answers. `adminToken`
 * signs in the first admin. Resolves as serve() does.
 */
export function teamServe({ dir, origin, port = 8080, host = "0.0.0.0", adminToken = "", secureCookie = true, log = console.log }) {
  if (!/^https?:\/\/[^/]+$/.test(String(origin ?? ""))) throw new Error("the team server needs its public address, such as https://asks.example.com, as its origin");
  const team = openTeam(dir, { adminToken });
  const cookie = cookieName(secureCookie);
  const projectsDir = join(dir, "projects");
  mkdirSync(projectsDir, { recursive: true, mode: 0o700 });
  const viewOf = (key) => join(projectsDir, key);
  const keyOf = (key, id) => `${key}/${id}`;

  // --- what every request reads, kept in memory -------------------------------------------
  const projects = new Map();
  const pages = new Map(); // key/id → { spec, asked, line, version }
  const waits = new Map(); // key/id → { since, seen, by }
  let version = 0;
  function loadProject(key) {
    try {
      const meta = JSON.parse(readFileSync(join(viewOf(key), "project.json"), "utf8"));
      projects.set(key, { key, name: String(meta.name || key), view: viewOf(key), kinds: cleanKinds(meta.kinds) ?? {} });
    } catch {
      projects.delete(key);
    }
  }
  /** Make a page's entry again from its files: after a publish, or a write to it. */
  function refresh(key, id) {
    const p = projects.get(key);
    const spec = p ? readSpec(p.view, id) : null;
    if (!spec || specProblem(spec, id)) { pages.delete(keyOf(key, id)); return; }
    const asked = new Date(statSync(join(askDir(p.view, id), "spec.json")).mtimeMs).toISOString();
    const { state, open, answers } = askState(p.view, id, spec);
    const live = spec.live ? readLive(p.view, id) : null;
    const answeredAt = existsSync(answersPath(p.view, id)) ? statSync(answersPath(p.view, id)).mtimeMs : 0;
    const line = { id, title: spec.title, template: spec.template, questions: spec.questions.length, open, state, asked, sent: answers?.submitted ?? null, asker: spec.asker ?? null, last: Math.max(Date.parse(asked), answeredAt), ...(archivedAsked(p.view, id) === asked ? { archived: true } : {}), ...(live ? { live: { state: live.state, step: live.step, progress: live.progress, at: live.at } } : {}) };
    pages.set(keyOf(key, id), { spec, asked, line, roles: readJson(join(askDir(p.view, id), "team.json")) ?? [], version: ++version });
  }
  for (const key of readdirSync(projectsDir).filter((k) => PROJECT.test(k))) {
    loadProject(key);
    if (!projects.has(key) || !existsSync(join(viewOf(key), "ask"))) continue;
    for (const id of readdirSync(join(viewOf(key), "ask")).filter((x) => ID.test(x))) refresh(key, id);
  }
  const waitingSince = (k) => {
    const w = waits.get(k);
    return w && Date.now() - w.seen < SEEN_MS ? w.since : null;
  };

  const allowed = limiter();
  // The kit signs in with its token; a browser with its session, from a password or an invite link.
  const gate = (req) => {
    const { secret, bearer } = secretOf(req, cookie);
    return bearer ? team.who(secret) : team.session(secret);
  };
  const setSession = (res, secret) => res.setHeader("Set-Cookie", `${cookie}=${encodeURIComponent(secret)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${TEAM_LIMITS.sessionDays * 86_400}${secureCookie ? "; Secure" : ""}`);
  const callerOf = (req) => String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "").split(",").at(-1).trim();
  // A browser's own writes: from this server's own page, signed in with a session, not the kit's token.
  const browser = (handle) => async (req, res, c, ...rest) => {
    if (req.method !== "POST" || !c.ownOrigin || secretOf(req, cookie).bearer) return c.json(res, 403, { error: "from this server's own pages" });
    if (!allowed(`w:${c.who.name}`, RATE.writes)) return c.json(res, 429, { error: "too many changes this minute; wait a little" });
    return handle(req, res, c, ...rest);
  };
  const may = (who, key, spec) => (spec ? maySee(who, key, spec) : inProject(who, key));
  // The kit's own routes take its bearer token, never the browser's cookie.
  const kit = (handle) => async (req, res, c, ...rest) => {
    if (!secretOf(req, cookie).bearer) return c.json(res, 401, { error: "the kit signs in with its token, as Authorization: Bearer" });
    if (req.method !== "GET" && !allowed(`w:${c.who.name}`, RATE.writes)) return c.json(res, 429, { error: "too many changes this minute; wait a little" });
    if (req.method !== "GET" && !String(req.headers["content-type"] ?? "").startsWith("application/json")) return c.json(res, 415, { error: "the kit sends application/json" });
    return handle(req, res, c, ...rest);
  };
  const adminOnly = (handle) => kit((req, res, c, ...rest) => (c.who.admin ? handle(req, res, c, ...rest) : c.json(res, 403, { error: "only an admin does that" })));
  const memberOf = (c, key) => !c.who.client && inProject(c.who, key);
  const collab = openCollab(viewOf);
  /** Who can see a page: the people it can be assigned to, or a line can name. */
  const peopleOf = (key, spec) => team.members().filter((m) => !m.revoked && !(m.expires && Date.parse(m.expires) <= Date.now()) && maySee(m, key, spec)).map((m) => ({ name: m.name, role: m.client ? "client" : m.role }));
  /** The people a page names for a person: all of them for the team; for a client, only themself and whom a question is assigned to. */
  const peopleFor = (who, key, spec, together) => {
    const all = peopleOf(key, spec);
    if (!who.client) return all;
    const named = new Set([who.name, ...Object.values(together.assign).map((a) => a.name)]);
    return all.filter((p) => named.has(p.name));
  };
  /**
   * A browser's write to a page it sees: from this server's own page, with
   * the page's token, as JSON, with its session, not the kit's token.
   */
  const pageWrite = (handle, rate = RATE.writes, bucket = "w") => async (req, res, c, key, id) => {
    if (req.method !== "POST" || !c.ownOrigin || secretOf(req, cookie).bearer) return c.json(res, 403, { error: "from this server's own pages" });
    const found = c.pageOf(key, id, c);
    if (!found) return c.json(res, 404, { error: `no ask page ${id}` });
    if (req.headers["x-wf-token"] !== c.pageToken(key, id)) return c.json(res, 403, { error: "the page's token is not this server's for this page; reload the page" });
    if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) return c.json(res, 415, { error: "application/json" });
    if (!allowed(`${bucket}:${c.who.name}`, rate)) return c.json(res, 429, { error: "too many changes this minute; wait a little" });
    const body = await c.jsonBody(req, res, 64 * 1024, "at most 64 KB", "not JSON");
    if (body === undefined) return;
    // A tab open from before the page was built again with other questions writes nothing into the new one.
    if (body?.hash !== found.spec.hash) return c.json(res, 409, { error: "this page was built again; reload it" });
    try {
      return await handle(req, res, c, found, body, String(req.headers["x-wf-conn"] ?? ""));
    } catch (err) {
      return c.json(res, 422, { error: err.message });
    }
  };
  let publishing = false;

  const extra = [
    [/^\/__team\/join$/, async (req, res, c) => {
      if (req.method === "GET") return c.send(res, 200, JOIN_PAGE, "text/html; charset=utf-8", PAGES_CSP);
      if (req.method !== "POST" || !c.ownOrigin) return c.json(res, 403, { error: "join from the invite link's page" });
      // The last address the host's proxy added is the caller's; the ones before it are whatever the caller sent.
      if (!allowed(`j:${callerOf(req)}`, RATE.joins)) return c.json(res, 429, { error: "too many tries; wait a minute" });
      const body = await c.jsonBody(req, res, 1024, "a code and a password are short", "not JSON");
      if (body === undefined) return;
      try {
        const { member, session, token } = await team.redeem(String(body?.code ?? ""), body?.password);
        setSession(res, session);
        // The kit's token is shown once, to a member; a client has no kit.
        return c.json(res, 200, { ok: true, name: member.name, client: member.client, ...(token ? { token } : {}) });
      } catch (err) {
        return c.json(res, 403, { error: err.message });
      }
    }, { open: true }],
    [/^\/__team\/login$/, async (req, res, c) => {
      if (req.method === "GET") return c.send(res, 200, SIGN_IN_PAGE, "text/html; charset=utf-8", PAGES_CSP);
      if (req.method !== "POST" || !c.ownOrigin) return c.json(res, 403, { error: "sign in from this server's own page" });
      const body = await c.jsonBody(req, res, 1024, "a name and a password are short", "not JSON");
      if (body === undefined) return;
      // Tries are limited from each address, for each name from each address, and for each name in all at a higher
      // count, so a password is slow to guess, and one address cannot lock a person out.
      const caller = callerOf(req);
      const name = String(body?.name ?? "").toLowerCase().slice(0, 40);
      if (!allowed(`l:${caller}`, RATE.joins) || !allowed(`n:${name}:${caller}`, RATE.joins) || !allowed(`n:${name}`, RATE.nameAll)) return c.json(res, 429, { error: "too many tries; wait a minute" });
      try {
        setSession(res, await team.login(String(body?.name ?? ""), body?.password, caller));
        return c.json(res, 200, { ok: true });
      } catch (err) {
        return c.json(res, 403, { error: err.message });
      }
    }, { open: true }],
    [/^\/__team\/logout$/, browser(async (req, res, c) => {
      const body = await c.jsonBody(req, res, 1024, "short", "not JSON");
      if (body === undefined) return;
      // { all: true } signs out every browser of theirs, this one with them.
      if (body?.all === true) team.logoutAll(c.who.name);
      else team.logout(secretOf(req, cookie).secret);
      res.setHeader("Set-Cookie", `${cookie}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureCookie ? "; Secure" : ""}`);
      return c.json(res, 200, { ok: true });
    })],
    // A new kit token outlasts any session, so it needs the password again, and signs every other browser out.
    [/^\/__team\/token$/, browser(async (req, res, c) => {
      const body = await c.jsonBody(req, res, 1024, "short", "not JSON");
      if (body === undefined) return;
      if (!allowed(`n:${c.who.name.toLowerCase()}:${callerOf(req)}`, RATE.joins)) return c.json(res, 429, { error: "too many tries; wait a minute" });
      if (!(await team.check(c.who.name, body?.password))) return c.json(res, 403, { error: "the password is not right" });
      try {
        const token = team.newToken(c.who.name);
        team.logoutAll(c.who.name);
        // This browser signs in again, a session of its own; every other one is out.
        setSession(res, await team.login(c.who.name, body.password, callerOf(req)));
        return c.json(res, 200, { ok: true, token });
      } catch (err) {
        return c.json(res, 403, { error: err.message });
      }
    })],
    [/^\/__team\/account$/, (req, res, c) => (secretOf(req, cookie).bearer ? c.json(res, 403, { error: "a browser's page" }) : c.send(res, 200, accountPage(c.who), "text/html; charset=utf-8", PAGES_CSP))],
    [/^\/__team\/me$/, (req, res, c) => c.json(res, 200, { name: c.who.name, role: c.who.role, client: c.who.client, admin: c.who.admin, projects: c.who.projects })],
    [/^\/__team\/members$/, adminOnly((req, res, c) => c.json(res, 200, { members: team.members() }))],
    [/^\/__team\/invite$/, adminOnly(async (req, res, c) => {
      const body = await c.jsonBody(req, res, 4096, "an invite is short", "the invite is not JSON");
      if (body === undefined) return;
      try {
        const code = team.invite(body ?? {}, c.who.name);
        return c.json(res, 200, { ok: true, link: `${origin}/__team/join#${code}` });
      } catch (err) {
        return c.json(res, 422, { error: err.message });
      }
    })],
    [/^\/__team\/revoke$/, adminOnly(async (req, res, c) => {
      const body = await c.jsonBody(req, res, 1024, "a revoke is short", "the revoke is not JSON");
      if (body === undefined) return;
      try {
        team.revoke(String(body?.name ?? ""), c.who.name);
        return c.json(res, 200, { ok: true });
      } catch (err) {
        return c.json(res, 422, { error: err.message });
      }
    })],
    [/^\/__team\/api\/([^/]+)$/, kit(async (req, res, c, key) => {
      if (req.method !== "PUT") return c.json(res, 405, { error: "PUT a project's name and kinds" });
      if (!PROJECT.test(key) || !memberOf(c, key)) return c.json(res, 403, { error: `you are not on the project ${key}; ask an admin to invite you to it` });
      const body = await c.jsonBody(req, res, 64 * 1024, "a project is short", "the project is not JSON");
      if (body === undefined) return;
      const kinds = cleanKinds(body?.kinds ?? {});
      if (!kinds) return c.json(res, 422, { error: "a project's kinds are each a word, a colour, and what it is for, as the kit's" });
      mkdirSync(viewOf(key), { recursive: true, mode: 0o700 });
      writeWhole(join(viewOf(key), "project.json"), `${JSON.stringify({ name: String(body?.name ?? key).slice(0, 80), kinds }, null, 2)}\n`);
      loadProject(key);
      team.log("project", c.who.name, { project: key });
      return c.json(res, 200, { ok: true });
    })],
    [/^\/__team\/api\/([^/]+)\/([^/]+)$/, kit(async (req, res, c, key, id) => {
      const p = projects.get(key);
      if (!p || !memberOf(c, key) || !ID.test(id)) return c.json(res, 404, { error: `no project ${key} of yours on this server, or no page ${id}; run npx wf ask page, which publishes it` });
      if (req.method === "GET") return pageState(req, res, c, p, id);
      if (req.method !== "PUT") return c.json(res, 405, { error: "GET a page's state, or PUT the page" });
      // One publish at a time, so two large ones never hold their pictures in memory together.
      if (publishing) return c.json(res, 503, { error: "another page is being published; try again in a moment" });
      publishing = true;
      try {
        const body = await c.jsonBody(req, res, Math.ceil((PICTURES * 4) / 3) + 4 * 1024 * 1024, "a page and its pictures are at most 24 MB of pictures", "the page is not JSON");
        if (body === undefined) return;
        return publish(res, c, p, id, body);
      } finally {
        publishing = false;
      }
    })],
    [/^\/__team\/api\/([^/]+)\/([^/]+)\/(waiting|told|more|reply|live)$/, kit(async (req, res, c, key, id, what) => {
      const p = projects.get(key);
      const spec = p && memberOf(c, key) ? pages.get(keyOf(key, id))?.spec : null;
      if (!spec) return c.json(res, 404, { error: `no page ${id} in ${key} of yours on this server; run npx wf ask page, which publishes it` });
      if (req.method !== "POST") return c.json(res, 405, { error: `POST ${what}` });
      const body = await c.jsonBody(req, res, 2 * 1024 * 1024, "at most 2 MB", "not JSON");
      if (body === undefined) return;
      try {
        if (what === "waiting") {
          const k = keyOf(key, id);
          const was = waitingSince(k);
          if (body?.on) waits.set(k, { since: typeof body.since === "string" ? body.since : new Date().toISOString(), seen: Date.now(), by: c.who.name });
          else waits.delete(k);
          // Its start and its end are logged, not each renewal.
          if (Boolean(was) !== Boolean(body?.on)) team.log(body?.on ? "wait" : "wait end", c.who.name, { project: key, page: id });
          return c.json(res, 200, { ok: true });
        }
        if (what === "told") markTold(p.view, spec, untoldAsks(p.view, spec).filter((a) => (body?.asks ?? []).some((t) => t.question === a.question && t.n === a.n)));
        else if (what === "more") {
          if (!drawableBlocks(body?.blocks)) return c.json(res, 422, { error: `more is at most ${BLOCK_LIMITS.live} blocks the kit checked, as wf ask more sends them` });
          addMore(p.view, spec, String(body?.question ?? ""), { blocks: body.blocks, options: body?.options ?? [] });
        } else if (what === "reply") addReply(p.view, spec, String(body?.question ?? ""), body?.text);
        else {
          if (!spec.live) return c.json(res, 422, { error: `the page ${id} is not live` });
          const live = liveOf(body?.live);
          if (!live) return c.json(res, 422, { error: "a live status is a state, a step, progress, log lines, and blocks, as wf ask live sends it" });
          writeLive(p.view, id, live);
        }
        refresh(key, id);
        team.log(what, c.who.name, { project: key, page: id });
        return c.json(res, 200, { ok: true });
      } catch (err) {
        return c.json(res, 422, { error: err.message });
      }
    })],
    // --- working together: the shared answers as they are made, and who is where -----------------------
    [/^\/__ask\/([^/]+)\/events\/([^/]+)$/, (req, res, c, key, id) => {
      if (req.method !== "GET" || secretOf(req, cookie).bearer) return c.json(res, 403, { error: "a browser's page" });
      if (!c.pageOf(key, id, c)) return c.json(res, 404, { error: `no ask page ${id}` });
      if (!allowed(`s:${c.who.name}`, RATE.streams)) return c.json(res, 429, { error: "too many opens this minute; wait a little" });
      // The session, and the person's right to the page, are checked again as the stream goes: a revoke, a sign-out, or a page republished for others ends it.
      const still = () => {
        const who = gate(req);
        return Boolean(who && who.name === c.who.name && c.pageOf(key, id, { ...c, who }));
      };
      return collab.open(req, res, key, id, c.who, new URLSearchParams((req.url ?? "").split("?")[1] ?? "").get("conn") ?? "", still);
    }],
    [/^\/__ask\/([^/]+)\/answer\/([^/]+)$/, pageWrite((req, res, c, { project, spec }, body, conn) => c.json(res, 200, { ok: true, ...collab.answer(project.key, spec.id, withMore(project.view, spec), project.kinds, c.who, String(body?.question ?? ""), body?.value ?? null, conn) }), RATE.saves, "a")],
    [/^\/__ask\/([^/]+)\/presence\/([^/]+)$/, pageWrite((req, res, c, { project, spec }, body, conn) => {
      collab.presence(project.key, spec.id, c.who, conn, body?.question ?? null, body?.typing);
      return c.json(res, 200, { ok: true });
    }, RATE.presence, "p")],
    [/^\/__ask\/([^/]+)\/thread\/([^/]+)$/, pageWrite((req, res, c, { project, spec }, body) => c.json(res, 200, { ok: true, entry: collab.thread(project.key, spec.id, spec, c.who, String(body?.question ?? ""), body?.text) }))],
    [/^\/__ask\/([^/]+)\/assign\/([^/]+)$/, pageWrite((req, res, c, { project, spec }, body) => {
      collab.assign(project.key, spec.id, spec, c.who, String(body?.question ?? ""), body?.name ?? null, peopleOf(project.key, spec));
      return c.json(res, 200, { ok: true });
    })],
    [/^\/__ask\/([^/]+)\/done\/([^/]+)$/, pageWrite((req, res, c, { project, spec }, body) => {
      collab.done(project.key, spec.id, c.who, body?.done === true);
      return c.json(res, 200, { ok: true });
    })],
    // A page is drawn for the person who opens it, with the shared answers and what goes with them.
    [/^\/([^/_][^/]*)\/ask\/([^/]+)\/(?:index\.html)?$/, (req, res, c, key, id) => {
      if (req.method !== "GET" && req.method !== "HEAD") return c.json(res, 405, { error: "only GET here" });
      const found = c.pageOf(key, id, c);
      if (!found) return c.send(res, 404, "Not found\n", "text/plain; charset=utf-8");
      const { working, collab: together } = collab.state(key, id, found.spec);
      const html = pageHtml({ spec: found.spec, kinds: found.project.kinds, key, team: pages.get(keyOf(key, id))?.roles ?? [], offline: false, previous: null, working, collab: { me: { name: c.who.name, role: c.who.client ? "client" : c.who.role, client: c.who.client }, people: peopleFor(c.who, key, found.spec, together), ...together } }, c.pageToken(key, id)).replace(SETTINGS_MARK, () => settingsScript({}));
      return c.send(res, 200, req.method === "HEAD" ? "" : html, "text/html; charset=utf-8", PAGE_CSP);
    }],
  ];

  /**
   * A page published by a member's kit: its spec, checked as the kit makes
   * one, and its pictures. The server draws the page itself from the kit's
   * own code, so a page holds no script but the kit's, whoever published it.
   */
  function publish(res, c, p, id, body) {
    const spec = body?.spec;
    const problem = specProblem(spec, id);
    if (problem) return c.json(res, 422, { error: `${problem}; build it with this kit's npx wf ask page` });
    const roles = (Array.isArray(body.team) ? body.team : []).filter((t) => t && typeof t.role === "string" && Array.isArray(t.names)).slice(0, 50).map((t) => ({ role: t.role.slice(0, 40), names: t.names.map(String).slice(0, 20) }));
    const pictures = body.pictures && typeof body.pictures === "object" ? body.pictures : {};
    let size = 0;
    for (const [name, data] of Object.entries(pictures)) {
      if (!PICTURE.test(name) || typeof data !== "string") return c.json(res, 422, { error: `${name} is not a page's picture, such as p/1.png` });
      size += data.length * 0.75;
    }
    if (size > PICTURES) return c.json(res, 413, { error: "a page's pictures are at most 24 MB" });
    const dir = askDir(p.view, id);
    const before = pages.get(keyOf(p.key, id))?.spec;
    // Written beside, then put in place, so a page is never half there.
    const next = `${dir}.${process.pid}.new`;
    rmSync(next, { recursive: true, force: true });
    mkdirSync(join(next, "p"), { recursive: true, mode: 0o700 });
    for (const [name, data] of Object.entries(pictures)) writeFileSync(join(next, name), Buffer.from(data, "base64"), { mode: 0o600 });
    writeWhole(join(next, "spec.json"), `${JSON.stringify(spec, null, 2)}\n`);
    writeWhole(join(next, "team.json"), `${JSON.stringify(roles)}\n`);
    // What the page said between builds stays with the same page; a changed one drops what was about the page before (as lib/ask/page.mjs does).
    if (existsSync(dir)) for (const file of readdirSync(dir).filter((f) => f.endsWith(".json") && !["spec.json", "team.json"].includes(f))) {
      if (before?.hash === spec.hash || !DROPPED_ON_CHANGE.includes(file)) renameSync(join(dir, file), join(next, file));
    }
    if (before?.hash !== spec.hash) {
      rmSync(answersPath(p.view, id), { force: true });
      collab.forget(p.key, id);
    }
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(join(p.view, "ask"), { recursive: true, mode: 0o700 });
    renameSync(next, dir);
    refresh(p.key, id);
    team.log("publish", c.who.name, { project: p.key, page: id, hash: spec.hash });
    return c.json(res, 200, { ok: true, address: `${origin}/${p.key}/ask/${id}/` });
  }

  /**
   * What the agent's wait reads: the state, the answers, the asks not yet
   * told, and the replies. With `since`, the version the wait last read, an
   * unchanged page answers in a word; with `waiting=1`, the poll renews the
   * mark that says an agent waits.
   */
  function pageState(req, res, c, p, id) {
    const k = keyOf(p.key, id);
    const page = pages.get(k);
    if (!page) return c.json(res, 404, { error: `no page ${id} in ${p.key} on this server; run npx wf ask page, which publishes it` });
    const q = new URLSearchParams((req.url ?? "").split("?")[1] ?? "");
    if (q.get("waiting") === "1" && waits.has(k)) waits.get(k).seen = Date.now();
    if (q.get("since") === String(page.version)) return c.json(res, 200, { unchanged: true, version: page.version });
    const { state, open, answers } = askState(p.view, id, page.spec);
    return c.json(res, 200, { version: page.version, hash: page.spec.hash, state, open, answers, untold: untoldAsks(p.view, page.spec), more: moreOf(p.view, id), replies: readReplies(p.view, id) });
  }

  /** The inbox, from memory: the pages the person sees, each saying whether it waits on them. */
  function inboxOf(c) {
    const items = [];
    const now = Date.now();
    for (const [k, page] of pages) {
      const key = k.split("/")[0];
      const p = projects.get(key);
      if (!p || !maySee(c.who, key, page.spec)) continue;
      const { last, ...line } = page.line;
      if (line.state === "answered" && now - last > ANSWERED_DAYS * 86_400_000) continue;
      const waiting = line.state === "waiting" || line.state === "partial" ? waitingSince(k) : null;
      const { assigned, sentBy } = collab.brief(key, line.id);
      items.push({ key, project: p.name, ...line, waitingSince: waiting, forYou: waitsOn(c.who, page.spec) || assigned.includes(c.who.name), ...(sentBy ? { sentBy } : {}), href: `/${key}/ask/${line.id}/` });
    }
    const rank = { waiting: 0, partial: 1, status: 2, answered: 3 };
    return items.sort((a, b) => rank[a.state] - rank[b.state] || b.asked.localeCompare(a.asked));
  }

  return serve({
    resolve: (key) => projects.get(key) ?? null,
    list: () => [],
    check: checkAnswers,
    stateOf: askState,
    liveOf: readLive,
    repliesOf: readReplies,
    moreOf,
    askMore: (view, spec, ask) => addAsk(view, spec, ask),
    specOf: withMore,
    historyOf: (view, spec) => rounds(view, spec.id).map((r) => ({ at: r.at, hash: r.hash, same: r.hash === spec.hash, markdown: answersMarkdown(r.spec, r.answers) })),
    onAnswers: keepRound,
    // Send takes the page's shared answers, whoever sends it, with who gave each and who sent them.
    answersOf: (view, spec, sent, c, projectKinds) => {
      const key = [...projects.values()].find((p) => p.view === view)?.key;
      // What the Send carries that differs is saved as the sender's first, so an answer not saved yet is not lost.
      const working = collab.adopt(key, spec.id, spec, projectKinds, c.who, sent.answers);
      const again = checkAnswers(spec, { id: spec.id, hash: spec.hash, submitted: sent.submitted, answers: working.answers }, projectKinds).answers ?? sent;
      team.log("answers", c.who.name, { project: key, page: spec.id });
      return { ...again, by: Object.fromEntries(Object.keys(again.answers).map((q) => [q, working.by[q]]).filter(([, n]) => n)), sent: collab.sent(key, spec.id, c.who) };
    },
    readPage: (project, id) => pages.get(keyOf(project.key, id))?.spec ?? null,
    inboxOf,
    limit: (c) => !c.who || allowed(`w:${c.who.name}`, RATE.writes),
    onChange: (project, id) => refresh(project.key, id),
    mayArchive: (c) => Boolean(c.who && !c.who.client),
    port,
    host,
    origin,
    gate,
    may,
    extra,
    forYou: waitsOn,
    // A cookie that names no session, such as a browser's from before v1.22, when it was the kit's token, is cleared.
    signIn: { html: SIGN_IN_PAGE, csp: PAGES_CSP, cookie: `${cookie}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureCookie ? "; Secure" : ""}` },
    log,
  }).then((served) => ({ ...served, close: () => { collab.flush(); return served.close(); } }));
}

/** A live status as wf ask live sends it, kept to its limits, or null. */
function liveOf(raw) {
  if (!raw || typeof raw !== "object" || !LIVE_STATES.includes(raw.state)) return null;
  const progress = Array.isArray(raw.progress) && raw.progress.length === 2 && raw.progress.every(Number.isInteger) ? raw.progress : null;
  const blocks = raw.blocks == null ? [] : raw.blocks;
  if (!drawableBlocks(blocks)) return null;
  const log = (Array.isArray(raw.log) ? raw.log : []).map((l) => String(l).slice(0, LIVE_LIMITS.line)).slice(-LIVE_LIMITS.log);
  return { state: raw.state, step: String(raw.step ?? "").slice(0, LIVE_LIMITS.step), progress, log, blocks, at: new Date().toISOString() };
}

const readJson = (file) => {
  try {
    return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
  } catch {
    return null;
  }
};
