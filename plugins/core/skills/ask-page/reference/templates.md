# Ask page templates

Each template's items field, and what each item becomes, for the `ask-page` skill. `npx wf ask example <template>` prints a whole spec to start from.

| Template | Items field | Each item becomes |
| --- | --- | --- |
| `decision` | `questions` | A question as written |
| `batch` | `questions`, each with a `role` | A question, grouped under its role |
| `compare` | `pairs`: `left`, `right`, `label`, `look` | A verdict on the pair, with side by side, swipe, onion skin, and difference views |
| `frame-review` | `frames`: `image`, `name`, `area`, `boxes` | A verdict on the frame: fine, bug, drift, or look again |
| `storyboard` | `steps`: `image`, `caption` | Works or breaks, step by step |
| `triage` | `items`: `id`, `text`, `context`, `needs` | Answer now, keep open, or drop |
| `rank` | `items`: `id`, `label`, `why`, and `prompt` | One ordering of every item |
| `naming` | `items`: `where`, `current`, `options`, `picture` | A pick, or the person's own words |
| `testdata` | `tables`: `columns`, `rows` of `id` and `cells` | Fine, a gap, or wrong, per row |
| `plan` | `steps`, and `prompt` | Approve or change, per step, then the plan as a whole |
| `signoff` | `checks` | Done or object, per check |
| `status` | `questions`, which may be none | A live page: where a step stands while it runs, with any questions as written |

A paged template (`compare`, `frame-review`, `storyboard`) shows one item at a time, with a strip of every item and an all-at-once grid. `verdicts` in the spec replaces the template's options.
