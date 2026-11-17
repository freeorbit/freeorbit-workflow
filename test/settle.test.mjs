import assert from "node:assert/strict";
import { test } from "node:test";

import { waitForStablePage } from "../lib/browser/settle.mjs";

/** A read that gives each page in turn, and throws for an Error in the list. */
const reads = (pages) => {
  let i = 0;
  return async () => {
    const page = pages[Math.min(i++, pages.length - 1)];
    if (page instanceof Error) throw page;
    return page;
  };
};
const p = (text, url = "/") => ({ text, url });

test("a page counts as started once it has text and reads the same twice running (TA-13)", async () => {
  const rows = [
    [[p("Loading"), p("Inbox"), p("Inbox")], "Inbox", "a page that changes once, then holds"],
    [[new Error("no page yet"), p("Inbox"), p("Inbox")], "Inbox", "a read that fails first starts the count again"],
    [[p("Inbox", "/a"), p("Inbox", "/b"), p("Inbox", "/b")], "Inbox", "the same text at a new address counts again"],
    [[p("  "), p("  "), p("  ")], null, "a page with no text never settles"],
    [[p("1"), p("2"), p("3"), p("4")], null, "a page that keeps changing never settles"],
  ];
  for (const [pages, want, why] of rows) {
    const page = await waitForStablePage(reads(pages), { tries: 4, every: 1 });
    assert.equal(page?.text ?? null, want, why);
  }
});

test("an app that exits ends the wait with its error", async () => {
  const alive = () => {
    throw new Error("the app exited");
  };
  await assert.rejects(waitForStablePage(reads([p("x")]), { alive, tries: 3, every: 1 }), /the app exited/);
});
