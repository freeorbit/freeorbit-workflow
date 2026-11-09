// The kit's generic docs, copied into a project with its own parts kept: the
// workflow docs into docs.workflow, and the root ones, such as AGENTS.md, into
// the project's root. A kit doc marks each project part with a `<!-- wf:local name -->`
// line. In the project's copy that part sits between `<!-- wf:local name -->`
// and `<!-- /wf:local name -->`, and the project edits it in place there.
// `wf docs sync` rewrites everything else from the kit and keeps the parts, and
// doc:check fails a copy that differs from the kit outside them. A kit doc may
// name a config value as {{key.path}}, and may hold the Who decides block, which
// is written from the roles. The docs index gets its kit tables between
// `<!-- wf:index name -->` lines, as index.mjs writes them.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { KIT_ROOT } from "./ai.mjs";
import { indexProblems, withIndex } from "./index.mjs";
import { BLOCK_END, BLOCK_START, rolesBlock } from "./roles.mjs";
import { withUnion } from "./union.mjs";

export const KIT_DOCS = path.join(KIT_ROOT, "docs");
const GROUPS = ["workflow", "root"];
const VALUE = /\{\{([^{}\n]*)\}\}/g;
const KEY = /^[A-Za-z][\w-]*(\.[A-Za-z][\w-]*)*$/;
const SLOT = /^<!-- wf:local ([a-z0-9-]+) -->$/;
// The opening line may carry a note after the name, as earlier versions wrote.
const PART = /^<!-- wf:local ([a-z0-9-]+)(?:: [^\n]*)? -->\n([\s\S]*?)^<!-- \/wf:local \1 -->$/gm;

/** The doc names the kit ships: a workflow doc by its name, such as "four-steps", and a root one as "root/AGENTS". */
export function kitDocs(dir = KIT_DOCS) {
  return GROUPS.flatMap((group) => {
    const folder = path.join(dir, group);
    if (!existsSync(folder)) return [];
    const names = readdirSync(folder).filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3)).sort();
    return names.map((name) => (group === "workflow" ? name : `${group}/${name}`));
  });
}

/** Where a kit doc comes from in the kit, and where it goes in the project. */
export function placeOf(config, name, dir = KIT_DOCS) {
  const [group, base] = name.includes("/") ? name.split("/") : ["workflow", name];
  const into = { workflow: config.docs.workflow, root: "" }[group];
  return { name, source: path.join(dir, group, `${base}.md`), file: into ? `${into}/${base}.md` : `${base}.md`, kitPath: `docs/${group}/${base}.md` };
}

/** A kit doc with its Who decides block cut to the start marker, which render fills from the roles. */
export function withoutRoles(text) {
  const start = text.indexOf(BLOCK_START);
  const end = text.indexOf(BLOCK_END, start);
  if (start < 0) return text;
  if (end < 0) throw new Error(`a ${BLOCK_START} line with no ${BLOCK_END}`);
  return text.slice(0, start + BLOCK_START.length) + text.slice(end + BLOCK_END.length);
}

/** A kit doc's {{key.path}} values filled from the config; a missing one is an error. */
export function fill(text, config) {
  return text.replace(VALUE, (_, key) => {
    if (!KEY.test(key)) throw new Error(`the kit doc has {{${key}}}, which is not a config key`);
    const value = key.split(".").reduce((at, part) => at?.[part], config);
    if (typeof value !== "string" || !value) throw new Error(`the kit doc names {{${key}}}, which the config does not set`);
    // A value is one line, so it can never start a marker line of its own.
    if (/[\n\r]/.test(value)) throw new Error(`the config value for {{${key}}} holds a line break`);
    return value;
  });
}

/** The slot names a kit doc has, in order. */
export function slots(text) {
  return text.split("\n").flatMap((line) => line.match(SLOT)?.[1] ?? []);
}

/** The project's parts in its copy of a doc, by slot name; each ends without a trailing newline. */
export function parts(text) {
  return new Map([...text.matchAll(PART)].map((match) => [match[1], match[2].replace(/\n+$/, "")]));
}

/** A kit doc with each slot holding the project's part, or an empty pair where it has none. */
export function render(name, text, own = new Map(), config = null, kitPath = `docs/workflow/${name}.md`) {
  const how = slots(text).length
    ? "Change this project's parts in place, between their wf:local lines; change the rest in the kit, then run wf docs sync."
    : "Change it in the kit, then run wf docs sync.";
  const out = [`<!-- From the freeorbit-workflow kit's ${kitPath}. ${how} -->`];
  const filled = config ? fill(text, config) : text;
  const roles = config && filled.includes(BLOCK_START) ? rolesBlock(config) : null;
  for (const line of filled.split("\n")) {
    if (roles && line === BLOCK_START) {
      out.push(roles);
      continue;
    }
    const slot = line.match(SLOT)?.[1];
    if (!slot) out.push(line);
    else out.push(`<!-- wf:local ${slot} -->`, ...(own.get(slot) ? [own.get(slot)] : []), `<!-- /wf:local ${slot} -->`);
  }
  return out.join("\n");
}

/** A reader of the project's files from disk: a path's text, or null when there is none. */
export const fromDisk = (root) => (file) => {
  const full = path.join(root, file);
  return existsSync(full) ? readFileSync(full, "utf8") : null;
};

/**
 * What sync would write for each synced doc, given `read` for the project's current copies.
 * Also returns each project part whose slot the kit doc no longer has, and each synced name the kit does not ship.
 */
export function planDocs(config, read, kitDir = KIT_DOCS) {
  const names = config.docs.synced ?? kitDocs(kitDir);
  const docs = new Map();
  const orphans = [];
  const unknown = [];
  for (const name of names) {
    const { source, file, kitPath } = placeOf(config, name, kitDir);
    if (!existsSync(source)) {
      unknown.push(`.workflow/config.json: docs.synced names ${name}, which the kit does not ship`);
      continue;
    }
    // The roles block is written, never kept, so its lines are not read back as a part.
    const text = withoutRoles(readFileSync(source, "utf8"));
    const own = parts(read(file) ?? "");
    const known = new Set(slots(text));
    for (const [slot, part] of own) if (part && !known.has(slot)) orphans.push(`${file}: a part for ${slot}, which the kit doc no longer has`);
    try {
      docs.set(file, render(name, text, own, config, kitPath));
    } catch (error) {
      unknown.push(`${kitPath}: ${error.message}`);
    }
  }
  return { docs, orphans, unknown };
}

/** Write each synced doc; returns the paths that changed. Refuses while a part would be lost. */
export function syncDocs(root, config, kitDir = KIT_DOCS) {
  const { docs, orphans, unknown } = planDocs(config, fromDisk(root), kitDir);
  if (unknown.length) throw new Error(unknown.join("; "));
  if (orphans.length) throw new Error(`${orphans.join("; ")}: move that text into another part, or delete it`);
  const changed = [];
  for (const [file, text] of docs) {
    const full = path.join(root, file);
    if (existsSync(full) && readFileSync(full, "utf8") === text) continue;
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, text);
    changed.push(file);
  }
  const index = path.join(root, config.docs.index);
  if (existsSync(index)) {
    const text = readFileSync(index, "utf8");
    const next = withIndex(text, config, fromDisk(root), kitDocs(kitDir).map((name) => placeOf(config, name, kitDir)));
    if (next !== text) {
      writeFileSync(index, next);
      changed.push(config.docs.index);
    }
  }
  const attributes = path.join(root, ".gitattributes");
  const union = withUnion(existsSync(attributes) ? readFileSync(attributes, "utf8") : null, config);
  if (union !== null) {
    writeFileSync(attributes, union);
    changed.push(".gitattributes");
  }
  return changed;
}

/** doc:check's problems, reading copies through `read`: a synced name the kit lacks, a part with no slot, a doc missing, and one that differs from the kit outside its parts. */
export function docProblems(config, read, kitDir = KIT_DOCS) {
  if (config.docs.synced?.length === 0) return [];
  const { docs, orphans, unknown } = planDocs(config, read, kitDir);
  const problems = [...unknown, ...orphans];
  problems.push(...indexProblems(config, read, kitDocs(kitDir).map((name) => placeOf(config, name, kitDir))));
  if (withUnion(read(".gitattributes"), config) !== null) problems.push(".gitattributes: its wf:union block is missing or out of date, run wf docs sync");
  for (const [file, text] of docs) {
    const current = read(file);
    if (current === null) problems.push(`${file}: missing, run wf docs sync`);
    else if (current !== text) problems.push(`${file}: differs from the kit outside its wf:local parts; change the kit, or run wf docs sync`);
  }
  return problems;
}
