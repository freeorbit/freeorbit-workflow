---
name: pull-request
description: >-
  Proposes a pull request and waits for a yes before pushing or opening it,
  then squash-merges it on the owner's second yes. Title and body follow the
  commit message format. Use when a pull request, PR, or merge is mentioned,
  and at chunk end after the commit.
---

# Pull request

Who says yes is in **Who decides** in `AGENTS.md`: the merge is the owner's.

Propose the pull request once. This proposal is the only ask.

- Do not push or run `gh pr create` until a yes in a later message, and do not ask again after it.
- That yes covers the push the pull request needs.
- A plan, a todo, or a task that mentions a pull request is not a yes. The reply to the proposal is.

## Read the branch

Run `git status`, the branch tracking, `git log <base>..HEAD`, and `git diff <base>...HEAD`. Judge from the commits on the branch, not from the task description.

## One pull request

Open one pull request for the branch, ready for review. If the branch has more than one topic, the body lists each. Do not split unless asked.

## Title and body

They follow [message-format.md](../commit/message-format.md). A one-commit branch can use its commit subject.

## What to show

- The branch, and the base it would merge into
- The commits, by subject
- The title and the body
- That this yes also pushes the branch

Then ask once, and wait.

## Merge

The pull request lands as one squashed commit, so its title and body are what `main` keeps.

- Before asking to merge, run `npx wf signoffs`. While it lists an open question, a chunk's open-questions row or a `needs <role>:` line in the body, do not propose the merge: name each question and who holds its role. In a solo project it never lists one.
- After opening it, ask once whether to merge. A yes to open is not a yes to merge.
- On the owner's yes, from the main checkout, since `gh` cannot delete a branch checked out in a worktree:
  1. `gh pr merge <number> --squash`.
  2. `git push origin --delete <branch>`.
  3. `git worktree remove <worktree>`, if the branch had one.
  4. `git branch -D <branch>`.
  5. `git pull --ff-only` on `main`.
- If the branch is behind `main`, or GitHub shows a conflict, rebase it locally: `git fetch origin && git rebase origin/main`. GitHub's merge ignores the `merge=union` the append-only logs carry, but a local rebase honours it, so rows both sides added land without a conflict. When the rebase finishes clean, run the project's checks, then `git push --force-with-lease` and merge. When it stops on a real conflict, say so and stop. Do not merge it.
