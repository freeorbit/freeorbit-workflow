# Branches

How work reaches `main`: on a named branch, through a pull request, squashed into one commit.

<!-- wf:local releases -->


## Rules

- **No direct commits.** Nothing is committed or pushed to `main` or a `release/X.Y` line. A typo fix goes through a branch too.
- **One branch per chunk or task.** A build chunk gets its branch at chunk start, and its pull request at chunk end. Other work, such as a docs change, gets its own.
- **Squash merge.** A pull request lands as one commit on `main`. Its title and body become that commit's subject and body, so they follow the `pull-request` skill.
- **Delete on merge.** The branch goes from GitHub and from this computer when its pull request merges.
<!-- wf:local checks -->

## Names

A branch is `<scope>/<slug>`, such as `app/chunk-21-scan` or `workflow/branch-rules`.

- **Scope.** The part the work changes most, one of `scopes` in `.workflow/config.json`.
<!-- wf:local scope-notes -->

- **Slug.** Lowercase words joined by hyphens, 40 characters or fewer. It starts with the ID when there is one: `chunk-21`, `app-37`, `sec-043`.
- **Release lines.** `release/X.Y`, such as `release/0.2`, is a release line, not work. Release tooling work uses any other slug, such as `release/feed-notes`.
- **Worktrees.** A branch an app or tool named for itself, such as `claude/…`, is renamed before its first push: `git branch -m <scope>/<slug>`.

## The flow

1. **Start.** From an up-to-date `main`: `git switch main && git pull --ff-only && git switch -c <scope>/<slug>`.
2. **Commit** on the branch, following the `commit` skill.
3. **Propose the pull request** with the `pull-request` skill, once the project's full check passes. One yes covers the push and opening it.
4. **Merge** on the owner's own yes in chat, a second one after the yes to open. The steps are in the `pull-request` skill. They run from the main checkout, because `gh` cannot delete a branch checked out in a worktree.

## On GitHub

What GitHub itself holds depends on the plan, set by `github` in `.workflow/config.json`.

- **Free and private.** No rulesets, so the git hooks and the `pull-request` skill hold the rules above.
- **Hooks.** `npx wf hooks install` writes `.workflow/hooks/pre-commit` and `pre-push`, and points this clone's `core.hooksPath` at them.
  - The project's `prepare` script runs it after each install, and `npx wf tools` says when the hooks are off.
  - They refuse a commit or push to a branch in `branches.protected`, and a push of a branch not named `<scope>/<slug>`, where the scope is one of `scopes` or an area's id.
  - A new area or scope goes in the config before its first branch. Tags push as usual.
- **Public, or a paid plan.** GitHub can hold them too: `npx wf github ruleset` prints the ruleset to apply.
- **Files.** `npx wf github sync` writes the pull request and issue templates, CODEOWNERS from the people and their roles, the check workflow, and Dependabot, each when its switch is on. `npx wf github check` fails when one drifts.

The append-only logs carry `merge=union` in `.gitattributes`, from `docs.union`, so rows added on two branches both land. GitHub's own merge ignores it, so a pull request behind `main` shows a conflict there; the `pull-request` skill rebases it locally, which resolves the rows, before it merges.

A question that waits on someone who holds a role is one of these:

- a row under its chunk's heading in the open questions log, with the role in Needs, until it is resolved and moved out;
- a `- [ ] needs <role>: <question>` line in the pull request body, ticked once answered.

`npx wf signoffs` lists the open ones, and no merge is proposed while any are.

A branch that needs work from another unmerged branch starts from that branch. After the first one merges, move it onto `main` with `git rebase --onto main <first branch>`, because the squash left the first branch's commits behind.

<!-- wf:local enforcement -->
