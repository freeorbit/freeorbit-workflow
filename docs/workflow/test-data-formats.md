# Test-data formats

The shapes of an area's `test-data/` folder: what the blind designer writes, the reviewer reads, and the project's tools parse. The designer may read this doc. A tool finds a table's column by its header, never by its place.

## The folder

| File | Holds |
| --- | --- |
| `README.md` | The `Updated:` line, a one-sentence status, the area index, `## Refresh history` newest first, and `## Dropped` |
| `core.md` | The rules and spec every flow area shares: personal data, placeholders, generation, real names, never, sources, personas, size profiles |
| `formats.md` | The input and output formats, the public spec for each, and each format's input classes |
| `<flow>.md` | One flow area, the `user-flows.md` sections on its `Flows:` line, while it fits on about a page |
| `<flow>/` | One flow area past a page and a half, as a folder of page-sized files |
| `glossary.md` | The area's domain words in plain terms, `\| Term \| Plain meaning \|`, for an owner new to the domain; the README's index links it |
| `coverage.toml` | Each story's acceptance hash when the spec last covered it, written by the project's tool |

- **About a page.** A file holds up to about 100 lines (`testdata.limits.lines`). `wf doc:check` warns past it, and past `testdata.limits.areaKB` for one flow area.
- **Not too many files.** A folder under about 150 lines (`testdata.limits.folder`) whose one file, without the README, would fit `testdata.limits.lines` is one file, and a file in a folder under about 15 lines (`testdata.limits.small`) folds into a sibling. `wf doc:check` advises both, naming the command: each file is a read and a link.
- **Merging and folding.** `npx wf testdata merge <folder>` makes a folder one file, and `npx wf testdata fold <file> <sibling>` puts a small file into a sibling. Each table goes to the section its header names, and links to a file now gone are moved. Nothing is written without `--write`, nor unless every row is kept.
- **One index row.** The docs index lists the area's `README.md`, or a folder's `README.md`, which links each file in it.
- **Unique across the app.** Rule, gap, and dataset IDs carry the area's prefix, such as `R-GM-09`, so no two areas share one. Fixtures, states, and inputs are named once in the whole app. [ids.md](ids.md) has every pattern, and `npx wf id <ID>` finds where one is defined and cited.

## A flow area's folder

| File | Holds |
| --- | --- |
| `README.md` | `Flows:` and `Covers:` lines, then one row per file and what it holds |
| `rules.md` | Its rules table, and proposed rules |
| `data.md` | Its datasets: seed, counts, stand-ins, and markers |
| `states.md` | Its journey states |
| `gaps.md` | Its gaps table |
| `<topic>.md` | One part of the flow, such as `review.md`: its input classes and edge cases side by side |

A one-file flow area has the same parts as `##` sections: `## Rules`, `## Datasets`, `## Input classes`, `## Edge-case fixtures`, `## Journey states`, `## Gaps`, `## Proposed rules`, each only when it has something.

## Rules

```markdown
| ID | Category | Type | Rule | Stories | Accepted | By |
| --- | --- | --- | --- | --- | --- | --- |
| R-GM-09 | Money and limits | product | Estimates are asserted only by how they relate, never by a price | GM-36, GM-37 | 2026-11-13 | |
```

- **ID.** `R-<prefix>-NN`, such as `R-GM-09`: the area's prefix and the next free number in the area, never reused.
- **Rule.** One line a reader takes in at once. A rule two flow areas need goes in `core.md`.
- **Accepted.** The day the reviewer accepted these words. A proposed rule sits under `## Proposed rules` in the same table shape, with `new`, and the reviewer accepts a category's rows together.
- **A change to an accepted rule** is proposed the same way: its own ID, Accepted `edit`, and the new wording in full, or `Remove: <why>`. Accepting it replaces the row and sets a new date. A rule is never edited in place, so its date always covers its words.
- **By.** Optional. Empty when a test proves the rule where it lives, citing its ID. A later chunk's id, such as `CH-37a`, parks it until that chunk, as `wf testdata trace --chunk` reads it. Never write the parking in the Accepted cell.
- **Where it lives.** A rule only one flow area cites stays in that area's file; once two cite it, it moves to `core.md`, and `wf doc:check` warns until it does.

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

A project adds its own in `testdata.categories`, such as Stand-ins or Data markers. `wf doc:check` warns for a rules table's category on neither list. A Stand-ins or Data markers rule is `craft`, and `wf doc:check` warns when one is typed otherwise; a Never sent or stored rule is usually `safety`.

## Who a row is for

The owner reviews only the rules that are theirs; the team handles the rest. Each rule has a Type, and `npx wf testdata review <area>` builds the owner's page and the team's from it. A solo project gets one page, with the craft rules as a single row.

| The owner's, one by one | The owner's, one yes/no list | The team's |
| --- | --- | --- |
| `product` | `safety` | `craft` |

- **Type.** `product`: how the app behaves, a decision the owner owns. `safety`: a privacy or safety promise. `craft`: how test data and stand-ins are built, such as fake domains, a fixed today, or canary tokens.
- **From the category.** A rule with no Type takes it from its category where it can: Stand-ins and Data markers are `craft`, Never sent or stored is `safety`. Any other is the owner's until typed, and `testdata.untagged` warns for it, or fails.
- **The designer's.** It writes `craft` and `safety` rules. What would be a `product` rule it proposes as an acceptance line, since how the app behaves is the stories' to say.
- **Plain words.** The owner reads a product rule as written, so it holds no code names, scenario ids, or tokens. `wf doc:check` warns for one.
- **Dropped.** A review page offers Drop beside Fine, A gap, and Wrong, for a rule not worth keeping at all, with its reason in the note.
  - `npx wf testdata drop <area> --from <ask id> --write` takes each such row out of the spec and lists it in the README's `| ID | What | Why | Dropped |` table.
  - Its ID is never reused, the designer never proposes it again, and `wf doc:check` fails a row that brings it back or cites it.

## Risk tiers

An acceptance line that is high-risk ends with its tag: `- My details are kept for the next letter. Risk: high (privacy)`. No tag is low.

- **High** is for money, privacy, irreversible steps, outside input, evidence, or workspaces.
- **Tag the line.** A story whose every line is high takes one line before Acceptance, `Risk: high (money, outside input)`, in place of a tag on each.
- **What it buys.** A high-risk line gets the input classes of what it reads, and up to `testdata.limits.fixtures.line` edge-case fixtures; a story tagged whole gets up to `testdata.limits.fixtures.story`. A low-risk story gets neither.
- **Rationed.** `wf doc:check` warns when more than `testdata.limits.highShare` of an area's acceptance lines are high.

## Acceptance lines, and what proves them

A story's acceptance lines are its checks. The test-data spec holds no checks of its own.

- **ID.** A line's ID is its story and its place in the Acceptance list, counted from 1: `GM-07.3`. A new line goes last, and a line taken out stays as `- Removed (<date>).`, so no other line's ID moves.
- **Proven.** A test or a scenario that shows the line cites it, such as `// GM-07.3`. `npx wf testdata trace --chunk <id>` lists the chunk's lines nothing proves, and `wf done chunk` waits on them (`testdata.chunkChecks`).
- **Proposed.** The designer may propose a line a story forgot, at most `testdata.limits.propose` a story. Its table is `| Story | Proposed line | Why |`, and the story's owner accepts each or not.

A line no test can prove has a row in the area's proof table, in any of its test-data files:

```markdown
| Line | By |
| --- | --- |
| GM-07.6 | walk |
| GM-07.2 | CH-14 |
```

- `walk`: only the walk through the app by hand proves it, so it goes on the chunk's sign-off page.
- `walked <chunk>`, such as `walked 37d`: the owner signed it off there, so a later chunk sharing its story never asks again.
- A later chunk's id, such as `CH-14`, when that chunk's code is what can prove it. The main agent sets that, with the reviewer's yes.
- `wf doc:check` fails a row that names no acceptance line.

A rule that holds everywhere, such as nothing reaching a log, gets one test across every state, citing the rule's ID.

## Input classes and edge cases

A topic file, or a one-file area, holds up to two tables: the classes of each input, and the few cases only a flow can show.

```markdown
| Input | Class | Values | Expect | Stories | Rules |
| Fixture | Varies | Expect | Stories | Rules | Reach |
```

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
- **Which classes.** Each input gets the unhappy classes it implies, once: empty, at and past its limit, malformed, duplicated, mixed encodings, and dates or time zones at the edges. A flow that reads the input does not list them again.

### Edge-case fixtures

A fixture is for what only a flow can show: a state, an order of steps, an interruption, a restart, or what one step leaves for the next. A case that varies only one input's value is an input class, not a fixture.

- **Varies.** What the fixture sets, against which state. Where axes combine, name them in one row, and the generator expands them, pairwise when every combination is too many.
- **Reach.** ``typed at `state` ``, ``date at `state` ``, or ``stored in `state` ``, then a step after a comma. A case no person can reach is an input class.
- **How many.** `testdata.limits.fixtures`: five for a story tagged high as a whole, two for each high-risk line, none for a low-risk story, fifteen in a flow area, and four on one rule.
  - `wf doc:check` warns past them, by the same count as `npx wf testdata budget <area> --check`, and `refresh-close` refuses a refresh that adds to one already over.
  - Merge rows into one with axes, or move the one-input cases to input classes. An exception is the owner's, in `testdata.limits.allow`.

### Check rows from before v0.69.0

A `| ID | Check | ... |` table is from when the designer wrote checks, and none is added. [test-data-process.md](test-data-process.md#check-rows-from-before-v0690) says what still reads it and how to prune it.

## Datasets

`### DS-GM-22. Short name`, the area's prefix and the next free number, then `Covers:` with story IDs and `Starts from:` with journey states. A two-column table gives the seed, the data, and where it is checked. Short paragraphs say what it holds and what a passing run shows.

## Journey states

```markdown
| State | What is already done |
```

A state is kebab-case and names its fixed today when anything depends on a date. A list, ``- `state`: what is done``, reads the same.

## Gaps and story-check questions

```markdown
| ID | Kind | Category | Question | Stories |
| G-GM-03 | gap | Time | Does the same calendar day 12 months back count as stale? | GM-39 |
```

- **Kind.** `gap`: the stories leave it open. `contradiction`: two lines say different things. `dispute`: building or testing showed an acceptance line or a rule is wrong, such as two that cannot both hold, or one no screen can show; its Question names the ID.
- **A dispute** is the one row the main agent writes, since it comes from the code side. `wf doc:check` fails one that names an ID no spec defines. It says what the test found, not how the code works, and keeps the line or rule out of the chunk end's unproven list.
  - The next refresh reads it and proposes the line's or the rule's new wording, or keeps it and says why, and the row leaves the table.
  - A line or a rule is never edited by hand to make a test pass.
- **Category.** A rule category where one fits, else the topic.
- **Question.** One the story's owner can answer. An answered row leaves the table, and its answer goes to the decisions log.
- A story check asks at most `testdata.limits.questions` questions, the most important first, under its `## Questions` heading, and `npx wf testdata delta` cuts the rest.
- It adds a table for the lines that look high-risk with no tag: `| Story or line | Risk | Why |`.
