import assert from "node:assert/strict";
import { test } from "node:test";

import { merge } from "../lib/config/config.mjs";
import { DEFAULTS } from "../lib/config/defaults.mjs";
import { dataRows, foldFile, mergeFolder, sectionOf } from "../lib/testdata-merge.mjs";

const config = merge(DEFAULTS, { areas: [{ id: "uplink", prefix: "GM", docs: "docs/plugins/uplink" }] });
const context = (texts) => ({ config, tracked: Object.keys(texts), files: (path) => texts[path] ?? "" });
const DIR = "docs/plugins/uplink/test-data";

const FOLDER = {
  [`${DIR}/move/README.md`]: [
    "# Uplink test data: move",
    "",
    "Flows: Move mail",
    "",
    "| File | Holds |",
    "| --- | --- |",
    "| [data.md](data.md) | DS-GM-27 |",
    "| [mail.md](mail.md) | Mail |",
  ].join("\n"),
  [`${DIR}/move/data.md`]: ["# Uplink test data: move datasets", "", "### DS-GM-27. Small", "", "| | |", "| --- | --- |", "| Seed | `1` |", "| Checked in | [mail.md](mail.md) |", "", "### DS-GM-28. Large", "", "| | |", "| --- | --- |", "| Seed | `2` |"].join("\n"),
  [`${DIR}/move/mail.md`]: [
    "# Uplink test data: mail",
    "",
    "The move of mail, one mailbox at a time; see [core](../core.md).",
    "",
    "| ID | Check | Stories | Rules | By |",
    "| --- | --- | --- | --- | --- |",
    "| C-GM-01 | It moves | GM-07 | R-GM-01 | |",
    "",
    "## Rules",
    "",
    "| ID | Category | Rule |",
    "| --- | --- | --- |",
    "| R-GM-01 | State | A rule |",
  ].join("\n"),
  [`${DIR}/core.md`]: "# Core\n\nSee [the mail checks](move/mail.md#checks) and [move](move/README.md).\n",
  "docs/README.md": "| Doc | Holds |\n| --- | --- |\n| [uplink move](plugins/uplink/test-data/move/README.md) | Move |\n| [uplink move data](plugins/uplink/test-data/move/data.md) | Data |\n",
};

test("a table's section comes from its header", () => {
  assert.equal(sectionOf("| ID | Check | Stories |"), "Checks");
  assert.equal(sectionOf("| Fixture | Varies | Expect |"), "Edge-case fixtures");
  assert.equal(sectionOf("| State | What is already done |"), "Journey states");
  assert.equal(sectionOf("| | |"), null);
});

test("a folder becomes one file: each table in its section, a datasets file whole, every row kept, and links moved", () => {
  const found = mergeFolder(context(FOLDER), `${DIR}/move/`);
  const text = found.writes.get(`${DIR}/move.md`);
  assert.equal(found.before, found.after);
  assert.equal(found.after, dataRows(Object.entries(FOLDER).filter(([p]) => p.includes("/move/") && !p.endsWith("README.md")).map(([, t]) => t).join("\n")));
  assert.deepEqual([...text.matchAll(/^## (.+)$/gm)].map((m) => m[1]), ["Rules", "Datasets", "Checks"]);
  assert.match(text, /### DS-GM-27\. Small\n\n\| \| \|\n\| --- \| --- \|\n\| Seed \| `1` \|\n\| Checked in \| \[mail\]\(#rules\) \|/, "a dataset keeps its own table, and a link to a sibling points where its text went");
  assert.match(text, /\*Mail\.\* The move of mail, one mailbox at a time; see \[core\]\(core\.md\)\./, "a topic's lead stays, labelled, its link moved up a folder");
  assert.ok(!text.includes("| File | Holds |"), "the folder's file table goes");
  assert.equal(found.writes.get(`${DIR}/core.md`), "# Core\n\nSee [the mail checks](move.md#checks) and [move](move.md).\n");
  assert.equal(found.writes.get("docs/README.md"), "| Doc | Holds |\n| --- | --- |\n| [uplink move](plugins/uplink/test-data/move.md) | Move |\n", "the index keeps one row for the file");
  assert.deepEqual(found.removes.sort(), Object.keys(FOLDER).filter((p) => p.includes("/move/")).sort());
});

test("a small file folds into a sibling, and the README's row for it joins the sibling's", () => {
  const found = foldFile(context(FOLDER), `${DIR}/move/data.md`, `${DIR}/move/mail.md`);
  assert.equal(found.before, found.after);
  assert.match(found.writes.get(`${DIR}/move/mail.md`), /## Datasets\n\n### DS-GM-27/);
  assert.match(found.writes.get(`${DIR}/move/README.md`), /\| \[mail\.md\]\(mail\.md\) \| Mail; DS-GM-27 \|/);
  assert.ok(!found.writes.get(`${DIR}/move/README.md`).includes("[data.md]"));
});

test("a merge needs the folder's README, and never overwrites a file", () => {
  assert.throws(() => mergeFolder(context({ [`${DIR}/x/a.md`]: "# A" }), `${DIR}/x`), /no README/);
  assert.throws(() => mergeFolder(context({ ...FOLDER, [`${DIR}/move.md`]: "# M" }), `${DIR}/move`), /there already/);
});
