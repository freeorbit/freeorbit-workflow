---
name: doc-find
description: >-
  Prints the doc entries that start with an ID, a date, or a heading: a
  section, a table row with its header, or a bullet with its lines. Use before
  reading a log or a long doc, so only the entry is read.
---

# Doc find

Run from the project root:

```sh
node <this skill's folder>/scripts/doc-find.mjs <ID, date, or heading> [path]
```

The path is optional; with none it searches every tracked Markdown file. Read only what it prints. Grep for a word inside an entry.
