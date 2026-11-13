# Ask page answer types

The richer question types, follow-ups, owners, and boxes, for the `ask-page` skill.

Beyond picking, ordering, and typing, a question can ask for a number, a grid, a sort, edits, or a small form. The example is the skill's `answers/release.json`.

| Type | Fields | Answer | Recommend |
| --- | --- | --- | --- |
| `scale` | `scale`: `min` (1), `max` (5), `step` (1), `style` (`stars` up to ten steps, `slider`, `number`), `low` and `high` labels, `unit` | `number` | A number on the scale |
| `grid` | `rows` of `id`, `label`, `why`; `options` are the columns | `rows`: a column for each row | `{ row: option }` |
| `buckets` | `items` of `id`, `label`, `why`; `options` are the buckets; drag, or pick on the card | `rows`: a bucket for each item | `{ item: bucket }` |
| `edits` | `edits` of `id`, `label`, `before`, `after`, `by` (word, or line), `why` | `edits`: `accept` or `reject` each | `"accept"`, or `{ edit: "accept" }` |
| `form` | `fields` of `id`, `label`, `kind` (`text`, `long`, `number`, `check`, `select`, `date`), `required`, `min`, `max`, `options`, `help`, `placeholder` | `fields` | Nothing; say what fits in `help` |

- **Answered.** A grid, a sort, or edits is answered when every row has its place; a form when every field is fine and something is filled in. Each is checked as it is filled.
- **The asking rules.** In the advised templates, every column and bucket says what it means in `why`, every edit says why it is suggested, and each recommends in `recommended` with `why`, or says in `noPick` why not. R takes it; rows already placed stay.
- **Follow-ups.** `showIf: { "question": "<earlier id>", "is": "<option>" }` shows a question only when that answer fits: `is` or `not` (one option or a list) for a choice, `atLeast` or `atMost` for a scale, or nothing, for any answer. A follow-up not shown is not asked, so it is never open, and what it held is not sent. Follow-ups are for list pages, not the paged reviews.
- **Owners.** `owners`, a list of names, puts a "who owns this" pick on a question; the answer's `owner` is one of them.
- **Boxes.** With `pins: true`, a drag in comment mode draws a box, a pin with a `w` and `h`; a click still drops a pin.
- **Off.** `off` and `ask.off` take the types too, and `followups`, `owners`, and `regions` (boxes); a spec using a type that is off fails its check.
