// The config's schema and its reference doc, both made from the defaults, the
// reasons, and the one-line descriptions in descriptions.mjs. `wf docs sync` writes
// them; doc:check fails when either is out of step with the kit.
//
//   .workflow/config.schema.json   an editor shows each key's meaning, default, and reason
//   docs/workflow/config.md        the same, as a doc to read

import { CHOICES, OPEN } from "./config.mjs";
import { DEFAULTS, REASONS } from "./defaults.mjs";
import { DESCRIPTIONS, settingPaths } from "./descriptions.mjs";

export const SCHEMA_FILE = ".workflow/config.schema.json";
export const SCHEMA_LINK = "./config.schema.json";

const at = (path) => path.split(".").reduce((node, part) => node?.[part], DEFAULTS);
const show = (value) => JSON.stringify(value);

/** A setting's words and what each means, as one line, or "" when it takes any value. */
const choicesLine = (path) => (CHOICES[path] ? `One of: ${Object.entries(CHOICES[path]).map(([word, meaning]) => `"${word}" ${meaning}`).join("; ")}.` : "");

/** The text an editor shows on hover: what the setting does, its choices, its default, and why. */
export function hover(path) {
  const parts = [DESCRIPTIONS[path], choicesLine(path), `Default: ${show(at(path))}.`].filter(Boolean);
  if (REASONS[path]) parts.push(`Why: ${REASONS[path]}`);
  return parts.join(" ");
}

function typeOf(value) {
  if (value === null) return {};
  if (Array.isArray(value)) return { type: "array" };
  return { type: typeof value === "object" ? "object" : typeof value };
}

function node(value, path) {
  const schema = { ...typeOf(value), description: hover(path), default: value, ...(CHOICES[path] ? { enum: Object.keys(CHOICES[path]) } : {}) };
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

/** A default as it reads inline, or null when it is too long to read on the setting's own line. */
function inline(value) {
  const text = show(value);
  return text.length <= 40 ? text : null;
}

/** JSON on one line, with a space after each comma and colon. */
function oneLine(value) {
  if (Array.isArray(value)) return `[${value.map(oneLine).join(", ")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    return entries.length ? `{ ${entries.map(([key, inner]) => `${JSON.stringify(key)}: ${oneLine(inner)}`).join(", ")} }` : "{}";
  }
  return JSON.stringify(value);
}

/** JSON two spaces deep, where anything that fits in 72 characters stays on one line. */
function pretty(value, indent = "") {
  const line = oneLine(value);
  if (line.length + indent.length <= 72 || !value || typeof value !== "object") return line;
  const next = `${indent}  `;
  const items = Array.isArray(value) ? value.map((inner) => `${next}${pretty(inner, next)}`) : Object.entries(value).map(([key, inner]) => `${next}${JSON.stringify(key)}: ${pretty(inner, next)}`);
  return Array.isArray(value) ? `[\n${items.join(",\n")}\n${indent}]` : `{\n${items.join(",\n")}\n${indent}}`;
}

/** A heading's anchor, as GitHub makes it. */
const anchor = (text) => text.toLowerCase().replace(/[^a-z0-9 _-]/g, "").replace(/ /g, "-");

/** Text as comment lines at an indent, wrapped near 100 characters, the first after `lead`. */
function comment(text, indent, lead = "") {
  const width = Math.max(40, 100 - indent.length - 3);
  const out = [];
  let line = lead;
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && `${line} ${word}`.length > width) {
      out.push(line);
      line = lead ? " ".repeat(lead.length) : "";
      line = line ? `${line}${word}` : word;
    } else line = line ? (line.endsWith(" ") ? `${line}${word}` : `${line} ${word}`) : word;
  }
  if (line.trim()) out.push(line);
  return out.map((each) => `${indent}// ${each}`);
}

/**
 * The reference doc: a contents list, then one section per top-level group,
 * each its defaults as JSON with comments: what each setting does, the words
 * it takes, and why the default is what it is. It reads as the file a
 * project writes, so a developer copies the part they change.
 */
export function configDoc() {
  const isGroup = (path) => {
    const value = at(path);
    return Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length && !OPEN.has(path));
  };
  const PLAIN = "The project and its team";
  const tops = Object.keys(DEFAULTS).filter(isGroup);
  const lines = [
    "# Settings",
    "",
    "Every setting in `.workflow/config.json`, with its default, as JSON with comments: what each does, and why the default is what it is. A setting left out takes its default, so a project writes only what differs, such as:",
    "",
    "```json",
    '{ "screens": { "runs": { "build": { "show": "screen" } } } }',
    "```",
    "",
    "- **See your values:** `npx wf config` prints the project's own.",
    "- **In your editor:** the same text shows on hover, from `.workflow/config.schema.json`.",
    "- **Do not edit this file:** `npx wf docs sync` writes it from the kit. The real file takes no comments.",
    "",
    "## Contents",
    "",
    `- [${PLAIN}](#${anchor(PLAIN)}): the settings at the top of the file.`,
    ...tops.map((top) => `- [${top}](#${anchor(top)}): ${DESCRIPTIONS[top]}`),
  ];
  /** One setting or group as commented JSON lines at an indent; `last` leaves off the comma. */
  const entry = (path, indent, last) => {
    const key = JSON.stringify(path.split(".").pop());
    const out = [];
    // A section's own line is its heading's paragraph, so its block does not say it again.
    if (DESCRIPTIONS[path] && !tops.includes(path)) out.push(...comment(DESCRIPTIONS[path], indent));
    for (const [word, meaning] of Object.entries(CHOICES[path] ?? {})) out.push(...comment(meaning, indent, `  "${word}": `));
    if (REASONS[path]) out.push(...comment(REASONS[path], indent, "Why: "));
    const comma = last ? "" : ",";
    if (isGroup(path)) {
      const keys = Object.keys(at(path));
      out.push(`${indent}${key}: {`);
      keys.forEach((inner, i) => {
        if (i) out.push("");
        out.push(...entry(`${path}.${inner}`, `${indent}  `, i === keys.length - 1));
      });
      out.push(`${indent}}${comma}`);
    } else {
      const value = pretty(at(path), indent).split("\n");
      value[0] = `${indent}${key}: ${value[0]}`;
      value[value.length - 1] += comma;
      out.push(...value);
    }
    return out;
  };
  const block = (paths) => {
    const out = ["```jsonc"];
    paths.forEach((path, i) => {
      if (i) out.push("");
      out.push(...entry(path, "", i === paths.length - 1));
    });
    out.push("```");
    return out;
  };
  lines.push("", `## ${PLAIN}`, "", ...block(Object.keys(DEFAULTS).filter((key) => !isGroup(key))));
  for (const top of tops) lines.push("", `## ${top}`, "", DESCRIPTIONS[top], "", ...block([top]));
  return `${lines.join("\n")}\n`;
}
