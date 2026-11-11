import assert from "node:assert/strict";
import { test } from "node:test";

import { OPEN } from "../lib/config/config.mjs";
import { configDoc, configSchema, hover } from "../lib/config/configdoc.mjs";
import { DEFAULTS, REASONS } from "../lib/config/defaults.mjs";
import { DESCRIPTIONS, settingPaths } from "../lib/config/descriptions.mjs";

test("every setting has a description, and every description names a setting", () => {
  const paths = settingPaths(DEFAULTS, OPEN);
  const missing = paths.filter((path) => !DESCRIPTIONS[path]);
  assert.deepEqual(missing, [], `add a line to lib/config/descriptions.mjs for: ${missing.join(", ")}`);
  const stray = Object.keys(DESCRIPTIONS).filter((path) => !paths.includes(path));
  assert.deepEqual(stray, [], `lib/config/descriptions.mjs describes settings the defaults do not have: ${stray.join(", ")}`);
  const loose = Object.keys(REASONS).filter((path) => !paths.includes(path));
  assert.deepEqual(loose, [], `REASONS names settings the defaults do not have: ${loose.join(", ")}`);
});

test("the schema closes every group but the open maps, and carries the meaning, default, and reason", () => {
  const schema = configSchema();
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.design.additionalProperties, false);
  assert.equal(schema.properties.design.properties.kinds.additionalProperties, true);
  assert.equal(schema.properties.decisions.additionalProperties, true);
  assert.deepEqual(schema.properties.design.properties.size.default, [1280, 800]);
  assert.match(schema.properties.design.properties.size.description, /exported at.*Default: \[1280,800\]\. Why: /);
  assert.ok(schema.properties.$schema);
  assert.match(hover("team"), /^"solo" for one person.*Default: "solo"\./);
});

test("the reference doc lists every setting once", () => {
  const doc = configDoc();
  for (const path of settingPaths(DEFAULTS, OPEN)) {
    const value = path.split(".").reduce((node, part) => node?.[part], DEFAULTS);
    const group = value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length && !OPEN.has(path);
    if (group) continue;
    assert.equal(doc.split(`- **\`${path}\`**,`).length - 1, 1, path);
  }
});

/** Enough of JSON Schema for the kit's: type, properties, and additionalProperties. Returns the paths that fail. */
function invalid(schema, value, path = "") {
  const kind = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  if (schema.type && schema.type !== kind && !(schema.type === "number" && kind === "number")) return [`${path || "(root)"}: ${kind}, not ${schema.type}`];
  if (kind !== "object") return [];
  return Object.entries(value).flatMap(([key, inner]) => {
    const child = schema.properties?.[key];
    if (!child) return schema.additionalProperties === false ? [`${path}${path ? "." : ""}${key}: not allowed`] : [];
    return invalid(child, inner, `${path}${path ? "." : ""}${key}`);
  });
}

test("the kit's defaults and real configs pass the schema, and an empty default is always an open map", async () => {
  const schema = configSchema();
  assert.deepEqual(invalid(schema, DEFAULTS), []);
  const { configFrom } = await import("../lib/setup/init.mjs");
  const atlas = configFrom({
    project: "Atlas NX", team: "team",
    people: [{ name: "Ana", handle: "ana", email: "ana@example.com", roles: ["owner", "designer", "developer", "reviewer"] }],
    areas: [{ id: "app", prefix: "APP", docs: "docs/app" }],
    plugins: ["core"], kit: { tag: "v9.9.9" },
    config: { design: { source: "png", size: [1440, 960], kinds: { idea: { color: "#00f", word: "idea", use: "a new idea" } } }, app: { kind: "web", web: { url: "http://x/", sizes: { phone: [360, 780] } }, databases: { main: "postgresql://x" } }, decisions: { custom: "owner" } },
  });
  assert.deepEqual(invalid(schema, atlas), []);
  assert.deepEqual(invalid(schema, { design: { sise: [1, 2] } }), ["design.sise: not allowed"]);
  const { unknownKeys } = await import("../lib/config/config.mjs");
  assert.deepEqual(unknownKeys({ $schema: "./config.schema.json", design: { $schema: "x" } }), ["design.$schema"]);
  const empty = [];
  const walk = (node, prefix) => {
    for (const [key, value] of Object.entries(node)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (value && typeof value === "object" && !Array.isArray(value)) {
        if (!Object.keys(value).length && !OPEN.has(path)) empty.push(path);
        walk(value, path);
      }
    }
  };
  walk(DEFAULTS, "");
  assert.deepEqual(empty, [], "an empty {} default would reject every key; add it to OPEN in lib/config/config.mjs");
});
