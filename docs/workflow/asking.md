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

How to ask, and how to show a visual question, are in [AGENTS.md](../../AGENTS.md) in full. They apply at a moment when nothing else would load them, so they are always on. If more questions remain after a batch, ask the next batch after the answers come. Without the question tool, ask in the message.
