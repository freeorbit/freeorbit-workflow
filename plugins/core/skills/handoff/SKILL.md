---
name: handoff
description: Writes a local handoff so another AI coding tool can continue the current task. Use only when someone invokes /handoff or asks for a tool switch.
disable-model-invocation: true
---

# Write an agent handoff

Write `.cache/agent-handoff.md` in the repository root. This file is gitignored. Invoking this skill replaces the previous handoff; do not create timestamped copies and do not commit it.

Capture the current conversation and repository as they are now. Do not finish pending work, rerun checks, or change project files just to make the handoff look complete. Never include secrets, credentials, real personal data, or a full conversation transcript.

Use `git branch --show-current`, `git rev-parse --short HEAD`, `git status --short`, and, when useful, `git diff --stat` to ground the repository state. Read small relevant files when needed to make the next action precise.

Use this shape, omitting only empty optional sections:

```markdown
# Agent handoff

Updated: <ISO 8601 date and time>
From: <tool and model, when known>
Branch: <branch>
HEAD: <short commit>

## Objective
<The user's current goal and the current workflow step or chunk.>

## Current state
<What is done, what is in progress, and what has not started.>

## Decisions and constraints
<Decisions made in this conversation and constraints the next tool must not lose.>

## Files changed
<Each relevant path and what changed. Include uncommitted work.>

## Checks
<Checks already run and their exact result. Say when none were run.>

## Next action
<One concrete action to take first.>

## Open questions
<Unresolved choices or blockers, if any.>

## Repository state when written
<text of git status --short>
```

Keep it concise, normally under 150 lines. Do not paste a full diff. Preserve unresolved questions rather than guessing their answers.

After writing it, say only where it is and the command for the other tool: `/handoff-resume`.
