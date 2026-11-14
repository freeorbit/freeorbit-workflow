# Test-data formats

The shapes of an area's `test-data/` folder: what the blind designer writes, the reviewer reads, and the project's tools parse. The designer may read this doc. A tool finds a table's column by its header, never by its place.

## The folder

| File | Holds |
| --- | --- |
| `README.md` | The `Updated:` line, a one-sentence status, the area index, and `## Refresh history`, newest first |
| `core.md` | The rules and spec every flow area shares: personal data, placeholders, generation, real names, never, sources, personas, size profiles |
| `formats.md` | The input and output formats, the public spec for each, and each format's input classes |
| `<flow>.md` | One flow area, the `user-flows.md` sections on its `Flows:` line, while it fits on one screen |
| `<flow>/` | One flow area too long for one screen, as a folder of one-screen files |
| `coverage.toml` | Each story's acceptance hash when the spec last covered it, written by the project's tool |

- **One screen.** A file holds about 40 lines (`testdata.limits.lines`). `wf doc:check` warns past it, and past `testdata.limits.areaKB` for one flow area. A small flow area stays one file.
- **One index row.** The docs index lists the area's `README.md`, or a folder's `README.md`, which links each file in it.
- **Unique names.** Rule IDs, dataset ids, fixtures, states, and inputs are unique across the area's folder, so one file can name another's.

## A flow area's folder

| File | Holds |
| --- | --- |
| `README.md` | `Flows:` and `Covers:` lines, then one row per file and what it holds |
| `rules.md` | Its rules table, and proposed rules |
| `data.md` | Its datasets: seed, counts, stand-ins, and markers |
| `states.md` | Its journey states |
| `gaps.md` | Its gaps table |
| `<topic>.md` | One part of the flow, such as `review.md`: its checks, input classes, and edge cases side by side |

A one-file flow area has the same parts as `##` sections: `## Rules`, `## Datasets`, `## Checks`, `## Input classes`, `## Edge-case fixtures`, `## Journey states`, `## Gaps`, `## Proposed rules`, each only when it has something.

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
- **Low** gets its checks and its rules. **High** also gets the input classes of what it reads, and edge-case fixtures for what only its flow can show.

## Checks, input classes, and edge cases

A topic file, or a one-file area, holds up to three tables: what a run shows, the classes of each input, and the few cases only a flow can show.

```markdown
| Check | Stories | Rules |
| Input | Class | Values | Expect | Stories | Rules |
| Fixture | Varies | Expect | Stories | Rules | Reach |
```

- **Check.** What a passing run shows for this flow, in one line, that no rule already says. A rule that holds everywhere, such as nothing reaching a log or every step working with AI off, is not restated as a check in each flow: it gets one test across every state, and the flow's rules name it.
- **How many.** About eight checks a story and thirty a flow area (`testdata.limits.checks`). `wf doc:check` warns past them, and for the same check written in three or more files.

### Input classes

One row for each class of one input: a field, a file format, a header, a request. Every value in a class gets the same outcome, so one test of the class covers them all.

```markdown
| Input | Class | Values | Expect | Stories | Rules |
| --- | --- | --- | --- | --- | --- |
| `new-address` | Blanks at the edges | Two leading spaces; a trailing tab; U+00A0 and U+3000 around it | Trimmed, then accepted | GM-06 | R-112 |
| `new-address` | A domain no mail reaches | `mara@192.0.2.10`, `mara@localhost`, `mara@box.local` | Refused, with why | GM-06 | R-113 |
```

- **Input.** The input's id, in backticks. A format's input lives in `formats.md`, shared by every flow that reads it; a field only one flow has lives in that flow's file.
- **Class.** One class, or one boundary where the outcome changes: at the limit and one past it, not every value between.
- **Values.** The representatives, several in one cell. They are data, not fixtures: the project tests the input once, where its rule lives, with one test that walks the rows or a property test, and stores no file and no journey state for them.
- **Which classes.** Each input gets the unhappy classes it implies, once: empty, at and past its limit, malformed, duplicated, mixed encodings, and dates or time zones at the edges. A flow that reads the input does not list them again; it names the input's classes it relies on in its checks.

### Edge-case fixtures

A fixture is for what only a flow can show: a state, an order of steps, an interruption, a restart, or what one step leaves for the next. A case that varies only one input's value is an input class, not a fixture.

- **Varies.** What the fixture sets, against which state. Where axes combine, name them in one row, and the generator expands them, pairwise when every combination is too many.
- **Reach.** ``typed at `state` ``, ``date at `state` ``, or ``stored in `state` ``, then a step after a comma. A case no person can reach is an input class.
- **How many.** About five a story and fifteen a flow area (`testdata.limits.fixtures`), and four on one rule. `wf doc:check` warns past them: merge rows into one with axes, move the one-input cases to input classes, or keep them and say why in the reviewer's question.

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
