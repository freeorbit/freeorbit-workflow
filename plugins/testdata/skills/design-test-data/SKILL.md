---
name: design-test-data
description: >-
  Designs synthetic test data so development never uses real personal data:
  runs the blind test-data-designer agent to write an area's test-data spec,
  refreshes only what stale stories reach, checks the spec stayed blind, and
  keeps the project's seeded generator in step. Use when an area reaches Step
  3, at chunk start, when a chunk needs data or a journey state, or when test
  data, fixtures, or scenarios come up.
---

# Design test data

The project's process and its generator are in its test-data doc, `testdata.processDoc` in `.workflow/config.json`; read it first. Its folder table says what each file in an area's `test-data/` holds. Rule verdicts go to the reviewer in **Who decides** in `AGENTS.md`.

The project's test-data commands run through `npx wf testdata <command> <area> [arguments]`, from `testdata.commands`:

| Command | Does |
| --- | --- |
| `route <area> <ids>` | The area files those stories reach |
| `stale <area> [--chunks <this>,<next>]` | Stories whose acceptance changed since the spec covered them |
| `covered <area> <ids>` | Record those stories as covered |
| `index <area>` | Rewrite the area index in the folder's README |
| `journeys <area> [--chunks ...]` | Each journey's starting states, and the scenario that holds each |
| `refresh-close <area> <ids>` | `covered`, then `index`, after a refresh is applied |

## 1. Draft the rules, once per area

If the area's `test-data/core.md` does not exist, run the `test-data-designer` subagent in rules mode:

```text
Area id: <area>
Mode: rules
```

Save the two files it returns, `core.md` and `formats.md`, and ask the reviewer to review them. Never add rules yourself from what you know of the code: you are not blind. Later rules arrive as "Proposed rules" in a refresh.

## When to refresh

A story edit does not start the designer. Each story's acceptance is hashed, and a story whose hash differs from what the spec last covered is stale. Refresh at these points only:

- **Chunk start.** `stale <area> --chunks <this>,<next>`. If it lists stories, run one refresh for exactly those.
- **During a chunk**, when a story this chunk builds changes, before building the part that depends on it.
- **When asked**: refresh every story `stale` lists.

After the delta is applied, or after `Need: none`, run `refresh-close` for the same stories, and commit what it writes with the spec. Then run `journeys --chunks <this>,<next>`: a state or a stored fixture with no scenario is built in this chunk, and "not set" goes back to the designer in the next refresh.

## 2. Write or refresh the spec

Run the subagent in spec mode. Name only the area id, the mode, and, for a refresh, the stale story IDs and the files `route` lists for them. Leave out a file whose only hits are passing mentions unless the stories' flow is on its `Flows:` line. A story `route` finds nowhere goes to the area whose flow holds it.

```text
Area id: <area>
Mode: spec
Changed stories: <ids>
Files: <area files>
```

A first draft returns the whole folder: save each file, then run `index`. A refresh returns a delta naming each edit's file: apply only the lines it names, never a rewritten dataset or section.

- `Need: none`. Stop. Change nothing, not even the `Updated` line.
- `Need: rules` or `both`. Leave each proposed rule under `## Proposed rules` until the reviewer accepts it, then move it into that file's `## Rules`, or `core.md` when two areas need it, with `new` replaced by the day.
- `Need: spec` or `both`. Apply the edits and set `Updated:` in the README to the day the spec changed; a change to `## Rules` alone does not count.
- **README.** Keep `Status:` to one sentence. Add the refresh as one bullet at the top of `## Refresh history`: the day, what changed, and the stories.

Then follow the test-data doc's steps for a changed spec or format.

## 3. Check it stayed blind

Send it back, or fix the line, when any of these is true in a file it touched:

- It names a table, a column, a function, a code file, or a library.
- A person has a real domain or a real name.
- A story the area builds has no dataset, or a path `testdata.mustCover` names is missing.
- A dataset has no seed or no counts.
- It breaks a rule in `core.md`, `formats.md`, or the area's own `## Rules`.
- A rule line has no `(stories; date)` tag, or a rule about one area sits in `core.md`.

Then ask the reviewer. A first draft gets its own review. A refresh is reviewed with the chunk-start questions: the spec edits in a line each, and each proposed rule to accept or drop. Update the area's row in the build order's Areas table, and add a line to its History.

## 4. Build and use it

Build the data the current chunk needs with the project's seeded generator, as its test-data doc says: scenarios, generated datasets, and fixtures. Data for a later chunk waits for that chunk.

## Do not

- Let the designer read code or architecture, or pass it rules in its prompt.
- Name area files the stories do not reach.
- Have a model write data files. Code writes them from a seed.
- Commit generated datasets. Only the generator and the fixtures it writes are committed.
- Read anyone's real data or real export. A shape check of a real export is something its owner runs themselves.
