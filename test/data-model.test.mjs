import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { merge } from "../lib/config/config.mjs";
import { DEFAULTS } from "../lib/config/defaults.mjs";
import { DATA_MODEL_SINCE, problems, warnings } from "../lib/docs/check.mjs";

const TEMPLATE = readFileSync(new URL("../templates/data-model.md", import.meta.url), "utf8");

/** A project whose app area finished Step 3 on `done`, with these files. */
function context(done, texts = {}) {
  const order = `# Build order\n\n## Areas\n\n| Area | Stories | Frames | Architecture | Build |\n| --- | --- | --- | --- | --- |\n| [app](build-order/app.md) | Done 2026-11-01 | Done 2026-11-02 | ${done} | Not started |\n| [jobs](build-order/jobs.md) | Done 2026-11-01 | Not started | In progress 2026-11-20 | Not started |\n`;
  const files = { "docs/log/build-order.md": order, ...texts };
  return {
    root: "/project",
    config: merge(DEFAULTS, { areas: [{ id: "app", prefix: "APP", docs: "docs/app" }, { id: "jobs", prefix: "JOB", docs: "docs/jobs" }], review: { threatModel: "", hotPaths: "" } }),
    tracked: Object.keys(files),
    files: (path) => files[path],
  };
}
const about = (lines) => lines.filter((line) => line.includes("data model"));

test("an area past Step 3 since v1.9.0 needs its data model, and the template does not count", async () => {
  assert.deepEqual(about(await problems(context(`Done ${DATA_MODEL_SINCE}`), "2026-12-01")), ["docs/app/data-model.md: app is past Step 3 and has no data model; draft it from the kit's templates/data-model.md, or say in one line that it stores nothing"]);
  assert.deepEqual(about(await problems(context("Done 2026-12-01", { "docs/app/data-model.md": TEMPLATE }), "2026-12-01")), ["docs/app/data-model.md: app is past Step 3, and its data model is still the kit's empty template"]);
  assert.deepEqual(about(await problems(context("Done 2026-12-01", { "docs/app/data-model.md": "# App: data model\n\nThis area stores nothing: it only shows the register's data.\n" }), "2026-12-01")), [], "one line saying it stores nothing is enough");
});

test("an area past Step 3 before v1.9.0, or with no date, is warned, so an upgrade fails nothing", async () => {
  for (const done of ["Done 2026-11-10", "Done"]) {
    assert.deepEqual(about(await problems(context(done), "2026-12-01")), [], done);
    assert.equal(about(warnings(context(done))).length, 1, done);
  }
  assert.deepEqual(about(warnings(context("In progress 2026-11-20"))), [], "an area still in Step 3 is not asked yet");
});

test("a data model reads at a glance: At a glance first, diagrams of twelve tables or fewer, and parts in files past 25 tables", async () => {
  const { modelShape, DIAGRAM_TABLES, MODEL_TABLES } = await import("../lib/docs/check.mjs");
  const diagram = (lines) => ["```mermaid", "erDiagram", ...lines, "```"].join("\n");
  const chain = (n) => Array.from({ length: n - 1 }, (_, i) => `  t${i} ||--o{ t${i + 1} : has`);
  const model = (...parts) => ["# App: data model", "", "## At a glance", "", "- **Store.** SQLite.", "", ...parts].join("\n");
  const sizes = (text) => modelShape("m.md", text).map((line) => line.match(/a diagram of (\d+) tables/)?.[1]).filter(Boolean).map(Number);
  // Each row: a diagram, and the tables it draws when over the limit (none when within it).
  const rows = [
    ["twelve, the limit", chain(DIAGRAM_TABLES), []],
    ["thirteen", chain(DIAGRAM_TABLES + 1), [13]],
    ["entity blocks, attributes not counted", Array.from({ length: 13 }, (_, i) => `  e${i} {\n    int oo_count\n    text name\n  }`), [13]],
    ["}|..|{ and quoted labels", Array.from({ length: 12 }, (_, i) => `  a${i} }|..|{ b${i} : "has many"`), [24]],
    ["no spaces, aliases, and quoted names", [...Array.from({ length: 7 }, (_, i) => `  x${i}||--o{y${i}:has`), '  p[Person] {', "  }", '  "Order line" ||--|| q : is'], [17]],
    ["word cardinalities", Array.from({ length: 7 }, (_, i) => `  w${i} only one to zero or more v${i} : has`), [14]],
    ["styles, classes, and comments are not tables", [...chain(DIAGRAM_TABLES), "  style t0 fill:#f9f", "  classDef hot fill:#f00", "  %% a note ||--o{ x : y"], []],
  ];
  for (const [what, lines, want] of rows) assert.deepEqual(sizes(model(diagram(lines))), want, what);
  // CRLF line endings, and front matter before erDiagram, still count.
  assert.deepEqual(sizes(model(["```mermaid", "---", "title: x", "---", "erDiagram", ...chain(13), "```"].join("\n")).replace(/\n/g, "\r\n")), [13]);
  // At a glance must be the first section, outside a code fence.
  assert.deepEqual(modelShape("t.md", TEMPLATE), [], "the kit's template is the shape");
  assert.match(modelShape("m.md", "# App\n\n## Entities\n\n```\n## At a glance\n```\n")[0], /m\.md: its first section is "Entities", not "At a glance"/);
  assert.deepEqual(modelShape("t.md", "# App: data model\n\nThis area stores nothing: it reads the register.\n\n## Why\n\nIt has no state.\n"), [], "a model that stores nothing is left alone");
  assert.deepEqual(modelShape("p.md", "# App: reviews\n\n## Reviews\n", { part: true }), [], "a part file is not asked for At a glance");
  // Past 25 tables, the parts go in files of their own.
  const tables = Array.from({ length: MODEL_TABLES + 1 }, (_, i) => `### t${i}`).join("\n\n");
  assert.match(modelShape("m.md", model(tables)).join(), /26 tables in one file, over 25; keep each part in its own file/);
  assert.deepEqual(modelShape("m.md", model(tables), { parts: 3 }), [], "split already");
  assert.deepEqual(modelShape("m.md", model(`${tables}\n\n### Single rows`).replace("### t25", "")), [], "Single rows is not a table");
});

test("shape notes are warnings only, for a model being drafted and its part files", async () => {
  const flat = "# App: data model\n\n## Entities\n\nA review.\n";
  const part = `# App: reviews\n\n## Reviews\n\n\`\`\`mermaid\nerDiagram\n${Array.from({ length: 13 }, (_, i) => `  t${i} ||--o{ u${i} : has`).join("\n")}\n\`\`\`\n`;
  const ctx = context("In progress 2026-11-20", { "docs/app/data-model.md": flat, "docs/app/data-model/reviews.md": part });
  assert.deepEqual(about(await problems(ctx, "2026-12-01")), [], "never a problem");
  const said = warnings(ctx).filter((line) => line.startsWith("docs/app/data-model"));
  assert.match(said.join("\n"), /docs\/app\/data-model\.md: its first section is "Entities"/, "warned while it is drafted");
  assert.match(said.join("\n"), /docs\/app\/data-model\/reviews\.md:5: a diagram of 26 tables/, "a part file is checked too");
});

test("each database the kit knows has its conventions to copy, under the data rules' limits", async () => {
  const { readdirSync } = await import("node:fs");
  const dir = new URL("../templates/data-engines/", import.meta.url);
  assert.deepEqual(readdirSync(dir).sort(), ["mongodb.md", "mysql.md", "postgres.md", "sqlite.md"]);
  for (const file of readdirSync(dir)) {
    const text = readFileSync(new URL(file, dir), "utf8");
    assert.match(text, /^### \w+/, `${file} starts with its heading, to sit under the project's part`);
    assert.match(text, /\*\*(Table|Collection) names\.\*\* <Singular or plural: pick one\.>/, `${file} asks the project to pick`);
    for (const line of text.split("\n")) assert.ok(line.split(/\s+/).length <= 60, `${file}: ${line.slice(0, 40)}`);
  }
  const standards = readFileSync(new URL("../docs/workflow/data-standards.md", import.meta.url), "utf8");
  assert.match(standards, /^<!-- wf:local data -->$/m, "the project's part, which docs sync keeps");
  for (const id of ["DATA-NAME", "DATA-KEY", "DATA-TYPE", "DATA-NULL", "DATA-FK", "DATA-CHECK", "DATA-MIGRATE"]) assert.match(standards, new RegExp(`\\*\\*${id}\\.\\*\\*`));
});
