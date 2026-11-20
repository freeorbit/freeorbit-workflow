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

test("a data model reads at a glance: an At a glance section, and diagrams of twelve tables or fewer", async () => {
  const { modelShape, DIAGRAM_TABLES } = await import("../lib/docs/check.mjs");
  assert.deepEqual(modelShape("t.md", TEMPLATE), [], "the kit's template is the shape");
  assert.deepEqual(modelShape("t.md", "# App: data model\n\nThis area stores nothing: it reads the register.\n"), [], "a model that stores nothing is left alone");
  const big = ["```mermaid", "erDiagram", ...Array.from({ length: DIAGRAM_TABLES + 1 }, (_, n) => `  t${n} ||--o{ t${n + 1} : has`), "```"].join("\n");
  const flat = `# App: data model\n\n## Entities\n\n${big}\n`;
  const said = modelShape("docs/app/data-model.md", flat);
  assert.match(said[0], /docs\/app\/data-model\.md: no "## At a glance" section/);
  assert.match(said[1], /docs\/app\/data-model\.md:5: a diagram of 14 tables, over 12; draw one small diagram for each part/);
  assert.deepEqual(modelShape("x", `# X\n\n## At a glance\n\n- **Store.** SQLite.\n\n## Part\n\n${["```mermaid", "erDiagram", "  a ||--o{ b : has", "```"].join("\n")}\n`), []);
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
