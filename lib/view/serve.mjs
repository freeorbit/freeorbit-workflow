// `wf view serve`: the ask-pages server, one for the machine. It
// serves each registered project's .cache/view at /<key>/ and takes its ask
// pages' answers.
//
//   GET  /                               the inbox: every ask, from every project and session
//   GET  /__hub                          who is serving, so a second start reuses this one
//   GET  /__hub/inbox[?archived=1]       the inbox as JSON, without the asks a person archived, or only those
//   POST /__hub/archive                  archive an ask, or take it back, from the inbox with its token
//   GET  /__hub/theme[?id=<palette>]     the Claude Desktop theme on this machine (its active one, or a palette), or { ok: false }
//   GET  /__hub/themes                   the palettes Claude Desktop offers, and its active one
//   GET  /<key>/<path>                   a file under that project's .cache/view; a folder serves its index.html
//   GET  /__ask/<key>/version/<id>       the hash of the page now, so an old tab can say it is old
//   GET  /__ask/<key>/live/<id>          a live page's status and the agent's replies, which the page polls
//   GET  /__ask/<key>/history/<id>       every round of answers sent to the page, as Markdown
//   POST /__ask/<key>/answers/<id>       the answers, checked against the page's spec
//   GET  /__hub/settings                 the ask pages' kept settings: the look, notifications, the inbox's filters
//   POST /__hub/settings                 keep them, from a page with its token
//   POST /__hub/notify                   a desktop notification, from a page with its token
//   POST /__hub/stop                     stop, with the token from the state folder
//
// Only this machine reaches it: it listens on 127.0.0.1, answers only a Host
// of 127.0.0.1 or localhost at its port, so a page on another name cannot
// reach it through DNS. Writes need a token: each ask page gets its own,
// derived from the server's secret and the page's key and id, so a page can
// answer only itself. Every other file is served sandboxed, so a script in a
// picture or a sheet runs in no origin and can read no page's token. Answers
// go only to <project>/.cache/view/answers/<id>.json, for a page whose spec is
// there, written for this user alone.

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, relative, resolve, sep } from "node:path";

import { inboxHtml } from "./inbox.mjs";
import { pageToken as signPage, waitingSince } from "./waiting.mjs";
import { answersPath, archivedAsked, archivePath, askDir, ID, readSpec } from "../ask/store.mjs";
import { writeWhole } from "../files.mjs";
import { cleanSettings, SETTINGS_MARK, SETTINGS_MAX, settingsScript } from "./settings.mjs";

export const TOKEN_MARK = "__WF_ASK_TOKEN__";
export const HUB_NAME = "freeorbit-workflow";
/** A project's key on the server. */
const KEY = /^[a-z0-9][a-z0-9-]{0,48}$/;
const BODY_MAX = 1024 * 1024;
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};
/** The kit's own pages run their inline script and talk only to this server. */
const PAGE_CSP = "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'";
/** Anything else runs in no origin at all, whatever it holds. */
const FILE_CSP = "sandbox allow-scripts; default-src 'self' 'unsafe-inline' data:; connect-src 'none'; object-src 'none'";


/** The file a GET names, inside the served folder through no link, or null. */
export function servedFile(dir, urlPath) {
  let path;
  try {
    path = decodeURIComponent(urlPath.split("?")[0]);
  } catch {
    return null;
  }
  if (path.includes("\0")) return null;
  const root = realpathSync(dir);
  let file = resolve(root, `.${path}`);
  if (file !== root && !file.startsWith(root + sep)) return null;
  if (!existsSync(file)) return null;
  const real = realpathSync.native(file);
  if (real !== root && !real.startsWith(root + sep)) return null;
  if (statSync(real).isDirectory()) {
    file = join(real, "index.html");
    return existsSync(file) && realpathSync.native(file).startsWith(root + sep) ? realpathSync.native(file) : null;
  }
  return real;
}

// Each page's inbox line, with the times of the files it was made from, so a
// poll reads and parses again only the pages that changed since (P-1).
// Kept for each state rule given, as a test may give another.
const LINES = new WeakMap();
const mtime = (file) => statSync(file, { throwIfNoEntry: false })?.mtimeMs ?? 0;
// A file as it is now: its time, inode, and size, since a file written whole twice in one millisecond keeps its time.
const stampOf = (file) => {
  const st = statSync(file, { throwIfNoEntry: false });
  return st ? `${st.mtimeMs}:${st.ino}:${st.size}` : "-";
};
/** How many days an answered page stays in the inbox; its answers stay in wf ask history. */
export const ANSWERED_DAYS = 30;

/**
 * Every ask page of the projects, waiting ones first, then newest. `stateOf`
 * gives a page's `{ state, open, answers }`, the one rule for what answered
 * means (askState in lib/ask/answers.mjs). A page answered more than
 * ANSWERED_DAYS ago is left out, so the list does not grow with every ask.
 */
export function inbox(list, stateOf, liveOf = () => null, now = Date.now()) {
  const items = [];
  if (!LINES.has(stateOf)) LINES.set(stateOf, new Map());
  const lines = LINES.get(stateOf);
  for (const project of list) {
    const dir = join(project.view, "ask");
    if (!existsSync(dir)) continue;
    for (const id of readdirSync(dir)) {
      const page = askDir(project.view, id);
      const specAt = mtime(join(page, "spec.json"));
      if (!specAt) continue;
      const answeredAt = mtime(answersPath(project.view, id));
      const stamp = [join(page, "spec.json"), answersPath(project.view, id), join(page, "live.json"), archivePath(project.view, id)].map(stampOf).join("|");
      const cacheKey = `${project.view}\0${id}`;
      let line = lines.get(cacheKey);
      if (line?.stamp !== stamp) {
        const spec = readSpec(project.view, id);
        if (!spec) {
          lines.delete(cacheKey);
          continue;
        }
        const { state, open, answers } = stateOf(project.view, id, spec);
        const live = spec.live ? liveOf(project.view, id) : null;
        const asked = new Date(specAt).toISOString();
        // An archive covers the page as it was asked then; asked again, it shows again.
        const archived = archivedAsked(project.view, id) === asked;
        line = { stamp, item: { id, title: spec.title, template: spec.template, questions: spec.questions.length, open, state, asked, sent: answers?.submitted ?? null, asker: spec.asker ?? null, ...(archived ? { archived: true } : {}), ...(live ? { live: { state: live.state, step: live.step, progress: live.progress, at: live.at } } : {}) } };
        lines.set(cacheKey, line);
      }
      const { item } = line;
      if (item.state === "answered" && now - Math.max(specAt, answeredAt) > ANSWERED_DAYS * 86_400_000) continue;
      // Whether an agent waits is read each time: its process can end with no file changing.
      const waiting = item.state === "waiting" || item.state === "partial" ? waitingSince(project.view, id) : null;
      items.push({ key: project.key, project: project.name, ...item, waitingSince: waiting, href: `/${project.key}/ask/${id}/` });
    }
  }
  const rank = { waiting: 0, partial: 1, status: 2, answered: 3 };
  return items.sort((a, b) => rank[a.state] - rank[b.state] || b.asked.localeCompare(a.asked));
}

/**
 * The inbox a page shows: every waiting ask, and the newest others up to
 * `limit` in all, so an open page polls a short list (P-2).
 */
export function inboxFor(items, limit) {
  if (!limit) return items;
  const waiting = items.filter((i) => i.state === "waiting" || i.state === "partial");
  return [...waiting, ...items.filter((i) => !waiting.includes(i)).slice(0, Math.max(0, limit - waiting.length))];
}

/**
 * Start the server; resolves with `{ server, port, token, close }`, where
 * `token` stops it and is the secret each page's token comes from.
 * - `resolve(key)` gives a project's `{ view, kinds, error }` or null, and `list()` every project as `{ key, name, view }`; the hub reads them from the registry on each request.
 * - `check(spec, raw, kinds)` checks answers, `stateOf(view, id, spec)` says how far a page is answered.
 * - `theme(id)` and `themes()` read Claude Desktop's.
 * - `liveOf(view, id)` gives a live page's status, `repliesOf(view, id)` the agent's replies,
 *   `historyOf(view, spec)` the rounds sent, and `onAnswers(view, spec, answers)` keeps each send.
 */
export function serve({ resolve: find, list, check, stateOf, liveOf = () => null, repliesOf = () => ({}), historyOf = () => [], onAnswers = () => {}, port, log = console.log, token = randomBytes(24).toString("hex"), version = "", onStop = () => {}, idleMs = 0, theme = () => null, themes = () => null, desktop = null, settings = { read: () => ({}), write: (changed) => changed } }) {
  const pageToken = (key, id) => signPage(token, key, id);
  const hosts = (at) => new Set([`127.0.0.1:${at}`, `localhost:${at}`]);
  let idle = null;
  const touch = () => {
    if (!idleMs) return;
    clearTimeout(idle);
    idle = setTimeout(() => { log("ask-pages: idle, stopping"); onStop(); }, idleMs);
    idle.unref?.();
  };
  touch();

  function send(res, status, body, type = "application/json; charset=utf-8", csp = "") {
    res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", ...(csp ? { "Content-Security-Policy": csp } : {}) });
    res.end(body);
  }
  const json = (res, status, value) => send(res, status, `${JSON.stringify(value)}\n`);

  /** A registered project's ask page, as { project, spec }, or null: the one lookup every route makes (TA-11). */
  const pageOf = (key, id) => {
    const project = KEY.test(key) ? find(key) : null;
    const spec = project ? readSpec(project.view, id) : null;
    return spec ? { project, spec } : null;
  };

  /**
   * A request's JSON body, at most `max` bytes. Resolves to it, or to
   * undefined once an error reply is sent: `big` when it is too long,
   * `notJson` when it does not parse.
   */
  const jsonBody = (req, res, max, big, notJson) =>
    new Promise((resolve) => {
      const chunks = [];
      let size = 0;
      req.on("data", (chunk) => {
        size += chunk.length;
        if (size > max) {
          if (!res.headersSent) json(res, 413, { error: big });
          req.destroy();
          resolve(undefined);
        } else chunks.push(chunk);
      });
      req.on("end", () => {
        if (size > max) return;
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch {
          json(res, 400, { error: notJson });
          resolve(undefined);
        }
      });
    });
  const query = (req) => new URLSearchParams((req.url ?? "").split("?")[1] ?? "");

  /** A POST of answers: checked against the page's spec, with that page's token. */
  async function takeAnswers(req, res, c, key, id) {
    if (req.method !== "POST") return json(res, 405, { error: "POST the answers" });
    if (!c.ownOrigin) return json(res, 403, { error: "answers come from this server's own pages" });
    const found = pageOf(key, id);
    if (!found) return json(res, 404, { error: `no ask page ${id}` });
    const { project, spec } = found;
    if (req.headers["x-wf-token"] !== pageToken(key, id)) return json(res, 403, { error: "the page's token is not this server's for this page; reload the page" });
    if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) return json(res, 415, { error: "answers are application/json" });
    if (!project.kinds) return json(res, 500, { error: `the project's settings could not be read, so its answers cannot be checked: ${project.error}` });
    const raw = await jsonBody(req, res, BODY_MAX, "answers are at most 1 MB", "the answers are not JSON");
    if (raw === undefined) return;
    {
      try {
        const { answers, problems } = check(spec, raw, project.kinds);
        if (problems) return json(res, 422, { error: problems.join("; ") });
        mkdirSync(join(project.view, "answers"), { recursive: true, mode: 0o700 });
        writeWhole(answersPath(project.view, id), `${JSON.stringify(answers, null, 2)}\n`);
        try {
          onAnswers(project.view, spec, answers);
        } catch (err) {
          log(`answers for ${key}/${id}: not kept in the history: ${err.message}`);
        }
        log(`answers for ${key}/${id}: ${answers.partial ? `${answers.open.length} of ${spec.questions.length} still open` : "every question answered"}`);
        return json(res, 200, { ok: true, partial: answers.partial, open: answers.open });
      } catch (err) {
        log(`answers for ${key}/${id} not saved: ${err.message}`);
        return json(res, 500, { error: `the answers could not be saved: ${err.message}` });
      }
    }
  }

  /** A file under a project's .cache/view; an ask page gets its token, anything else runs sandboxed. */
  function serveStatic(req, res, c, key, rest) {
    if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { error: "only GET here" });
    const project = KEY.test(key) ? find(key) : null;
    if (!project) return send(res, 404, "Not found. The inbox, at /, lists every page.\n", "text/plain; charset=utf-8");
    if (!rest) {
      res.writeHead(301, { Location: `/${key}/` });
      return res.end();
    }
    if (!existsSync(project.view)) return send(res, 404, "Not found\n", "text/plain; charset=utf-8");
    const file = servedFile(project.view, rest);
    if (!file) return send(res, 404, "Not found\n", "text/plain; charset=utf-8");
    if (relative(realpathSync.native(project.view), file).split(sep)[0].toLowerCase() === "answers") return send(res, 403, "Answers are read with npx wf ask answers\n", "text/plain; charset=utf-8");
    const type = TYPES[extname(file).toLowerCase()] ?? "application/octet-stream";
    const page = rest.match(new RegExp(`^/ask/(${ID.source.slice(1, -1)})/(index\\.html)?$`));
    let body = readFileSync(file);
    if (page && type.startsWith("text/html")) {
      body = body.toString("utf8").replaceAll(TOKEN_MARK, pageToken(key, page[1])).replace(SETTINGS_MARK, () => settingsScript(settings.read()));
      return send(res, 200, req.method === "HEAD" ? "" : body, type, PAGE_CSP);
    }
    return send(res, 200, req.method === "HEAD" ? "" : body, type, FILE_CSP);
  }

  /**
   * A desktop notification a page asks for: from this server's own page,
   * with that page's token (the inbox's is the hub's), as a small JSON body.
   * The OS shows it, so a pane that refuses web notifications still tells.
   */
  async function takeNotify(req, res, c) {
    if (req.method !== "POST") return json(res, 405, { error: "POST a notification" });
    if (!c.ownOrigin) return json(res, 403, { error: "notifications come from this server's own pages" });
    if (!desktop) return json(res, 501, { error: "this machine has no desktop notifier" });
    if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) return json(res, 415, { error: "a notification is application/json" });
    const body = await jsonBody(req, res, 4096, "a notification is at most 4 KB", "the notification is not JSON");
    if (body === undefined) return;
    const key = String(body?.key ?? "");
    const id = String(body?.id ?? "");
    const page = key === "__hub" ? id === "inbox" : Boolean(pageOf(key, id));
    if (!page || req.headers["x-wf-token"] !== pageToken(key, id)) return json(res, 403, { error: "the page's token is not this server's; reload the page" });
    return json(res, 200, { ok: desktop(body.title, body.body) });
  }

  /**
   * The kept settings: read by any page of this server, kept from a page with
   * its token (the inbox's is the hub's), as a small JSON body of known keys.
   */
  async function takeSettings(req, res, c) {
    if (req.method === "GET") return json(res, 200, { settings: settings.read() });
    if (req.method !== "POST") return json(res, 405, { error: "GET or POST the settings" });
    if (!c.ownOrigin) return json(res, 403, { error: "settings come from this server's own pages" });
    if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) return json(res, 415, { error: "settings are application/json" });
    const body = await jsonBody(req, res, SETTINGS_MAX + 1024, `settings are at most ${SETTINGS_MAX / 1024} KB`, "the settings are not JSON");
    if (body === undefined) return;
    const key = String(body?.key ?? "");
    const id = String(body?.id ?? "");
    const page = key === "__hub" ? id === "inbox" : Boolean(pageOf(key, id));
    if (!page || req.headers["x-wf-token"] !== pageToken(key, id)) return json(res, 403, { error: "the page's token is not this server's; reload the page" });
    const { settings: changed, error } = cleanSettings(body.settings);
    if (error) return json(res, 422, { error });
    try {
      return json(res, 200, { ok: true, settings: settings.write(changed) });
    } catch (err) {
      log(`settings not kept: ${err.message}`);
      return json(res, 500, { error: `the settings could not be kept: ${err.message}` });
    }
  }

  /**
   * An ask archived in the inbox, or taken back: from this server's own inbox
   * with its token, for a page that is there. The mark holds the time the
   * page was asked, so asking it again brings it back.
   */
  async function takeArchive(req, res, c) {
    if (req.method !== "POST") return json(res, 405, { error: "POST an archive" });
    if (!c.ownOrigin) return json(res, 403, { error: "an archive comes from this server's own inbox" });
    if (req.headers["x-wf-token"] !== pageToken("__hub", "inbox")) return json(res, 403, { error: "the inbox's token is not this server's; reload the inbox" });
    if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) return json(res, 415, { error: "an archive is application/json" });
    const body = await jsonBody(req, res, 1024, "an archive is at most 1 KB", "the archive is not JSON");
    if (body === undefined) return;
    const found = pageOf(String(body?.key ?? ""), String(body?.id ?? ""));
    if (!found || typeof body.archived !== "boolean") return json(res, 422, { error: "an archive names a page there, and archived true or false" });
    const { project, spec } = found;
    const file = archivePath(project.view, spec.id);
    if (!body.archived) {
      rmSync(file, { force: true });
      return json(res, 200, { ok: true, archived: false });
    }
    const asked = new Date(statSync(join(askDir(project.view, spec.id), "spec.json")).mtimeMs).toISOString();
    writeWhole(file, `${JSON.stringify({ asked, at: new Date().toISOString() })}\n`);
    log(`archived ${body.key}/${spec.id}`);
    return json(res, 200, { ok: true, archived: true });
  }

  const routes = [
    [/^\/__hub$/, (req, res, c) => json(res, 200, { hub: HUB_NAME, version, pid: process.pid, port: c.at, notify: Boolean(desktop) })],
    [/^\/__hub\/notify$/, takeNotify],
    [/^\/__hub\/settings$/, takeSettings],
    [/^\/__hub\/inbox$/, (req, res) => {
      const limit = Number(new URL(req.url, "http://x").searchParams.get("limit")) || 0;
      const archived = query(req).get("archived") === "1";
      return json(res, 200, { items: inboxFor(inbox(list(), stateOf, liveOf).filter((i) => Boolean(i.archived) === archived), Math.min(limit, 500)) });
    }],
    [/^\/__hub\/archive$/, takeArchive],
    [/^\/__hub\/theme$/, (req, res) => {
      const id = query(req).get("id") ?? "";
      const desktop = /^[a-z0-9-]{0,61}$/.test(id) ? theme(id) : null;
      return json(res, 200, desktop ? { ok: true, ...desktop } : { ok: false });
    }],
    [/^\/__hub\/themes$/, (req, res) => {
      const all = themes();
      return json(res, 200, all ? { ok: true, ...all } : { ok: false });
    }],
    [/^\/__hub\/stop$/, (req, res, c) => {
      if (req.method !== "POST" || !c.ownOrigin || req.headers["x-wf-token"] !== token) return json(res, 403, { error: "stop needs the server's token" });
      json(res, 200, { ok: true });
      return setImmediate(onStop);
    }],
    [/^\/(index\.html)?$/, (req, res) => send(res, 200, inboxHtml(pageToken("__hub", "inbox"), settingsScript(settings.read())), "text/html; charset=utf-8", PAGE_CSP)],
    [/^\/__ask\/([^/]+)\/version\/([^/]+)$/, (req, res, c, key, id) => {
      const found = req.method === "GET" ? pageOf(key, id) : null;
      return found ? json(res, 200, { hash: found.spec.hash }) : json(res, 404, { error: "no such page" });
    }],
    [/^\/__ask\/([^/]+)\/live\/([^/]+)$/, (req, res, c, key, id) => {
      const found = req.method === "GET" ? pageOf(key, id) : null;
      if (!found) return json(res, 404, { error: "no such page" });
      const { project, spec } = found;
      return json(res, 200, { live: spec.live ? liveOf(project.view, id) : null, replies: spec.off?.includes("replies") ? {} : repliesOf(project.view, id) });
    }],
    [/^\/__ask\/([^/]+)\/history\/([^/]+)$/, (req, res, c, key, id) => {
      const found = req.method === "GET" ? pageOf(key, id) : null;
      if (!found) return json(res, 404, { error: "no such page" });
      return json(res, 200, { rounds: found.spec.off?.includes("history") ? [] : historyOf(found.project.view, found.spec) });
    }],
    [/^\/__ask\/([^/]+)\/answers\/([^/]+)$/, takeAnswers],
    [/^\/([^/]+)(\/.*)?$/, serveStatic],
  ];

  const server = createServer((req, res) => {
    touch();
    const at = server.address().port;
    try {
      if (!hosts(at).has(req.headers.host ?? "")) return json(res, 403, { error: "this server answers only 127.0.0.1 and localhost" });
      const url = (req.url ?? "/").split("?")[0];
      const origin = req.headers.origin;
      const c = { at, ownOrigin: !origin || hosts(at).has(origin.replace(/^http:\/\//, "")) };
      for (const [pattern, handle] of routes) {
        const m = url.match(pattern);
        if (m) return handle(req, res, c, ...m.slice(1));
      }
      return send(res, 404, "Not found\n", "text/plain; charset=utf-8");
    } catch (err) {
      // One project's broken file never stops the server for every other.
      log(`ask-pages: ${req.method} ${req.url} failed: ${err.message}`);
      if (!res.headersSent) json(res, 500, { error: err.message });
      else res.end();
    }
  });
  return new Promise((done, fail) => {
    server.once("error", fail);
    server.listen(port, "127.0.0.1", () => {
      const at = server.address().port;
      log(`ask-pages: serving every registered project at http://127.0.0.1:${at}/`);
      done({ server, port: at, token, pageToken, close: () => new Promise((end) => { clearTimeout(idle); server.close(end); server.closeAllConnections(); }) });
    });
  });
}
