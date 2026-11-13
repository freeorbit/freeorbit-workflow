# Asking

When an agent asks before choosing, whom it asks, when it does not, and how it asks. The short rule is in [AGENTS.md](../../AGENTS.md).

## When to ask

On this machine, decide what you can from the repo, the rules, and the chat. When you cannot, ask the role that owns the choice, from Who decides in AGENTS.md, before you commit to it. This applies in every chat, including planning and implementation.

Look first. Ask before writing the plan or the code that depends on the answer when any of these is unresolved:

- Divergent plans: more than one valid plan, and picking one changes the work.
- Missing information: a fact you need is not in the repo, the rules, or the chat, and guessing it would send the work the wrong way.
- Design: UI, API shape, data model, or interaction, when the repo does not already decide it.
- Architecture: where code lives, new boundaries, or a structure different from the one already in the project.
- Approach: a different algorithm, library, or strategy, beyond a small reversible default.
- Scope: the request is broad, and what is in or out changes the work.
- Irreversible or expensive: deletes, migrations, breaking a public API, or a large rewrite.
- New project libraries or services: adding one to the project is a choice. Ask before adding it.
- Product, UX, or public naming, when the repo does not already decide it.
- Security, privacy, auth, or what data is kept and for how long.
- Conflict: the request fights an existing pattern, a rule, or an earlier decision in this chat.

## When not to ask

- If a sensible default exists and changing it later is cheap, take it, say what you assumed, and keep going.
- The exception: a missing dependency that would make the job easier. Ask, even though the job can proceed without it, as [tools.md](tools.md#missing-packages) says.
- Do not ask what the repo, the rules, or this chat already answers. Do not re-ask a question that was already answered.

## How to ask

How to ask, and how to show a visual question, are in [AGENTS.md](../../AGENTS.md) in full. They apply at a moment when nothing else would load them, so they are always on. Without the question tool or a browser pane, ask in the message.

## Ask pages

An ask page holds any number of questions, with their pictures, on one page in the browser pane. The steps and the spec are in the kit's `ask-page` skill.

- **Templates.** `npx wf ask templates` lists them: a decision, a batch by role, a compare, a frame review, a storyboard, a triage, a ranking, naming, test-data rows, a plan, and a sign-off.
- **Recommendations.** Every option on a page says what it means, every choice names the recommended option and why, and a ranking lists its suggested order and why; `wf ask page` refuses a spec without them. A review's verdicts recommend nothing.
- **Answering.** Each question can take "You decide" or "Later", a note, and pins on its pictures. A partial send is fine; the agent carries on with what is answered.
- **Many at once.** The bulk bar takes every recommendation, marks a shared verdict, or leaves questions to the agent or for later, for the selected questions or every open one. Undo puts them back.
- **The keyboard.** J and K move, 1–9 pick, R takes the recommendation, Enter goes to the next open question, Ctrl+K lists commands, Ctrl+Z undoes, Ctrl+Enter sends, and ? lists the rest.
- **Moving between asks.** Each page's header shows the other waiting asks; [ and ] go to the previous and next, I opens the inbox, and the receipt after Send offers the next one.
- **Project templates.** A question that comes back often can get a template of its own, as data in `.workflow/ask-templates/`. The agent proposes one and the owner says yes; it holds no code.
- **Colours.** The page follows the Claude Desktop theme when Claude Desktop is installed, and offers every palette it bundles, or one of the kit's six themes, each light and dark. An accent of nine or the person's own, and a text size, sit over any theme; all are kept in the browser.
- **Folding.** Expand all, Collapse all, and Fold answered sit above the questions with Select all.
- **Wording.** Questions, labels, and reasons are held short; `explain: true` gives room where the person asked for more detail.
- **Drafts.** The page keeps a draft in the browser, so a reload loses nothing. A newer version of the page says so at the top.
- **Export.** `npx wf ask export <id>` writes one HTML file, pictures inside, for someone without the pane, and the answers as Markdown and JSON. Their answers file comes back through `npx wf ask import`.
- **The record.** `npx wf ask record <id>` adds each "Later" to the open questions, and each answer the spec marks with `record` to that decisions file.
- **The server.** One `question-pictures` server serves every project, worktree, and session on the machine, each at its own address. `wf ask page` starts it when none runs, and `.claude/launch.json`'s entry joins it.
- **Many sessions.** Its front page is an inbox of every ask, waiting ones first, with the repository, branch or worktree, and session that asked. A page another session still waits on is never replaced without `--replace`.
