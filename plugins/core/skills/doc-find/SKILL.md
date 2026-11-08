---
name: doc-find
description: >-
  Prints the doc entries that start with an ID, a date, or a heading: a
  section, a table row with its header, or a bullet with its lines. Use before
  reading a log or a long doc, or to look up a story, finding, chunk, or
  decision by its ID or date, so only the entry is read.
---

# Doc find

Run it from anywhere in the project:

```sh
npx wf doc:find <ID, date, or heading> [file or folder ...]
```

With no path it searches the tracked Markdown under `docs/`. Read only what it prints. When nothing starts with the query, grep for a word inside an entry instead.
