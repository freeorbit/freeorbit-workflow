---
name: design-test-data
description: >-
  Designs synthetic test data so development never uses real personal data:
  runs the blind test-data-designer agent to check stories for gaps, write an
  area's test-data spec as page-sized tables, and refresh only what stale
  stories reach; checks the spec stayed blind and short; and keeps the
  project's seeded generator in step. Use when an area reaches Step 3, at chunk
  start, when stories change, when a chunk needs data or a journey state, or
  when test data, fixtures, or scenarios come up.
---

# Design test data

The project's process and its generator are in its test-data doc, `testdata.processDoc` in `.workflow/config.json`; read it first. The shapes of every file are in the kit's `test-data-formats.md`, in `docs.workflow`. Rule verdicts go to the reviewer, and story questions to the story's owner, in **Who decides** in `AGENTS.md`.

The project's test-data commands run through `npx wf testdata <command> <area> [arguments]`, from `testdata.commands`. Each takes every story ID given.

| Command | Does |
| --- | --- |
| `route <area> <ids>` | The area files those stories reach |
| `stale <area> [--chunks <this>,<next>]` | Stories whose acceptance changed since the spec covered them |
| `covered <area> <ids>` | Record those stories as covered |
| `index <area>` | Rewrite the area index in the folder's README |
| `journeys <area> [--chunks ...]` | Each journey's starting states, and the scenario that holds each |
| `refresh-close <area> <ids>` | `covered`, then `index`, after a refresh is applied |
| `ids <area>` | The kit's own: give each check without an ID its `C-<prefix>-NN` |
| `merge <folder> [--write]`, `fold <file> <sibling> [--write]` | The kit's own: a flow area's folder as one file, or a small file into a sibling, every row kept and links moved; a dry run without `--write` |
| `rename-ids [area] [--write]` | The kit's own: qualify old `R-12`, `C-41`, `G-03`, and `D27` IDs with the area's prefix, everywhere they are cited; a dry run without `--write` |
| `trace [area]` | The kit's own: spec ids no code names, and tests that name none |

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
```

Ask the story's owner its questions, in batches as the asking rules say, with your recommendation for each: on an ask page, a `batch` page by owner. Each answer goes into the story and, when it is a choice, the decisions log. Then ask the owner about its Risk tags: a story they mark high gets a `Risk: high (<why>)` line before Acceptance. `No questions.` needs nothing.

## 2. Draft the rules, once per area

If the area's `test-data/core.md` does not exist, run the subagent in rules mode:

```text
Area id: <area>
Mode: rules
```

Save the two files it returns, `core.md` and `formats.md`, and ask the reviewer to review them on a `testdata` ask page, a table each category, one category at a time. Never add rules yourself from what you know of the code: you are not blind. Later rules arrive as proposed rules in a refresh.

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
```

**Just in time.** A first draft is for the stories of this chunk and the next only: name them as its changed stories. A later chunk's flow areas wait, as a line in the README index, until its chunk starts; then `stale` lists their stories, which were never covered, and that refresh writes them. The area's rules in `core.md` and `formats.md` are drafted whole at Step 3, since every chunk relies on them.

A first draft returns the folder for those stories: save each file, then run `index`. A refresh returns a delta naming each edit's file: apply only the rows it names, never a rewritten dataset or section.

- `Need: none`. Stop. Change nothing, not even the `Updated` line.
- **Proposed rules.** Leave each under `## Proposed rules` until the reviewer accepts it, then move its row into that file's rules table, or `core.md` when two flow areas need it, with `new` replaced by the day.
- **Spec edits.** Apply them and set `Updated:` in the README to the day the spec changed; a change to rules alone does not count.
- **Questions.** Ask them as in step 1.
- **README.** Keep `Status:` to one sentence. Add the refresh as one bullet at the top of `## Refresh history`: the day, what changed, and the stories.

After the delta is applied, or after `Need: none`, run `refresh-close` for the same stories, and commit what it writes with the spec. Then run `journeys --chunks <this>,<next>`: a state or a stored fixture with no scenario is built in this chunk, and "not set" goes back to the designer in the next refresh. Then follow the test-data doc's steps for a changed spec or format.

## 4. Check it stayed blind and short

Send it back, or fix the line, when any of these is true in a file it touched:

- It names a table, a column, a function, a code file, or a library of the project.
- A person has a real domain or a real name.
- A story the area builds has no dataset, or a path `testdata.mustCover` names is missing.
- A dataset has no seed or no counts.
- It breaks a rule in `core.md`, `formats.md`, or the flow area's own rules.
- A rule has no ID, category, stories, or Accepted cell, or a rule about one flow area sits in `core.md`. A check has no ID: run `ids`. An ID has no area prefix: run `rename-ids`.
- A low-risk story got input classes or edge-case fixtures, or prose stands where `test-data-formats.md` gives a table.
- A fixture varies only one input's value, or reaches `unit`: it belongs in that input's classes. An input's classes are listed again for another flow.
- A check restates a rule, or one that holds everywhere is written in each flow.
- `npx wf testdata trace <area>` names a row this chunk builds that no code names yet: it is not built, or its test cites another id.
- `npx wf doc:check` warns for a file it wrote: past about a page, too small to stand alone, a flow area past its size, a category on no list, an input class listed twice, or fixtures past `testdata.limits.fixtures`. Over a budget, the designer merges rows or asks the reviewer whether a row's risk is worth it.

Then ask the reviewer. A first draft gets its own review, rules one category at a time. A refresh is reviewed with the chunk-start questions: the spec edits in a line each, and the proposed rules by category, to accept or drop. Update the area's row in the build order's Areas table, and add a line to its History.

## 5. Build and use it

Build the data the current chunk needs with the project's seeded generator, as its test-data doc says: scenarios, generated datasets, and fixtures. Data for a later chunk waits for that chunk. A combined fixture row is expanded by the generator, pairwise when every combination is too many. Input classes are tested once, where their rule lives: one test walks the rows of the table, or a property test covers the class; they need no fixture file and no journey state.

With the design plugin's screen review, a new scenario goes on the area's screen list in the same change: as the Reach of each frame whose state it holds, replacing that frame's `none, <chunk>`, or as a row under "Screens with no frame". `npx wf screens --check` fails a scenario on no row.

## Do not

- Let the designer read code or architecture, or pass it rules in its prompt.
- Name area files the stories do not reach.
- Have a model write data files. Code writes them from a seed.
- Commit generated datasets. Only the generator and the fixtures it writes are committed.
- Read anyone's real data or real export. A shape check of a real export, and a domain product's Step 0 profiles, run where the samples are kept, by their owner.
