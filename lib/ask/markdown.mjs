// The Markdown an ask page draws, as the page parses it: the kit loads the
// page's own parser (lib/ask/browser/markdown.js), as rules.mjs loads its
// rules, so the checks and the tests read what the person will see.

import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const sandbox = { window: {} };
runInNewContext(readFileSync(new URL("./browser/markdown.js", import.meta.url), "utf8"), sandbox);
const MARKDOWN = sandbox.window.wfMarkdown;

/** Markdown's blocks, as the page draws them, as this realm's plain objects. */
export const parseMarkdown = (source) => JSON.parse(JSON.stringify(MARKDOWN.parse(source)));

/** Whether some blocks hold a fence left open, in a quote or a list too. */
const fenceOpen = (nodes) => nodes.some((n) => (n.k === "pre" && n.open) || (n.k === "quote" && fenceOpen(n.kids)) || ((n.k === "ul" || n.k === "ol") && n.items.some(fenceOpen)));

/**
 * What would show wrong: `refuse`, a reason the text is not what was meant
 * (Markdown that came through the shell as one line, its line breaks as \n),
 * and `warnings` the agent is told and may leave (a fence left open, as the
 * page's parser reads it).
 */
export function markdownProblems(source) {
  const text = String(source ?? "");
  // No line break, and \n where Markdown breaks lines: before another \n, a fence, a list mark, or a heading.
  const flat = !text.includes("\n") && /\\n(\\n|```|~~~|[-*+] |\d+[.)] |#|>)/.test(text);
  if (flat) return { refuse: "the text holds \\n as two characters and no line breaks, so the page would show it on one line; pass Markdown with --md - and a heredoc, or --md <file>", warnings: [] };
  return { refuse: null, warnings: fenceOpen(MARKDOWN.parse(text)) ? ["a code fence is left open, so the rest is shown as code"] : [] };
}
