import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { merge } from "../lib/config/config.mjs";
import { DEFAULTS } from "../lib/config/defaults.mjs";
import { problems } from "../lib/docs/check.mjs";

const ORDER = (architecture, head = "Architecture") => `| Area | Stories | Frames | ${head} | Build |\n| --- | --- | --- | --- | --- |\n| App | Done 2026-11-01 | Done 2026-11-01 | ${architecture} | Not started |\n`;
const TEMPLATE = readFileSync(new URL("../templates/threat-model.md", import.meta.url), "utf8");

async function threat(architecture, review = {}, model = null, head = "Architecture") {
  const texts = { "docs/log/build-order.md": ORDER(architecture, head), ...(model === null ? {} : { "docs/app/threat-model.md": model }) };
  const context = { root: "/nowhere", config: merge(DEFAULTS, { docs: { index: "none.md" }, review }), tracked: Object.keys(texts), files: (path) => texts[path] };
  return (await problems(context, "2026-11-09")).filter((line) => line.includes("threat") && !line.includes(": no file "));
}

test("before Step 3 is done, no threat model is asked for", async () => {
  assert.deepEqual(await threat("In progress 2026-11-02"), []);
});

test("past Step 3, a missing, unset, or template threat model is a problem", async () => {
  assert.match((await threat("Done 2026-11-02"))[0], /App is past Step 3, and review.threatModel is not set/);
  assert.match((await threat("Done 2026-11-02", { threatModel: "docs/app/threat-model.md" }))[0], /is missing/);
  assert.match((await threat("Done 2026-11-02", { threatModel: "docs/app/threat-model.md" }, TEMPLATE))[0], /still the kit's empty template/);
  const drafted = TEMPLATE.split("\n").slice(1).join("\n");
  assert.deepEqual(await threat("Done 2026-11-02", { threatModel: "docs/app/threat-model.md" }, drafted), []);
});

test("an Areas table with no Architecture column is reported, not passed", async () => {
  assert.match((await threat("Done 2026-11-02", {}, null, "Design"))[0], /no Architecture column/);
});

test("a story ID inside a fenced example is not a reference", async () => {
  const texts = { "docs/a.md": "# A\n\n```markdown\n### APP-01. Short name\n```\n\nSee APP-02.\n" };
  const context = { root: "/nowhere", config: merge(DEFAULTS, { docs: { index: "none.md" }, areas: [{ id: "app", prefix: "APP", docs: "docs/app" }], stories: { files: ["docs/app/user-stories.md"] } }), tracked: Object.keys(texts), files: (path) => texts[path] };
  const found = (await problems(context, "2026-11-09")).filter((line) => line.includes("no story"));
  assert.deepEqual(found, ["docs/a.md: no story APP-02"]);
});
