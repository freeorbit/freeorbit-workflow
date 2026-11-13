# Ask page blocks design

How an ask page grows from a list of questions into a page made of parts: text, numbers, tables, diffs, charts, and the questions among them. The kit's developers read it; each part moves into the `ask-page` skill as it is built.

## Direction

A page is still data only. The kit draws every block, and a spec can neither bring its own HTML or script nor name a file to read.

- **Blocks.** A spec may list `blocks`, in order, beside or around its questions. A `questions` block places the template's questions; with none, they come after the blocks.
- **Sections.** `sections` groups blocks under headings, each its own card.
- **Data, never paths.** A block takes its rows inline, or from a named source the kit reads, such as `open-questions`.
- **Off where it can be.** Each block kind and page feature can be turned off for a page, or for a project by default.
- **Export where it can be.** A block that holds data saves or copies it: a table as CSV or Markdown, a chart as SVG.

## The spec

A block is one object with a `type`; the page draws them in order.

```json
{
  "id": "chunk-12-status", "title": "Chunk 12: where it stands", "template": "decision",
  "sections": [
    { "title": "Where it stands", "blocks": [
      { "type": "stats", "items": [{ "label": "Checks", "value": "12 of 14", "tone": "warn" }] },
      { "type": "table", "title": "Open questions", "source": "open-questions" }
    ] },
    { "title": "Questions", "blocks": [{ "type": "questions" }] }
  ],
  "questions": [ … ],
  "off": ["bulk"]
}
```

- **Section.** `title` and `blocks`, optional `note`. A spec with plain `blocks` has one untitled section.
- **Limits.** At most 60 blocks and 500 table rows a page, and 4,000 characters in a text block, so a page stays readable.

## Blocks

Phase 1 builds the first four; each later phase adds its row.

| Block | Holds | Export | Phase |
| --- | --- | --- | --- |
| `text` | Headings, paragraphs, lists, bold, italic, and code; no links or HTML | Markdown | 1 |
| `stats` | Tiles: a label, a value, a tone (ok, warn, bad, info), and a note | Markdown, CSV | 1 |
| `table` | Columns and rows, sortable and filterable | CSV, Markdown | 1 |
| `diff` | Before and after text, by line or word, side by side or inline | Markdown, a unified diff | 1 |
| `questions` | Where the template's questions go | The answers | 1 |
| `part` | A project part, by name, with values to fill | As its blocks | 1 |
| `chart` | Bar, line, or sparkline from a small spec | SVG, CSV | 3 |
| `diagram` | Boxes and arrows from nodes and links | SVG | 3 |
| `timeline` | Events along a line, done and next | Markdown | 3 |
| `board` | Cards in columns, read only | Markdown | 3 |

## Sources

A source is a name the kit knows and reads at `wf ask page`, never a path; its rows go into the page.

| Source | Rows |
| --- | --- |
| `open-questions` | The open questions log: ID, question, needs, from, story, raised |
| `decisions` | Every decisions file's rows: ID, decision, why, date; `filter` names one file |
| `ledger` | The review ledger's open findings: ID, severity, status, title |

A source the project lacks gives an empty table that says so, not an error.

## Parts

A part is a block list kept as data in `.workflow/ask-parts/<name>.json`, used with `{ "type": "part", "name": "<name>", "with": { … } }`.

- **Fill.** `{field}` in any string takes the value in `with`.
- **Checked like the kit's.** A part holds only kit blocks, and may not use itself.

## Turning things off

`off` lists what a page leaves out: block kinds, and the page features `bulk`, `outline`, `palette`, `pins`, and `compare`.

- **A project default.** `ask.off` in `.workflow/config.json` does the same for every page.
- **On again.** A page's `on` turns back on what the project turned off.

## Later phases

- **Phase 2, richer answers.** Follow-ups that show when an earlier answer fits (`showIf`), a grid of choices, sorting into buckets, accepting or rejecting suggested edits, ratings, numbers and sliders, a small form with checks, drawing a box on a picture, and assigning an owner.
- **Phase 3, more to show.** Charts, diagrams, timelines, and the board view.
- **Phase 4, live pages.** A status page the agent updates while a step runs, a reply under a question, a history of every ask, what changed since the last ask, and step-by-step pages.

## Not chosen, for later

Ken left these out of the first plan, on 2026-11-13.

- **Edit a table in place.** Change cells of test data or settings, and send the rows back.
- **Spread points.** Share 100 points across items.
- **Say a page is waiting.** A tab count beyond the inbox's, or a browser notification.
- **A project colour theme.** The project's own colours in its config.
