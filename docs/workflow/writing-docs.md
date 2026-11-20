# Doc conventions

How to write the project's docs so later steps can rely on them.

## One topic per file

Put new material in the file that already owns that topic. The index is [docs/README.md](../README.md). Do not append notes to raw research exports under `docs/research/`. Add a new research file, or summarize into an existing one and say what you added.

## What stays in AGENTS.md

A rule stays in full in `AGENTS.md`, not behind a link, when all three hold:

- it applies in any chat;
- nothing loads its detail before the moment it applies, such as a skill or a step that reads the doc;
- missing it costs someone's time or a wrong choice.

The asking rules pass. A rule that a skill or a check brings in at the right moment lives in that skill, inside its numbered steps.

## At a glance

A person reads a doc by skimming. An agent reads it by searching. Both need short, separate pieces.

- **Lead.** The first line under a heading says what the section is for, in one sentence.
- **Short blocks.** A paragraph is three sentences or fewer. A bullet is one idea, about 40 words.
- **Limit.** `npx wf doc:check` fails a paragraph or bullet over 60 words. Code and headings do not count.
- **Table cells.** A cell over 30 words is split into a short lead and `<br>• ` bullets, each at most 15 words, since a cell holds no real list. `doc:check` fails a longer cell or bullet.
- **Split a long bullet.** Keep the bold name and the rule on the first line. Put each detail in a sub-bullet under it.
- **Tables** hold anything compared across the same columns, such as options, tools, or states.
- **Steps** are a numbered list, one action per step.
- **No repeats.** Link to the file that owns a fact rather than retelling it.

A rule doc or an architecture doc follows this shape:

```markdown
# Title

One sentence: what this file is for, and who reads it.

## Part

One sentence: what this part decides.

- **Name.** The rule or fact, in one sentence.
  - A detail, an exception, or the reason.
```

Some docs predate the limit. `docs.loose` in `.workflow/config.json` lists them, and `npx wf doc:facts growth` counts their long blocks. Take a doc off the list when it is tightened. A new doc is never added to it.

## IDs

Stories use stable IDs that are never reused. Every kind of ID, and how to find one, is in [ids.md](ids.md).

Each area's prefix is in `areas` in `.workflow/config.json`.

<!-- wf:local ids -->


If a story is dropped, leave the ID in place with a one-line "Removed" note and the date. Do not renumber.

## Story shape

```markdown
### APP-01. Short name

As a first-time user, I want a short privacy promise, so that I know my mail never leaves this machine unless I send it.

Acceptance:

- Given I launch the app for the first time, the promise is shown before the plugin catalog. Risk: high (privacy)
- The step finishes with AI off.
```

- Role, want, and reason, in that order.
- Acceptance is testable. "Given / when / then" or a plain checklist both work.
- Each acceptance line is a check with an ID by its place: the story's ID, a dot, and the line's number in the list. A test cites the line it proves.
  - Add a new line last, and leave one taken out as `- Removed (<date>).`, so no other line's ID moves.
  - The client reads the lines on the board, so a line holds no date and no decision ID. When a line is added or changed, the note goes in the area's `story-changes.md`.
- `Risk: high (<why>)` at the end of a line marks one about money, privacy, irreversible steps, outside input, evidence, or workspaces, so its test data gets edge cases.
  - A story whose every line is high takes the tag once, on a line of its own before Acceptance. No tag is low.
<!-- wf:local story-rules -->


## Flows

Flows live in `user-flows.md` for that area, as mermaid flowcharts. Name nodes in camelCase with no spaces. A flow step maps to one or more story IDs. Mention those IDs in the paragraph under the diagram.

## Plan docs

An area may have a plan doc for the work that is not a story: research, rounds of questions with a domain expert, a trial, the architecture. Start one from the kit's `templates/plan.md`.

- **Only work that is not a story.** A step leaves behind knowledge, a decision, or a tool. What a person can check by using the product is a story, built in the order the build order gives, and never repeated as a step.
- **It ends where the build order takes over.** A phase that would be "build these stories" is left out; a step that unblocks a story names it under Unblocks.
- **Shown to the client.** With `board.workItems.plans` listing it, each phase and step is a work item on the client's board, apart from the stories. `npx wf doc:check` checks its shape.

```markdown
## Phase 1. Understand the documents

Learn what the documents hold before deciding what to build.

| ID | Step | Who | Status | Leaves behind | Unblocks |
| --- | --- | --- | --- | --- | --- |
| W-APP-01 | 1.1 Profile each sample document | Developer | Done | A profile of each | |
| W-APP-02 | 1.2 Get the missing records from the expert | Expert, developer | Waiting on Glen: asked 2026-11-20 | A contract for records | APP-03 |
```

- **A phase.** A `## Phase N. Title` heading, numbered 1, 2, 3 in order, a new one last. Under it a one-sentence lead, then the table. Other `##` sections are the team's and are not read.
- **A step.** `ID`, then `Step`, `Who`, and `Status`. `Leaves behind` and `Unblocks` are optional.
  - `ID` is `W-<prefix>-<nn>`, never reused. A step keeps it when renumbered, so its board item keeps the client's replies.
  - `Step` is the step's number under its phase, then what is done.
  - `Unblocks` lists the story IDs the step unblocks, comma-separated.
- **Status.** One of these words, then a comma or colon and anything the client should read, such as `Later: after 1.7`.
  - **Done.** Finished.
  - **Now.** In hand.
  - **Next.** Can start as soon as someone picks it up.
  - **Later.** Waits on an earlier step.
  - **Waiting.** `Waiting on <name>`: waits on a person outside the work, such as the client.
- **What the client reads.** A phase's title and lead, and a step's text, Who, and Status, so none holds an ID, a link, a backtick, or a file path. `Leaves behind` is the team's and may.

## Logs

The append-only records live in `docs/log/`. They grow every chunk, so nobody reads one whole, and each keeps a shape that grep can find:

- One entry is one table row, one bullet, or one `### ` section, never spread over loose paragraphs.
- The row or bullet starts with what a search is for: a date, an ID, a chunk number, or a bold short name.
- A section heading is the ID or the symptom, as someone would search for it.
- A script that cuts a log matches a heading as a whole line (`^## Open$`), because `## Open` is also inside `### Open`.
- What is settled moves to its own file, as closed findings and resolved questions do, so the live file stays the size of what is left to do.

`npx wf doc:find` prints an entry by what it starts with, and `npx wf doc:facts` reports a log that has outgrown its line.

## Decisions and open questions

Where each note goes is the table in [AGENTS.md](../../AGENTS.md).

- A decision is a dated row with the reason, under its topic.
- An open question is a row in the table under the chunk it blocks, or under "Not tied to a chunk yet". `npx wf question add` gives it the next ID.

```markdown
## CH-03: Risk register

| ID | Question | Needs | From | Story | Raised |
| --- | --- | --- | --- | --- | --- |
| Q-012 | Should risk names match the client's register exactly? | owner | client (monday) | REV-03 | 2026-11-02 |

- **Q-012.** The register spells some names two ways.
```

- **ID.** `Q-NNN`, one counter across the open and resolved logs, never reused.
- **Needs.** The role that answers it, from `roles`, or `client`, which the client's board asks on its story's item. A row under a chunk's heading is an open sign-off for `npx wf signoffs` until it moves out, except a `client` one, which never holds a merge.
- **From.** Who raised it: a role, `client (<channel>)`, or `team (<channel>)` for a teammate's comment on a board.
- **Story.** The story IDs it touches, or `none`. **Raised** is the date.
- **Detail.** The Question cell is one short sentence. More goes in one bullet per ID under the table, `- **Q-012.** ...`, with sub-bullets if needed.
- **Revisit.** An untied question blocks nothing, so its detail says when to ask it again: a `Revisit when: ...` line on its bullet or a sub-bullet, or `--revisit "<when>"` on `npx wf question add`. `npx wf doc:facts status` lists each trigger for chunk start and the code review, and names the untied questions with none.
- **Answered.** In the same pass, the answer goes in the decisions log, and `npx wf question resolve <ID> "<D-IDs or none: why>"` moves the row to the resolved log with the date. Nothing ticked stays in the open log, and `npx wf doc:check` fails one.
- Do not record a tech stack, a library, or an architecture boundary as a decision before Step 3 of that area.

## Architecture

A library named in these docs is a candidate. It is agreed before it is added in Step 4.

<!-- wf:local area-rules -->

<!-- wf:local design -->

## New area folder

A new area gets its stories and flows, its screen list, and a row in the docs index and in the build order's Areas table, with its own file in the build order folder.

<!-- wf:local area-folder -->
