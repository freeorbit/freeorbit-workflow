import assert from "node:assert/strict";
import { test } from "node:test";

import { efficiencyDue, findingRows, frontmatter, repeatedHeadings, section, tokens, wholeReads } from "../lib/docs/shape.mjs";

test("a section ends at the next heading at its level or above", () => {
  const text = "## A\none\n### B\ntwo\n## C\nthree\n";
  assert.equal(section(text, "## A"), "one\n### B\ntwo");
  assert.equal(section(text, "### B"), "two");
  assert.equal(section(text, "## Missing"), "");
});

test("finding rows are the linked rows of a table", () => {
  assert.deepEqual(findingRows("| ID | Status |\n| --- | --- |\n| [A-001](#a-001) | open |\n"), ["| [A-001](#a-001) | open |"]);
});

test("a heading repeated at one level is found, and one in code is not", () => {
  assert.deepEqual(repeatedHeadings("## A\n## B\n### A\n## A\n```\n## B\n```\n"), ["## A"]);
});

test("a sentence that reads a large doc with no search is found", () => {
  const large = ["docs/log/decisions.md"];
  const text = "Read `docs/log/decisions.md` first. Search decisions.md for a topic. This is read-only decisions.md.";
  assert.deepEqual(
    wholeReads(text, large).map((hit) => hit.line),
    ["Read `docs/log/decisions.md` first."],
  );
});

test("frontmatter and tokens", () => {
  assert.equal(frontmatter("---\nname: a\n---\nbody"), "name: a");
  assert.equal(frontmatter("no frontmatter"), "");
  assert.equal(tokens(4000), 1000);
});

test("the efficiency check is due after five chunks built since the last one", () => {
  const efficiency = "## Check\n\n| Date | Result |\n| --- | --- |\n| 2026-11-01 | a |\n| 2026-11-02 | b |\n";
  const rows = ["| 1 | Built 2026-11-02 |", "| 2 | Built 2026-11-03 |", "| 3 | none |"];
  assert.deepEqual(efficiencyDue(efficiency, rows, 5), { last: "2026-11-02", since: 1, due: false });
  assert.equal(efficiencyDue(efficiency, Array(5).fill("| x | Built 2026-11-04 |"), 5).due, true);
  assert.equal(efficiencyDue("", rows, 5).last, "never");
});
