# Test data

How the project is developed and tested without anyone's real data. It applies to every area.

<!-- wf:local intro -->

## The idea

Test data has two authors who never share context.

- **The blind side decides what to test.** A data-design agent, the kit's `test-data-designer`, writes the spec.
  - It reads the area's `overview.md`, `user-stories.md`, `user-flows.md`, its test-data rules, and public format specs.
  - It never reads code or architecture, so the data does not copy the implementation's assumptions.
  - A first draft writes the area's `test-data/` folder: personas, datasets, size profiles, and edge cases, each tied to story IDs, in one file per flow area.
  - A refresh reads the changed stories, `core.md`, and only the area files those stories reach. It returns only the lines to add or edit, each naming its file, or says the spec already covers the change.
- **The code side makes it.** The project's seeded generator implements that spec, including the edge fixtures. The same seed gives the same bytes, so a failing test fails the same way every time. Development and tests use that output.

<!-- wf:local generator -->

```mermaid
flowchart LR
  docs["Stories, flows, overview"] --> agent[BlindDataAgent]
  specs["Public format specs"] --> agent
  core["test-data/core.md and formats.md"] --> agent
  agent --> areas["test-data/&lt;area&gt;.md: rules, datasets, fixtures, states"]
  areas -.->|"accepted proposed rules"| areas
  areas --> gen["Seeded generator"]
  gen --> fix["Fixtures the generator writes"]
  gen --> tests[Tests and the app]
  fix --> tests
  gen --> scen["Seeded app states"]
```

An AI does not write the data files itself. Data written by a model cannot be reproduced, goes wrong at scale, and costs a model call every run. The agent writes the spec. Code writes the data.

Blindness is kept by the agent's instructions, and checked at review: the spec cites only story IDs, flows, and public specs. A line that names a table, a function, or a code file sends the spec back.

## Area rules

Each area touches different personal data, so the generic guardrails below are not enough. A photos area would need generated images with no faces. A password area would need secrets that cannot be mistaken for real ones.

Those rules live in the area's `test-data/` folder. They are not passed in the agent's prompt, because the agent running the skill has seen the code and could leak it.

## The folder

An area's test data is the `test-data/` folder in its docs folder, one file per flow area, so a story change touches only the files that cover it.

| File | Holds |
| --- | --- |
| `README.md` | The `Updated:` line, a one-sentence status, the area index, written by `npx wf testdata index`, and `## Refresh history`, one bullet per refresh, newest first. |
| `core.md` | Rules every area needs (personal data, placeholders, generation, real names, never) and the shared spec: sources, personas, size profiles, and what no one area owns. |
| `formats.md` | The format rules. |
| `<area>.md` | The `user-flows.md` sections on its `Flows:` line: its rules, datasets, fixtures, journey states, gaps, and proposed rules. |
| `coverage.toml` | Each story's acceptance hash when the spec last covered it. |

- **Rules sit beside their data.** A rule about one area is in that area's `## Rules`, and a rule two areas need is in `core.md`. Each rule line ends with its stories and the day the reviewer accepted it, `(GM-16, GM-34; 2026-11-07)`.
- **A story reaches the files that name it.** `npx wf testdata route <area> <ids>` lists them, from their `Covers` lines, rule tags, and other mentions. A refresh reads `core.md`, `formats.md`, and only those.
- **Areas follow the flows**, which change less than the stories. A story in two flows reaches two files. Dataset ids, fixtures, and states are unique across the folder, so one file can name another's.
- **An area stays reviewable.** `route` names an area past 40 KB, and the refresh that touches it proposes a split by dataset group.

<!-- wf:local folder-checks -->

The rules are never written from scratch by hand:

1. The data designer drafts `core.md` and `formats.md` once, in rules mode, from the overview and stories. The reviewer reviews them.
2. When the data designer writes or refreshes the spec, any rule it had to assume goes in the area's `## Proposed rules`. At review, the reviewer accepts or drops each one. Accepted rules move into that file's `## Rules`, or `core.md`.

Where an area rule is stricter or more specific than a generic one, the area rule wins.

## Kinds of data

Fixtures are small committed files for the edge cases the spec names. Generated datasets are the profiles and named sets the spec gives, written when a test or a scenario needs them and never committed. Seeded app states start the app at a journey point. Fake services stand in for real ones.

<!-- wf:local kinds -->

## Guardrails

- **Reserved domains for people.** Every person, including the user, uses a reserved domain: `example.com`, `example.org`, `example.net`, or a `.test` or `.invalid` name (RFC 2606, RFC 6761). Service senders may use real public service domains.
- **No real data folder.** Agents and tests use a throwaway data folder, never the user's, unless the owner asks.
- **No generated output in git.** Generated datasets go to ignored folders.

<!-- wf:local guardrails -->

## Per area

1. **At Step 3**, run the blind agent for the area, as the `design-test-data` skill says: first in rules mode for `core.md` and `formats.md`, then in spec mode for the rest. The reviewer reviews both like a story file, and the same day `npx wf testdata covered` records every story's acceptance hash.
   - A later story edit does not start the agent. It makes the story stale: its acceptance no longer has the hash the coverage file holds.
   - **When.** Stale stories are refreshed in one run, at the start of the chunk that builds them or the chunk before. A change to a story the current chunk builds is refreshed before the work that depends on it. The reviewer can ask for a refresh at any time.
   - **How.** `route` names the area files those stories reach. The agent reads `core.md`, `formats.md`, and those files, and returns a delta. The main agent applies it and runs `refresh-close`.
   - **Review.** The refresh is reviewed in the chunk-start question in [four-steps.md](four-steps.md#chunk-start), not in a separate round.
2. **In each chunk of Step 4**, teach the generator the data that chunk needs, before or with the code: a scenario for each new journey point, support for each dataset and profile the spec gives that chunk, and a writer for each edge fixture. Then develop and test against what it writes.
3. **When the spec or the rules change**, update the generator in the same change, regenerate the fixtures, and point the tests and the scenarios at that output. A test that still expects the old bytes is updated to the new output.

The spec lists data by story. A story's data is due in the chunk that builds the story. Data for a later chunk can wait.

<!-- wf:local drift -->

## What uses it

The app, a test, and a scenario all read data the generator produced. A test does not assemble its own copy of a dataset. That second copy drifts from the spec, and a later spec change never reaches it.

<!-- wf:local uses -->

## When the spec or the format changes

A refresh that says no change does not start this list.

1. If the spec changed, set its `Updated:` line to that day.
2. Update the generator so the dataset or fixture matches. A format change with no spec edit still starts here.
3. Regenerate the committed fixtures.
4. Run the tests and the app from that output. Add a scenario when the chunk needs to open the app on that data.

<!-- wf:local change-steps -->

<!-- wf:local building -->
