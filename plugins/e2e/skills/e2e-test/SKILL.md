---
name: e2e-test
description: >-
  Tests the app or one area end to end, as a person would: a blind tester
  agent walks each test-data journey through the running app on its synthetic
  scenario, checks every story's acceptance lines on screen, and opens the
  files the app writes. Each draft is replayed before it counts, then goes into
  the review ledger as an E2E- finding for the reviewer's verdict. Journeys
  that need a real outside service are deferred only on the owner's yes.
  Manual only: use when someone asks for an end-to-end, E2E, or integration
  test, or to test an area or the app as a user would.
disable-model-invocation: true
---

# End-to-end test

Unit tests check the code, and `screen-review` checks how each screen looks. This walks the journeys through the running app, the way a person would, and finds what neither sees. It is a hypothesis under test: the run log, `logs.e2eRuns` in `.workflow/config.json`, says whether it earns its cost.

The tester is the `e2e-tester` agent. It reads no code, so it tests what the stories promise, not what the code meant. Only this skill writes the ledger and the run log.

It needs the app driver (`wf app`, from the `stack-tauri-rust` plugin or another stack's), the project's test-data commands (`testdata.commands`: `journeys` and `e2e-files`), and the review ledger (`logs.ledger`), which `npx wf ledger` writes whether or not the review plugin is installed. `npx wf config` prints them all.

## 1. Scope

The person asking names the area: an area id from `areas` in the config. List, without asking:

- **The journeys.** Each `### D<n>.` section in the area files of `<area docs>/test-data/`, with its `Covers:` line. Leave out a journey whose stories are all in chunks not built yet.
- **Starts and fixtures.** `npx wf testdata journeys <area>` prints each journey's `Starts from:` states with the scenario that holds each, and each fixture's `Reach`. Note every state or stored fixture with "no scenario", and every "not set". Typed and date fixtures go to the tester.
- **Uncovered lines.** Every acceptance line in the area's `user-stories.md` that no journey's `Covers:` names.
- **Outside services.** A journey that needs a real provider, a real account, real data, a downloaded model, or a network service with no local stand-in. The open questions log lists the known ones under "Testing with real providers (deferred)". A local stand-in or a stub is not an outside service, so a journey that uses one is not deferred.

## 2. Ask

### First: build the missing test data?

When any built journey's state or stored fixture has "no scenario", ask the owner this first, on its own, with the structured question tool. Name the journeys and the states each needs.

- **Build them first** (recommended). Build the scenarios now with the `design-test-data` skill, each naming its state, then run `journeys` again. Several states are still built here, one after another, before the walk.
- **Defer.** Build nothing now. Each missing state stays as "no scenario", and its journeys are left out of this run.

Skip this question when nothing is missing.

### Then: which journeys?

One batch, with the structured question tool, each question to the role that owns it:

- **Which journeys.**
  - After building, or when nothing was missing: offer all the built journeys (recommended), or one chunk's.
  - After a defer: offer to run with what is available, the journeys whose states all have a scenario (recommended), or one chunk's of those, or to stop.
- Each journey that needs an outside service: defer it, or say what stand-in to use. Recommend defer. A deferred journey goes under "Testing with real providers (deferred)" in the open questions log if it is not there.
- Each uncovered acceptance line: walk it from the story alone, or ask the `design-test-data` skill for a journey later. Recommend walk it.
- "Not set" starts or reaches: ask the designer to fill them in the next refresh, and walk on the closest scenario now. Recommend that.

Do not walk a journey that waits on an answer.

## 3. Prepare

Build the app as the project's app-testing doc says (`app.doc`): the driver runs the binary as it is, and an old binary can fail on newer data. Then write the tester's files:

```bash
E=$PWD/.cache/e2e/$(date +%F)-<area>   # absolute, for the picker stub; .cache is ignored by git
rm -rf $E && mkdir -p $E
npx wf testdata e2e-files <area> --out $E   # the area's fixtures, and each quick profile's archives
```

The tester cannot run the generator, so everything it picks must be in `$E` before the walk. The command's last line lists the typed fixtures with no file of their name. A typed text needs none. A fixture that is picked as a file and has none cannot be walked: leave it out, name it in the summary, and ask whether to build it.

## 4. Walk

Run the `e2e-tester` agent with only these lines. Do not add what you expect it to find, or anything about the code:

```text
Area: <area>
Journeys: <D-ids, and each uncovered line to walk from the story>
Scenarios: <for each journey, the scenario to start from, from the journeys report>
Fixtures: <for each journey, its typed and date fixture IDs, each picked one with its file in $E>
Deferred: <D-ids, or none>
Files: <$E>
```

One app window runs at a time, so journeys run in one agent, one after another. With more than `e2e.journeysPerAgent`, split them across agents run one after the other, so no one context grows too large. In Claude Code, pass the model `e2e.testerModel`; in OpenCode, use the session model.

## 5. Replay

Each draft must reproduce before it counts. Replay its `Replay:` steps yourself:

```bash
npx wf app start --fresh --scenario <scenario>
npx wf app run '<step>' '<step>' 'lines <text from the evidence>'
npx wf app stop
```

- **Reproduces:** keep it.
- **Does not reproduce, or the steps fail before the fault:** drop it, and keep its title and reason for the summary.
- **An Info draft about the story itself:** keep it without a replay. It is a question for the owner, not a fault.

Read each kept draft against its story before it goes on. A draft that the story does not support, such as a wish beyond its acceptance lines, becomes Info with that said in its note.

## 6. Ledger

Write the kept drafts to `.cache/e2e/findings.json` and add them with the review ledger's tool, so they live with every other finding:

```bash
npx wf ledger add .cache/e2e/findings.json   # prints each new E2E- ID
npx wf ledger check
```

Do not touch `Last reviewed` or `Deep reviewed`. An E2E run is not a code review.

## 7. Ask for verdicts

Ask the reviewer once, with the structured question tool, in batches of about five: one question per new E2E- finding, with its ID, severity, title, and the evidence in a line. Options: Accept, fix now; Accept, fix later; Defer; Reject. Recommend one and say why. Write each answer with `npx wf ledger set <ID> --status <accepted|deferred|rejected> --decision "<answer>, <date>."`.

Accepted findings are work. Fix the small ones now with the owner's yes, and replay their steps to show the fix. A larger one is proposed as a session of its own. A fixed one becomes `fixed` with the commit in its note, and the next code review or E2E run confirms it.

## 8. Log the run

Add one row to the run log: the date, the area and journeys, drafts, kept after replay, accepted, how many a unit test or the screen review would also have caught, and the run's tokens if they can be read. The row is what shows whether this is worth keeping. A project with no run log yet starts it with this header:

```markdown
| Date | Area and journeys | Drafts | Kept after replay | Accepted | Also caught elsewhere | Tokens |
| --- | --- | --- | --- | --- | --- | --- |
```

## Do not

- Do not let the tester read code, the ledger, or this chat's reasoning.
- Do not use `--real`, real personal data, or a real outside service. Every file comes from the project's synthetic test data.
- Do not count a draft that did not replay.
- Do not run it unasked: it costs about as much as building a chunk.
