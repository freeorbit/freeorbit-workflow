---
name: design-test-data
description: >-
  Designs synthetic test data so development never uses real personal data:
  runs the blind test-data-designer agent to check stories for gaps, write an
  area's data spec as page-sized tables, and refresh only what stale stories
  reach, each run held to a budget the tool counts; checks the spec stayed
  blind and short; and keeps the project's seeded generator in step. Use when an area reaches Step 3, at chunk
  start, when stories change, when a chunk needs data or a journey state, or
  when test data, fixtures, or scenarios come up.
---

# Design test data

The project's process and its generator are in its test-data doc, `testdata.processDoc` in `.workflow/config.json`; read it first. The shapes of every file are in the kit's `test-data-formats.md`, in `docs.workflow`. Rule verdicts go to the reviewer, and story questions to the story's owner, in **Who decides** in `AGENTS.md`.

The designer designs data: datasets, journey states, input classes, and edge-case fixtures. It writes no checks. A story's acceptance lines are its checks, each by its ID, such as `GM-07.3`, and a test or a scenario cites the line it proves.

The project's test-data commands run through `npx wf testdata <command> <area> [arguments]`, from `testdata.commands`. Each takes every story ID given.

| Command | Does |
| --- | --- |
| `route <area> <ids>` | The area files those stories reach |
| `stale <area> [--chunks <this>,<next>]` | Stories whose acceptance changed since the spec covered them |
| `covered <area> <ids>` | Record those stories as covered |
| `index <area>` | Rewrite the area index in the folder's README |
| `journeys <area> [--chunks ...]` | Each journey's starting states, and the scenario that holds each |
| `refresh-close <area> <ids>` | `covered`, then `index`, after a refresh is applied; refused when the refresh took one of those stories over budget |
| `budget <area> [ids] [--check]` | The kit's own: each story's fixtures against its cap, as the `Budget:` block for the designer's prompt; `--check` fails when one is over |
| `delta <area> <file>` | The kit's own: the designer's return, saved to a file, held to its caps before any of it is applied |
| `prune <area> [--all] [--write]` | The kit's own: check rows from before v0.69.0 that no code cites, out of the spec; a dry run without `--write` |
| `merge <folder> [--write]`, `fold <file> <sibling> [--write]` | The kit's own: a flow area's folder as one file, or a small file into a sibling, every row kept and links moved; a dry run without `--write` |
| `review <area> [--chunk <id> \| --stories <ids>] [--team]` | The kit's own: an ask page's spec of the owner's rules, or with `--team` the team's craft rules, for `npx wf ask page -`; a solo project gets both on the one page |
| `drop <area> --from <ask id> [--write]` | The kit's own: the rows a review page marked Drop, out of the spec and into the README's Dropped table |
| `rename-ids [area] [--write]` | The kit's own: qualify old `R-12`, `C-41`, `G-03`, and `D27` IDs with the area's prefix, everywhere they are cited; a dry run without `--write` |
| `trace [area]` | The kit's own: spec ids no code names, and tests that name none |

## Every run has a budget

The designer's volume is counted by the tool, never left to its judgement. On every run:

1. **Before.** Run `npx wf testdata budget <area> <ids>` and paste its `Budget:` block into the prompt, as it prints it. It holds counts, limits, and the next free IDs, not rules, so the designer stays blind.
2. **After.** Save what the designer returned to `.cache/testdata/<area>-return.md` and run `npx wf testdata delta <area> <that file>`.
   - It fails when the return holds more than `testdata.limits.questions` questions, more than `testdata.limits.propose` proposed acceptance lines for a story, or any check row.
   - Apply what is within the caps and leave the rest out. Name what was held back in one line to the owner.
   - Do not run the designer again to make it fit: a second run costs more than the rows it would save.
3. **At the close.** `refresh-close` refuses when one of those stories, its flow area, or a rule its fixtures cite is over budget and holds more fixtures than at the last commit. An overage that was already there does not stop it; `budget --check` and `doc:check` still list it. Merge rows into one with axes, move a one-input case into its input classes, or drop the row. An exception is the owner's, in `testdata.limits.allow`.

## The designer's three jobs

| Job | Mode | When |
| --- | --- | --- |
| Story check | `check` | Whenever stories change, before frames or a refresh build on them |
| Rules and spec | `rules`, then `spec` | At Step 3, once per area |
| Refresh | `spec` with changed stories | At chunk start, and when a story this chunk builds changes |

## 1. Check the stories

When stories are written or changed, run the subagent in check mode. It reads and returns only questions, so it is cheap.

```text
Area id: <area>
Mode: check
Changed stories: <ids>
Files: <area files route lists, or none>
Budget:
<the block npx wf testdata budget printed>
```

Run `delta` on what it returns, then ask the story's owner, in one batch as the asking rules say, with your recommendation for each: on an ask page, a `batch` page by owner.

- **Questions.** Each answer goes into the story and, when it is a choice, the decisions log.
- **Proposed acceptance lines.** Each one the owner accepts is added to the story as its last acceptance line, so no other line's ID moves. One they refuse is dropped.
- **Risk tags.** A line they mark high ends with `Risk: high (<why>)`. A story gets its own `Risk: high (<why>)` line before Acceptance only when every line is high: `npx wf doc:check` warns when more than a third of an area's lines are.

`No questions.` needs nothing.

## A spec written before v0.69.0

Its `| ID | Check |` tables stay readable, and a test that cites `C-GM-41` still names it. Nothing gates, budgets, or reviews those rows, and the designer adds none.

- `npx wf testdata prune <area>` lists the check rows no code cites, for stories already built; `--write` takes them out. Rows with a By or a dispute stay.
- A rule with no Type takes it from its category where it can. Type the rest by hand as they come up; there is no tagging pass.

## 2. Draft the rules, once per area

If the area's `test-data/core.md` does not exist, run the subagent in rules mode:

```text
Area id: <area>
Mode: rules
```

Save the two files it returns, `core.md` and `formats.md`, and ask for their review: `npx wf testdata review <area> | npx wf ask page -` for the owner's product and safety rules, and `--team` for the craft rules, a category at a time. In a solo project the first page holds both, the craft rules as one row. Never add rules yourself from what you know of the code: you are not blind. Later rules arrive as proposed rules in a refresh.

## 3. Write or refresh the spec

A story edit does not start the designer. Each story's acceptance is hashed, and a story whose hash differs from what the spec last covered is stale. Refresh at these points only:

- **Chunk start.** `stale <area> --chunks <this>,<next>`. If it lists stories, run one refresh for exactly those. A `dispute` row in a gaps table joins it: name the disputed check's stories, and its file.
- **During a chunk**, when a story this chunk builds changes, before building the part that depends on it.
- **When asked**: refresh every story `stale` lists.

Run the subagent in spec mode. Name only the area id, the mode, and, for a refresh, the stale story IDs and the files `route` lists for them. Leave out a file whose only hits are passing mentions unless the stories' flow is on its `Flows:` line. A story `route` finds nowhere goes to the area whose flow holds it.

```text
Area id: <area>
Mode: spec
Changed stories: <ids>
Files: <area files>
Budget:
<the block npx wf testdata budget printed>
```

**Just in time.** A first draft is for the stories of this chunk and the next only: name them as its changed stories. A later chunk's flow areas wait, as a line in the README index, until its chunk starts; then `stale` lists their stories, which were never covered, and that refresh writes them. The area's rules in `core.md` and `formats.md` are drafted whole at Step 3, since every chunk relies on them.

A first draft returns the folder for those stories: save each file, then run `index`. A refresh returns a delta naming each edit's file: run `delta` on it, then apply only the rows it names, never a rewritten dataset or section.

- `Need: none`. Stop. Change nothing, not even the `Updated` line.
- **Proposed rules.** Leave each under `## Proposed rules` until the reviewer accepts it, then move its row into that file's rules table, or `core.md` when two flow areas need it, with `new` replaced by the day.
- **Spec edits.** Apply them and set `Updated:` in the README to the day the spec changed; a change to rules alone does not count.
- **Questions and proposed acceptance lines.** Ask them as in step 1.
- **README.** Keep `Status:` to one sentence. Add the refresh as one bullet at the top of `## Refresh history`: the day, what changed, and the stories.

After the delta is applied, or after `Need: none`, run `refresh-close` for the same stories, and commit what it writes with the spec. Then run `journeys --chunks <this>,<next>`: a state or a stored fixture with no scenario is built in this chunk, and "not set" goes back to the designer in the next refresh. Then follow the test-data doc's steps for a changed spec or format.

## 4. Check it stayed blind and short

Send it back, or fix the line, when any of these is true in a file it touched:

- It names a table, a column, a function, a code file, or a library of the project.
- A person has a real domain or a real name.
- A story the area builds has no dataset, or a path `testdata.mustCover` names is missing.
- A dataset has no seed or no counts.
- It breaks a rule in `core.md`, `formats.md`, or the flow area's own rules.
- It added a row to a checks table, or wrote a new one. What a passing run shows is an acceptance line.
- A rule has no ID, category, stories, or Accepted cell, or a rule about one flow area sits in `core.md`. An ID has no area prefix: run `rename-ids`.
- A rule says how the app behaves, with Type `product`: that is a proposed acceptance line, or a question.
- A low-risk story got input classes or edge-case fixtures, or prose stands where `test-data-formats.md` gives a table.
- A fixture varies only one input's value, or reaches `unit`: it belongs in that input's classes. An input's classes are listed again for another flow.
- `npx wf testdata trace <area>` names a row this chunk builds that no code names yet: it is not built, or its test cites another id.
- `npx wf doc:check` warns for a file it wrote: past about a page, too small to stand alone, a flow area past its size, a category on no list, or an input class listed twice.
- `npx wf testdata budget <area> <ids> --check` lists a row this run added. Fix the rows by hand as the budget section says; do not send the designer back for it.

Then ask for the review of its rules: `npx wf testdata review <area> [--chunk <this>] | npx wf ask page -` for the owner's, `--team` for the craft rules, accepted in bulk; solo, one page. A first draft gets its own review; a refresh goes with the chunk-start questions. After a send, `npx wf testdata drop <area> --from <ask id> --write` applies each Drop. Update the area's row in the build order's Areas table, and add a line to its History.

## 5. Build and use it

Build the data the current chunk needs with the project's seeded generator, as its test-data doc says: scenarios, generated datasets, and fixtures. Data for a later chunk waits for that chunk. A combined fixture row is expanded by the generator, pairwise when every combination is too many. Input classes are tested once, where their rule lives: one test walks the rows of the table, or a property test covers the class; they need no fixture file and no journey state.

With the design plugin's screen review, a new scenario goes on the area's screen list in the same change: as the Reach of each frame whose state it holds, replacing that frame's `none, <chunk>`, or as a row under "Screens with no frame". `npx wf screens --check` fails a scenario on no row.

## Do not

- Let the designer read code or architecture, or pass it rules in its prompt. The `Budget:` block is counts, and is the one thing you add.
- Run the designer a second time to fit a budget, or write check rows yourself.
- Name area files the stories do not reach.
- Have a model write data files. Code writes them from a seed.
- Commit generated datasets. Only the generator and the fixtures it writes are committed.
- Read anyone's real data or real export. A shape check of a real export, and a domain product's Step 0 profiles, run where the samples are kept, by their owner.
