# Doc conventions

How to write the project's docs so later steps can rely on them.

## One topic per file

Put new material in the file that already owns that topic. The index is [docs/README.md](../README.md). Do not append notes to raw research exports under `docs/research/`. Add a new research file, or summarize into an existing one and say what you added.

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

Stories use stable IDs that are never reused.

Each area's prefix is in `areas` in `.workflow/config.json`.

<!-- wf:local ids -->


If a story is dropped, leave the ID in place with a one-line "Removed" note and the date. Do not renumber.

## Story shape

```markdown
### APP-01. Short name

As a first-time user, I want a short privacy promise, so that I know my mail never leaves this machine unless I send it.

Acceptance:

- Given I launch the app for the first time, the promise is shown before the plugin catalog.
- The step finishes with AI off.
```

- Role, want, and reason, in that order.
- Acceptance is testable. "Given / when / then" or a plain checklist both work.
<!-- wf:local story-rules -->


## Flows

Flows live in `user-flows.md` for that area, as mermaid flowcharts. Name nodes in camelCase with no spaces. A flow step maps to one or more story IDs. Mention those IDs in the paragraph under the diagram.

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
- **From.** Who raised it: a role, or `client (<channel>)`.
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
