// The scripts a driver runs in the app's page, as strings for
// Runtime.evaluate, and how a run step splits into words. None of them knows
// the app: they find things by what a person reads on the screen.

import { groupName } from "./clickTarget.mjs";

export const PAGE_TEXT = `JSON.stringify({ url: location.href, text: document.body.innerText })`;

// Finds a button, link, list option, or field by its visible text, its aria-label, its
// <label>, or its placeholder. A field's typed value does not count.
// With `within`, only an element inside the closest box that also holds that
// group's label counts, such as a form row "Scheme:" (`click Sage in Scheme`).
export const FIND = (label, within = null) => `(() => {
  const want = ${JSON.stringify(label)}.toLowerCase();
  const group = ${JSON.stringify(within ? groupName(within) : null)};
  const named = (t) => String(t ?? '').trim().replace(/:$/, '').trim().toLowerCase();
  // How many boxes up from n the group's label first shows. Lower is closer.
  const depth = (n) => {
    if (!group) return 0;
    for (let box = n.parentElement, up = 0; box && up < 6; box = box.parentElement, up++) {
      const hit = [...box.querySelectorAll('*')].some((e) => !e.contains(n) && e.children.length === 0 && named(e.textContent) === group);
      if (hit) return up;
    }
    return Infinity;
  };
  const all = [...document.querySelectorAll('button, a, [role=button], [role=option], input, textarea, select, label')];
  const names = (n) => {
    const field = ['INPUT', 'TEXTAREA', 'SELECT'].includes(n.tagName);
    return [
      n.getAttribute('aria-label'),
      field ? [...(n.labels || [])].map((l) => l.innerText).join(' ') : n.innerText,
      n.placeholder,
      !field ? n.value : null,
    ].filter(Boolean).map((t) => t.trim().toLowerCase());
  };
  // Of the elements with that name, the one closest to the group's label wins.
  const closest = (list) => list.map((n) => [depth(n), n]).filter(([d]) => d < Infinity).sort((a, b) => a[0] - b[0])[0]?.[1];
  const node =
    closest(all.filter((n) => names(n).includes(want))) || closest(all.filter((n) => names(n).some((t) => t.includes(want))));
  if (!node) return null;
  return node.tagName === 'LABEL' && node.control ? node.control : node;
})()`;

// Sets a field's value the way React sees a user's typing.
export const SET = (label, value) => `(() => {
  const n = ${FIND(label)};
  if (!n || !('value' in n)) return false;
  const proto = n.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : n.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(n, ${JSON.stringify(value)});
  n.dispatchEvent(new Event('input', { bubbles: true }));
  n.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`;

// The tallest box that scrolls, and how far one window moves it.
export const SCROLLER = `(() => {
  let best = document.scrollingElement;
  let tallest = 0;
  for (const e of document.querySelectorAll('*')) {
    const s = getComputedStyle(e);
    const scrolls = /(auto|scroll)/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 1;
    if (scrolls && e.clientHeight > tallest) { best = e; tallest = e.clientHeight; }
  }
  window.__pageBox = best;
  const r = best === document.scrollingElement ? { left: 0, top: 0, width: innerWidth, height: innerHeight } : best.getBoundingClientRect();
  return JSON.stringify({ max: best.scrollHeight - best.clientHeight, step: best.clientHeight,
    box: [r.left, r.top, r.width, Math.min(r.height, best.clientHeight)].map(Math.round) });
})()`;
export const SCROLL_TO = "(top) => { window.__pageBox.scrollTop = top; }";

// Anything wider than the window that is not inside a box that scrolls.
export const FITS = `(() => {
  const w = innerWidth;
  const out = [];
  const scrolls = (e) => {
    for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (/(auto|scroll)/.test(s.overflowX) && p.clientWidth < w - 50) return true;
    }
    return false;
  };
  for (const e of document.querySelectorAll('body *')) {
    const s = getComputedStyle(e);
    if (s.display === 'none' || s.position === 'fixed') continue;
    const r = e.getBoundingClientRect();
    if (r.width && r.right > w + 1 && !scrolls(e)) out.push(e.tagName.toLowerCase() + ' "' + (e.innerText || '').trim().slice(0, 40) + '" +' + Math.round(r.right - w) + 'px');
  }
  return JSON.stringify(out.slice(0, 8));
})()`;

/** Split one step into words, keeping "quoted words" together. */
export function words(step) {
  const out = [];
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g;
  for (const m of step.matchAll(re)) out.push(m[1] !== undefined ? m[1].replace(/\\"/g, '"') : m[2] ?? m[3]);
  return out;
}

/**
 * The script of an `eval` run step, as written after the word eval, so quotes
 * inside it stay. A script wrapped whole in one pair of quotes, as in
 * `eval "document.title"`, is unwrapped, as words() would.
 */
export function evalSource(step) {
  const rest = step.replace(/^\s*eval\b\s*/, "").trim();
  const one = words(rest);
  return one.length === 1 && /^(["']).*\1$/s.test(rest) ? one[0] : rest;
}

// How long since the page last changed, in ms. The first call starts watching.
export const QUIET = `(() => {
  if (!window.__dlphQuiet) {
    window.__dlphQuiet = { at: performance.now() };
    new MutationObserver(() => { window.__dlphQuiet.at = performance.now(); })
      .observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
  }
  return performance.now() - window.__dlphQuiet.at;
})()`;
