// How ask pages move: the motion part (browser/motion.js), the Motion
// setting (look.js), and the styles' timings.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

import { normalize } from "../lib/ask/spec.mjs";
import { pageScript } from "../lib/ask/page.mjs";

const here = dirname(fileURLToPath(import.meta.url));
// Objects made in the page's context compare by value here.
const plain = (o) => JSON.parse(JSON.stringify(o));
const browser = join(here, "../lib/ask/browser");

/** An element with a place on the page that can be moved, and the animations started on it. */
function element(rect) {
  const el = { rect, started: [], getBoundingClientRect: () => ({ ...el.rect }), animate: (frames, opts) => { const a = { frames, opts, cancel() {}, onfinish: null }; el.started.push(a); return a; } };
  return el;
}
/** The motion part, loaded as the page loads it, with `data-motion` set to `motion`. */
function motion(motionLevel, { reduce = false } = {}) {
  const sandbox = {
    window: {},
    document: { documentElement: { dataset: { motion: motionLevel } }, startViewTransition: undefined },
    matchMedia: () => ({ matches: reduce, addEventListener() {} }),
    performance: { now: () => 0 },
    requestAnimationFrame: (f) => sandbox.frames.push(f),
    frames: [],
  };
  runInNewContext(readFileSync(join(browser, "motion.js"), "utf8"), sandbox);
  return { M: sandbox.window.wfMotion, sandbox };
}

test("things glide from where they were, and nothing moves with motion off", () => {
  const { M } = motion("full");
  const a = element({ left: 0, top: 0 });
  const b = element({ left: 0, top: 40 });
  const list = [a, b];
  let changed = 0;
  M.glide(() => list, () => { changed++; a.rect = { left: 0, top: 40 }; b.rect = { left: 0, top: 0 }; });
  assert.equal(changed, 1);
  assert.deepEqual(plain(a.started[0].frames[0]), { transform: "translate(0px, -40px)" }, "a glides down from its old place");
  assert.equal(a.started[0].opts.duration, M.DUR.base);
  // Drawn anew, an element of the same key still glides from its old place; a new key comes in.
  const c = element({ left: 0, top: 0 });
  c.key = "c";
  const c2 = element({ left: 0, top: 80 });
  c2.key = "c";
  const d = element({ left: 0, top: 0 });
  d.key = "d";
  let now = [c];
  M.glide(() => now, () => { now = [c2, d]; }, (el) => el.key);
  assert.deepEqual(plain(c2.started[0].frames[0]), { transform: "translate(0px, -80px)" });
  assert.equal(d.started[0].frames[0].opacity, 0, "a new one comes in");
  // A first draw has nothing to move from, so nothing comes in.
  const e = element({ left: 0, top: 0 });
  let first = [];
  M.glide(() => first, () => { first = [e]; });
  assert.equal(e.started.length, 0);
  for (const level of ["off", "subtle"]) {
    const { M: quiet } = motion(level);
    const x = element({ left: 0, top: 0 });
    let moved = 0;
    quiet.glide(() => [x], () => { moved++; x.rect = { left: 50, top: 0 }; });
    assert.equal(moved, 1, `${level}: the change is still made`);
    assert.equal(x.started.length, 0, `${level}: nothing glides`);
  }
});

test("coming in fades, and only in full motion rises; off, nothing starts and the change still happens", () => {
  const full = element({});
  motion("full").M.enter(full, { from: "right" });
  assert.deepEqual(plain(full.started[0].frames[0]), { opacity: 0, transform: "translateX(16px)" });
  const subtle = element({});
  motion("subtle").M.enter(subtle);
  assert.deepEqual(plain(subtle.started[0].frames[0]), { opacity: 0 }, "subtle fades, with no movement");
  const off = element({});
  motion("off").M.enter(off);
  assert.equal(off.started.length, 0);
  let gone = false;
  motion("off").M.leave(element({}), () => { gone = true; });
  assert.equal(gone, true, "with motion off, leaving is at once");
  let shown = null;
  motion("off").M.reveal(element({}), true, (s) => { shown = s; });
  assert.equal(shown, true);
  let whole = 0;
  motion("full").M.whole(() => whole++);
  assert.equal(whole, 1, "with no view transitions, a whole-page change is made at once");
});

test("a number counts from what it said to what it says, and ends exact", () => {
  const { M, sandbox } = motion("full");
  const el = { textContent: "3 of 12" };
  M.count(el, "3 of 12", "7 of 12");
  sandbox.performance.now = () => 0;
  const step = sandbox.frames.shift();
  step(M.DUR.slow / 2);
  assert.match(el.textContent, /^\d of 12$/, "part way, the words around the number stay");
  for (let f; (f = sandbox.frames.shift());) f(M.DUR.slow);
  step(M.DUR.slow);
  assert.equal(el.textContent, "7 of 12");
  const other = { textContent: "1 Medium" };
  motion("full").M.count(other, "1 Medium", "2 High");
  assert.equal(other.textContent, "1 Medium", "different words are not counted, only swapped by the page");
  const off = motion("off");
  const quiet = { textContent: "3" };
  off.M.count(quiet, "3", "9");
  assert.equal(off.sandbox.frames.length, 0);
});

/** look.js, loaded with the computer's reduce-motion setting, a page's off list, and a saved look. */
function look({ reduce, off = "", saved = {} }) {
  const stored = new Map([["wf-ask:look", JSON.stringify(saved)]]);
  const root = { dataset: { off }, style: { setProperty() {} } };
  const sandbox = {
    window: {},
    document: { documentElement: root },
    matchMedia: (q) => ({ matches: q.includes("reduced-motion") ? reduce : false, addEventListener() {} }),
    localStorage: { getItem: (k) => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, v), removeItem: (k) => stored.delete(k) },
  };
  runInNewContext(readFileSync(join(browser, "shared.js"), "utf8"), sandbox);
  runInNewContext(readFileSync(join(browser, "look.js"), "utf8"), sandbox);
  sandbox.window.wfLook.init({ default: "clay", themes: { clay: { name: "Clay", light: {}, dark: {} } } }, false);
  return { root, L: sandbox.window.wfLook };
}

test("Motion starts at System, which follows the computer; the person's own choice wins, and a page's off wins over both", () => {
  assert.equal(look({ reduce: false }).root.dataset.motion, "full");
  assert.equal(look({ reduce: true }).root.dataset.motion, "off", "System, with the computer asking for less motion");
  assert.equal(look({ reduce: true, saved: { motion: "full" } }).root.dataset.motion, "full", "Full chosen wins over the computer");
  assert.equal(look({ reduce: false, saved: { motion: "subtle" } }).root.dataset.motion, "subtle");
  assert.equal(look({ reduce: false, saved: { motion: "full" }, off: "bulk motion" }).root.dataset.motion, "off", "a page that turns motion off has none");
  const { root, L } = look({ reduce: false });
  L.set({ motion: "off" });
  assert.equal(root.dataset.motion, "off");
  assert.equal(L.look.motion, "off");
  assert.deepEqual(normalize({ id: "m", title: "M", questions: [{ id: "q", text: "Fine?" }], off: ["motion"] }).spec.off, ["motion"]);
});

test("the styles move on the motion rhythm, and every move stops with motion off", () => {
  const css = readdirSync(join(browser, "style")).sort().map((f) => readFileSync(join(browser, "style", f), "utf8")).join("\n");
  // Every timing is at most the slowest of the rhythm, but a pulse that runs on while a live page runs.
  const slow = 320;
  const long = [...css.matchAll(/(?:animation|transition)[^;{}]*?(\d+)ms/g)].map((m) => [Number(m[1]), m[0]]).filter(([ms, rule]) => ms > slow && !/infinite/.test(rule));
  assert.deepEqual(long, [], "a move longer than the rhythm's slowest");
  assert.match(css, /:root\[data-motion="off"\] \*, :root\[data-motion="off"\] \*::before, :root\[data-motion="off"\] \*::after \{ transition: none !important; animation: none !important; \}/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{ :root:not\(\[data-motion\]\)/, "until the look is set, the computer's setting holds");
  assert.match(css, /:root\[data-motion="subtle"\] \.pop/, "subtle keeps fades, not movement");
  // The page's script uses the one motion part, never its own timers for moves.
  const script = pageScript();
  assert.ok(script.includes("window.wfMotion = "));
  assert.ok(!/prefers-reduced-motion/.test(readdirSync(join(browser, "page")).map((f) => readFileSync(join(browser, "page", f), "utf8")).join("\n").replace(/matchMedia\("\(prefers-reduced-motion: reduce\)"\)\.matches \? "System \(off\)"/, "")), "page parts ask the motion part, not the media query");
});
