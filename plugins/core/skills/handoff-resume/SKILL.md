---
name: handoff-resume
description: Reads the local agent handoff, reconciles it with the current repository, and continues the task. Use only when someone invokes /handoff-resume or asks to resume a handoff.
disable-model-invocation: true
---

# Resume an agent handoff

Read `.cache/agent-handoff.md` from the repository root. If it does not exist, say there is no handoff and stop. Do not create one.

Before continuing:

1. Check the current branch, short HEAD, and `git status --short`.
2. Compare them with the handoff. A different HEAD or changed files is not automatically a conflict, but report the difference and inspect enough of the current files to avoid undoing newer work.
3. Read the project instructions and the specific files needed for the next action. Treat the handoff as a summary to verify, not proof of the current state.
4. If the handoff belongs to another task or its next action is ambiguous, ask before changing anything.

Give a short summary of the objective, current state, any repository differences, and the next action. Then continue that action as part of this request; do not stop after the summary unless you were asked only to inspect the handoff.

Keep the handoff file unchanged. The next `/handoff` replaces it. Do not mark it consumed and do not commit it.
