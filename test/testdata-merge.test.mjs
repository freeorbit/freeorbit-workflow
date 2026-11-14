import assert from "node:assert/strict";
import { test } from "node:test";

import { merge } from "../lib/config/config.mjs";
import { DEFAULTS } from "../lib/config/defaults.mjs";
import { dataRows, foldFile, mergeFolder, mergeLines, sectionOf } from "../lib/testdata-merge.mjs";

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

test("a merge refuses a folder outside a test-data flow area, a symbolic link, and a file there already but ignored", () => {
  assert.throws(() => mergeFolder(context({ "docs/README.md": "# D", "docs/a.md": "# A" }), "docs"), /not a flow area's folder/);
  assert.throws(() => mergeFolder({ ...context(FOLDER), links: new Set([`${DIR}/move/mail.md`]) }, `${DIR}/move`), /is a symbolic link/);
  assert.throws(() => mergeFolder({ ...context(FOLDER), exists: (p) => p === `${DIR}/move.md` }, `${DIR}/move`), /there already/);
  assert.throws(() => foldFile(context({ "docs/a.md": "# A", "docs/b.md": "# B" }), "docs/a.md", "docs/b.md"), /not in an area's test-data folder/);
});

test("a symbolic link elsewhere is never rewritten, and a link inside code is left as written", () => {
  const texts = { ...FOLDER, "docs/linked.md": "[m](plugins/uplink/test-data/move/mail.md)", "docs/note.md": "`[m](plugins/uplink/test-data/move/mail.md)` and [m](plugins/uplink/test-data/move/mail.md)" };
  const found = mergeFolder({ ...context(texts), links: new Set(["docs/linked.md"]) }, `${DIR}/move`);
  assert.ok(!found.writes.has("docs/linked.md"));
  assert.equal(found.writes.get("docs/note.md"), "`[m](plugins/uplink/test-data/move/mail.md)` and [m](plugins/uplink/test-data/move.md#rules)");
});

test("the index drops only a row the relink made repeat another, never one it left alone", () => {
  const index = "| Doc | Holds |\n| --- | --- |\n| [a](other.md#one) | One |\n| [b](other.md#two) | Two |\n| [move](plugins/uplink/test-data/move/README.md) | Move |\n| [data](plugins/uplink/test-data/move/data.md) | Data |\n";
  const found = mergeFolder(context({ ...FOLDER, "docs/README.md": index }), `${DIR}/move`);
  assert.equal(found.writes.get("docs/README.md"), "| Doc | Holds |\n| --- | --- |\n| [a](other.md#one) | One |\n| [b](other.md#two) | Two |\n| [move](plugins/uplink/test-data/move.md) | Move |\n");
});

test("a fold joins a README row cell by cell, so the table keeps its columns", () => {
  const texts = {
    [`${DIR}/f/README.md`]: "# F\n\n| File | Holds | Flows |\n| --- | --- | --- |\n| [a.md](a.md) | A | F1 |\n| [b.md](b.md) | B | F2 |",
    [`${DIR}/f/a.md`]: "# F: a\n\nText.",
    [`${DIR}/f/b.md`]: "# F: b\n\n## Checks\n\n| ID | Check |\n| --- | --- |\n| C-GM-01 | x |",
  };
  const found = foldFile(context(texts), `${DIR}/f/a.md`, `${DIR}/f/b.md`);
  assert.equal(found.writes.get(`${DIR}/f/README.md`), "# F\n\n| File | Holds | Flows |\n| --- | --- | --- |\n| [b.md](b.md) | B; A | F2; F1 |");
});

test("the printed lines say what was done and what to do, and never both write and refuse", () => {
  const found = (before, after) => ({ to: "x.md", writes: new Map([["x.md", ""], ["docs/README.md", ""]]), removes: ["x/a.md", "x/README.md"], before, after, lines: 120 });
  const rows = [
    [found(3, 3), { asked: false, write: false }, ["x/ → x.md: 120 lines, data rows 3 → 3.", "It is over testdata.limits.lines (100); a page is easier to read than this.", "Links to move in 1 file: docs/README.md", "2 files to remove.", "Nothing written; --write applies it. Then run npx wf doc:check."]],
    [found(3, 3), { asked: true, write: true, kept: ["notes.txt"] }, ["x/ → x.md: 120 lines, data rows 3 → 3.", "It is over testdata.limits.lines (100); a page is easier to read than this.", "Links moved in 1 file: docs/README.md", "2 files removed.", "The folder stays, since it still holds notes.txt."]],
    [found(3, 2), { asked: true, write: false }, ["x/ → x.md: 120 lines, data rows 3 → 2.", "The rows differ, so nothing is written; merge this one by hand.", "It is over testdata.limits.lines (100); a page is easier to read than this.", "Links to move in 1 file: docs/README.md", "2 files to remove."]],
  ];
  for (const [each, options, want] of rows) assert.deepEqual(mergeLines(each, { from: "x/", limit: 100, ...options }), want);
});
