---
name: commit
description: >-
  Commits changes with an area-first subject and an ID-first body. Commits at
  once when a person asks and the git identity is theirs; otherwise proposes
  the message and waits for a yes. Use whenever a commit is mentioned or the
  agent is about to commit.
---

# Commit

Who may say yes, and each person's git identity, are in **Who decides** in `AGENTS.md`.

## When to ask

Read the identity with `git config user.name` and `git config user.email`.

- **A person asked.** They ran this skill, said in chat to commit, or said yes to a question that said it would commit. If the identity is theirs, commit without asking: their request is the yes. If either part differs, show both and ask once.
- **The agent wants to commit.** Nobody asked in this turn. Propose it and wait.
  - This covers a chunk start or end, a small doc-only edit, a plan step, a task that mentions committing, or a commit you think is due.
  - Do not run `git commit` until they agree in a later message, and do not ask again after they agree.
  - A plan or a todo is not a yes. Their reply to the proposal is.

## Check the branch

Run `git branch --show-current`. Never commit on `main` or a `release/X.Y` line, even when asked.

- Start a branch named `<area>/<slug>` from the work, as the project's branch rules say, and commit there. Say the branch name with the message.
- Rename a branch that breaks the naming rule, such as `claude/…`, with `git branch -m` before committing.

## Read the diff

Run `git status`, `git diff` (staged and unstaged), and `git log -5 --oneline`. Judge from the diff, not from the task description.

## The message

Write it as [message-format.md](message-format.md) says. A commit may hold more than one topic; do not stop to split it.

## What to show in chat

Show only the message, never the files, paths, or a count of them.

- **Proposal:** the branch and the message, then ask once and wait. Add the author and email only when they are not the expected identity.
- **After committing:** the short hash and the message.
