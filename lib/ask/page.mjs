// The ask page: one HTML file per spec, under .cache/view/ask/<id>/, with
// its pictures copied beside it. The page is the spec and the kit's client
// script and style, inlined, so the same page can be exported whole.

import { createHash } from "node:crypto";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { askDir, answersPath, TOKEN_MARK, writeWhole } from "./serve.mjs";
import { normalize, pictures } from "./spec.mjs";

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

const script = (data) => JSON.stringify(data).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
const escape = (text) => String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** The page's HTML around its data. `token` is what the server swaps in; an export has none. */
export function pageHtml(data, token = TOKEN_MARK) {
  const css = readFileSync(join(HERE, "client.css"), "utf8");
  const js = readFileSync(join(HERE, "client.js"), "utf8");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="wf-token" content="${escape(token)}">
<title>${escape(data.spec.title)}</title>
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
 * and spec. Answers to the same page, by hash, are shown on it again.
 */
export function buildPage(root, viewDir, raw, kinds, custom = {}) {
  const { spec, problems } = normalize(raw, custom);
  if (problems.length) throw new Error(`the spec is not right:\n- ${problems.join("\n- ")}`);
  const dir = askDir(viewDir, spec.id);
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
  spec.hash = createHash("sha256").update(JSON.stringify(shape)).update(digests.join()).digest("hex").slice(0, 12);
  const previous = readAnswers(viewDir, spec.id);
  writeWhole(join(dir, "spec.json"), `${JSON.stringify(spec, null, 2)}\n`);
  const page = join(dir, "index.html");
  writeWhole(page, pageHtml({ spec, kinds, offline: false, previous: previous?.hash === spec.hash ? previous : null }));
  return { page, spec, kept: previous?.hash === spec.hash };
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
  return pageHtml({ spec: whole, kinds, offline: true, previous: answers?.hash === spec.hash ? answers : null }, "");
}
