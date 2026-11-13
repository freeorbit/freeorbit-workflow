// The look of ask pages and the inbox, shared by both: a theme (the Claude
// Desktop theme, any palette it bundles, or one of the kit's), an accent
// colour over it, light or dark, density, and text size. Kept in this
// browser for every page. Colours are Claude Desktop's tokens, each an
// "H S% L%" triple, set on <html>; nothing else reaches a style.
window.wfLook = (() => {
  "use strict";
  const get = (k, d) => window.wfAskShared.store.get(k, d);
  const put = (k, v) => window.wfAskShared.store.set(k, v);
  const TRIPLE = /^\d+(\.\d+)?\s+\d+(\.\d+)?%\s+\d+(\.\d+)?%$/;
  const SIZES = { s: ["Small", 0.92], m: ["Default", 1], l: ["Large", 1.08], xl: ["Larger", 1.17] };
  // Each accent has a light and a dark tone, each readable with its text colour.
  const ACCENTS = {
    clay: ["Clay", "15 58% 44%", "15 70% 66%"], teal: ["Teal", "196 64% 31%", "194 58% 60%"], moss: ["Moss", "100 42% 28%", "95 42% 62%"],
    indigo: ["Indigo", "237 50% 50%", "234 85% 80%"], violet: ["Violet", "265 48% 50%", "265 80% 78%"], rose: ["Rose", "345 60% 44%", "345 75% 75%"],
    amber: ["Amber", "32 90% 32%", "38 90% 62%"], sky: ["Sky", "205 80% 35%", "200 85% 68%"], slate: ["Slate", "212 26% 34%", "212 32% 74%"],
  };
  const look = Object.assign({ theme: "", mode: "auto", density: "comfortable", size: "m", accent: "", advance: true, sep: "sections" }, get("wf-ask:look", {}));
  const cache = get("wf-ask:palette-cache", {});
  let palettes = get("wf-ask:palettes", null);
  let kit = { default: "clay", themes: {} };
  let served = false;
  const listeners = [];
  const dark = matchMedia("(prefers-color-scheme: dark)");

  const parse = (t) => t.replace(/%/g, "").split(/\s+/).map(Number);
  function rgbOf(t) {
    const [h, s, l] = parse(t);
    const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
    const f = (n) => { const k = (n + h / 30) % 12; return l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
    return [f(0), f(8), f(4)];
  }
  const lum = (t) => { const c = rgbOf(t).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  /** The text colour that reads best on an accent. */
  const onColor = (t) => (ratio(t, "0 0% 100%") >= ratio(t, "0 0% 8%") ? "0 0% 100%" : "0 0% 8%");
  function hexToTriple(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? "");
    if (!m) return null;
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
    let h = 0;
    if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    const s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
    return [Math.round(((h * 60) + 360) % 360), Math.round(s * 100), Math.round(l * 100)];
  }
  /** The accent for a mode: a preset's tone, or a custom colour moved into a readable lightness. */
  function accentFor(mode) {
    if (ACCENTS[look.accent]) return ACCENTS[look.accent][mode === "dark" ? 2 : 1];
    const hsl = hexToTriple(look.accent);
    if (!hsl) return null;
    const [h, s, l] = hsl;
    const light = mode === "dark" ? Math.min(82, Math.max(60, l)) : Math.min(46, Math.max(24, l));
    return `${h} ${s}% ${light}%`;
  }
  const kitTokens = (mode) => (kit.themes[look.theme] ?? kit.themes[kit.default] ?? Object.values(kit.themes)[0] ?? {})[mode] ?? {};
  const pending = new Set();
  function fetchPalette(id) {
    if (!served || pending.has(id)) return;
    pending.add(id);
    fetch(`/__hub/theme?id=${encodeURIComponent(id)}`, { cache: "no-store" }).then((r) => r.json()).then((t) => {
      if (t?.ok) { cache[id] = { name: t.name, light: t.light, dark: t.dark }; put("wf-ask:palette-cache", cache); apply(); }
    }).catch(() => {}).finally(() => pending.delete(id));
  }
  /** The theme's tokens for a mode, from the Claude Desktop theme, one of its palettes, or the kit. */
  function tokensFor(mode) {
    const id = look.theme || (cache.__active ? "desktop" : "");
    if (id === "desktop") return cache.__active?.[mode] ?? kitTokens(mode);
    if (id.startsWith("cd:")) {
      const one = cache[id.slice(3)];
      if (!one) fetchPalette(id.slice(3));
      return one?.[mode] ?? cache.__active?.[mode] ?? kitTokens(mode);
    }
    return kitTokens(mode);
  }
  function apply() {
    const root = document.documentElement;
    const mode = look.mode === "auto" ? (dark.matches ? "dark" : "light") : look.mode;
    root.dataset.mode = mode;
    root.dataset.density = look.density;
    root.dataset.sep = look.sep;
    const tokens = { ...tokensFor(mode) };
    const accent = accentFor(mode);
    if (accent) { tokens["--accent-brand"] = accent; tokens["--oncolor-100"] = onColor(accent); }
    else if (tokens["--accent-brand"] && TRIPLE.test(tokens["--accent-brand"])) tokens["--oncolor-100"] = tokens["--oncolor-100"] && ratio(tokens["--accent-brand"], tokens["--oncolor-100"]) >= 4.5 ? tokens["--oncolor-100"] : onColor(tokens["--accent-brand"]);
    for (const [k, v] of Object.entries(tokens)) if (/^--[a-z0-9-]+$/.test(k) && TRIPLE.test(v)) root.style.setProperty(k, v);
    root.style.setProperty("--zoom", String((SIZES[look.size] ?? SIZES.m)[1]));
    put("wf-ask:look", look);
    listeners.forEach((f) => f());
  }
  dark.addEventListener("change", () => look.mode === "auto" && apply());
  async function init(themes, isServed) {
    kit = themes ?? kit;
    served = isServed;
    apply();
    if (!served) return;
    try {
      const t = await (await fetch("/__hub/theme", { cache: "no-store" })).json();
      if (t?.ok) cache.__active = { name: t.name, id: t.id, light: t.light, dark: t.dark }; else delete cache.__active;
      const l = await (await fetch("/__hub/themes", { cache: "no-store" })).json();
      palettes = l?.ok ? { active: l.active, list: l.list } : null;
      put("wf-ask:palette-cache", cache);
      put("wf-ask:palettes", palettes);
    } catch { /* the server is away; the kit's themes still work */ }
    apply();
  }
  function choices() {
    return {
      desktop: cache.__active ? cache.__active.name : null,
      palettes: palettes?.list ?? [],
      kit: Object.entries(kit.themes).map(([id, t]) => ({ id, name: t.name })),
      accents: Object.entries(ACCENTS).map(([id, [name, l, d]]) => ({ id, name, light: l, dark: d })),
      sizes: Object.entries(SIZES).map(([id, [name]]) => ({ id, name })),
      current: look.theme || (cache.__active ? "desktop" : kit.default),
    };
  }
  const set = (patch) => { Object.assign(look, patch); apply(); };
  return { init, look, set, choices, onChange: (f) => listeners.push(f) };
})();
