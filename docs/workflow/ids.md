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
| check | `C-<prefix>-<n>` | `C-GM-41` | What a passing run shows in one flow | A test-data checks table |
| gap | `G-<prefix>-<n>` | `G-GM-03` | A question the stories leave open, or a contradiction, for the story's owner | A test-data gaps table |
| dataset | `DS-<prefix>-<n>` | `DS-GM-27` | A named, seeded set of test data | A `### DS-GM-27. Name` heading in the test-data spec |
| story | `<prefix>-<nn>` | `GM-07` | One thing a user wants, with its acceptance lines | A `### GM-07. Title` heading in the area's stories |
| decision | `D-<area or topic>-<nnn>` | `D-GM-101` | A decision, by area or topic | A decisions file's table |
| question | `Q-<nnn>` | `Q-113` | An open question, or one settled | The open questions log, or the resolved one |
| chunk | `CH-<n>`, with a letter for a split | `CH-12` | One chunk of the build | The build order |
| finding | `<LETTERS>-<n>` | `SEC-083` | A code review or E2E finding | The review ledger, or its closed file |

- **Names.** A fixture, a journey state, or an input is a kebab-case name, such as `gmail-move-file-saved`, unique across the app. Code may write it with underscores; `wf id` finds both.
- **Telling them apart.** `D-GM-101` is a decision and `DS-GM-27` a dataset; `GM-07` is a story and `R-GM-07` a rule. A finding's prefix is never an area's.
- **Citing.** A test names what it proves, such as `// C-GM-41` or `// R-GM-119`, so `npx wf testdata trace` can tell what nothing proves.

## Old IDs

Before v0.64.0 the test-data IDs had no area: `R-12`, `C-41`, `G-03`, and datasets `D27`. Two areas could both have an `R-76`, and `npx wf doc:check` warns for them.

`npx wf testdata rename-ids [area]` qualifies them, in the spec and everywhere they are cited. It is a dry run until `--write`. A mention whose place does not say which area it means is listed for a person, never guessed.
