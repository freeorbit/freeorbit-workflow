---
name: workflow-init
description: Sets up a new project on the workflow kit. Asks the owner who is on the team, the areas, and which kit plugins to use, writes the answers, runs wf init, and checks the result with wf doctor. Use only when someone invokes /workflow-init or asks to set up a new project on the kit.
disable-model-invocation: true
---

# Set up a project on the workflow kit

Run in the new project's root, a git clone. Nothing is committed or pushed without the owner's yes.

## 1. Look first

- `git status` and `git remote -v`. If the folder is not a clone, say so and stop.
- Read what is already there: a README, a `package.json`, an `AGENTS.md` or `CLAUDE.md`, a `docs/` folder. Init keeps every file that exists. Say which ones it will leave alone, so the owner can merge them by hand.
- `node --version` must be 24 or later. A missing tool is named with its install command, never installed.

## 2. Ask once

Ask in one batch with the question tool, recommending an option for each:

- **The team.** Each person's name, GitHub handle, email, and roles: `owner`, `designer`, `developer` (or `developer:frontend`, `developer:backend`), `reviewer`. Solo is one person holding every role. A person who never touches the repo, such as a designer in a design tool, has no handle.
- **The areas.** Each part of the product that goes through the four steps alone: an id, a story prefix of two to five capitals, and a docs folder under `docs/`.
- **The plugins.** `core` always. `review` for the code review. `testdata` for synthetic test data. `design` for frames and the screen review, with `design.source` `html` or `png` (pictures exported from a design tool). `e2e` for the blind end-to-end tester. `release` for versions and tags. A stack adapter (`stack-tauri-rust`, `stack-web`) only once Step 3 has chosen the stack.
- **The agent tools.** `claude`, `opencode`, or both, for `ai.tools`.
- **The kit's tag.** The newest release unless the owner names one.

Do not ask what the repo already answers, such as the project's name from its README.

## 3. Write the answers and run init

Write `.cache/workflow-init.json` in the shape `lib/init.mjs` documents: `project`, `team`, `people`, `scopes`, `areas`, `plugins`, `kit.tag`, and `config` for any other setting. Then run the kit once from its tag, before it is installed:

```bash
npx --yes --package "git+https://github.com/freeorbit/freeorbit-workflow.git#<tag>" wf init .cache/workflow-init.json
```

It prints each file it wrote or kept. A problem with the answers stops it before anything is written; fix the answers and run it again.

## 4. Install and check

1. The package install, such as `pnpm install`, installs the kit and its `prepare` script turns the branch hooks on.
2. In Claude Code: `claude plugin marketplace add "freeorbit/freeorbit-workflow#<tag>" --scope project`, then `claude plugin install <plugin>@freeorbit-workflow --scope project` for each plugin. Ask the person to restart Claude Code.
3. `npx wf doctor`. Every line is OK, or its FAIL says what to run. `npx wf doc:check` passes.

## 5. Hand over

- Tell the owner what is next: Step 1 for the first area, its stories and flows (`npx wf ready area`).
- Propose the set-up's commit on a `workflow/<slug>` branch and its pull request, with the `commit` and `pull-request` skills.
- If init or the doctor showed a gap in the kit itself, say so plainly, with the file and what broke.
