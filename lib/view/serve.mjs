// `wf view serve`: the question-pictures server, one for the machine. It
// serves each registered project's .cache/view at /<key>/ and takes its ask
// pages' answers.
//
//   GET  /                               the inbox: every ask, from every project and session
//   GET  /__hub                          who is serving, so a second start reuses this one
//   GET  /__hub/inbox                    the inbox as JSON
//   GET  /__hub/theme[?id=<palette>]     the Claude Desktop theme on this machine (its active one, or a palette), or { ok: false }
//   GET  /__hub/themes                   the palettes Claude Desktop offers, and its active one
//   GET  /<key>/<path>                   a file under that project's .cache/view; a folder serves its index.html
//   GET  /__ask/<key>/version/<id>       the hash of the page now, so an old tab can say it is old
//   GET  /__ask/<key>/live/<id>          a live page's status and the agent's replies, which the page polls
//   GET  /__ask/<key>/history/<id>       every round of answers sent to the page, as Markdown
//   POST /__ask/<key>/answers/<id>       the answers, checked against the page's spec
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

import { createHmac, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, relative, resolve, sep } from "node:path";

import { inboxHtml } from "./inbox.mjs";

export const TOKEN_MARK = "__WF_ASK_TOKEN__";
export const HUB_NAME = "freeorbit-workflow";
/** An ask page's id, and a project's key on the server. */
export const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
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

/** Where an ask page's files and its answers live under the served folder. */
export const askDir = (dir, id) => join(dir, "ask", id);
export const answersPath = (dir, id) => join(dir, "answers", `${id}.json`);

/** A page's spec, or null: for an id that is not one, a file that is not JSON, or a spec that is not a page's. */
export function readSpec(dir, id) {
  if (typeof id !== "string" || !ID.test(id)) return null;
  const file = join(askDir(dir, id), "spec.json");
  if (!existsSync(file)) return null;
  try {
    const spec = JSON.parse(readFileSync(file, "utf8"));
    return spec && spec.id === id && Array.isArray(spec.questions) ? spec : null;
  } catch {
    return null;
  }
}

/** Write a file whole or not at all, readable by this user alone. */
export function writeWhole(file, text, mode = 0o600) {
  const part = `${file}.${process.pid}.part`;
  writeFileSync(part, text, { mode });
  renameSync(part, file);
}

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

/**
 * Every ask page of the projects, waiting ones first, then newest. `stateOf`
 * gives a page's `{ state, open, answers }`, the one rule for what answered
 * means (askState in lib/ask/answers.mjs).
 */
export function inbox(list, stateOf, liveOf = () => null) {
  const items = [];
  for (const project of list) {
    const dir = join(project.view, "ask");
    if (!existsSync(dir)) continue;
    for (const id of readdirSync(dir)) {
      const spec = readSpec(project.view, id);
      if (!spec) continue;
      const { state, open, answers } = stateOf(project.view, id, spec);
      const asked = new Date(statSync(join(askDir(project.view, id), "spec.json")).mtimeMs).toISOString();
      const live = spec.live ? liveOf(project.view, id) : null;
      items.push({ key: project.key, project: project.name, id, title: spec.title, template: spec.template, questions: spec.questions.length, open, state, asked, sent: answers?.submitted ?? null, asker: spec.asker ?? null, href: `/${project.key}/ask/${id}/`, ...(live ? { live: { state: live.state, step: live.step, progress: live.progress, at: live.at } } : {}) });
    }
  }
  const rank = { waiting: 0, partial: 1, status: 2, answered: 3 };
  return items.sort((a, b) => rank[a.state] - rank[b.state] || b.asked.localeCompare(a.asked));
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
export function serve({ resolve: find, list, check, stateOf, liveOf = () => null, repliesOf = () => ({}), historyOf = () => [], onAnswers = () => {}, port, log = console.log, token = randomBytes(24).toString("hex"), version = "", onStop = () => {}, idleMs = 0, theme = () => null, themes = () => null }) {
  const pageToken = (key, id) => createHmac("sha256", token).update(`${key}/${id}`).digest("hex").slice(0, 48);
  const hosts = (at) => new Set([`127.0.0.1:${at}`, `localhost:${at}`]);
  let idle = null;
  const touch = () => {
    if (!idleMs) return;
    clearTimeout(idle);
    idle = setTimeout(() => { log("question-pictures: idle, stopping"); onStop(); }, idleMs);
    idle.unref?.();
  };
  touch();

  function send(res, status, body, type = "application/json; charset=utf-8", csp = "") {
    res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", ...(csp ? { "Content-Security-Policy": csp } : {}) });
    res.end(body);
  }
  const json = (res, status, value) => send(res, status, `${JSON.stringify(value)}\n`);
  const query = (req) => new URLSearchParams((req.url ?? "").split("?")[1] ?? "");

  /** A POST of answers: checked against the page's spec, with that page's token. */
  function takeAnswers(req, res, c, key, id) {
    if (req.method !== "POST") return json(res, 405, { error: "POST the answers" });
    if (!c.ownOrigin) return json(res, 403, { error: "answers come from this server's own pages" });
    const project = KEY.test(key) ? find(key) : null;
    const spec = project ? readSpec(project.view, id) : null;
    if (!spec) return json(res, 404, { error: `no ask page ${id}` });
    if (req.headers["x-wf-token"] !== pageToken(key, id)) return json(res, 403, { error: "the page's token is not this server's for this page; reload the page" });
    if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) return json(res, 415, { error: "answers are application/json" });
    if (!project.kinds) return json(res, 500, { error: `the project's settings could not be read, so its answers cannot be checked: ${project.error}` });
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > BODY_MAX) {
        json(res, 413, { error: "answers are at most 1 MB" });
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on("end", () => {
      if (size > BODY_MAX) return;
      try {
        let raw;
        try {
          raw = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          return json(res, 400, { error: "the answers are not JSON" });
        }
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
    });
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
    const page = rest.match(/^\/ask\/([a-z0-9][a-z0-9-]{0,63})\/(index\.html)?$/);
    let body = readFileSync(file);
    if (page && type.startsWith("text/html")) {
      body = body.toString("utf8").replaceAll(TOKEN_MARK, pageToken(key, page[1]));
      return send(res, 200, req.method === "HEAD" ? "" : body, type, PAGE_CSP);
    }
    return send(res, 200, req.method === "HEAD" ? "" : body, type, FILE_CSP);
  }

  const routes = [
    [/^\/__hub$/, (req, res, c) => json(res, 200, { hub: HUB_NAME, version, pid: process.pid, port: c.at })],
    [/^\/__hub\/inbox$/, (req, res) => json(res, 200, { items: inbox(list(), stateOf, liveOf) })],
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
    [/^\/(index\.html)?$/, (req, res) => send(res, 200, inboxHtml(), "text/html; charset=utf-8", PAGE_CSP)],
    [/^\/__ask\/([^/]+)\/version\/([^/]+)$/, (req, res, c, key, id) => {
      const project = req.method === "GET" && KEY.test(key) ? find(key) : null;
      const spec = project ? readSpec(project.view, id) : null;
      return spec ? json(res, 200, { hash: spec.hash }) : json(res, 404, { error: "no such page" });
    }],
    [/^\/__ask\/([^/]+)\/live\/([^/]+)$/, (req, res, c, key, id) => {
      const project = req.method === "GET" && KEY.test(key) ? find(key) : null;
      const spec = project ? readSpec(project.view, id) : null;
      if (!spec) return json(res, 404, { error: "no such page" });
      return json(res, 200, { live: spec.live ? liveOf(project.view, id) : null, replies: spec.off?.includes("replies") ? {} : repliesOf(project.view, id) });
    }],
    [/^\/__ask\/([^/]+)\/history\/([^/]+)$/, (req, res, c, key, id) => {
      const project = req.method === "GET" && KEY.test(key) ? find(key) : null;
      const spec = project ? readSpec(project.view, id) : null;
      if (!spec) return json(res, 404, { error: "no such page" });
      return json(res, 200, { rounds: spec.off?.includes("history") ? [] : historyOf(project.view, spec) });
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
      log(`question-pictures: ${req.method} ${req.url} failed: ${err.message}`);
      if (!res.headersSent) json(res, 500, { error: err.message });
      else res.end();
    }
  });
  return new Promise((done, fail) => {
    server.once("error", fail);
    server.listen(port, "127.0.0.1", () => {
      const at = server.address().port;
      log(`question-pictures: serving every registered project at http://127.0.0.1:${at}/`);
      done({ server, port: at, token, pageToken, close: () => new Promise((end) => { clearTimeout(idle); server.close(end); server.closeAllConnections(); }) });
    });
  });
}
