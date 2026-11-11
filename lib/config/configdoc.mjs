// The config's schema and its reference doc, both made from the defaults, the
// reasons, and the one-line descriptions in descriptions.mjs. `wf docs sync` writes
// them; doc:check fails when either is out of step with the kit.
//
//   .workflow/config.schema.json   an editor shows each key's meaning, default, and reason
//   docs/workflow/config.md        the same, as a doc to read

import { OPEN } from "./config.mjs";
import { DEFAULTS, REASONS } from "./defaults.mjs";
import { DESCRIPTIONS, settingPaths } from "./descriptions.mjs";

export const SCHEMA_FILE = ".workflow/config.schema.json";
export const SCHEMA_LINK = "./config.schema.json";

const at = (path) => path.split(".").reduce((node, part) => node?.[part], DEFAULTS);
const show = (value) => JSON.stringify(value);

/** The text an editor shows on hover: what the setting does, its default, and why. */
export function hover(path) {
  const parts = [DESCRIPTIONS[path], `Default: ${show(at(path))}.`];
  if (REASONS[path]) parts.push(`Why: ${REASONS[path]}`);
  return parts.join(" ");
}

function typeOf(value) {
  if (value === null) return {};
  if (Array.isArray(value)) return { type: "array" };
  return { type: typeof value === "object" ? "object" : typeof value };
}

function node(value, path) {
  const schema = { ...typeOf(value), description: hover(path), default: value };
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if (OPEN.has(path)) {
      schema.additionalProperties = true;
    } else {
      schema.properties = Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, node(inner, `${path}.${key}`)]));
      schema.additionalProperties = false;
    }
  }
  return schema;
}

/** The JSON Schema for .workflow/config.json. */
export function configSchema() {
  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    title: "Workflow kit settings",
    description: "The project's .workflow/config.json. Every key is optional: one left out takes the kit's default. Written by wf docs sync; change the kit, not this file.",
    type: "object",
    properties: { $schema: { type: "string" }, ...Object.fromEntries(Object.entries(DEFAULTS).map(([key, value]) => [key, node(value, key)])) },
    additionalProperties: false,
  };
}

/** The reference doc: one section per top-level group, one bullet per setting. */
export function configDoc() {
  const lines = [
    "# Settings",
    "",
    "Every setting in `.workflow/config.json`, what it does, its default, and why the default is what it is. A setting left out takes the default. Your editor shows the same on hover, from `.workflow/config.schema.json`; `npx wf config` prints the project's values.",
    "",
    "This doc is written by `npx wf docs sync` from the kit. Change the kit, not this file.",
  ];
  const paths = settingPaths(DEFAULTS, OPEN);
  const isGroup = (path) => {
    const value = at(path);
    return Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length && !OPEN.has(path));
  };
  const bullet = (path) => {
    lines.push(`- **\`${path}\`**, default \`${show(at(path))}\`. ${DESCRIPTIONS[path]}`);
    if (REASONS[path]) lines.push(`  - Why: ${REASONS[path]}`);
  };
  // The plain settings at the top come first, together; each group of settings has its own section.
  lines.push("", "## The project and its team", "");
  for (const top of Object.keys(DEFAULTS).filter((key) => !isGroup(key))) bullet(top);
  for (const top of Object.keys(DEFAULTS).filter(isGroup)) {
    lines.push("", `## ${top}`, "", DESCRIPTIONS[top], "");
    for (const path of paths.filter((p) => p.startsWith(`${top}.`) && !isGroup(p))) bullet(path);
  }
  return `${lines.join("\n")}\n`;
}
