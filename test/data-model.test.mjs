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
