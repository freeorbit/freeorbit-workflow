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

1. Pick a template: `npx wf ask templates`. Start from its example: `npx wf ask example <template> > .cache/view/<id>.json`, then edit it. The example builds as it is, with stand-in pictures.
   - `npx wf ask fields <part>` prints one template's, question type's, or block's fields and limits.
   - `npx wf ask page <spec> --check` checks a spec and builds nothing, so the open page stays.
2. **Pictures.** A question about a frame, a screen, or an image shows it, with boxes around what to look at. Never crop or join pictures by hand.
   - With the design plugin, make them with `npx wf design annotate <spec> --ask`; the `design-frames` skill has its spec. It writes each picture on its own and `<out>.ask.json`: paste its pairs into a question's `compare` or the `compare` template's `pairs`, and its pictures into `pictures`.
   - A shot from `wf screens` or `wf app` goes through it too, as an `image` with `rect` boxes. A frame against the app is one compare pair, never one joined sheet.
3. Build the page: `npx wf ask page .cache/view/<id>.json`. It checks the spec, copies the pictures, starts the shared server if none runs, and prints the address.
   - Read every `Grouping:`, `Pictures:`, and `Template:` line it prints. Fix the spec and build again, or say in the chat why not.
4. Open the page, every time, before anything else: `npx wf ask open <id>`. It opens where the person looks, by `ask.open`: a tab of Orca's browser in Orca, the system's browser in a terminal. In Claude's desktop app it says to open the address in the browser pane: do, and where the pane's preview start is needed, start `ask-pages` from `.claude/launch.json`, which joins the shared server.
   - Then bring the pane into view where the harness can, such as the desktop app's show-pane tool, so a pane tucked in the sidebar is not missed.
5. Run `npx wf ask wait <id>` in the background. Say in one line, starting **Waiting on the ask page:**, what it asks; do not repeat the questions in the chat.
   - While `wait` runs, the page's header says "Agent waiting", its tab title and icon carry a dot, and the person gets a desktop notification, then one reminder after `ask.remind` minutes (`ask.notify`).
   - End the turn there, with no question, buttons, or "Sent it" choice in the chat, and none in a closing next-step box either. `wait` wakes you when the page is sent, and a choice in the chat stays open after the person has answered on the page.
   - A page built again asks again: open it and run `wait` again.
6. When `wait` prints the answers, act on them. A partial send lists the open questions; carry on with what is answered, and wait again for the rest.
7. Run `npx wf ask record <id>` when the spec marks decisions with `record`, or any answer is "Later". Each "Later" becomes an open question for the person the answer names in `for`, else the question's `role`, else the owner, with its note under it.

No browser pane: send `wf ask export <id>`'s `.html` file, or ask in the chat. When the person says notifications do not show, run `npx wf view notify`. The person's Copy answers text, pasted into the chat, is read with `wf ask import` from a file holding it.

## Grouping

No limit on questions is no reason to ask them all at once. `wf ask page` prints Grouping advice where a page could be grouped better; act on it, or say why not.

- **One page per moment.** Ask together what blocks the next piece of work. A question nothing waits on yet goes on a later page; a blocking one never waits behind it.
- **By what the person thinks about together**: a screen, an area, a role. Each `group` says what it decides; groups go in the order the work will. Past about eight questions, use `sections`, or `steps: true` when they follow one another.
- **One question for the same shape.** Three or more with the same options are one `grid`; several facts about one thing, one `form`; the same verdict on many items, `triage` or a table; a choice that matters only after another answer, a `showIf` follow-up.
- **Answerable in a few minutes**, about a dozen answers. Past that, steps, or a second page once the first is answered.

## Which part for which question

Every template, question type, and block is made for one kind of question. Pick by what you need; `npx wf ask example <template>` gives its spec, and [templates](reference/templates.md) lists each one's items.

| You need | Use |
| --- | --- |
| One of a few plans or answers | `decision` |
| How to run a step: runs with their commands, and options that add flags | `launch`; `npx wf choose <point>` writes one from the project, and its answer is the command |
| Answers from several people, each their own | `batch`, by `role`: chunk start, a story check |
| The open questions: now, keep, or drop | `triage`, with `verdicts` for others, such as Accept, Defer, Reject on review findings |
| An order: chunks, fixes, stories | `rank`, or a `rank` question |
| A plan approved step by step | `plan` |
| A chunk closed: done or object per check | `signoff` |
| Words for a label or a message | `naming`, with the screen as a picture |
| Rows judged: test data, a rules table | `testdata`, a table each |
| A frame against the app, before against after | `compare`, pairs from `wf design annotate --ask` |
| Several frames, or a journey | `frame-review`, or `storyboard` step by step |
| Where a long step stands | `status`, updated with `wf ask live` |
| A rating, a choice per row, a sort, edits, a few fields | `scale`, `grid`, `buckets`, `edits`, `form` |
| Several decisions that follow one another | `"steps": true`, a section each |
| To show numbers, rows, text, a change, a plan in time, work in columns, a flow | `stats`, `table`, `text`, `diff`, `timeline`, `board`, `diagram`, `chart` |
| Where to look on a picture | `boxes` as data, from `--ask` |

`wf ask page` prints advice where a page could use a better part: Grouping, Pictures, and Template.

## The spec

- **Fields.** A field the kit does not know fails the check, with the nearest name.
- **Top.** `id` (lowercase, dashes), `title`, `template`, `intro`; `chunk` and `from` (a role) for the record.
- **A question.** `id`, `text`, `type` (`one`, `many`, `text`, `rank`, or a richer one below), `options` of `id`, `label`, `why`, `preview` (a text sketch), `kind` (a colour), and `recommended` with `why`.
  - **Recommend.** In `decision`, `batch`, `naming`, and `triage`, every option says what it means in its own `why`, and every choice names `recommended` and says `why`; `rank` lists its items in the suggested order and says `why` at the top. The page check fails without them.
  - `noPick` instead, only when there is honestly nothing to recommend, says why; the page shows it. A review template's verdicts are the person's own, so they recommend nothing; a `testdata` page from `npx wf testdata review` recommends Fine on each row, so the rows can be accepted together.
  - `role`, `group`, `look` (where to look), `detail`, `chunk`.
  - `pictures`: `image` (a path in the project), `label`, `name`, and `boxes` of `n`, `kind`, `rect` `[x, y, width, height]` in the picture's pixels.
  - `compare`: two pictures, the frame or before first. `pins: true` lets the person pin comments on the pictures.
  - `other: true` adds "Something else" with a text box; `defer: false` hides "You decide" and "Later".
  - `record`: a decisions file id, such as an area's, for `wf ask record`.
- **Pictures.** Step 2 makes them.

## Room and wording

- **Room.** Options with no description sit in one row; three or more questions with the same described options describe them once above. A page with a picture or a block takes the window's width, and its text keeps a reading width. On a wide window a picture sits beside its answer at the window's height; on a narrower one it sits above the answer at a third of the window. A table page and a paged review take the window's width too.
- **Wording.** A question is at most 160 characters, a label 60, a reason 200, and an option's description 160. Where the person asked for more detail, or the question opens follow-ups, `explain: true` gives its reasons and descriptions room.

## More, read when the page needs it

- **[The page](reference/the-page.md).** What the person sees and uses: keys, reviews, sending, themes, motion, folding. Read it when they ask how the page works.
- **[Blocks](reference/blocks.md).** Sections of text, tiles, tables, diffs, charts, diagrams, timelines, and boards around the questions, with their exports and what turns off.
- **[Answer types](reference/answer-types.md).** Scale, grid, buckets, edits, and form questions; follow-ups with `showIf`, owners, and boxes on pictures.
- **[A project's own templates](reference/project-templates.md).** A template kept as data in `.workflow/ask-templates/`, checked like the kit's.
- **[Many sessions](reference/many-sessions.md).** One server for every project and session, the inbox, ids, and stopping the server.
- **[Live pages](reference/live.md).** A status page you update while a step runs, a reply under a question, history, what changed, step-by-step pages, and the waiting count and notifications.

## Answers


Each answer has `choice`, `order`, `text`, `number`, `rows`, `edits`, `fields`, or `decide` (`agent` or `later`, and with `later` a `for` role), with an optional `note`, `other`, `owner`, `reply`, and `pins` (picture, x, y, `w` and `h` for a box, kind, text).

- `wait` prints a count, then every answer; past eight plain agreements with the recommendation, only the others. `npx wf ask answers <id>` prints them again, `--all` lists every one, and `--json` gives the file. They are in `.cache/view/answers/<id>.json`.
- `npx wf ask export <id>` writes one `.html` with the pictures inside, and the answers as `.md` and `.json`. Offline, the page saves an answers file for `wf ask import`.
- Answers to a page built again, pictures and all, stay filled in.

