# Test-data formats

The shapes of an area's `test-data/` folder: what the blind designer writes, the reviewer reads, and the project's tools parse. The designer may read this doc. A tool finds a table's column by its header, never by its place.

## The folder

| File | Holds |
| --- | --- |
| `README.md` | The `Updated:` line, a one-sentence status, the area index, and `## Refresh history`, newest first |
| `core.md` | The rules and spec every flow area shares: personal data, placeholders, generation, real names, never, sources, personas, size profiles |
| `formats.md` | The input and output formats, and the public spec for each |
| `<flow>.md` | One flow area, the `user-flows.md` sections on its `Flows:` line, while it fits on one screen |
| `<flow>/` | One flow area too long for one screen, as a folder of one-screen files |
| `coverage.toml` | Each story's acceptance hash when the spec last covered it, written by the project's tool |

- **One screen.** A file holds about 40 lines (`testdata.limits.lines`). `wf doc:check` warns past it, and past `testdata.limits.areaKB` for one flow area. A small flow area stays one file.
- **One index row.** The docs index lists the area's `README.md`, or a folder's `README.md`, which links each file in it.
- **Unique names.** Rule IDs, dataset ids, fixtures, and states are unique across the area's folder, so one file can name another's.

## A flow area's folder

| File | Holds |
| --- | --- |
| `README.md` | `Flows:` and `Covers:` lines, then one row per file and what it holds |
| `rules.md` | Its rules table, and proposed rules |
| `data.md` | Its datasets: seed, counts, stand-ins, and markers |
| `states.md` | Its journey states |
| `gaps.md` | Its gaps table |
| `<topic>.md` | One part of the flow, such as `review.md`: its checks and its edge cases side by side |

A one-file flow area has the same parts as `##` sections: `## Rules`, `## Datasets`, `## Checks`, `## Edge-case fixtures`, `## Journey states`, `## Gaps`, `## Proposed rules`, each only when it has something.

## Rules

```markdown
| ID | Category | Rule | Stories | Accepted |
| --- | --- | --- | --- | --- |
| R-09 | Money and limits | Estimates are asserted only by how they relate, never by a price | GM-36, GM-37 | 2026-11-13 |
```

- **ID.** `R-NN`, the next free number in the area, never reused.
- **Rule.** One line a reader takes in at once. A rule two flow areas need goes in `core.md`.
- **Accepted.** The day the reviewer accepted it. A proposed rule sits under `## Proposed rules` in the same table shape, with `new`, and the reviewer accepts a category's rows together.

## Categories

| Category | Use |
| --- | --- |
| Never sent or stored | What must never leave the machine, reach a log, or be kept |
| Money and limits | Prices, spend, caps, quotas, and counts with a ceiling |
| Time | Fixed todays, dates, time zones, ages, and anything that would read the clock |
| Input shape | Formats, sizes, encodings, and malformed or huge input |
| State | What a step may change, in what order, and what survives a restart |
| Trust | Outside text, links, replies from other systems, and what may act on them |
| Evidence and citations | A judgement or extracted field and the passage it rests on |
| Workspaces | One client, tenant, or account never seeing another's data |

A project adds its own in `testdata.categories`, such as Stand-ins or Data markers. `wf doc:check` warns for a rules table's category on neither list.

## Risk tiers

A story's owner tags it with a line before Acceptance: `Risk: high (money, outside input)`, or `Risk: low`. No line is low.

- **High** is for money, privacy, irreversible steps, outside input, evidence, or workspaces.
- **Low** gets its checks and its rules. **High** also gets edge-case fixtures.

## Checks and edge cases

A topic file, or a one-file area, holds two tables.

```markdown
| Check | Stories | Rules |
| Fixture | Varies | Expect | Stories | Rules | Reach |
```

- **Check.** What a passing run shows, in one line.
- **Varies.** What the fixture sets, against which state. Where axes combine, name them, and the generator expands them, pairwise when every combination is too many.
- **Reach.** ``typed at `state` ``, ``date at `state` ``, ``stored in `state` ``, or `unit` (no person can reach it), then a step after a comma.

## Datasets

`### D22. Short name`, then `Covers:` with story IDs and `Starts from:` with journey states. A two-column table gives the seed, the data, and where it is checked. Short paragraphs say what it holds and what a passing run shows.

## Journey states

```markdown
| State | What is already done |
```

A state is kebab-case and names its fixed today when anything depends on a date. A list, ``- `state`: what is done``, reads the same.

## Gaps and story-check questions

```markdown
| ID | Kind | Category | Question | Stories |
| G-03 | gap | Time | Does the same calendar day 12 months back count as stale? | GM-39 |
```

- **Kind.** `gap`: the stories leave it open. `contradiction`: two lines say different things.
- **Category.** A rule category where one fits, else the topic.
- **Question.** One the story's owner can answer. An answered row leaves the table, and its answer goes to the decisions log.
- A story check adds a second table for stories that look high-risk with no Risk line: `| Story | Risk | Why |`.
