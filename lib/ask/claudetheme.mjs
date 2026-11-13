// The Claude Desktop theme on this machine, so an ask page can look like the
// app beside it. Claude Desktop colours itself with tokens such as --bg-100
// and --accent-brand, each an "H S% L%" triple, in its own stylesheet; the
// claude-desktop-extra package swaps them for a palette named by activeTheme
// in its config. This reads both, read only, from the installed app, and
// copies nothing into the kit. Any part it cannot find leaves the page on
// the kit's own themes.

import { existsSync, openSync, readFileSync, readSync, closeSync, statSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

/** The token names a page takes from a theme; anything else is dropped. */
export const TOKENS = [
  "--bg-000", "--bg-100", "--bg-200", "--bg-300", "--bg-400", "--bg-500",
  "--text-000", "--text-100", "--text-200", "--text-300", "--text-400", "--text-500",
  "--border-100", "--border-200", "--border-300", "--border-400",
  "--accent-brand", "--accent-000", "--oncolor-100",
  "--danger-100", "--warning-100", "--success-100",
];
const TRIPLE = /^\d+(\.\d+)?\s+\d+(\.\d+)?%\s+\d+(\.\d+)?%$/;

/** Only known tokens with a plain "H S% L%" value, so nothing else reaches a style. */
export function cleanTokens(map) {
  const out = {};
  for (const key of TOKENS) {
    const value = typeof map?.[key] === "string" ? map[key].trim() : "";
    if (TRIPLE.test(value)) out[key] = value;
  }
  return out;
}

/** Where Claude Desktop keeps its app files and its config, on this system. */
export function claudePaths(env = process.env, os = platform()) {
  const resources = env.WF_CLAUDE_RESOURCES
    ? [env.WF_CLAUDE_RESOURCES]
    : os === "darwin"
      ? ["/Applications/Claude.app/Contents/Resources", join(homedir(), "Applications/Claude.app/Contents/Resources")]
      : ["/usr/lib/claude-desktop/resources", "/opt/Claude/resources", "/usr/lib/claude/resources"];
  const config = env.WF_CLAUDE_CONFIG ?? (os === "darwin" ? join(homedir(), "Library/Application Support/Claude") : join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "Claude"));
  return { resources: resources.find((dir) => existsSync(join(dir, "app.asar"))) ?? null, config };
}

/** Each file in an asar archive: `{ path, read() }`. */
export function asarFiles(file) {
  const fd = openSync(file, "r");
  try {
    const head = Buffer.alloc(16);
    readSync(fd, head, 0, 16, 0);
    const json = Buffer.alloc(head.readUInt32LE(12));
    readSync(fd, json, 0, json.length, 16);
    const base = 8 + head.readUInt32LE(4);
    const out = [];
    const walk = (node, at) => {
      for (const [name, entry] of Object.entries(node.files ?? {})) {
        const path = at ? `${at}/${name}` : name;
        if (entry.files) walk(entry, path);
        else if (!entry.unpacked && Number(entry.size) < 40e6) out.push({ path, size: Number(entry.size), offset: base + Number(entry.offset) });
      }
    };
    walk(JSON.parse(json.toString("utf8")), "");
    return out.map((each) => ({
      ...each,
      read() {
        const handle = openSync(file, "r");
        try {
          const buf = Buffer.alloc(each.size);
          readSync(handle, buf, 0, each.size, each.offset);
          return buf.toString("utf8");
        } finally {
          closeSync(handle);
        }
      },
    }));
  } finally {
    closeSync(fd);
  }
}

/** The JSON object that starts at `text[at]`, by matching braces outside strings. */
export function objectAt(text, at) {
  let depth = 0;
  let inString = false;
  for (let i = at; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return JSON.parse(text.slice(at, i + 1));
  }
  return null;
}

/** Claude's own light and dark tokens, from the stylesheet in ion-dist.asar. */
export function stockTokens(resources) {
  const file = join(resources, "ion-dist.asar");
  if (!existsSync(file)) return null;
  const css = asarFiles(file).filter((each) => each.path.endsWith(".css")).map((each) => each.read()).find((text) => text.includes("[data-theme=claude][data-mode=dark]{"));
  if (!css) return null;
  const block = (selector) => {
    const at = css.indexOf(`${selector}{`);
    if (at < 0) return {};
    const body = css.slice(at + selector.length + 1, css.indexOf("}", at));
    return Object.fromEntries([...body.matchAll(/(--[a-z0-9-]+):([^;]+)/g)].map((m) => [m[1], m[2]]));
  };
  const light = cleanTokens(block("[data-theme=claude],[data-theme=claude][data-mode=light]"));
  const dark = cleanTokens(block("[data-theme=claude][data-mode=dark]"));
  return Object.keys(light).length && Object.keys(dark).length ? { light, dark } : null;
}

/** The theme claude-desktop-extra's config names, or "" for Claude's own. */
export function activeTheme(config) {
  let name = "";
  for (const file of ["claude-desktop-extra.json", "claude-desktop-extra.jsonc"]) {
    const path = join(config, file);
    if (!existsSync(path)) continue;
    // Comments are stripped line by line, outside strings well enough for this one key.
    const text = readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const match = text.match(/"activeTheme"\s*:\s*"([^"]*)"/);
    if (match) name = match[1];
  }
  return name;
}

/** Every palette bundled in the app (claude-desktop-extra's built-ins and community ones), by id. */
export function allPalettes(resources) {
  const main = asarFiles(join(resources, "app.asar")).find((each) => each.path === ".vite/build/index.js");
  if (!main) return {};
  const text = main.read();
  const out = {};
  for (const m of text.matchAll(/"([a-z0-9][a-z0-9-]{0,60})":\{"(?:name|light|dark|spinner)"/g)) {
    if (out[m[1]]) continue;
    try {
      const palette = objectAt(text, m.index + m[1].length + 3);
      const light = cleanTokens(palette?.light ?? palette?.dark);
      const dark = cleanTokens(palette?.dark ?? palette?.light);
      if (light["--bg-100"] && dark["--bg-100"]) out[m[1]] = { name: typeof palette.name === "string" ? palette.name : m[1].split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" "), light, dark };
    } catch {
      // Not a palette.
    }
  }
  return out;
}

let cache = { stamp: "", value: null };

/** Everything read from the install, once per change of the app or its config. */
function load(env) {
  const { resources, config } = claudePaths(env);
  if (!resources) return null;
  const stamp = ["app.asar", "ion-dist.asar"].map((f) => (existsSync(join(resources, f)) ? statSync(join(resources, f)).mtimeMs : 0))
    .concat(["claude-desktop-extra.json", "claude-desktop-extra.jsonc"].map((f) => (existsSync(join(config, f)) ? statSync(join(config, f)).mtimeMs : 0)), resources, config).join();
  if (cache.stamp === stamp) return cache.value;
  let value = null;
  try {
    const stock = stockTokens(resources);
    if (stock) value = { stock, active: activeTheme(config), palettes: allPalettes(resources) };
  } catch {
    value = null;
  }
  cache = { stamp, value };
  return value;
}

/**
 * A Claude Desktop theme as `{ name, id, light, dark }`, each a token map
 * with the stock tokens under the palette's: the one its config makes active,
 * or the palette `id` names ("claude" for the stock look). Null when Claude
 * Desktop is not found, or no such palette.
 */
export function claudeTheme(env = process.env, id = "") {
  const all = load(env);
  if (!all) return null;
  const want = id || all.active || "claude";
  if (want === "claude") return { name: "Claude", id: "claude", light: { ...all.stock.light }, dark: { ...all.stock.dark } };
  const palette = all.palettes[want];
  if (!palette) return id ? null : { name: "Claude", id: "claude", light: { ...all.stock.light }, dark: { ...all.stock.dark } };
  return { name: palette.name, id: want, light: { ...all.stock.light, ...palette.light }, dark: { ...all.stock.dark, ...palette.dark } };
}

/** The palettes Claude Desktop offers, `[{ id, name }]`, the stock look first, then by name; and the active one's id. */
export function claudePalettes(env = process.env) {
  const all = load(env);
  if (!all) return null;
  const list = Object.entries(all.palettes).map(([id, p]) => ({ id, name: p.name })).sort((a, b) => a.name.localeCompare(b.name));
  return { active: all.active && all.palettes[all.active] ? all.active : "claude", list: [{ id: "claude", name: "Claude" }, ...list] };
}
