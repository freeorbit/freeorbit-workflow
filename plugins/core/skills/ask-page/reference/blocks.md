# Ask page blocks

What a page can show around its questions, for the `ask-page` skill.

A page can show more than questions: give `sections`, each a `title` and its `blocks`, or plain `blocks`. The design is in the kit's `docs/design/ask-blocks.md`. The examples are `status.json`, `charts.json`, and `steps.json` in the skill's `blocks/` folder.

| Block | Fields | Export |
| --- | --- | --- |
| `text` | `text`: headings (`#`), paragraphs, `-` and `1.` lists, `**bold**`, `*italic*`, `` `code` ``, and fenced code; no links or HTML | Markdown |
| `stats` | `items` of `label`, `value` (24 characters), `tone` (ok, warn, bad, info), `note`, and `trend`, up to 60 numbers drawn as a sparkline | Markdown, CSV |
| `table` | `columns` and `rows`, or `source`: `open-questions`, `decisions` (with `filter`, a file id), or `ledger`; sortable, and filterable over 8 rows | CSV, Markdown |
| `diff` | `before` and `after`, `by` line or word, `view` side or inline, `labels` | A unified diff |
| `chart` | `kind` (`bar` or `line`), `labels`, `series` of `name` and `values` (a number or null for each label, 8 series at most), `stacked` for bars, `unit`; one axis, a tooltip on hover, the arrow keys, and Show the numbers for the table | SVG, CSV, Markdown |
| `diagram` | `nodes` of `id`, `label`, `note`, `tone`; `links` of `from`, `to`, `label`; `direction` `right` or `down`; laid out by the kit, a loop's arrow dashed | SVG, Mermaid |
| `timeline` | `events` of `date`, `title`, `note`, `state` (`done`, `now`, `next`) | Markdown |
| `board` | `columns` (ids, or `id` and `title`), `cards` of `title`, `column`, `note`, `tone`, `owner`, `tags`; read only | Markdown, CSV |
| `questions` | Where the questions go; with none, they come after the blocks | — |
| `part` | `name` of a part in `.workflow/ask-parts/<name>.json`, and `with`, values for `{field}` | — |

- **Every block** takes a `title` and a `note`. A titled block has its own Export menu; an untitled one's sits in its section's.
- **Limits.** 60 blocks and 500 table rows a page, 4,000 characters a text block, 200 points a chart, 40 boxes a diagram, 100 events, and 200 cards.
- **Which one.** A single number is a `stats` tile, with a `trend` when its change matters. Change over time is a line; amounts across a few things, bars. Two measures of different scale are two charts, never one with two axes.
- **Questions in more than one place.** A `questions` block with a `group` places that group's questions, one with `ids` places those, and the one with neither places every question left. Each question is placed once.
- **Off.** `off` lists block kinds, question types, or features a page leaves out (`bulk`, `outline`, `palette`, `pins`, `compare`, `regions`, `followups`, `owners`, `live`, `replies`, `history`, `changes`, `notify`, `tabcount`, `motion`); `ask.off` in `.workflow/config.json` does it for every page, and a page's `on` brings one back.
