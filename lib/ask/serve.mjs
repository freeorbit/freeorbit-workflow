// `wf view serve`: the question-pictures server. It serves .cache/view on
// loopback, as python's http.server did, and takes an ask page's answers.
//
//   GET  /<path>                    a file under .cache/view; a folder serves its index.html
//   GET  /__ask/version/<id>        the hash of the page now, so an old tab can say it is old
//   POST /__ask/answers/<id>        the answers, checked against the page's spec
//
// Only this machine reaches it: it listens on 127.0.0.1, answers only a Host
// of 127.0.0.1 or localhost at its port, so a page on another name cannot
// reach it through DNS, and writes only with the token it puts into the
// pages it serves, which a page from another origin cannot read. Answers go
// only to .cache/view/answers/<id>.json, for a page whose spec is there.

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, relative, resolve, sep } from "node:path";

import { checkAnswers } from "./answers.mjs";

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

/** Start the server; resolves with `{ server, port, token, close }`. `kinds` are the pin kinds answers may name. */
export function serve({ dir, port, kinds, log = console.log, token = randomBytes(24).toString("hex") }) {
  mkdirSync(dir, { recursive: true });
  const hosts = (at) => new Set([`127.0.0.1:${at}`, `localhost:${at}`]);
  const server = createServer((req, res) => {
    const at = server.address().port;
    const send = (status, body, type = "application/json; charset=utf-8") => {
      res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" });
      res.end(body);
    };
    const json = (status, value) => send(status, `${JSON.stringify(value)}\n`);
    if (!hosts(at).has(req.headers.host ?? "")) return json(403, { error: "this server answers only 127.0.0.1 and localhost" });
    const url = req.url ?? "/";
    const version = url.match(/^\/__ask\/version\/([^/?]+)$/);
    if (req.method === "GET" && version) {
      const spec = ID.test(version[1]) ? readSpec(dir, version[1]) : null;
      return spec ? json(200, { hash: spec.hash }) : json(404, { error: "no such page" });
    }
    const post = url.match(/^\/__ask\/answers\/([^/?]+)$/);
    if (post) {
      if (req.method !== "POST") return json(405, { error: "POST the answers" });
      const origin = req.headers.origin;
      if (origin && !hosts(at).has(origin.replace(/^http:\/\//, ""))) return json(403, { error: "answers come from this server's own pages" });
      if (req.headers["x-wf-token"] !== token) return json(403, { error: "the page's token is not this server's; reload the page" });
      if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) return json(415, { error: "answers are application/json" });
      const id = post[1];
      const spec = ID.test(id) ? readSpec(dir, id) : null;
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
        const { answers, problems } = checkAnswers(spec, raw, kinds);
        if (problems) return json(422, { error: problems.join("; ") });
        const file = answersPath(dir, id);
        mkdirSync(join(dir, "answers"), { recursive: true });
        writeWhole(file, `${JSON.stringify(answers, null, 2)}\n`);
        log(`answers for ${id}: ${answers.partial ? `${answers.open.length} of ${spec.questions.length} still open` : "every question answered"}`);
        return json(200, { ok: true, partial: answers.partial, open: answers.open });
      });
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") return json(405, { error: "only GET here" });
    const file = servedFile(dir, url);
    if (!file) return send(404, "Not found\n", "text/plain; charset=utf-8");
    if (relative(realpathSync(dir), file).split(sep)[0] === "answers") return send(403, "Answers are read with npx wf ask answers\n", "text/plain; charset=utf-8");
    const type = TYPES[extname(file).toLowerCase()] ?? "application/octet-stream";
    let body = readFileSync(file);
    if (type.startsWith("text/html")) body = body.toString("utf8").replaceAll(TOKEN_MARK, token);
    return send(200, req.method === "HEAD" ? "" : body, type);
  });
  return new Promise((done, fail) => {
    server.once("error", fail);
    server.listen(port, "127.0.0.1", () => {
      const at = server.address().port;
      log(`question-pictures: serving ${dir} at http://127.0.0.1:${at}/`);
      done({ server, port: at, token, close: () => new Promise((end) => { server.close(end); server.closeAllConnections(); }) });
    });
  });
}
