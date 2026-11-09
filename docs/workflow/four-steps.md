# Four steps

The project is built in four steps, and each area goes through them on its own. The areas are listed in `areas` in `.workflow/config.json`. Finish a step before starting the next one for that area.

<!-- wf:local areas -->

## The four steps

### Step 1. User stories and flows

Who the user is, what they are trying to finish, and the path they take. Written as stories with acceptance criteria and as mermaid flows. No screens yet, and no tech stack.

### Step 2. Design frames

Screens and interaction for the stories from Step 1, drawn as frames that the designer reviews. Design follows the stories. It does not invent a new journey.

<!-- wf:local step-2 -->

### Step 3. Architecture

Where code lives, how the parts talk, and the tech stack. Open questions from Step 1 get answered here, or get an explicit "still open" with a reason. Step 3 ends by adding the area's chunks to [build-order.md](../log/build-order.md), following its checklist. It also lists each outside thing the stories need, such as a server, a model, a sign-in, a file picker, or another computer, and the chunk whose stand-in lets a scenario reach those screens.

The first area to finish Step 3 also drafts the threat model, from the kit's `templates/threat-model.md`, into the file `review.threatModel` names.

- It says what is protected, who could attack it, and each boundary where trust changes.
- The agent drafts it from the architecture and the stories, and the owner reviews it with the rest of the step.
- A later area adds its own assets and boundaries.
- `npx wf doc:check` fails while an area is past Step 3 and the threat model is missing or still the template.

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

Each change takes one of three tracks, so the ceremony fits its size. `npx wf ready <track> [chunk]` runs the scripted checks before work starts, and `npx wf done <track> [chunk]` before the pull request. Each check prints OK, FAIL, or SKIP. Each ASK line is a judgement the agent answers itself, and raises with the owner when the answer is no.

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

Before anything in a chunk is built, run `npx wf doc:facts status` for where things stand, and start the chunk's branch, as in [branches.md](branches.md). Then, in order:

- Check the stories against the frames, below.
- Put any story added or changed since the last chunk start into the [build order](build-order.md#making-or-updating-an-areas-order): an existing chunk or a new row. Move this chunk's row to In progress.
- If the chunk builds on an outside service, make one real call first and read that service's rules for clients. A stand-in proves only what it was told. The chunk that first uses an outside thing also builds its stand-in, so a scenario can reach the screens behind it. A test-only stub is not enough.
- With the design plugin's screen review, run `npx wf screens --gate <this>`. It lists each frame showing this chunk's stories that no Reach opens. Each one is reached in this chunk, or, with the designer's yes in the questions below, waits on a later chunk named in its Reach.

<!-- wf:local chunk-start -->

- Before building a guard, a check, a tool, or test data to make a check easier, say what it protects, what it costs, and what would show it is not worth keeping. Put it to the owner with the questions below.
- Ask once, in one set of questions, each to the role that owns it: each drift with its suggested fix, each change to the build order, and each question the steps above raised. Work that depends on none of the answers can go on.

## Chunk end

Before the commit proposal, run the project's full check once. Then run the `code-review-ledger` skill in diff mode. The reviewer picks a deep or light run, or defers it to a later run, which then reviews every deferred chunk at once. A light run is logged in the ledger, and the next deep run covers it. It runs the scans and the read-only `code-reviewer` agent, writes its findings to [the ledger](../log/review-findings.md), and asks the reviewer once to accept, defer, or reject each new one. The rubric is [code-standards.md](code-standards.md). The reviewer can also ask for a full review at any time.

With the design plugin's screen review, a chunk that changed UI files or frames also checks its screens:

- Before the code review, `npx wf screens --gate <chunk>` passes: every frame showing the chunk's stories is reached, or waits on a later chunk the designer agreed to. A frame shared by two chunks is reached by the first to end, or handed to the later one.
- Once the code review's accepted findings are fixed, run the `screen-review` skill, never at the same time as the code review, since a fix can change a screen.
- Fix or record each difference it finds before the commit. A difference the designer accepts goes in the frame or the decisions log, never only in the code.

<!-- wf:local chunk-end -->

Then move the chunk's row in [build-order.md](../log/build-order.md#chunks): to Waiting if something about the chunk is left to check, or to [chunks-done.md](../log/chunks-done.md) if not.

After the commit, propose the chunk's pull request with the `pull-request` skill. It is squash-merged on the owner's yes, as in [branches.md](branches.md).

If the chunk wasted real effort, add a row to [efficiency-log.md](../log/efficiency-log.md). No waste, no row.

## Check stories against frames

Stories and frames drift apart as both grow. Each chunk checks them in both directions, at its start and again while the screen is built and compared to its frame:

- A story or acceptance line with no frame showing it. For example, a story lets the user reorder, but no frame shows how.
- A frame element with no story behind it. For example, a button, filter, count, or state that no acceptance line asks for.
- A frame and a story that disagree, in wording, order, or behavior.
- A flow step with no screen, or a screen no flow reaches.

<!-- wf:local drift -->

When the check finds a drift, stop the part of the chunk that depends on it. Tell the designer what drifted, with the story ID and the frame name, and ask how to close it. Suggest one fix and say why: draw a frame, change the story, or drop the element. Do not settle it by building a guess. Work that does not depend on it can go on.

Log the open drift in [open-questions.md](../log/open-questions.md) until it is answered. Once it is, the fix goes back through Step 1 or Step 2, then the chunk continues.

## What to do with an idea that arrives early

If a tech choice, a library, or a behavior shows up during Step 1 or Step 2, write it in [open-questions.md](../log/open-questions.md). Do not treat it as decided. Agreed decisions go in the decisions log (`wf decision add`).
