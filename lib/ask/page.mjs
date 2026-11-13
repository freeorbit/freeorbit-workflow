// The ask page: one HTML file per spec, under .cache/view/ask/<id>/, with
// its pictures copied beside it. The page is the spec and the kit's client
// script and style, inlined, so the same page can be exported whole.

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { askDir, answersPath, readSpec, TOKEN_MARK, writeWhole } from "../view/serve.mjs";
import { changesSince, readLive, readReplies, repliesFile } from "./live.mjs";
import { normalize, pageHash, pictureAdvice, pictures } from "./spec.mjs";
import { escapeAttribute } from "../html.mjs";
import { projectKey } from "../view/view.mjs";
import { pageStyles } from "./styles.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const IMAGES = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml" };

/** A picture's file, inside the project and reached through no link. Throws otherwise. */
export function pictureFile(root, image) {
  const file = resolve(root, image);
  const rel = relative(root, file);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error(`${image} is outside the project; a picture is a file in it`);
  if (!IMAGES[extname(file).toLowerCase()]) throw new Error(`${image} is not a picture: png, jpg, gif, webp, or svg`);
  if (!existsSync(file)) throw new Error(`${image} does not exist`);
  if (lstatSync(file).isSymbolicLink()) throw new Error(`${image} is a link; a picture is read through none`);
  const real = realpathSync(file);
  const realRoot = realpathSync(root);
  if (relative(realRoot, real).startsWith("..")) throw new Error(`${image} leads out of the project`);
  return real;
}

/** A picture's width and height from its header (PNG, JPEG, GIF, WebP), or null. */
export function imageSize(buf) {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
  if (buf.length > 10 && buf.toString("ascii", 0, 3) === "GIF") return [buf.readUInt16LE(6), buf.readUInt16LE(8)];
  if (buf.length > 30 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    const kind = buf.toString("ascii", 12, 16);
    if (kind === "VP8X") return [1 + buf.readUIntLE(24, 3), 1 + buf.readUIntLE(27, 3)];
    if (kind === "VP8 ") return [buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff];
    if (kind === "VP8L") { const bits = buf.readUInt32LE(21); return [(bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1]; }
  }
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    for (let at = 2; at + 9 < buf.length; ) {
      if (buf[at] !== 0xff) return null;
      const marker = buf[at + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return [buf.readUInt16BE(at + 7), buf.readUInt16BE(at + 5)];
      at += 2 + buf.readUInt16BE(at + 2);
    }
  }
  return null;
}

/**
 * The page's script: the shared helpers, the answer steps, the look, then the
 * page's own parts in file order, which run as one function.
 */
export function pageScript() {
  const browser = join(HERE, "browser");
  const parts = readdirSync(join(browser, "page")).filter((f) => f.endsWith(".js")).sort();
  return [...["shared.js", "state.js", "look.js", "motion.js"].map((f) => join(browser, f)), ...parts.map((f) => join(browser, "page", f))].map((f) => readFileSync(f, "utf8")).join("\n");
}

const script = (data) => JSON.stringify(data).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

const THEMES = JSON.parse(readFileSync(join(HERE, "browser", "themes.json"), "utf8"));

/** The page's HTML around its data. `token` is what the server swaps in; an export has none. */
export function pageHtml(data, token = TOKEN_MARK) {
  data = { ...data, themes: { default: THEMES.default, themes: THEMES.themes } };
  const css = pageStyles();
  const js = pageScript();
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="wf-token" content="${escapeAttribute(token)}">
<title>${escapeAttribute(data.spec.title)}</title>
<style>
${css}</style>
</head>
<body>
<noscript>This page needs JavaScript to show the questions. The spec is in spec.json beside it.</noscript>
<div id="app"></div>
<script type="application/json" id="ask-data">${script(data)}</script>
<script>
${js}</script>
</body>
</html>
`;
}

/**
 * Build the page for a spec: check it, copy its pictures, and write spec.json
 * and index.html under `<viewDir>/ask/<id>/`. Resolves with the page's path
 * and spec, and advice on how it groups its questions. Answers to the same
 * page, by hash, are shown on it again.
 */
export function buildPage(root, viewDir, raw, kinds, custom = {}, { asker = null, key = projectKey(root), ctx = {} } = {}) {
  const { spec, problems, advice } = normalize(raw, custom, ctx);
  if (problems.length) throw new Error(`the spec is not right:\n- ${problems.join("\n- ")}`);
  const dir = askDir(viewDir, spec.id);
  // The page asked before, if any, to say what changed since.
  const before = readSpec(viewDir, spec.id);
  const beforeAt = before ? statSync(join(dir, "spec.json")).mtime.toISOString() : null;
  rmSync(join(dir, "p"), { recursive: true, force: true });
  mkdirSync(join(dir, "p"), { recursive: true });
  const copied = new Map();
  const digests = [];
  for (const pic of pictures(spec)) {
    if (!copied.has(pic.image)) {
      const file = pictureFile(root, pic.image);
      const name = `p/${copied.size + 1}${extname(file).toLowerCase()}`;
      const bytes = readFileSync(file);
      copyFileSync(file, join(dir, name));
      digests.push(createHash("sha256").update(bytes).digest("hex"));
      copied.set(pic.image, { src: name, size: imageSize(bytes) });
    }
    const { src, size } = copied.get(pic.image);
    pic.src = src;
    if (size) [pic.w, pic.h] = size;
  }
  // The hash covers the pictures too, so a new shot of the same screen is a new page.
  const { hash, ...shape } = spec;
  spec.hash = pageHash(shape, digests);
  // Who asks is not part of the page, so the same page asked again keeps its answers.
  if (asker) spec.asker = asker;
  // What changed since the page was last asked; asked again as it was, it keeps what it said before.
  if (!spec.off?.includes("changes")) {
    const changes = before?.hash === spec.hash ? before.changes : changesSince(before, spec, beforeAt);
    if (changes) spec.changes = changes;
  }
  // The agent's replies were about the page before; a changed page starts without them.
  if (before && before.hash !== spec.hash) rmSync(repliesFile(viewDir, spec.id), { force: true });
  const previous = readAnswers(viewDir, spec.id);
  writeWhole(join(dir, "spec.json"), `${JSON.stringify(spec, null, 2)}\n`);
  const page = join(dir, "index.html");
  writeWhole(page, pageHtml({ spec, kinds, key, offline: false, previous: previous?.hash === spec.hash ? previous : null }));
  return { page, spec, kept: previous?.hash === spec.hash, advice: [...advice, ...pictureAdvice(spec).map((line) => `Pictures: ${line}`)] };
}

/** The answers saved for a page, or null. */
export function readAnswers(viewDir, id) {
  const file = answersPath(viewDir, id);
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null;
}

/** The page as one file, its pictures inside it, to send to someone who answers it offline. */
export function exportHtml(viewDir, spec, kinds, answers) {
  const dir = askDir(viewDir, spec.id);
  const inline = (pic) => {
    const file = join(dir, pic.src);
    return { ...pic, src: `data:${IMAGES[extname(file).toLowerCase()]};base64,${readFileSync(file).toString("base64")}` };
  };
  const whole = { ...spec, questions: spec.questions.map((q) => ({ ...q, pictures: q.pictures.map(inline), compare: q.compare ? q.compare.map(inline) : null })) };
  // Offline, the page has no server to poll, so its status and the agent's replies go inside it.
  return pageHtml({ spec: whole, kinds, offline: true, previous: answers?.hash === spec.hash ? answers : null, live: spec.live ? readLive(viewDir, spec.id) : null, replies: readReplies(viewDir, spec.id) }, "");
}
