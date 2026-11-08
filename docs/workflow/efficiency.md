# Efficiency

Efficiency that leads to our outcome is how we work. It is a hypothesis, so we test it and change it. The short rule is in [AGENTS.md](../../AGENTS.md). This file holds the test.

## Hypothesis

We may not start out efficient. If the people and the model correct each other and themselves, and weigh efficiency across the whole of the work, the work reaches its outcome with less total waste over time.

The whole of the work means our ways of working, test cases, code, process, design, user stories, and thinking. A saving in one area that costs more in another is not a saving.

## What would disprove it

- The same correction has to be made twice or more.
- Rework and tokens per chunk do not fall over several chunks.
- Bugs, gaps, or review findings rise as the work gets cheaper. The work got faster, not better.
- Keeping this log costs more than it saves.

## Signals

Use what the work already leaves behind. Do not add tracking for its own sake.

- **Rework:** work built and then removed or redone, from git history.
- **Tokens:** usage per chunk and per review, from session logs.
- **Quality:** review findings per chunk, and bugs found after a chunk ended.
- **Repeats:** log rows whose change did not hold.

## Parallel work

Run independent work at once when it saves more than it costs. Before you split the work, say what runs at once, the approach, and its cost, then ask. A guideline, not a rule, and part of the hypothesis: drop what does not pay.

<!-- wf:local parallel-costs -->

- **Never two writers in one checkout.** A session can commit another's uncommitted work.
- **Not in parallel:** chained steps such as a release, work that waits on someone's answer, and CI waits.
- **Not before what it reads is settled.** A step that reads what another may still change waits for it. The screen review starts only once the code review's findings are fixed and the app is rebuilt, because a fix can change a screen (decided 2026-11-07).
- **Each role's attention.** Each session asks its own questions, so two sessions double them for whoever holds the role.
<!-- wf:local parallel-measured -->

## Log

The evidence is in [efficiency-log.md](../log/efficiency-log.md), with its rules for adding a row and for growth.

## Check

Every 5 chunks, or when the owner asks, read the log against the signals, and run `npx wf doc:facts growth` for what the instructions and docs cost to load. Mark what held, drop what did not help, and update the hypothesis or the rule. Keep the check short, because it is held to the same standard.

To shrink AGENTS.md, move out only what fails its Always on test. A rule moved out on 2026-11-05 to save size came back on 2026-11-06, after visual questions went out with no picture.

`npx wf doc:facts status` says when the check is due.

<!-- wf:local check-results -->
