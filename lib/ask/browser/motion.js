// How ask pages and the inbox move, in one place: one rhythm of timings and
// one curve, and the few moves every part uses. Things glide to a new place
// instead of jumping, come in and go out instead of popping, and charts draw
// themselves in. Only position, size, and opacity move, so a long page stays
// smooth; nothing waits on a move, since each runs after the change is made.
//
// The person's Motion setting (look.js) resolves to `data-motion` on <html>:
// full, subtle (fades, no movement), or off. Its default, System, is off when
// the computer asks for reduced motion; a page's `off: ["motion"]` is off
// whatever was chosen.
window.wfMotion = (() => {
  "use strict";
  const root = document.documentElement;
  /** The timings every move uses, in ms: a press, a change of place, and an entrance. */
  const DUR = { quick: 140, base: 220, slow: 320 };
  const EASE = "cubic-bezier(0.23, 1, 0.32, 1)";
  /** 2 full, 1 subtle (fades only), 0 off. */
  const level = () => (root.dataset.motion === "off" ? 0 : root.dataset.motion === "subtle" ? 1 : 2);
  const run = (el, frames, duration, extra = {}) => el.animate(frames, { duration, easing: EASE, ...extra });

  /**
   * Make a change, and let what moved glide from where it was. `els` gives
   * the elements to follow, and `keyOf` what makes two of them the same
   * thing, so an element drawn anew still glides from its old place. One
   * that is new comes in.
   */
  function glide(els, change, keyOf = (el) => el) {
    if (level() < 2) { change(); return; }
    const before = new Map();
    for (const el of els()) before.set(keyOf(el), el.getBoundingClientRect());
    change();
    for (const el of els()) {
      const was = before.get(keyOf(el));
      // On a first draw nothing was there to move from, and nothing comes in.
      if (!was) { if (before.size) enter(el); continue; }
      const now = el.getBoundingClientRect();
      const dx = was.left - now.left;
      const dy = was.top - now.top;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
      run(el, [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], DUR.base);
    }
  }

  /** Come in: a fade, and in full motion a short rise, or a slide from a side. */
  function enter(el, { from = "below", duration = DUR.base } = {}) {
    const l = level();
    if (!l || !el?.animate) return;
    const offset = { below: "translateY(6px)", left: "translateX(-16px)", right: "translateX(16px)" }[from];
    run(el, l === 2 ? [{ opacity: 0, transform: offset }, { opacity: 1, transform: "none" }] : [{ opacity: 0 }, { opacity: 1 }], duration);
  }

  /** Go out, then `done`: a fade, and in full motion a small drop. */
  function leave(el, done) {
    const l = level();
    if (!l || !el?.animate) { done(); return; }
    const a = run(el, l === 2 ? [{ opacity: 1 }, { opacity: 0, transform: "translateY(-4px)" }] : [{ opacity: 1 }, { opacity: 0 }], DUR.quick, { fill: "forwards" });
    a.onfinish = () => { done(); a.cancel(); };
  }

  /** Show or hide an element by opening or closing its height, so what is below moves smoothly. `apply(shown)` makes the change. */
  function reveal(el, shown, apply) {
    const l = level();
    if (!l || !el?.animate) { apply(shown); return; }
    if (shown) {
      apply(true);
      const h = el.offsetHeight;
      run(el, [{ height: "0px", opacity: 0, overflow: "clip" }, { height: `${h}px`, opacity: 1, overflow: "clip" }], DUR.slow);
    } else {
      const h = el.offsetHeight;
      const a = run(el, [{ height: `${h}px`, opacity: 1, overflow: "clip" }, { height: "0px", opacity: 0, overflow: "clip" }], DUR.base, { fill: "forwards" });
      a.onfinish = () => { apply(false); a.cancel(); };
    }
  }

  /** Count a number in a piece of text from what it was to what it is, such as "7 of 12" from "3 of 12". */
  function count(el, from, to) {
    const num = (s) => { const m = /-?\d[\d,]*(\.\d+)?/.exec(String(s)); return m ? { n: Number(m[0].replace(/,/g, "")), at: m.index, len: m[0].length, dp: (m[1] ?? "").length > 0 ? m[1].length - 1 : 0 } : null; };
    const a = num(from);
    const b = num(to);
    if (!level() || !a || !b || a.n === b.n || String(from).replace(/-?\d[\d,]*(\.\d+)?/, "#") !== String(to).replace(/-?\d[\d,]*(\.\d+)?/, "#")) return;
    const start = performance.now();
    const text = String(to);
    const step = (t) => {
      const p = Math.min(1, (t - start) / DUR.slow);
      const eased = 1 - (1 - p) ** 3;
      const v = a.n + (b.n - a.n) * eased;
      el.textContent = p < 1 ? `${text.slice(0, b.at)}${v.toLocaleString(undefined, { minimumFractionDigits: b.dp, maximumFractionDigits: b.dp })}${text.slice(b.at + b.len)}` : text;
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /** A chart draws itself in: bars grow from their baseline, lines run from the left. */
  function drawIn(svg) {
    if (!level() || !svg) return;
    if (level() === 1) { run(svg, [{ opacity: 0 }, { opacity: 1 }], DUR.base); return; }
    svg.querySelectorAll(".viz-marks path[data-bar]").forEach((bar, i) => {
      bar.style.transformBox = "fill-box";
      bar.style.transformOrigin = bar.dataset.bar === "down" ? "top" : "bottom";
      run(bar, [{ transform: "scaleY(0)" }, { transform: "scaleY(1)" }], DUR.slow, { delay: Math.min(i * 18, 240), fill: "backwards" });
    });
    svg.querySelectorAll("path[data-line]").forEach((line) => {
      const len = line.getTotalLength?.() ?? 0;
      if (!len) return;
      run(line, [{ strokeDasharray: `${len}`, strokeDashoffset: `${len}` }, { strokeDasharray: `${len}`, strokeDashoffset: "0" }], DUR.slow * 2);
    });
    // A diagram's boxes come in one after another, then its arrows draw between them.
    svg.querySelectorAll("[data-box]").forEach((box, i) => run(box, [{ opacity: 0, transform: "translateY(4px)" }, { opacity: 1, transform: "none" }], DUR.base, { delay: Math.min(i * 40, 400), fill: "backwards" }));
    svg.querySelectorAll("[data-fade]").forEach((el) => run(el, [{ opacity: 0 }, { opacity: 1 }], DUR.slow, { delay: DUR.slow, fill: "backwards" }));
  }

  /** A change to the whole page, such as a theme, as one cross-fade where the browser can. */
  function whole(change) {
    if (level() && document.startViewTransition) document.startViewTransition(change);
    else change();
  }

  return { DUR, EASE, level, glide, enter, leave, reveal, count, drawIn, whole };
})();
