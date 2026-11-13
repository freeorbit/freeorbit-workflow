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
2. Build the page: `npx wf ask page .cache/view/<id>.json`. It checks the spec, copies the pictures, and prints the address.
3. Start the `question-pictures` server from `.claude/launch.json` (the browser pane's preview start, by that name), and open the address in the pane.
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

## The spec

- **Top.** `id` (lowercase, dashes), `title`, `template`, `intro`; `chunk` and `from` (a role) for the record.
- **A question.** `id`, `text`, `type` (`one`, `many`, `text`, `rank`), `options` of `id`, `label`, `why`, `preview` (a text sketch), `kind` (a colour), and `recommended` with `why`.
  - **Recommend.** In `decision`, `batch`, `naming`, and `triage`, every choice names `recommended` and says `why`; `rank` lists its items in the suggested order and says `why` at the top. The page check fails without them.
  - `noPick` instead, only when there is honestly nothing to recommend, says why; the page shows it. A review template's verdicts are the person's own, so they recommend nothing.
  - `role`, `group`, `look` (where to look), `detail`, `chunk`.
  - `pictures`: `image` (a path in the project), `label`, `name`, and `boxes` of `n`, `kind`, `rect` `[x, y, width, height]` in the picture's pixels.
  - `compare`: two pictures, the frame or before first. `pins: true` lets the person pin comments on the pictures.
  - `other: true` adds "Something else" with a text box; `defer: false` hides "You decide" and "Later".
  - `record`: a decisions file id, such as an area's, for `wf ask record`.
- **Pictures.** A sheet from `npx wf design annotate`, or a shot from `wf screens` or `wf app`, works as a picture; the box kinds are the annotate kinds.

## Answers

Each answer has `choice`, `order`, `text`, or `decide` (`agent`: you decide, `later`: an open question), with an optional `note`, `other`, and `pins` (picture index, x, y, kind, text, box).

- `npx wf ask answers <id>` prints them again; `--json` gives the file. They are in `.cache/view/answers/<id>.json`.
- `npx wf ask export <id>` writes one `.html` with the pictures inside, and the answers as `.md` and `.json`. Offline, the page saves an answers file for `wf ask import`.
- Building the page again asks again: `wait` waits for a send after the build. Answers to the same page, pictures and all, stay filled in.
- The server takes answers only from its own pages, on this machine: it listens on 127.0.0.1, refuses other host names, and needs the token it puts in each page it serves.
