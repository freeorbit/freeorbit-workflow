// The inbox at the shared server's front page: every ask from every project
// and session, waiting ones first, so a person answers them in one place.
// It reads /__hub/inbox every few seconds, says the waiting count in the
// tab's title, and looks like the ask pages: the same theme, kept in the
// browser, from the kit or Claude Desktop.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BROWSER = join(dirname(fileURLToPath(import.meta.url)), "..", "ask", "browser");



/** The inbox page, styled like the ask pages. */
export function inboxHtml() {
  const css = readFileSync(join(BROWSER, "client.css"), "utf8");
  const themes = readFileSync(join(BROWSER, "themes.json"), "utf8").replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Asks</title>
<style>
${css}</style>
</head>
<body>
<main class="inbox">
<h1>Asks</h1>
<p class="summary" id="summary" role="status" aria-live="polite">Loading…</p>
<div class="filters" id="filters"></div>
<nav id="items" aria-label="Every ask"></nav>
</main>
<script type="application/json" id="themes">${themes}</script>
<script>
${["shared.js", "look.js", "inbox.js"].map((f) => readFileSync(join(BROWSER, f), "utf8")).join("\n")}
</script>
</body>
</html>
`;
}
