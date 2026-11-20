# Four steps

The project is built in four steps, and each area goes through them on its own. The areas are listed in `areas` in `.workflow/config.json`. Finish a step before starting the next one for that area.

<!-- wf:local areas -->

## The four steps

### Step 1. User stories and flows

Who the user is, what they are trying to finish, and the path they take. Written as stories with acceptance criteria and as mermaid flows. No screens yet, and no tech stack.

- With the testdata plugin, the blind designer's story check reads the new stories and returns a few ranked questions about their gaps and contradictions. The story's owner ends each high-risk acceptance line with `Risk: high (<why>)`.
- An area whose rules come from source documents, such as a domain product's, starts with Step 0, source analysis, as [project-kinds.md](project-kinds.md) says.

### Step 2. Design frames

Screens and interaction for the stories from Step 1, drawn as frames that the designer reviews. Design follows the stories. It does not invent a new journey.

<!-- wf:local step-2 -->

### Step 3. Architecture

Where code lives, how the parts talk, and the tech stack. Open questions from Step 1 get answered here, or get an explicit "still open" with a reason.

- Step 3 ends by adding the area's chunks to [build-order.md](../log/build-order.md), following [Making or updating an area's order](build-order.md#making-or-updating-an-areas-order).
- It lists each outside thing the stories need, such as a server, a model, a sign-in, a file picker, or another computer, and the chunk whose stand-in lets a scenario reach those screens.

Each area also designs its data in Step 3, before any chunk builds it, in its own `data-model.md` from the kit's `templates/data-model.md`, beside `architecture.md`.

- **What it holds.** Where the data lives, the entities and how they relate, each table's fields, keys, and constraints, the index each hot path's query needs, which fields are sensitive, how long rows are kept and what a delete takes with it, and how migrations run.
- **A design, not the SQL.** The area's first build chunk writes the schema and its migrations from it, and the code review checks them against it, by CS-DATA in [code-standards.md](code-standards.md).
- **If it stores nothing,** the file says so in one line, with why.
- **Its conventions.** The model follows [data-standards.md](data-standards.md). When the area picks a store the project has not used yet, its conventions are copied from the kit's `templates/data-engines/<engine>.md`, such as `postgres.md` or `sqlite.md`, into that doc's project part, and its table names are set to singular or plural there.
- **At a glance.** The model starts with At a glance, splits its tables into parts with a small diagram each, and keeps one-row tables in one table per part. `doc:check` warns when it does not.
- **Reviewed with the architecture.** The agent drafts it from the stories, the architecture, the threat model, and the hot-paths doc, and the owner reviews it with the rest of the step. A choice of store, or of what is kept and for how long, is asked on an ask page.
- `npx wf doc:check` fails while an area is past Step 3 and its `data-model.md` is missing or still the template. An area whose Architecture step is dated before 2026-11-21, when the kit added this, or not dated, is warned instead.

The first area to finish Step 3 also drafts the threat model, from the kit's `templates/threat-model.md`, into the file `review.threatModel` names.

- It says what is protected, who could attack it, and each boundary where trust changes.
- The agent drafts it from the architecture and the stories, and the owner reviews it with the rest of the step.
- A later area adds its own assets and boundaries.
- `npx wf doc:check` fails while an area is past Step 3 and the threat model is missing or still the template.

It drafts the hot-paths doc beside it, from the kit's `templates/hot-paths.md`, into the file `review.hotPaths` names.

- It says what the person waits for and each budget, how large the data gets, and each hot path with its files.
- The agent drafts it from the architecture and the stories, and the owner reviews it with the threat model.
- A later area adds its own paths.
- `npx wf doc:check` fails while an area is past Step 3 and the doc `review.hotPaths` names is missing or still the template.

<!-- wf:local step-3 -->

### Step 4. Implementation

Build what Step 2 and Step 3 describe, in the order from [build-order.md](../log/build-order.md). Stories are the acceptance check. Each chunk opens with the [chunk-start check](#chunk-start), and checks the stories against the frames again while it builds.

## Per area

Each area repeats the four steps on its own. An area is not started at Step 3 because another area reached Step 3; it has its own Step 1.

<!-- wf:local per-area -->

## Steps can be revisited

The frames are a first pass. They are simpler than the product will be, and they change as the requirements and the understanding grow.

Step 2 can be reopened after Step 3 or Step 4. A return to Step 2 is followed by updating Step 3 and Step 4 for what changed. The old frames and the old architecture are not final.

The same loop applies to each area on its own. Revising one area does not reopen another area's steps.

A story added to an area past its Step 3 gets a chunk row in the same pass, as in [the build order](build-order.md#making-or-updating-an-areas-order). It does not wait for the next chunk start.

When a frame, story, or architecture note changes, update the matching doc in the same pass: the area's screen list, the frames doc if the file layout changes, and the decisions log (`wf decision add`) only when something is actually agreed.

<!-- wf:local revisit -->

## Tracks

Each change takes one of three tracks, so the ceremony fits its size.

- `npx wf ready <track> [chunk]` runs the scripted checks before work starts, and `npx wf done <track> [chunk]` before the pull request. Each check prints OK, FAIL, or SKIP.
- Each ASK line is a judgement the agent answers itself, and raises with the owner when the answer is no.

| Track | For | Steps |
| --- | --- | --- |
| Quick | A fix to docs, tools, or the workflow's own files | A branch, the change, the project's quick check (`tracks.check`), and a pull request.<br>• No chunk start or end, code review, or screen check |
| Chunk | A few whole stories in one area past Step 3 | Chunk start, the build, and chunk end, below |
| Area | A new area, or one going back to Step 1 | The four steps, above, then each of its chunks on the chunk track |

- A quick change stays within `tracks.quickPaths`. One that reaches app code, a story, or a screen is a chunk, and `wf done quick` fails on it.
- The chunk track's done list runs the project's full check (`tracks.fullCheck`). It checks the ledger covers HEAD, the screen gate passes, and no sign-off is open.
- When a track is in doubt, take the larger one. A chunk that turns out small costs a review, and a quick change that was really a chunk skips one.

<!-- wf:local tracks -->

## Chunk start

Before anything in a chunk is built, run `npx wf doc:facts status` for where things stand, and start the chunk's branch, as in [branches.md](branches.md).

When the person has not named the chunk, ask which on the choice page, `npx wf choose chunk | npx wf ask page -`. It lists each chunk that can start, any in progress, and a quick fix, each with its `wf ready` command.

A chunk split into lanes runs chunk start and end once per lane, as in [build-order.md](build-order.md#lanes). Then, in order:

- Check the stories against the frames, below.
- Put any story added or changed since the last chunk start into the [build order](build-order.md#making-or-updating-an-areas-order): an existing chunk or a new row. Move this chunk's row to In progress.
- If the chunk builds on an outside service, make one real call first and read that service's rules for clients. A stand-in proves only what it was told. The chunk that first uses an outside thing also builds its stand-in, so a scenario can reach the screens behind it. A test-only stub is not enough.
- With the testdata plugin, run `npx wf testdata stale <area> --chunks <this>,<next>`, and refresh each story it lists with the `design-test-data` skill.
- With the design plugin's screen review, run `npx wf screens --gate <this>`. It lists each frame showing this chunk's stories that no Reach opens. Each one is reached in this chunk, or, with the designer's yes in the questions below, waits on a later chunk named in its Reach.
- Read the status's `Revisit` lines. Each untied question whose trigger may now hold goes to its role in the questions below, and one that holds moves under this chunk's heading. Give a trigger to each question under `No revisit trigger`, or ask its role for one.

<!-- wf:local chunk-start -->

- Before building a guard, a check, a tool, or test data to make a check easier, say what it protects, what it costs, and what would show it is not worth keeping. Put it to the owner with the questions below.
- Ask once, in one set of questions, each to the role that owns it: each drift with its suggested fix, each change to the build order, and each question the steps above raised. Work that depends on none of the answers can go on.
  - On an ask page, that is a `batch` page by role, with the order as a `rank` question. The open questions whose trigger holds go on a `triage` page, and a plan to approve on a `plan` page.
  - A test-data refresh's rules go on their own page: `npx wf testdata review <area> --chunk <this> | npx wf ask page -` for the owner's, and `--team` for the craft rules. A solo project gets one page, with the craft rules as one row.
- Last, run `npx wf ready chunk <this>`. Fix each FAIL and answer each ASK before anything is built.

## Chunk end

Before the commit proposal, in this order. The parts below say how.

1. With the design plugin, when UI files or frames changed: `npx wf screens --gate <chunk>` passes.
2. Run the project's full check, `tracks.fullCheck`.
3. Run the `code-review-ledger` skill in diff mode, and fix the findings the reviewer accepts.
4. When UI files or frames changed: run the `screen-review` skill, after those fixes and never beside the review.
5. With the testdata plugin: `npx wf testdata trace --chunk <chunk>` lists no held line or rule proven by nothing.
6. Move the chunk's row, and put each `walk` line on the owner's `signoff` page.
7. Run `npx wf done chunk <chunk>`. Fix each FAIL and answer each ASK. It runs the full check again, as the gate.
8. Commit with the `commit` skill, then propose the pull request with the `pull-request` skill.

### The code review

The `code-review-ledger` skill runs in diff mode.

- The reviewer picks a deep or light run, or defers it to a later run, which then reviews every deferred chunk at once. A light run is logged in the ledger, and the next deep run covers it.
- It runs the scans and the read-only `code-reviewer` agent, writes its findings to [the ledger](../log/review/findings.md), and asks the reviewer once to accept, defer, or reject each new one.
- The rubrics are [code-standards.md](code-standards.md), [data-standards.md](data-standards.md), and [performance-standards.md](performance-standards.md). The reviewer can also ask for a full review at any time.

### Acceptance lines proven

With the testdata plugin, `npx wf testdata trace --chunk <chunk>` sorts the acceptance lines of the chunk's stories, and their accepted rules. `wf done chunk` waits until no high-risk line, and no product or safety rule, is proven by nothing (`testdata.chunkChecks`).

- **High-risk lines are held.** A line tagged `Risk: high`, or any line of a story tagged high as a whole, needs one of the proofs below.
- **Low-risk lines are counted.** One no test cites is not guaranteed a test: the trace gives their count, and `--all` lists them. `testdata.chunkScope: "all"` holds every line instead.
- **Craft rules** are the team's and not gated.

Each line or rule is:

- proven: a test or a scenario cites its ID, such as `// GM-07.3`;
- walk: only a walk by hand proves it, so it goes on the sign-off page; once done there, its By becomes `walked <chunk>`;
- later: its By names a later chunk, as a parked rule's does;
- covered: its By names a rule whose one test covers it in every state, and a test cites that rule;
- disputed: a `dispute` row in its gaps table says it is wrong, for the next refresh.

A line's By is its row in the area's proof table, `| Line | By |`, as [test-data-formats.md](test-data-formats.md) says. For one proven by nothing, cite it in the test that already shows it first. A new test is only for what no test shows, as CS-TEST says.

### Screens

With the design plugin's screen review, a chunk that changed UI files or frames also checks its screens:

- Before the code review, `npx wf screens --gate <chunk>` passes: every frame showing the chunk's stories is reached, or waits on a later chunk the designer agreed to. A frame shared by two chunks is reached by the first to end, or handed to the later one.
- Once the code review's accepted findings are fixed, run the `screen-review` skill, never at the same time as the code review, since a fix can change a screen.
- Fix or record each difference it finds before the commit. A difference the designer accepts goes in the frame or the decisions log, never only in the code.

<!-- wf:local chunk-end -->

### The row, the sign-off, and the pull request

Move the chunk's row in [build-order.md](../log/build-order.md#chunks): to Waiting if something about the chunk is left to check, or to [chunks-done.md](../log/chunks-done.md) if not.

- A row moved to the done list gets its "For the client" sentence: what the client can now do, in plain words, with no ids, such as "You can sign in with your work email and password." The client's board posts it when the chunk's stories are built.
- When the owner checks what is left by hand, ask on a `signoff` page, one check for each `walk` line the trace lists, by its ID, so each is done or objected to with a note.
  - A low-risk line with a `walk` row is on it too. The low-risk lines with no test and no row get one line of text with their count, and no check each.

After the commit, propose the chunk's pull request with the `pull-request` skill. It is squash-merged on the owner's yes, as in [branches.md](branches.md).

If the chunk wasted real effort, add a row to [efficiency-log.md](../log/efficiency-log.md). No waste, no row.

## Check stories against frames

Stories and frames drift apart as both grow. Each chunk checks them in both directions, at its start and again while the screen is built and compared to its frame:

- A story or acceptance line with no frame showing it. For example, a story lets the user reorder, but no frame shows how.
- A frame element with no story behind it. For example, a button, filter, count, or state that no acceptance line asks for.
- A frame and a story that disagree, in wording, order, or behavior.
- A flow step with no screen, or a screen no flow reaches.

<!-- wf:local drift -->

When the check finds a drift, stop the part of the chunk that depends on it.

- Tell the designer what drifted, with the story ID and the frame name, and ask how to close it.
- Suggest one fix and say why: draw a frame, change the story, or drop the element. Do not settle it by building a guess.
- Work that does not depend on it can go on.

Log the open drift in [open-questions.md](../log/open-questions.md) until it is answered. Once it is, the fix goes back through Step 1 or Step 2, then the chunk continues.

## What to do with an idea that arrives early

If a tech choice, a library, or a behavior shows up during Step 1 or Step 2, write it in [open-questions.md](../log/open-questions.md). Do not treat it as decided. Agreed decisions go in the decisions log (`wf decision add`).
