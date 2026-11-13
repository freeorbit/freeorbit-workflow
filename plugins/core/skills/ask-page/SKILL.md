---
name: ask-page
description: >-
  Asks a person on a page beside the chat instead of the question tool: any
  number of questions, pictures with boxes and pins, frame-against-app
  compares, rankings, plan approvals, sign-offs, and test-data tables, from a
  template. The answers come back as JSON and Markdown. Use for more than four
  questions, any visual question, or a review of many frames or rows.
---

# Ask page

An ask page is one HTML page built from a JSON spec. The person answers in the browser pane and presses Send; you get the answers from `wf ask wait`. The rules for when to ask are in `AGENTS.md`.

## Steps

1. Pick a template: `npx wf ask templates`. Start from its example: `npx wf ask example <template> > .cache/view/<id>.json`, then edit it.
2. Build the page: `npx wf ask page .cache/view/<id>.json`. It checks the spec, copies the pictures, starts the shared server if none runs, and prints the address.
3. Open the address in the browser pane. Where the pane's preview start is needed, start `question-pictures` from `.claude/launch.json`: it joins the shared server.
4. Run `npx wf ask wait <id>` in the background. Say in one line that the page is open and what it asks; do not repeat the questions in the chat.
5. When `wait` prints the answers, act on them. A partial send lists the open questions; carry on with what is answered, and wait again for the rest.
6. Run `npx wf ask record <id>` when the spec marks decisions with `record`, or any answer is "Later".

No browser pane: send `wf ask export <id>`'s `.html` file, or ask in the chat. The person's Copy answers text, pasted into the chat, is read with `wf ask import` from a file holding it.

## Templates

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

A paged template (`compare`, `frame-review`, `storyboard`) shows one item at a time, with a strip of every item and an all-at-once grid. `verdicts` in the spec replaces the template's options.

## A template of the project's own

When none of the templates fits a question that will come back, such as a dependency review, propose a project template to the owner. Ask first; it is a file in the project, committed like any other.

- **Where.** `.workflow/ask-templates/<name>.json`. `npx wf ask templates` lists it beside the kit's and names what is wrong with it.
- **What.** Data only, never code: `name`, `use`, `layout` (`list`, `pages`, `groups`, `table`), `items` (the spec's field that lists them), `text` and `detail` with `{field}` and `{n}`, `type`, `options`, `advised`, `pins`, `defer`, `other`, `groupBy`, and `columns` for a table.
- **Advised.** `advised: true` holds its choices to the asking rules: a recommendation, why, and what each option means.
- **The example.** `project-template/dependency-review.json` beside this skill, and the spec that uses it.
- **Why not code.** The page takes answers on this machine; a template that ran its own script could send anything. A layout the kit lacks is a change to the kit.

## The spec

- **Top.** `id` (lowercase, dashes), `title`, `template`, `intro`; `chunk` and `from` (a role) for the record.
- **A question.** `id`, `text`, `type` (`one`, `many`, `text`, `rank`), `options` of `id`, `label`, `why`, `preview` (a text sketch), `kind` (a colour), and `recommended` with `why`.
  - **Recommend.** In `decision`, `batch`, `naming`, and `triage`, every option says what it means in its own `why`, as the question tool's descriptions do, and every choice names `recommended` and says `why`; `rank` lists its items in the suggested order and says `why` at the top. The page check fails without them.
  - `noPick` instead, only when there is honestly nothing to recommend, says why; the page shows it. A review template's verdicts are the person's own, so they recommend nothing.
  - `role`, `group`, `look` (where to look), `detail`, `chunk`.
  - `pictures`: `image` (a path in the project), `label`, `name`, and `boxes` of `n`, `kind`, `rect` `[x, y, width, height]` in the picture's pixels.
  - `compare`: two pictures, the frame or before first. `pins: true` lets the person pin comments on the pictures.
  - `other: true` adds "Something else" with a text box; `defer: false` hides "You decide" and "Later".
  - `record`: a decisions file id, such as an area's, for `wf ask record`.
- **Pictures.** A sheet from `npx wf design annotate`, or a shot from `wf screens` or `wf app`, works as a picture; the box kinds are the annotate kinds.

## The page

Every template shares one layout: a header with the title, who asked, the draft state, the other asks, and the progress; a column of questions; and a footer whose one primary button is Send.

- **Keys.** J and K move between questions, 1–9 pick, R takes the recommendation, D and L are You decide and Later, N is a note, Enter goes to the next open question, X selects, Ctrl+K opens the command list, Ctrl+Z undoes, and ? lists them all.
- **Reviews.** A compare opens on Swipe, the slider. A paged template shows one frame with a filmstrip of verdict colours and comment counts; 1–4 give a verdict and move to the next frame, which the settings can turn off. C turns on comment mode for pins, M changes the compare view, Z zooms.
- **Many at once.** Take all recommendations, or select questions or rows and give them one answer. Every change can be undone, from the toast or Ctrl+Z.
- **Sending.** Questions left open get one panel: send them as You decide, as Later, or open. A receipt then shows exactly what was sent, with Change answers and the next waiting ask.
- **Look.** Themes are in Claude Desktop's own colour tokens. With Claude Desktop installed, the page follows its theme and offers every palette it bundles; the kit's Clay, Teal, Moss, Indigo, Slate, and High contrast are there too, each light and dark. Any theme takes one of nine accents or a colour of the person's own, a text size, and Comfortable or Compact density.
- **Separation.** Each section is one panel by default, its questions split by hairlines; Cards, Lines, and Bands are in the settings.
- **Folding.** Answered questions fold to one line; Expand all (E), Collapse all (⇧E), or Fold answered changes that, and Select all (⇧X) selects every question for one bulk answer.
- **Wording.** A question is at most 160 characters, a label 60, a reason 200, and an option's description 160. Where the person asked for more detail, or the question opens follow-ups, `explain: true` gives its reasons and descriptions room.

## Blocks

A page can show more than questions: give `sections`, each a `title` and its `blocks`, or plain `blocks`. The design and the phases still to come are in the kit's `docs/design/ask-blocks.md`; the example is `blocks/status.json` beside this skill.

| Block | Fields | Export |
| --- | --- | --- |
| `text` | `text`: headings (`#`), paragraphs, `-` and `1.` lists, `**bold**`, `*italic*`, `` `code` ``, and fenced code; no links or HTML | Markdown |
| `stats` | `items` of `label`, `value` (24 characters), `tone` (ok, warn, bad, info), and `note` | Markdown, CSV |
| `table` | `columns` and `rows`, or `source`: `open-questions`, `decisions` (with `filter`, a file id), or `ledger`; sortable, and filterable over 8 rows | CSV, Markdown |
| `diff` | `before` and `after`, `by` line or word, `view` side or inline, `labels` | A unified diff |
| `questions` | Where the questions go; with none, they come after the blocks | — |
| `part` | `name` of a part in `.workflow/ask-parts/<name>.json`, and `with`, values for `{field}` | — |

- **Every block** takes a `title` and a `note`. A titled block has its own Export menu; an untitled one's sits in its section's.
- **Limits.** 60 blocks and 500 table rows a page, and 4,000 characters a text block.
- **Off.** `off` lists block kinds or features a page leaves out (`bulk`, `outline`, `palette`, `pins`, `compare`); `ask.off` in `.workflow/config.json` does it for every page, and a page's `on` brings one back.

## Answers


Each answer has `choice`, `order`, `text`, or `decide` (`agent`: you decide, `later`: an open question), with an optional `note`, `other`, and `pins` (picture index, x, y, kind, text, box).

- `npx wf ask answers <id>` prints them again; `--json` gives the file. They are in `.cache/view/answers/<id>.json`.
- `npx wf ask export <id>` writes one `.html` with the pictures inside, and the answers as `.md` and `.json`. Offline, the page saves an answers file for `wf ask import`.
- Building the page again asks again: `wait` waits for a send after the build. Answers to the same page, pictures and all, stay filled in.
- The server takes answers only from its own pages, on this machine: it listens on 127.0.0.1, refuses other host names, and needs the token it puts in each page it serves.

## Many sessions at once

One server serves every project, worktree, and session on the machine, so asks never clash.

- **Addresses.** Each project is at `http://127.0.0.1:8765/<key>/`, where the key is its folder's name and a short hash; its pages and answers stay in its own `.cache/view`.
- **The inbox.** `http://127.0.0.1:8765/` lists every ask, waiting first, with who asked: the repository, the branch or worktree, and the session. The tab title counts what waits.
- **Ids.** A page another session is still waiting on is not replaced; pick another id, or pass `--replace` when it is truly yours.
- **The server.** It runs on its own, detached, and stops after 12 idle hours; `wait` starts it again if it stopped. `npx wf view stop` stops it. Its log and registry are in `~/.local/state/freeorbit-workflow`.
