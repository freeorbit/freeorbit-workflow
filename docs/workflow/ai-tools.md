# Claude Code and OpenCode

Claude Code and OpenCode use the same project instructions, skills, and agent prompts. Both stay configured all the time; there is no mode switch and no need to rewrite files when changing tools.

## Source and adapters

| What | Canonical source | Compatibility layer |
| --- | --- | --- |
| Project instructions | `AGENTS.md` | `CLAUDE.md` imports it with `@AGENTS.md`. OpenCode discovers it directly. |
| Skills and supporting scripts | The kit's plugins, and `.claude/skills/` for the project's own | Claude Code loads the kit as plugins and `.claude/skills/` directly. OpenCode reads both through the `skills` paths in `opencode.json`. Do not copy skills to `.opencode/skills/`. |
| Subagents | The kit's plugins, and `.claude/agents/` for the project's own | `npx wf ai:sync` generates native OpenCode agents in `.opencode/agents/` from both. |
| Slash commands | A skill with `disable-model-invocation: true` | `npx wf ai:sync` generates a wrapper in `.opencode/commands/` that loads it. A hand-written wrapper, such as `make-test-files.md`, stays as it is. |
| Settings, permissions, hooks, and model providers | Tool-specific configuration | Keep these native; their schemas and behavior are not interchangeable. |
| Current task handoff | Written from the current conversation | `.cache/agent-handoff.md` is local and gitignored. |

The generated files under `.opencode/agents/` are committed so a fresh checkout or worktree works without a setup step. Never edit them directly. After changing a canonical agent, run:

```sh
npx wf ai:sync
npx wf ai:check
```

`ai:sync` is the kit's `wf ai:sync`. It also removes a generated file whose source is gone, and stops on a hand-written file it would replace. It refuses an agent defined both in `.claude/agents/` and in the kit, because Claude Code would quietly prefer the project copy. `ai:check` fails on any of these without writing.

Generated agents deny every action they do not list, and OpenCode applies the last matching rule. So the adapter repeats OpenCode's `.env` read rules after the read allow, and an agent cannot read outside the repo. A workflow that hands an agent files writes them inside the repo, such as `.cache/review-scan/` for the review scanners.

Canonical agents use `name`, `description`, `model: inherit`, and a comma-separated `tools` list. The generator requires the filename and `name` to match. It rejects unknown frontmatter fields, fixed models, and unmapped tools rather than silently dropping behavior. A new field or tool needs an explicit mapping in the kit's `lib/setup/ai.mjs`.

## The workflow kit

The generic workflow is moving into the `freeorbit-workflow` kit, a public MIT repo installed as a dev dependency pinned to a tag.

| Who | Gets the kit from |
| --- | --- |
| `pnpm` scripts, git hooks, CI | `node_modules/freeorbit-workflow`, through the `wf` command |
| Claude Code | The `core` plugin, from the marketplace in the committed `.claude/settings.json`, at the same tag |
| OpenCode | The `skills` path in the committed `opencode.json` |

- **Settings.** `.workflow/config.json` holds the project's paths, areas, scopes, loose docs, scans, and extensions. `npx wf config` prints every setting with the reason for its default.
- **Workflow docs.** Each doc in `docs/workflow/` that starts with a "From the freeorbit-workflow kit" line is written by `npx wf docs sync`. The project's own parts sit between a `wf:local` pair and are edited in place; the rest changes in the kit. `doc:check` fails an edit outside the parts.
- **Who decides.** The block in `AGENTS.md` is written from `people` and `decisions` in `.workflow/config.json`. After changing either, run `npx wf roles --write`; `doc:check` fails a stale block.
<!-- wf:local ci -->
- **A new version** is a new tag in the kit. Change the tag in `package.json` and `.claude/settings.json` together, then run `pnpm install`.
  - Claude Code keeps the old plugin until the marketplace is added again at the new tag: `claude plugin marketplace add "freeorbit/freeorbit-workflow#<tag>" --scope project`, then `claude plugin update core@freeorbit-workflow --scope project`. Changing the `ref` alone does not update it.

## Skills and commands

Keep skill instructions portable. Both tools load `name`, `description`, and `disable-model-invocation`; Claude-specific frontmatter or behavior needs an explicit compatibility check before it is relied on.

Claude Code exposes a project skill as `/<skill-name>`. OpenCode can load it with `@<skill-id>`, the ID OpenCode derives from the path (the folder name for `.claude/skills/<name>/SKILL.md`). These OpenCode wrappers provide the slash commands used directly in this repo:

- `/make-test-files <arguments>` forwards the exact arguments to the canonical skill.
- `/handoff` writes a handoff.
- `/release` makes a release. Its skill has `disable-model-invocation`, so the command is the way in.
- `/handoff-resume` resumes one. The longer name avoids replacing either tool's built-in session-resume command.

Other skills do not need command wrappers.

## Model routing

Canonical agents inherit the active model, so switching tools does not leave a Claude model ID in OpenCode or an OpenCode provider ID in Claude Code. When a workflow requires a particular or different model, keep that choice at the native invocation point.

For a review, the models for each tool are in step 3 of the `code-review-ledger` skill.

## Switch mid-task

In the tool that has the current conversation, run:

```text
/handoff
```

This replaces `.cache/agent-handoff.md` with a concise snapshot of the objective, decisions, changed files, checks, repository state, and exact next action. It contains no full transcript and must not contain secrets or real personal data.

In the other tool, run:

```text
/handoff-resume
```

The new agent verifies the summary against the current branch, HEAD, status, and relevant files, reports any drift, and continues the next action. The handoff stays in place until the next `/handoff`; it is not committed or automatically updated.
