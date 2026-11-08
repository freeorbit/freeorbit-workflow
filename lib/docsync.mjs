// The kit's generic workflow docs, copied into a project with its own parts
// kept. A kit doc marks each project part with a `<!-- wf:local name -->`
// line. In the project's copy that part sits between `<!-- wf:local name -->`
// and `<!-- /wf:local name -->`, and the project edits it in place there.
// `wf docs sync` rewrites everything else from the kit and keeps the parts, and
// doc:check fails a copy that differs from the kit outside them.

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { KIT_ROOT } from "./ai.mjs";

export const KIT_DOCS = path.join(KIT_ROOT, "docs", "workflow");
const SLOT = /^<!-- wf:local ([a-z0-9-]+) -->$/;
// The opening line may carry a note after the name, as earlier versions wrote.
const PART = /^<!-- wf:local ([a-z0-9-]+)(?:: [^\n]*)? -->\n([\s\S]*?)^<!-- \/wf:local \1 -->$/gm;

/** The doc names the kit ships, such as "four-steps". */
export function kitDocs(dir = KIT_DOCS) {
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3)).sort() : [];
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
export function render(name, text, own = new Map()) {
  const out = [
    `<!-- From the freeorbit-workflow kit's docs/workflow/${name}.md. Change this project's parts in place, between their wf:local lines; change the rest in the kit, then run wf docs sync. -->`,
  ];
  for (const line of text.split("\n")) {
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
    const source = path.join(kitDir, `${name}.md`);
    if (!existsSync(source)) {
      unknown.push(`.workflow/config.json: docs.synced names ${name}, which the kit does not ship`);
      continue;
    }
    const text = readFileSync(source, "utf8");
    const file = `${config.docs.workflow}/${name}.md`;
    const own = parts(read(file) ?? "");
    const known = new Set(slots(text));
    for (const [slot, part] of own) if (part && !known.has(slot)) orphans.push(`${file}: a part for ${slot}, which the kit doc no longer has`);
    docs.set(file, render(name, text, own));
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
    writeFileSync(full, text);
    changed.push(file);
  }
  return changed;
}

/** doc:check's problems, reading copies through `read`: a synced name the kit lacks, a part with no slot, a doc missing, and one that differs from the kit outside its parts. */
export function docProblems(config, read, kitDir = KIT_DOCS) {
  if (config.docs.synced?.length === 0) return [];
  const { docs, orphans, unknown } = planDocs(config, read, kitDir);
  const problems = [...unknown, ...orphans];
  for (const [file, text] of docs) {
    const current = read(file);
    if (current === null) problems.push(`${file}: missing, run wf docs sync`);
    else if (current !== text) problems.push(`${file}: differs from the kit outside its wf:local parts; change the kit, or run wf docs sync`);
  }
  return problems;
}
