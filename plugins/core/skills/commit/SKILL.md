---
name: commit
description: >-
  Commits Freeorbit changes. When Ken asks to commit and the git identity is
  ordinarylinuxuser <kentparker666@gmail.com>, commits without asking. When the
  agent wants to commit on its own, or the identity differs, proposes the
  commit and waits for Ken's yes. The subject is the area and what changed, in
  72 characters or fewer. The body gives one short ID-first line per topic. In
  chat, shows only the message. Do not list the files. Use when Ken mentions a
  commit, committing, or a commit message, and whenever the agent is about to
  commit.
---

# Commit

This skill lives only in this project.

## When to ask

Read the identity with `git config user.name` and `git config user.email`.

- **Ken asked.** He ran this skill, or said in chat to commit. If the identity is `ordinarylinuxuser` and `kentparker666@gmail.com`, commit without asking. His request is the yes. If either differs, show both and ask once before committing.
- **The agent wants to commit.** Ken did not ask in this turn. Propose it and wait.
  - This covers a chunk end, a plan step, a task that mentions committing, or a commit you think is due.
  - Do not run `git commit` until Ken agrees in a later message. Do not ask again after he agrees.
  - A plan or a todo is not a yes. His reply to the proposal is.

## Check the branch

Run `git branch --show-current`. Never commit on `main` or a `release/X.Y` line, even when Ken asked to commit.

- Start a branch named `<area>/<slug>` from the work, as in `docs/workflow/branches.md`, and commit there. Say the branch name with the message.
- Rename a branch that breaks the naming rule, such as `claude/…`, with `git branch -m` before committing.

## Read the diff

Run `git status`, `git diff` (staged and unstaged), and `git log -5 --oneline` for recent messages. Judge from the diff, not from the task description.

## Topics

A topic is one reason. The change and the docs or tests that exist for that reason are part of that topic.

A commit may hold more than one topic. Do not stop, and do not ask Ken to split it. The subject names the main topic. The body lists every topic, in order of weight. Do not leave a topic out of the body.

## The message

A contributor reads the log at a glance, so the subject says what changed, and the body says enough to find the why. The full reasons live in the docs (`decisions.md`, `review-findings.md`, `troubleshooting.md`, the stories), so the body points there by ID instead of repeating them.

**Subject.** `area: what changed`, in 72 characters or fewer, with no full stop.

- The area is the part of the project the commit changes most: `app`, `uplink`, `downlink`, `release`, `design`, `testdata`, or `workflow` (docs process, agent configuration, and the tools behind them). Use another plugin's id when one is added.
- What changed is plain words, starting with a verb, such as "add", "check", "fix", or "name". No commit type (`feat`, `fix`, `docs`), and no file names.

**Body.** After a blank line, one bullet per topic, wrapped at 72 characters.

- Start a bullet with its ID when it has one: a story (DR-05), a finding (SEC-043), a chunk (chunk 19h), or a question.
- One line on what changed and why, two at most. Name a file only when the topic is that file, such as a research note.
- A one-topic commit with nothing to add beyond the subject may have no body.

Good, one topic with a body:

```
release: check build tools after bundling, close chunk 19h

- SEC-043: rehash the tools after the build; an AppRun or AppImage
  not in build-tools.txt fails it.
- SEC-044: every Windows SDK link must resolve inside its folder.
- Light review found nothing else.
```

Good, mixed:

```
downlink: name the plugin and write its Step 1

- Stories DR-01 to DR-20 and flows, from the data requests research.
- APP-37 and GM-33: hand services over from Uplink when the user
  approves, so neither plugin reads the other's data.
- doc-check knows DR- IDs.
```

Bad: `docs: update build-order.md, screens.md, and four-steps.md`

Bad: a subject that is the whole reason in two sentences. It is cut off in every list that shows it.

The commit itself always carries the whole subject and body.

## What to show in chat

Show only the message: the subject and the body. Do not show the files, the paths, or a count of them.

- **Proposal** (the agent wants to commit): the branch and the message, then ask once and wait. Add the author and email only when they are not the expected identity above.
- **After committing**: the short hash and the message.
