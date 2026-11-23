// `wf team serve`: the ask-pages server for a team and its client, reached
// over HTTPS from anywhere. It is the local hub (lib/view/serve.mjs) behind a
// sign-in, serving one folder per project laid out as .cache/view is, with
// the routes the kit uses to publish pages and wait on them. The design is
// docs/design/team-server.md; what it promises is in SECURITY.md.
//
//   GET  /__team/health                  up, for the host's probes, open to all
//   GET  /__team/join                    the invite link's page: Join posts the link's code
//   POST /__team/join                    use a code: sets the browser's cookie, and gives the kit's token once
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
import { inProject, maySee, openTeam, PROJECT, waitsOn } from "./store.mjs";

const PICTURES = 24 * 1024 * 1024;
const PICTURE = /^p\/\d{1,3}\.(png|jpe?g|gif|webp|svg)$/;
// Writes a person may make a minute, and invite codes a caller may try a minute.
const RATE = { writes: 120, joins: 10 };

/** The cookie a browser signs in with: `__Host-` on HTTPS, so no other site on a parent domain can set it. */
export const cookieName = (secure) => (secure ? "__Host-wf_team" : "wf_team");

/** The secret a request signs in with: a bearer token from the kit, or the browser's cookie. */
export function secretOf(req, cookie = cookieName(true)) {
  const auth = String(req.headers.authorization ?? "");
  if (auth.startsWith("Bearer ")) return { secret: auth.slice(7).trim(), bearer: true };
  const found = String(req.headers.cookie ?? "").split(/;\s*/).find((c) => c.startsWith(`${cookie}=`));
  return { secret: found ? decodeURIComponent(found.slice(cookie.length + 1)) : "", bearer: false };
}

/**
 * The answers kept for a page several people answer: each person's latest
 * answer to each question. `by` maps a question to who gave its answer. A
 * person's page shows them their own answers, so a question they answered
 * before and leave empty now is theirs to take back; anyone else's stays.
 */
export function mergeAnswers(before, sent, name) {
  if (!before || before.hash !== sent.hash) return { ...sent, by: Object.fromEntries(Object.keys(sent.answers).map((q) => [q, name])) };
  const answers = { ...before.answers };
  const by = { ...(before.by ?? {}) };
  for (const [q, who] of Object.entries(by)) if (who === name && !sent.answers[q]) { delete answers[q]; delete by[q]; }
  for (const [q, value] of Object.entries(sent.answers)) { answers[q] = value; by[q] = name; }
  return { ...sent, answers, by };
}

/** One person's own answers out of a page's kept ones, for their page to show. */
export function ownAnswers(kept, name) {
  if (!kept?.answers) return null;
  const mine = Object.fromEntries(Object.entries(kept.answers).filter(([q]) => kept.by?.[q] === name));
  return Object.keys(mine).length ? { ...kept, answers: mine } : null;
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
    // The oldest keys come first; ones whose minute is over go.
    for (const [k, v] of seen) {
      if (seen.size <= 5_000 && at - v.start < 60_000) break;
      seen.delete(k);
    }
    return hit.n <= most;
  };
}

const JOIN_PAGE = `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width"><title>Join</title>
<body style="font:16px system-ui;max-width:40em;margin:12vh auto;padding:0 16px"><h1>Join the asks</h1><p id=say>This link signs this browser in, once. Press Join to use it.</p>
<button id=go style="font:inherit;padding:6px 16px">Join</button><pre id=kit hidden style="white-space:pre-wrap;background:#eee;padding:12px"></pre>
<script>(() => {
  const code = location.hash.slice(1); history.replaceState(null, "", location.pathname);
  const say = (t) => { document.getElementById("say").textContent = t; };
  const go = document.getElementById("go");
  if (!code) { go.hidden = true; return say("This link has no code. Open the whole link you were sent."); }
  // Used only when the person presses Join, so a mail scanner that opens the link does not use it up.
  go.onclick = async () => {
    go.disabled = true;
    const res = await fetch("/__team/join", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) });
    const body = await res.json().catch(() => ({}));
    go.hidden = true;
    if (!res.ok) return say(body.error || "That did not work. Ask for a new link.");
    document.querySelector("h1").textContent = "You are in, " + body.name;
    if (body.client) { say("Your asks are waiting."); return setTimeout(() => location.assign("/"), 800); }
    say("This browser is signed in. For your kit, keep this token in the environment variable your project's teamServer.tokenEnv names (WF_TEAM_TOKEN), such as in a gitignored .env. It is shown once.");
    const kit = document.getElementById("kit"); kit.hidden = false; kit.textContent = body.token;
    const asks = document.createElement("a"); asks.href = "/"; asks.textContent = "Go to your asks"; document.body.append(asks);
  };
})();</script>`;

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
  const gate = (req) => team.who(secretOf(req, cookie).secret);
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
  let publishing = false;

  const extra = [
    // For the host's probes: up, and nothing more.
    [/^\/__team\/health$/, (req, res, c) => c.json(res, 200, { ok: true }), { open: true }],
    [/^\/__team\/join$/, async (req, res, c) => {
      if (req.method === "GET") return c.send(res, 200, JOIN_PAGE, "text/html; charset=utf-8", "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'");
      if (req.method !== "POST" || !c.ownOrigin) return c.json(res, 403, { error: "join from the invite link's page" });
      // The last address the host's proxy added is the caller's; the ones before it are whatever the caller sent.
      const caller = String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "").split(",").at(-1).trim();
      if (!allowed(`j:${caller}`, RATE.joins)) return c.json(res, 429, { error: "too many tries; wait a minute" });
      const body = await c.jsonBody(req, res, 1024, "a code is short", "the code is not JSON");
      if (body === undefined) return;
      try {
        const { member, secret } = team.redeem(String(body?.code ?? ""));
        const age = member.expires ? Math.max(60, Math.floor((Date.parse(member.expires) - Date.now()) / 1000)) : 400 * 86_400;
        res.setHeader("Set-Cookie", `${cookie}=${encodeURIComponent(secret)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secureCookie ? "; Secure" : ""}`);
        // The kit's token is the same secret, shown once to a member; a client has no kit.
        return c.json(res, 200, { ok: true, name: member.name, client: member.client, ...(member.client ? {} : { token: secret }) });
      } catch (err) {
        return c.json(res, 403, { error: err.message });
      }
    }, { open: true }],
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
    // A page is drawn for the person who opens it, with their own answers in it, so a send never takes back what they cannot see.
    [/^\/([^/_][^/]*)\/ask\/([^/]+)\/(?:index\.html)?$/, (req, res, c, key, id) => {
      if (req.method !== "GET" && req.method !== "HEAD") return c.json(res, 405, { error: "only GET here" });
      const found = c.pageOf(key, id, c);
      if (!found) return c.send(res, 404, "Not found\n", "text/plain; charset=utf-8");
      const kept = readJson(answersPath(found.project.view, id));
      const html = pageHtml({ spec: found.spec, kinds: found.project.kinds, key, team: pages.get(keyOf(key, id))?.roles ?? [], offline: false, previous: kept?.hash === found.spec.hash ? ownAnswers(kept, c.who.name) : null }, c.pageToken(key, id)).replace(SETTINGS_MARK, () => settingsScript({}));
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
    if (before?.hash !== spec.hash) rmSync(answersPath(p.view, id), { force: true });
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
      items.push({ key, project: p.name, ...line, waitingSince: waiting, forYou: waitsOn(c.who, page.spec), href: `/${key}/ask/${line.id}/` });
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
    answersOf: (view, spec, sent, c, projectKinds) => {
      const kept = mergeAnswers(readJson(answersPath(view, spec.id)), sent, c.who.name);
      // Who answered what is kept with the answers, and the open questions are counted again over every person's.
      const again = checkAnswers(spec, { id: spec.id, hash: spec.hash, submitted: kept.submitted, answers: kept.answers }, projectKinds).answers ?? kept;
      team.log("answers", c.who.name, { page: spec.id });
      return { ...again, by: kept.by };
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
    log,
  });
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
