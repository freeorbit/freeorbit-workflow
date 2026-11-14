// Every part of an ask page lives in several places: the check, the page's
// drawing, the fields line, the skill's reference, and an example. This test
// names the place a new template, question type, or block was left out of.
// It costs one file to keep; if no part is added for half a year, drop it.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { BLOCK_KINDS, RICH_TYPES } from "../lib/ask/blocks.mjs";
import { BLOCK_FIELDS, fieldsOf, TYPE_FIELDS } from "../lib/ask/fields.mjs";
import { pageScript } from "../lib/ask/page.mjs";
import { ITEM_FIELDS, normalize, TEMPLATES, TYPES } from "../lib/ask/spec.mjs";

const skill = join(dirname(fileURLToPath(import.meta.url)), "../plugins/core/skills/ask-page");
const read = (file) => readFileSync(join(skill, file), "utf8");
const specs = ["examples", "blocks", "answers"].flatMap((dir) => readdirSync(join(skill, dir)).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(read(`${dir}/${f}`))));
const script = pageScript();
const missing = (parts, has) => parts.filter((part) => !has(part));

test("every block kind has its drawing, its fields line, its reference row, and an example", () => {
  const drawn = BLOCK_KINDS.filter((kind) => !["questions", "part"].includes(kind));
  assert.deepEqual(missing(drawn, (kind) => new RegExp(`\\n    ${kind}: \\{ name: "`).test(script)), [], "drawn in the page's BLOCKS record");
  assert.deepEqual(missing(BLOCK_KINDS, (kind) => BLOCK_FIELDS[kind] && fieldsOf(kind)), [], "listed by wf ask fields");
  assert.deepEqual(missing(BLOCK_KINDS, (kind) => read("reference/blocks.md").includes(`| \`${kind}\` |`)), [], "a row in reference/blocks.md");
  const used = JSON.stringify(specs);
  assert.deepEqual(missing(BLOCK_KINDS, (kind) => used.includes(`"type":"${kind}"`)), [], "used in an example");
});

test("every question type has its drawing, its fields line, its reference, and an example", () => {
  assert.deepEqual(missing(TYPES, (type) => script.includes(`q.type === "${type}"`)), [], "drawn by the page");
  assert.deepEqual(missing(TYPES, (type) => TYPE_FIELDS[type] && fieldsOf(type)), [], "listed by wf ask fields");
  assert.deepEqual(missing(RICH_TYPES, (type) => read("reference/answer-types.md").includes(`| \`${type}\` |`)), [], "a row in reference/answer-types.md");
  assert.deepEqual(missing(TYPES.filter((type) => !RICH_TYPES.includes(type)), (type) => read("SKILL.md").includes(`\`${type}\``)), [], "named in SKILL.md");
  const asked = new Set(specs.filter((raw) => raw.title).flatMap((raw) => normalize(raw, {}, { parts: { "release-checks": [] } }).spec?.questions.map((q) => q.type) ?? []));
  assert.deepEqual(missing(TYPES, (type) => asked.has(type)), [], "asked in an example");
});

test("every template has its items' fields, its reference row, its place in the skill's table, and an example", () => {
  const names = Object.keys(TEMPLATES);
  assert.deepEqual(missing(names, (name) => TEMPLATES[name].asWritten || ITEM_FIELDS[name]), [], "its items' fields, for the unknown-field check");
  assert.deepEqual(missing(names, (name) => read("reference/templates.md").includes(`| \`${name}\` |`)), [], "a row in reference/templates.md");
  assert.deepEqual(missing(names, (name) => read("SKILL.md").includes(`\`${name}\``)), [], "named in SKILL.md's table");
  assert.deepEqual(missing(names, (name) => specs.some((raw) => raw.template === name)), [], "an example");
});
