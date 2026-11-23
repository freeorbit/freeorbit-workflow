// The Markdown an ask page draws: the agent's replies, and a text block. The
// page parses it (lib/ask/browser/markdown.js); Node loads the same file to
// check it, so these cases hold for both.

import assert from "node:assert/strict";
import { test } from "node:test";

import { markdownProblems, parseMarkdown } from "../lib/ask/markdown.mjs";

const md = (source) => JSON.parse(JSON.stringify(parseMarkdown(source)));
/** One paragraph's inline nodes. */
const inline = (source) => {
  const [p] = md(source);
  assert.equal(p.k, "p", `${source} is one paragraph`);
  return p.kids;
};
const text = (s) => ({ t: "text", s });

test("words with underscores or stars between spaces stay as written", () => {
  assert.deepEqual(inline("Rename ask_more_test and wf_ask_page."), [text("Rename ask_more_test and wf_ask_page.")]);
  assert.deepEqual(inline("Cost is 2 * 3 * 4."), [text("Cost is 2 * 3 * 4.")]);
  assert.deepEqual(inline("a\\*b\\* and \\_c\\_"), [text("a*b* and _c_")], "a backslash keeps a mark as text");
});

test("bold, italic, and struck nest, and code spans hold their marks as text", () => {
  assert.deepEqual(inline("**bold with *italic* inside**"), [{ t: "b", kids: [text("bold with "), { t: "i", kids: [text("italic")] }, text(" inside")] }]);
  assert.deepEqual(inline("__bold__ and _slant_ and ~~gone~~"), [{ t: "b", kids: [text("bold")] }, text(" and "), { t: "i", kids: [text("slant")] }, text(" and "), { t: "del", kids: [text("gone")] }]);
  assert.deepEqual(inline("run `a * b_c` now"), [text("run "), { t: "code", s: "a * b_c" }, text(" now")]);
  assert.deepEqual(inline("``has ` inside``"), [{ t: "code", s: "has ` inside" }]);
  assert.deepEqual(inline("an `open tick"), [text("an `open tick")]);
  assert.deepEqual(inline("<script>x</script>"), [text("<script>x</script>")], "markup stays text, which the page draws as text");
});

test("links go to https or mailto only; others, and pictures, are their text", () => {
  assert.deepEqual(inline("See [the **docs**](https://x.dev/a_b) now"), [text("See "), { t: "a", href: "https://x.dev/a_b", kids: [text("the "), { t: "b", kids: [text("docs")] }] }, text(" now")]);
  assert.deepEqual(inline("[mail](mailto:a@b.c)")[0].href, "mailto:a@b.c");
  assert.deepEqual(inline("[run](javascript:alert(1))"), [text("run")]);
  assert.deepEqual(inline("[plain](http://x.dev) and http://y.dev"), [text("plain and http://y.dev")], "an address without TLS is its words");
  assert.deepEqual(inline("[here](#q-1) and [file](src/a.js)"), [text("here and file")]);
  assert.deepEqual(inline("![a chart](https://x.dev/c.png)"), [text("a chart")]);
  assert.deepEqual(inline("Open https://x.dev/path_one. Then go."), [text("Open "), { t: "a", href: "https://x.dev/path_one", kids: [text("https://x.dev/path_one")] }, text(". Then go.")]);
  assert.deepEqual(inline("[not a link] (no)"), [text("[not a link] (no)")]);
});

test("headings from one to six marks, rules, and quotes", () => {
  assert.deepEqual(md("#### Deep\n###### Deepest\n####### not"), [{ k: "h", level: 4, kids: [text("Deep")] }, { k: "h", level: 6, kids: [text("Deepest")] }, { k: "p", kids: [text("####### not")] }]);
  assert.deepEqual(md("one\n\n---\n\ntwo").map((n) => n.k), ["p", "hr", "p"]);
  assert.deepEqual(md("> a **quote**\n> - with a list\n\nafter"), [{ k: "quote", kids: [{ k: "p", kids: [text("a "), { t: "b", kids: [text("quote")] }] }, { k: "ul", items: [[{ k: "p", kids: [text("with a list")] }]] }] }, { k: "p", kids: [text("after")] }]);
});

test("fences: backticks or tildes, indented, with a language and a first line, closed or not", () => {
  assert.deepEqual(md("~~~\ncode\n~~~"), [{ k: "pre", text: "code", lang: "", start: null }]);
  assert.deepEqual(md("```ts:120\nlet a;\n```"), [{ k: "pre", text: "let a;", lang: "ts", start: 120 }]);
  assert.deepEqual(md("````md\n```js\nx\n```\n````"), [{ k: "pre", text: "```js\nx\n```", lang: "md", start: null }], "a longer fence holds a shorter one");
  assert.deepEqual(md("```\nleft open\n\nstill code"), [{ k: "pre", text: "left open\n\nstill code", lang: "", start: null, open: true }]);
  assert.deepEqual(md("  ```py\n  def f():\n      pass\n  ```"), [{ k: "pre", text: "def f():\n    pass", lang: "py", start: null }], "the fence's indent comes off its lines");
});

test("lists nest, take fences and paragraphs inside an item, and start where they say", () => {
  assert.deepEqual(md("1. Change this:\n   ```js\n   const a = 1;\n   ```\n2. Then run it."), [{ k: "ol", start: 1, items: [
    [{ k: "p", kids: [text("Change this:")] }, { k: "pre", text: "const a = 1;", lang: "js", start: null }],
    [{ k: "p", kids: [text("Then run it.")] }],
  ] }]);
  assert.deepEqual(md("- top\n  - child\n    - grandchild\n- next"), [{ k: "ul", items: [
    [{ k: "p", kids: [text("top")] }, { k: "ul", items: [[{ k: "p", kids: [text("child")] }, { k: "ul", items: [[{ k: "p", kids: [text("grandchild")] }]] }]] }],
    [{ k: "p", kids: [text("next")] }],
  ] }]);
  assert.equal(md("3) third\n4) fourth")[0].start, 3);
  assert.deepEqual(md("- one\nmore of one\n\n  still one\n- two")[0].items[0], [{ k: "p", kids: [text("one more of one")] }, { k: "p", kids: [text("still one")] }]);
  assert.deepEqual(md("- a\n\n1. b").map((n) => n.k), ["ul", "ol"], "another kind of mark starts another list");
  assert.deepEqual(md("A line\n- then a list").map((n) => n.k), ["p", "ul"]);
  assert.deepEqual(md("It shipped in\n2024. Then more.").map((n) => n.k), ["p"], "a number in a sentence is no list");
  assert.deepEqual(md("x\n-").map((n) => n.k), ["p"], "an empty item does not break a paragraph");
  assert.deepEqual(md("- a\n- b\n\n* * *").map((n) => n.k), ["ul", "hr"], "a rule is a rule after a list");
  // A fence opened under an item and closed at the margin closes there; what follows is not in the item.
  assert.deepEqual(md("- a\n  ```\n  x\n```\n\nNext para\n\n## Heading").map((n) => n.k), ["ul", "p", "h"]);
  assert.deepEqual(md("- a\n  ```\n  x\n```")[0].items[0][1], { k: "pre", text: "x", lang: "", start: null });
  assert.deepEqual(md("- a\n  ````\n  ```js\n  ````")[0].items[0][1].text, "```js", "a shorter fence inside does not close it");
});

test("tables: a header, a delimiter row with alignment, and rows; pipes in code stay", () => {
  const [t] = md("| Name | Cost | Note |\n| :--- | ---: | :-: |\n| `a|b` | 3 | **x** |\n| c | 4 |");
  assert.equal(t.k, "table");
  assert.deepEqual(t.align, ["left", "right", "center"]);
  assert.deepEqual(t.head, [[text("Name")], [text("Cost")], [text("Note")]]);
  assert.deepEqual(t.rows, [[[{ t: "code", s: "a|b" }], [text("3")], [{ t: "b", kids: [text("x")] }]], [[text("c")], [text("4")], []]], "a short row is filled out");
  assert.deepEqual(md("a | b\n--- | ---\n1 | 2")[0].rows, [[[text("1")], [text("2")]]], "outer pipes are optional");
  assert.deepEqual(md("| just | pipes |").map((n) => n.k), ["p"], "no delimiter row, no table");
});

test("paragraphs join their lines, and deep nesting stops at a limit", () => {
  assert.deepEqual(md("one\ntwo\n\nthree"), [{ k: "p", kids: [text("one two")] }, { k: "p", kids: [text("three")] }]);
  const deep = md(`${"> ".repeat(200)}deep`);
  let depth = 0;
  for (let n = deep[0]; n?.k === "quote"; n = n.kids[0]) depth++;
  assert.ok(depth <= 20, `${depth} quotes deep`);
  assert.ok(md("*".repeat(5000)).length, "a long run of marks parses");
});

test("the agent is told when its Markdown came through the shell as one line, or a fence was left open", () => {
  assert.match(markdownProblems("First line\\n\\n```js\\nconst a=1;\\n```").refuse, /holds \\n as two characters/);
  assert.equal(markdownProblems("Split on `\\n` here.").refuse, null, "one \\n in code is fine");
  assert.deepEqual(markdownProblems("```js\nconst a = 1;").warnings, ["a code fence is left open, so the rest is shown as code"]);
  assert.deepEqual(markdownProblems("Fine.\n\n```\nx\n```"), { refuse: null, warnings: [] });
  // The warning reads fences as the page does.
  assert.deepEqual(markdownProblems("```js``` inline\nnot code").warnings, []);
  assert.deepEqual(markdownProblems("    ```\n    x").warnings, []);
  assert.equal(markdownProblems("- a\n  ```\n  x").warnings.length, 1, "open in a list item");
});

test("the parse grows with its input: no 4000-character text holds the page up", () => {
  const nested = `${Array.from({ length: 20 }, (_, i) => `${"  ".repeat(i)}- a`).join("\n")}\n${"\n".repeat(3000)}${" ".repeat(40)}b`;
  const cases = {
    "a list over blank lines": nested.slice(0, 4000),
    "[ with no ]": "[".repeat(4000),
    "[]( with no )": "[](".repeat(1333),
    "![ with no ]": "![".repeat(2000),
    "a heading over spaces": `# a${" ".repeat(3994)}b`,
    "an address of )s": `https://a${")".repeat(3990)}`,
    "closers alone": "a* ".repeat(1333),
  };
  for (const [what, source] of Object.entries(cases)) {
    const start = performance.now();
    parseMarkdown(source);
    const ms = performance.now() - start;
    assert.ok(ms < 100, `${what}: ${ms.toFixed(0)} ms`);
  }
});

test("any text parses, and no link goes anywhere but https or mailto", () => {
  // A seeded generator, so a failure repeats: Markdown's marks, brackets, schemes, and line breaks.
  let seed = 7;
  const rand = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const bits = ["*", "_", "~~", "`", "[", "]", "(", ")", "![", "\\", "#", "> ", "- ", "1. ", "|", "---", "```", "~~~", "\n", "\n\n", "  ", "a", "word ", "https://x.dev/a", "http://y.dev", "javascript:alert(1)", "data:text/html,x", "mailto:a@b.c", "<b>", "\u0000", "\t"];
  const links = (nodes) => nodes.flatMap((n) => [...(n.t === "a" ? [n.href] : []), ...links([...(n.kids ?? []), ...(n.items ?? []).flat(), ...(n.head ?? []).flat(), ...(n.rows ?? []).flat(2)])]);
  for (let run = 0; run < 3000; run++) {
    const source = Array.from({ length: 5 + rand(80) }, () => bits[rand(bits.length)]).join("");
    const parsed = parseMarkdown(source);
    for (const href of links(parsed)) assert.match(href, /^(https:\/\/|mailto:)/i, `${JSON.stringify(source)} links to ${href}`);
  }
});
