# Ask when the choice is not yours

On this machine, decide what you can from the repo, these rules, and the chat. When you cannot, ask the person whose role owns that choice, as Who decides below says, before you commit to it, in every chat, including planning and implementation.

- **When.** Look first. Ask before the plan or code that depends on it when plans diverge, a needed fact is missing, or design, architecture, approach, scope, an irreversible or expensive step, a new library or service, naming, security or data kept, or a conflict with a rule is unresolved.
- **When not.** Take a sensible default that is cheap to change, and say what you assumed. Do not ask what the repo, the rules, or the chat already answers, or re-ask what was already answered.
- **How.** Ask at the fork. Recommend one option and say why. Stop only the work that depends on the answer. Their answer in a later message, or on an ask page, is the decision. An unstated assumption is not.
  - Up to four quick questions with no picture go to the structured question tool when it is available, or in the message.
  - More than four, or any visual question, go on an ask page, with the kit's `ask-page` skill: `npx wf ask page <spec>`, opened in the browser pane, then `npx wf ask wait <id>` in the background.
  - Group them: one page for what blocks the same piece of work, related questions together under what they decide, and questions of the same shape as one. The skill says how.
- **Show what a visual question is about.** A question about a frame, a screen, or an image comes with its picture. So does a picture sent for review, such as a new or redrawn frame.
  - Send the picture just before the question, so it stays in view while the question is open.
  - A comparison is one labelled picture, such as the frame on the left and the app on the right. Several questions share one labelled sheet.
  - With the design plugin, make every picture you send with `npx wf design annotate <spec>`. Each one gets a bar with its letter and frame name, and numbered boxes around what to look at: blue to look, red for a bug, amber for drift, green for fine, purple for new or changed.
    - When nothing fits, add a kind under `design.kinds` in [.workflow/config.json](.workflow/config.json), never changing an existing one.
    - A frame's boxes come from its elements. The spec is in the kit's `design-frames` skill.
  - Each question says where to look, such as "sheet A, box 2". Option previews hold text only, so a layout choice can add a rough text sketch.
  - Where a browser pane is open beside the chat, ask on an ask page, so each picture sits beside its question; an annotate sheet can be one of its pictures. Without a pane, send the sheet just before the question.
<!-- wf:local asking-pictures -->
- The full list of when to ask and when not is in [asking.md]({{docs.workflow}}/asking.md).
- **Missing packages.** Never install a system package. Name what is missing, give the install command, and wait for the person at this computer, or ask when it would only make the job easier. The steps are in [tools.md]({{docs.workflow}}/tools.md#missing-packages).

<!-- wf:roles -->
<!-- /wf:roles -->

# {{project}}

The workflow docs are in [{{docs.workflow}}]({{docs.workflow}}), and the append-only logs in [docs/log](docs/log). Every doc is indexed in [{{docs.index}}]({{docs.index}}).

## Efficiency

Efficiency that leads to our outcome is how we work, in every chat and every task, without being asked. It is a hypothesis under test, in [efficiency.md]({{docs.workflow}}/efficiency.md).

- **Outcome first.** The goal is the outcome for the least total waste, not the fewest tokens or steps. It never overrides a rule here, such as test data, security, or review.
- **Weigh the whole.** Consider ways of working, test cases, code, process, design, user stories, and thinking together. A saving in one area that costs more in another is not a saving.
- **Correct each other.** When a request or plan looks wasteful, tell the person you are working with, with the cost and a cheaper way to the same outcome. Then do what they decide. When they correct you, fix the cause, not just the instance.
- **Script what repeats.** On the third time, make a small script.
  - It reads the repo's shape and no one feature, needs no new dependency, and reports facts for a person or model to judge.
  - A script others rely on has a test. One that needs changing with each feature does not belong, and the efficiency check removes one nobody uses.
- **Parallel work.** When parts of the work are independent, propose running them at once, and ask first. A guideline, not a rule. The approaches and their costs are in [efficiency.md]({{docs.workflow}}/efficiency.md#parallel-work).
  - Never put two writers in one checkout. Each writing session gets its own worktree.
- **Correct yourself.** Measure before you optimize, test the riskiest assumption small before building on it, and stop when the evidence turns, whatever has already been spent.

## Rules

- **Four steps.** Follow [four-steps.md]({{docs.workflow}}/four-steps.md), for each area on its own. A later step can send the work back to design. Do not pick a stack or architecture before Step 3. Log an early idea in [open-questions.md]({{logs.openQuestions}}).
- **Chunks.** Run the [chunk-start]({{docs.workflow}}/four-steps.md#chunk-start) and [chunk-end]({{docs.workflow}}/four-steps.md#chunk-end) steps. Ask once at the start, each question to the role that owns it, and do not build the part that depends on an answer. Chunk end runs the `code-review-ledger` skill before the commit proposal.
<!-- wf:local data -->
- **Code** follows [code-standards.md]({{docs.workflow}}/code-standards.md).
<!-- wf:local design -->
- **Branches.** Nothing is committed or pushed to `main`. Work goes on an `<area>/<slug>` branch and lands by pull request, as in [branches.md]({{docs.workflow}}/branches.md).
- **Commits** follow the `commit` skill, and pull requests the `pull-request` skill. One yes covers a pull request and the push it needs; a merge needs its own yes.
- **Issues.** An issue that took real debugging gets an entry in [troubleshooting.md]({{logs.troubleshooting}}) in the same change, including one fixed by a workaround or left open. Search the log before debugging a symptom that looks familiar.
- **Always on.** A rule stays in full in this file, not behind a link, when all three hold:
  - it applies in any chat;
  - nothing loads its detail before the moment it applies, such as a skill or a step that reads the doc;
  - missing it costs someone's time or a wrong choice.
  - The asking rules above pass. A rule that a skill or a check brings in at the right moment can live in its doc.
- **Search before you read.** Find the entry, then read only that.
  - `npx wf doc:find <ID, date, or heading> [path]` prints each section, row, or bullet that starts with it. Grep for a word inside an entry.
  - A log in `docs/log/`: never read one whole. The one exception is the efficiency log, read whole at its check.
  - Any other doc: read it whole when you need how it fits together (a review, a design change, a debug that crosses sections), or you would search it three or more times. Above about 50 KB, read by section.
  - For where the work stands, run `npx wf doc:facts`.
- **Docs.** One topic per file. [writing-docs.md]({{docs.workflow}}/writing-docs.md) has the formats. After adding a doc, add its row to `{{docs.index}}`. When a step starts or finishes, update the area's row in the Areas table in `build-order.md`, and add a line to the History in its file in `docs/log/build-order/`.
- **Agent configuration.** Claude Code and OpenCode share the instructions, skills, and agent prompts in this repo. Follow [ai-tools.md]({{docs.workflow}}/ai-tools.md) when changing them or switching tools mid-task.

## Where a note goes

| Kind | File |
| --- | --- |
| Agreed decision | `{{logs.decisions}}/<area or topic>.md`, added with `npx wf decision add`, cited by its ID |
| Unresolved question | `{{logs.openQuestions}}`, under the chunk it blocks |
| Story or flow | the area's `user-stories.md` and `user-flows.md`, in its folder from `areas` in the config |
| Area work | the area's folder |
| Architecture | the area's `architecture.md` |
| Raw research | a new file under `docs/research/` |
| An issue we hit, with its cause and fix | `{{logs.troubleshooting}}` |
| Real wasted effort, and the change it led to | `{{logs.efficiencyLog}}` |
| Synthetic test data for an area | the area's `test-data/` folder, one-screen files by flow area, with its rules beside its datasets, process in `{{docs.workflow}}/test-data-process.md` |

<!-- wf:local notes -->
