#!/usr/bin/env node
// Prints the doc entries a search names, so finding one is a single step: a
// heading's section, a table row with its header, or a bullet with its lines.
// An entry matches when it starts with the query, the shape writing-docs.md
// gives logs, so an ID mentioned in passing is not a hit. It knows no feature.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The project is where the agent runs, not where the kit is installed.
const ROOT = process.cwd();

/** Text with Markdown emphasis, links, and code marks removed, for matching. */
const plain = (text) => text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[*_`]/g, "").trim().toLowerCase();

/** Every entry in a Markdown text that starts with the query, as `{ line, text }`. */
export function entries(text, query) {
  const want = query.toLowerCase();
  const lines = text.split("\n");
  const found = [];
  let fenced = false;
  let header = null;
  lines.forEach((line, i) => {
    if (/^\s*```/.test(line)) fenced = !fenced;
    if (fenced) return;
    const heading = line.match(/^(#{1,6}) (.+)$/);
    if (heading) {
      if (!plain(heading[2]).includes(want)) return;
      const end = lines.findIndex((next, j) => j > i && new RegExp(`^#{1,${heading[1].length}} `).test(next));
      found.push({ line: i + 1, text: lines.slice(i, end < 0 ? undefined : end).join("\n").trimEnd() });
    } else if (line.startsWith("|")) {
      const first = line.split("|")[1] ?? "";
      if (!header) header = [line, lines[i + 1] ?? ""];
      else if (!/^\s*:?-+/.test(first) && plain(first).startsWith(want)) found.push({ line: i + 1, text: [...header, line].join("\n") });
    } else {
      header = null;
      const bullet = line.match(/^- (.+)$/);
      if (!bullet || !plain(bullet[1]).startsWith(want)) return;
      let end = i + 1;
      while (end < lines.length && /^\s+\S/.test(lines[end])) end += 1;
      found.push({ line: i + 1, text: lines.slice(i, end).join("\n") });
    }
  });
  return found;
}

function main() {
  const [query, ...paths] = process.argv.slice(2);
  if (!query) {
    console.log("Usage: pnpm doc:find <ID, date, or heading> [file or folder ...]   (default: docs)");
    process.exit(2);
  }
  const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", ...(paths.length ? paths : ["docs"])], {
    cwd: ROOT,
    encoding: "utf8",
  })
    .split("\n")
    .filter((path) => path.endsWith(".md"));
  let count = 0;
  for (const path of files) {
    for (const entry of entries(readFileSync(join(ROOT, path), "utf8"), query)) {
      console.log(`${path}:${entry.line}\n${entry.text}\n`);
      count += 1;
    }
  }
  console.log(count ? `${count} found.` : `Nothing starts with "${query}". Try grep for a word inside an entry.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
