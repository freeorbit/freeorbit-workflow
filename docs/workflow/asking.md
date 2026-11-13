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
- **Recommendations.** Every choice on a page names the recommended option and why, and a ranking lists its suggested order and why; `wf ask page` refuses a spec without them. A review's verdicts recommend nothing.
- **Answering.** Each question can take "You decide" or "Later", a note, and pins on its pictures. A partial send is fine; the agent carries on with what is answered.
- **The keyboard.** 1–9 picks an option, ← → pages, j and k move between questions, n finds the next open one, Ctrl+Enter sends, and ? lists them.
- **Drafts.** The page keeps a draft in the browser, so a reload loses nothing. A newer version of the page says so at the top.
- **Export.** `npx wf ask export <id>` writes one HTML file, pictures inside, for someone without the pane, and the answers as Markdown and JSON. Their answers file comes back through `npx wf ask import`.
- **The record.** `npx wf ask record <id>` adds each "Later" to the open questions, and each answer the spec marks with `record` to that decisions file.
- **The server.** The `question-pictures` entry in `.claude/launch.json` runs `npx wf view serve`. `npx wf view setup` writes it, or replaces the old file server.
