# IDs

Every ID the workflow makes, its pattern, and where it is defined. An ID is unique across the whole app, never reused, and never renumbered. The patterns live in one table in the kit's code (`lib/ids.mjs`), which `wf doc:check`, `wf testdata`, and `wf id` all read.

<!-- wf:local intro -->

## Finding one

```sh
npx wf id R-GM-119
npx wf id gmail-move-file-saved --all
```

`wf id` says what kind of ID it is, where it is defined, and every line that cites it, grouped as spec, docs, logs, tests, and code. It matches the whole ID only: `R-GM-1` is never found inside `R-GM-12`. Use it before searching by hand. Without `--all` it lists the first 15 citations.

## The kinds

A kind with an area in it carries the area's prefix from `areas` in `.workflow/config.json`, such as `GM`. The letter before it says the kind.

| Kind | Pattern | Example | Names | Defined in |
| --- | --- | --- | --- | --- |
| rule | `R-<prefix>-<n>` | `R-GM-119` | A rule the test data and the app follow | A test-data rules table |
| check | `C-<prefix>-<n>` | `C-GM-41` | A check row from before v0.69.0, kept while a test cites it | A test-data checks table |
| gap | `G-<prefix>-<n>` | `G-GM-03` | A question the stories leave open, or a contradiction, for the story's owner | A test-data gaps table |
| dataset | `DS-<prefix>-<n>` | `DS-GM-27` | A named, seeded set of test data | A `### DS-GM-27. Name` heading in the test-data spec |
| acceptance | `<prefix>-<nn>.<n>` | `GM-07.3` | One acceptance line of a story, by its place: what a test or a walk proves | The story's Acceptance list, counted from 1 |
| story | `<prefix>-<nn>` | `GM-07` | One thing a user wants, with its acceptance lines | A `### GM-07. Title` heading in the area's stories |
| work | `W-<prefix>-<nn>`, or `W-<prefix>-P<n>` for a phase | `W-GM-07` | A work item: a step of the area's plan that is not a story, or a phase of it | A step row's ID cell in the area's plan doc; a phase's is its `## Phase N.` heading |
| decision | `D-<area or topic>-<nnn>` | `D-GM-101` | A decision, by area or topic | A decisions file's table |
| question | `Q-<nnn>` | `Q-113` | An open question, or one settled | The open questions log, or the resolved one |
| chunk | `CH-<n>`, with a letter for a split | `CH-12` | One chunk of the build | The build order |
| finding | `<LETTERS>-<n>` | `SEC-083` | A code review or E2E finding | The review ledger, or its closed file |

- **Names.** A fixture, a journey state, or an input is a kebab-case name, such as `gmail-move-file-saved`, unique across the app. Code may write it with underscores; `wf id` finds both.
- **Telling them apart.** `D-GM-101` is a decision and `DS-GM-27` a dataset; `GM-07` is a story, `R-GM-07` a rule, and `W-GM-07` a work item. A finding's prefix is never an area's.
- **Citing.** A test names what it proves, such as `// GM-07.3` or `// R-GM-119`, so `npx wf testdata trace` can tell what nothing proves.
- **Acceptance lines.** A line's ID is its story and its place in the Acceptance list. A new line goes last, and a line taken out stays as `- Removed (<date>).`, so no other line's ID moves.
  - The decision behind a line is named in the area's `story-changes.md`, not in the line, so `wf id` on the decision still finds the line.
- **Work items.** A step's ID is its own, kept when the step is renumbered, so its item on the board keeps the client's replies. A phase's comes from its number, so a new phase goes last. The plan doc's shape is in [writing-docs.md](writing-docs.md#plan-docs).
- **Checks.** A `C-` ID is from before v0.69.0, when the test-data designer wrote checks beside the stories. A test that cites one still names it; nothing new gets one.

## Old IDs

Before v0.64.0 the test-data IDs had no area: `R-12`, `C-41`, `G-03`, and datasets `D27`. Two areas could both have an `R-76`, and `npx wf doc:check` warns for them.

`npx wf testdata rename-ids [area]` qualifies them, in the spec and everywhere they are cited. It is a dry run until `--write`. A mention whose place does not say which area it means is listed for a person, never guessed.
