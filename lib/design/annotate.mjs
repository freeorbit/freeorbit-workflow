// `wf design annotate`: label pictures for a visual question to a person,
// mark where to look, and join them into one sheet.
//
//   wf design annotate <spec.json>     or a spec on stdin with -
//
// The spec:
//
//   {
//     "out": ".cache/view/sheet.png",
//     "pictures": [
//       { "label": "A", "frame": "gm-accounts",
//         "boxes": [{ "n": 1, "kind": "look", "selector": ".task-tabs" },
//                   { "n": 2, "kind": "bug", "selector": ".row-tag", "text": "Unsubscribe" }] },
//       { "label": "B", "name": "the app", "image": ".cache/screens/latest/x.png",
//         "boxes": [{ "n": 1, "kind": "drift", "rect": [633, 373, 598, 35] }] }
//     ]
//   }
//
// A frame's boxes come from its own elements, found in headless Chromium at
// the size it renders at, so they land where the element is. A screenshot's
// boxes are rectangles, x, y, width, height, such as from getBoundingClientRect
// in the running app. Each kind has one colour: look blue, bug red, drift
// amber, ok green, new purple, and any a project adds under design.kinds. The
// name bar names the picture and the kinds it uses.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { KIT_ROOT } from "../ai.mjs";
import { escapeAttribute } from "../html.mjs";
import { browserFor, fontArgs, fontFor } from "../platform.mjs";
import { designPaths, findFrame } from "./frames.mjs";

/**
 * The kit's kinds of mark, each with its colour and its word in the legend,
 * from plugins/design/annotate-kinds.json. A kind is never changed, so it
 * looks the same in every run and every project.
 */
export const KIT_KINDS = JSON.parse(readFileSync(join(KIT_ROOT, "plugins", "design", "annotate-kinds.json"), "utf8")).kinds;

/**
 * The kit's kinds, then the project's own from design.kinds. A project kind
 * may not reuse a kit kind's name or any kind's colour, so a mark never
 * changes meaning. Throws with what clashes.
 */
export function kindsFor(config) {
  const out = { ...KIT_KINDS };
  const colors = new Map(Object.entries(KIT_KINDS).map(([kind, { color }]) => [color.toLowerCase(), kind]));
  for (const [kind, value] of Object.entries(config.design.kinds)) {
    if (KIT_KINDS[kind]) throw new Error(`design.kinds.${kind}: the kit already has a kind named ${kind}, and a kind never changes.`);
    if (!value || typeof value.color !== "string" || !value.word || !value.use) {
      throw new Error(`design.kinds.${kind}: a kind has a color, a word, and a use.`);
    }
    const clash = colors.get(value.color.toLowerCase());
    if (clash) throw new Error(`design.kinds.${kind}: ${value.color} is already the colour of ${clash}.`);
    colors.set(value.color.toLowerCase(), kind);
    out[kind] = value;
  }
  return out;
}
const STROKE = 2;
const PAD = 4;
const BAR = 34;
const GAP = 16;

/** Check a spec and fill in defaults. Throws with what is wrong. */
export function checkSpec(spec, KINDS = KIT_KINDS) {
  if (!spec || !Array.isArray(spec.pictures) || spec.pictures.length === 0) {
    throw new Error("The spec needs a list of pictures.");
  }
  const labels = new Set();
  const pictures = spec.pictures.map((pic, i) => {
    const label = String(pic.label ?? String.fromCharCode(65 + i));
    // The label is drawn by ImageMagick, which reads a file for a leading @ and expands % (SEC-083).
    if (!/^[A-Z0-9]{1,3}$/.test(label)) throw new Error(`Picture ${i + 1}: a label is one to three capital letters or digits, such as A or B2, not ${JSON.stringify(label)}.`);
    if (labels.has(label)) throw new Error(`Two pictures are labelled ${label}.`);
    labels.add(label);
    if (!pic.frame === !pic.image) throw new Error(`Picture ${label} needs a frame or an image, not both.`);
    const boxes = (pic.boxes ?? []).map((box, j) => {
      const kind = box.kind ?? "look";
      if (!KINDS[kind]) throw new Error(`Picture ${label}, box ${j + 1}: kind "${kind}" is not one of ${Object.keys(KINDS).join(", ")}.`);
      if (!box.rect === !box.selector) throw new Error(`Picture ${label}, box ${j + 1} needs a selector or a rect, not both.`);
      if (box.rect && (box.rect.length !== 4 || box.rect.some((v) => typeof v !== "number"))) {
        throw new Error(`Picture ${label}, box ${j + 1}: a rect is four numbers, x, y, width, height.`);
      }
      if (box.selector && pic.image) throw new Error(`Picture ${label} is a screenshot, so its boxes are rects.`);
      const n = box.n ?? j + 1;
      if (!Number.isInteger(n) || n < 1 || n > 999) throw new Error(`Picture ${label}, box ${j + 1}: n is a whole number from 1 to 999.`);
      return { n, kind, rect: box.rect, selector: box.selector, text: box.text, nth: box.nth ?? 0 };
    });
    return { label, name: pic.name ?? pic.frame ?? pic.image, frame: pic.frame, image: pic.image, boxes };
  });
  return { out: spec.out ?? ".cache/view/sheet.png", pictures };
}

/** A rect grown by the padding and kept inside the picture. */
export function fit([x, y, w, h], width, height) {
  const x0 = Math.max(STROKE, Math.round(x - PAD));
  const y0 = Math.max(STROKE, Math.round(y - PAD));
  const x1 = Math.min(width - STROKE - 1, Math.round(x + w + PAD));
  const y1 = Math.min(height - STROKE - 1, Math.round(y + h + PAD));
  return [x0, y0, x1, y1];
}

/** The magick arguments that draw each box and its number. */
export function boxArgs(boxes, width, height, KINDS = KIT_KINDS, FONT = "") {
  const args = [];
  for (const box of boxes) {
    const [x0, y0, x1, y1] = fit(box.rect, width, height);
    const { color } = KINDS[box.kind];
    // The number sits on the box's top left corner, inside the picture.
    const cx = Math.max(12, x0);
    const cy = Math.max(12, y0);
    args.push(
      "-fill", "none", "-stroke", color, "-strokewidth", String(STROKE),
      "-draw", `roundrectangle ${x0},${y0} ${x1},${y1} 6,6`,
      "-stroke", "none", "-fill", color, "-draw", `circle ${cx},${cy} ${cx + 11},${cy}`,
      "-fill", "white", ...fontArgs(FONT), "-pointsize", "14", "-gravity", "NorthWest",
      "-annotate", `+${cx - (String(box.n).length > 1 ? 8 : 4)}+${cy - 10}`, String(box.n),
    );
  }
  return args;
}

/** The kinds a picture uses, in the legend's order. */
export function legend(boxes, KINDS = KIT_KINDS) {
  return Object.keys(KINDS).filter((kind) => boxes.some((box) => box.kind === kind));
}

function framePath(name, paths) {
  const frame = findFrame(name, paths);
  if (!frame) throw new Error(`No frame named ${name}.`);
  return { html: frame.html, png: frame.png };
}

/** A box by selector needs the frame's HTML; a picture frame takes rectangles only. */
function needsHtml(name, frame) {
  if (!frame.html) throw new Error(`${name} is a picture from the design tool (design.source is png), so it has no elements: give each box a rect.`);
}

// Runs in the page: the box of the nth element that matches, and holds the text if one is given.
function findBox(selector, text, nth) {
  const all = [...document.querySelectorAll(selector)].filter((el) => !text || (el.innerText || "").includes(text));
  // With text, the smallest match is the element that holds it, not a wrapper.
  if (text) all.sort((a, b) => a.getBoundingClientRect().width * a.getBoundingClientRect().height - b.getBoundingClientRect().width * b.getBoundingClientRect().height);
  const el = all[nth];
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return [r.x, r.y, r.width, r.height];
}

async function resolveBoxes(pictures, paths) {
  const framed = pictures.filter((pic) => pic.frame && pic.boxes.some((box) => box.selector));
  if (framed.length === 0) return;
  const { openChromium } = await import("../browser/headless.mjs");
  const browser = await openChromium(paths.root, browserFor(paths.config));
  try {
    for (const pic of framed) {
      const [width, height] = paths.config.design.size;
      const frame = framePath(pic.frame, paths);
      needsHtml(pic.frame, frame);
      await browser.open(pathToFileURL(frame.html).href, width, height);
      for (const box of pic.boxes.filter((b) => b.selector)) {
        const rect = await browser.evaluate(`(${findBox})(${JSON.stringify(box.selector)}, ${JSON.stringify(box.text ?? "")}, ${box.nth})`);
        if (!rect) throw new Error(`Picture ${pic.label}: nothing in ${pic.frame} matches ${box.selector}${box.text ? ` with "${box.text}"` : ""}.`);
        box.rect = rect;
      }
    }
  } finally {
    await browser.close();
  }
}

/**
 * Text as ImageMagick draws it literally in label: and -annotate (SEC-083): a
 * leading @ would read a file, % starts an escape, and a backslash escapes.
 */
export function magickText(text) {
  return String(text).replace(/\\/g, "\\\\").replace(/%/g, "%%").replace(/^@/, "\\@");
}

function size(path) {
  const [w, h] = execFileSync("magick", ["identify", "-format", "%w %h", path], { encoding: "utf8" }).split(" ").map(Number);
  return [w, h];
}

/** How wide a line of text is in the bar's font, in pixels. */
function textWidth(text, points, FONT) {
  return Number(execFileSync("magick", [...fontArgs(FONT), "-pointsize", String(points), `label:${magickText(text)}`, "-format", "%w", "info:"], { encoding: "utf8" }));
}

/** The name bar: the label and name, then a coloured dot and word for each kind used. */
function barArgs(pic, width, KINDS, FONT) {
  const mid = Math.round(BAR / 2);
  const title = `${pic.label}   ${pic.name}`;
  const args = ["(", "-size", `${width}x${BAR}`, "xc:#1f2937", ...fontArgs(FONT), "-gravity", "NorthWest",
    "-fill", "white", "-pointsize", "17", "-annotate", `+12+${mid - 9}`, magickText(title)];
  let x = 12 + textWidth(title, 17, FONT) + 28;
  for (const kind of legend(pic.boxes, KINDS)) {
    const { color, word } = KINDS[kind];
    args.push("-fill", color, "-draw", `circle ${x + 5},${mid - 2} ${x + 10},${mid - 2}`,
      "-pointsize", "15", "-annotate", `+${x + 16}+${mid - 8}`, magickText(word));
    x += 16 + textWidth(word, 15, FONT) + 22;
  }
  return [...args, ")"];
}

/** One picture with its name bar on top and its boxes drawn. */
function drawPicture(pic, out, paths, KINDS) {
  const FONT = fontFor(paths.config);
  const source = pic.frame ? framePath(pic.frame, paths).png : resolve(paths.root, pic.image);
  if (!existsSync(source)) throw new Error(`Picture ${pic.label}: ${source} does not exist. Render the frame first.`);
  const [width, height] = size(source);
  execFileSync("magick", [source, "+repage", ...boxArgs(pic.boxes, width, height, KINDS, FONT), ...barArgs(pic, width, KINDS, FONT), "+swap", "-gravity", "North", "-append", "+repage", out]);
}


/**
 * A page for the browser pane that puts the pictures two to a row, as the
 * sheet does, so a frame sits beside its app picture (A beside B). It links
 * them by name, so a browser pane opens it from a server on the sheet's
 * folder, such as one on .cache/view on this computer. A click
 * opens one picture at full size, and a second click or Escape closes it.
 */
export function viewerHtml(pictures, files) {
  const items = pictures
    .map((pic, i) => {
      const alt = `${escapeAttribute(pic.label)} ${escapeAttribute(pic.name)}`;
      return `<figure><img src="${escapeAttribute(basename(files[i]))}" alt="${alt}" onclick="show(this)"></figure>`;
    })
    .join("\n");
  return `<!doctype html>
<meta charset="utf-8">
<title>Question pictures</title>
<style>
body { margin: 0; padding: 8px; background: #0b0f14; color: #e5e7eb; font: 13px sans-serif; }
p { margin: 0 0 8px; color: #9ca3af; }
.pairs { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
figure { margin: 0; min-width: 0; }
img { display: block; width: 100%; height: auto; cursor: zoom-in; }
#full { position: fixed; inset: 0; display: none; overflow: auto; background: #0b0f14; cursor: zoom-out; }
#full.on { display: block; }
#full img { width: auto; max-width: none; cursor: zoom-out; }
</style>
<p>Two to a row, as the sheet. Click a picture for full size; click again or press Escape to close.</p>
<div class="pairs">
${items}
</div>
<div id="full" onclick="hide()"><img alt=""></div>
<script>
const full = document.getElementById("full");
function show(img) { full.querySelector("img").src = img.src; full.classList.add("on"); }
function hide() { full.classList.remove("on"); }
addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); });
</script>
`;
}

/** The picture server's root page: it sends the pane on to the newest sheet's page. */
export function indexHtml(page) {
  const href = escapeAttribute(encodeURI(page));
  return `<!doctype html>
<meta charset="utf-8">
<meta http-equiv="refresh" content="0; url=${href}">
<title>Question pictures</title>
<p><a href="${href}">The newest pictures</a></p>
`;
}

export async function annotate(raw, paths = designPaths()) {
  const KINDS = kindsFor(paths.config);
  const spec = checkSpec(raw, KINDS);
  await resolveBoxes(spec.pictures, paths);
  const out = resolve(paths.root, spec.out);
  mkdirSync(dirname(out), { recursive: true });
  const parts = spec.pictures.map((pic, i) => (spec.pictures.length === 1 ? out : out.replace(/\.png$/, `-${pic.label || i}.png`)));
  spec.pictures.forEach((pic, i) => drawPicture(pic, parts[i], paths, KINDS));
  if (parts.length > 1) {
    // Two to a row, so a sheet stays readable at full size.
    const rows = [];
    for (let i = 0; i < parts.length; i += 2) rows.push(["(", ...parts.slice(i, i + 2), "-background", "#0b0f14", "-splice", `${GAP}x0`, "+append", "-chop", `${GAP}x0`, ")"]);
    execFileSync("magick", [...rows.flat(), "-background", "#0b0f14", "-splice", `0x${GAP}`, "-append", "-chop", `0x${GAP}`, "+repage", out]);
  }
  const page = out.replace(/\.png$/, ".html");
  writeFileSync(page, viewerHtml(spec.pictures, parts));
  // The pane opens the server at its root, so the root goes to the newest sheet.
  writeFileSync(join(dirname(out), "index.html"), indexHtml(basename(page)));
  return out;
}
