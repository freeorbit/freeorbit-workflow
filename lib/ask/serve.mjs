// `wf view serve`: the question-pictures server, one for the machine. It
// serves each registered project's .cache/view at /<key>/ and takes its ask
// pages' answers.
//
//   GET  /                               the inbox: every ask, from every project and session
//   GET  /__hub                          who is serving, so a second start reuses this one
//   GET  /__hub/inbox                    the inbox as JSON
//   GET  /__hub/theme                    the Claude Desktop theme on this machine, or { ok: false }
//   GET  /<key>/<path>                   a file under that project's .cache/view; a folder serves its index.html
//   GET  /__ask/<key>/version/<id>       the hash of the page now, so an old tab can say it is old
//   POST /__ask/<key>/answers/<id>       the answers, checked against the page's spec
//   POST /__hub/stop                     stop, with the token from the state folder
//
// Only this machine reaches it: it listens on 127.0.0.1, answers only a Host
// of 127.0.0.1 or localhost at its port, so a page on another name cannot
// reach it through DNS, and writes only with the token it puts into the
// pages it serves, which a page from another origin cannot read. Answers go
// only to <project>/.cache/view/answers/<id>.json, for a page whose spec is there.

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, relative, resolve, sep } from "node:path";

import { answered, checkAnswers } from "./answers.mjs";
import { inboxHtml } from "./inbox.mjs";

export const TOKEN_MARK = "__WF_ASK_TOKEN__";
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
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const KEY = /^[a-z0-9][a-z0-9-]{0,48}$/;
export const HUB_NAME = "freeorbit-workflow";

/** Where an ask page's files and its answers live under the served folder. */
export const askDir = (dir, id) => join(dir, "ask", id);
export const answersPath = (dir, id) => join(dir, "answers", `${id}.json`);

/** Read a page's spec, or null. */
export function readSpec(dir, id) {
  const file = join(askDir(dir, id), "spec.json");
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
}

/** Write a file whole or not at all. */
export function writeWhole(file, text) {
  const part = `${file}.${process.pid}.part`;
  writeFileSync(part, text);
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
  const real = realpathSync(file);
  if (real !== root && !real.startsWith(root + sep)) return null;
  if (statSync(real).isDirectory()) {
    file = join(real, "index.html");
    return existsSync(file) && realpathSync(file).startsWith(root + sep) ? realpathSync(file) : null;
  }
  return real;
}

/** Every ask page of the projects, newest first, with its state: waiting, partial, or answered. */
export function inbox(list) {
  const items = [];
  for (const project of list) {
    const dir = join(project.view, "ask");
    if (!existsSync(dir)) continue;
    for (const id of readdirSync(dir)) {
      if (!ID.test(id)) continue;
      const specFile = join(dir, id, "spec.json");
      if (!existsSync(specFile)) continue;
      let spec;
      try {
        spec = JSON.parse(readFileSync(specFile, "utf8"));
      } catch {
        continue;
      }
      const asked = statSync(specFile).mtimeMs;
      const file = answersPath(project.view, id);
      let state = "waiting";
      let open = spec.questions.length;
      let sent = null;
      if (existsSync(file) && statSync(file).mtimeMs > asked) {
        try {
          const answers = JSON.parse(readFileSync(file, "utf8"));
          if (answers.hash === spec.hash) {
            open = spec.questions.filter((q) => !answered(answers.answers?.[q.id])).length;
            state = open ? "partial" : "answered";
            sent = answers.submitted ?? null;
          }
        } catch {
          // A broken answers file reads as no answers.
        }
      }
      items.push({ key: project.key, project: project.name, id, title: spec.title, template: spec.template, questions: spec.questions.length, open, state, asked: new Date(asked).toISOString(), sent, asker: spec.asker ?? null, href: `/${project.key}/ask/${id}/` });
    }
  }
  const rank = { waiting: 0, partial: 1, answered: 2 };
  return items.sort((a, b) => rank[a.state] - rank[b.state] || b.asked.localeCompare(a.asked));
}

/**
 * Start the server; resolves with `{ server, port, token, close }`.
 * `resolve(key)` gives a project's `{ view, kinds }` or null, and `list()`
 * every project as `{ key, name, view }`; the hub reads them from the
 * registry on each request, so a project registered later is served at once.
 */
export function serve({ resolve: find, list, port, log = console.log, token = randomBytes(24).toString("hex"), version = "", onStop = () => {}, idleMs = 0, theme = () => null }) {
  const hosts = (at) => new Set([`127.0.0.1:${at}`, `localhost:${at}`]);
  let idle = null;
  const touch = () => {
    if (!idleMs) return;
    clearTimeout(idle);
    idle = setTimeout(() => { log("question-pictures: idle, stopping"); onStop(); }, idleMs);
    idle.unref?.();
  };
  touch();
  const server = createServer((req, res) => {
    touch();
    const at = server.address().port;
    const send = (status, body, type = "application/json; charset=utf-8") => {
      res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" });
      res.end(body);
    };
    const json = (status, value) => send(status, `${JSON.stringify(value)}\n`);
    if (!hosts(at).has(req.headers.host ?? "")) return json(403, { error: "this server answers only 127.0.0.1 and localhost" });
    const url = (req.url ?? "/").split("?")[0];
    const origin = req.headers.origin;
    const ownOrigin = !origin || hosts(at).has(origin.replace(/^http:\/\//, ""));
    const withToken = () => ownOrigin && req.headers["x-wf-token"] === token;
    if (url === "/__hub") return json(200, { hub: HUB_NAME, version, pid: process.pid, port: at });
    if (url === "/__hub/inbox") return json(200, { items: inbox(list()) });
    if (url === "/__hub/theme") {
      const desktop = theme();
      return json(200, desktop ? { ok: true, ...desktop } : { ok: false });
    }
    if (url === "/__hub/stop") {
      if (req.method !== "POST" || !withToken()) return json(403, { error: "stop needs the server's token" });
      json(200, { ok: true });
      return setImmediate(onStop);
    }
    if (url === "/" || url === "/index.html") return send(200, inboxHtml(), "text/html; charset=utf-8");
    const version_ = url.match(/^\/__ask\/([^/]+)\/version\/([^/]+)$/);
    if (req.method === "GET" && version_) {
      const project = KEY.test(version_[1]) ? find(version_[1]) : null;
      const spec = project && ID.test(version_[2]) ? readSpec(project.view, version_[2]) : null;
      return spec ? json(200, { hash: spec.hash }) : json(404, { error: "no such page" });
    }
    const post = url.match(/^\/__ask\/([^/]+)\/answers\/([^/]+)$/);
    if (post) {
      if (req.method !== "POST") return json(405, { error: "POST the answers" });
      if (!ownOrigin) return json(403, { error: "answers come from this server's own pages" });
      if (req.headers["x-wf-token"] !== token) return json(403, { error: "the page's token is not this server's; reload the page" });
      if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) return json(415, { error: "answers are application/json" });
      const project = KEY.test(post[1]) ? find(post[1]) : null;
      const id = post[2];
      const spec = project && ID.test(id) ? readSpec(project.view, id) : null;
      if (!spec) return json(404, { error: `no ask page ${id}` });
      const chunks = [];
      let size = 0;
      req.on("data", (chunk) => {
        size += chunk.length;
        if (size > BODY_MAX) {
          json(413, { error: "answers are at most 1 MB" });
          req.destroy();
        } else chunks.push(chunk);
      });
      req.on("end", () => {
        if (size > BODY_MAX) return;
        let raw;
        try {
          raw = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        } catch {
          return json(400, { error: "the answers are not JSON" });
        }
        const { answers, problems } = checkAnswers(spec, raw, project.kinds);
        if (problems) return json(422, { error: problems.join("; ") });
        mkdirSync(join(project.view, "answers"), { recursive: true });
        writeWhole(answersPath(project.view, id), `${JSON.stringify(answers, null, 2)}\n`);
        log(`answers for ${post[1]}/${id}: ${answers.partial ? `${answers.open.length} of ${spec.questions.length} still open` : "every question answered"}`);
        return json(200, { ok: true, partial: answers.partial, open: answers.open });
      });
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") return json(405, { error: "only GET here" });
    const parts = url.match(/^\/([^/]+)(\/.*)?$/);
    const project = parts && KEY.test(parts[1]) ? find(parts[1]) : null;
    if (!project) return send(404, "Not found. The inbox, at /, lists every page.\n", "text/plain; charset=utf-8");
    if (!parts[2]) {
      res.writeHead(301, { Location: `/${parts[1]}/` });
      return res.end();
    }
    if (!existsSync(project.view)) return send(404, "Not found\n", "text/plain; charset=utf-8");
    const file = servedFile(project.view, parts[2]);
    if (!file) return send(404, "Not found\n", "text/plain; charset=utf-8");
    if (relative(realpathSync(project.view), file).split(sep)[0] === "answers") return send(403, "Answers are read with npx wf ask answers\n", "text/plain; charset=utf-8");
    const type = TYPES[extname(file).toLowerCase()] ?? "application/octet-stream";
    let body = readFileSync(file);
    if (type.startsWith("text/html")) body = body.toString("utf8").replaceAll(TOKEN_MARK, token);
    return send(200, req.method === "HEAD" ? "" : body, type);
  });
  return new Promise((done, fail) => {
    server.once("error", fail);
    server.listen(port, "127.0.0.1", () => {
      const at = server.address().port;
      log(`question-pictures: serving every registered project at http://127.0.0.1:${at}/`);
      done({ server, port: at, token, close: () => new Promise((end) => { clearTimeout(idle); server.close(end); server.closeAllConnections(); }) });
    });
  });
}
