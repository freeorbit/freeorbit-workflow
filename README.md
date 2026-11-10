# freeorbit-workflow

The Freeorbit agent workflow as installable Claude Code plugins, the scripts they run, and the same skills for OpenCode. The plan and the audit behind it are `docs/research/workflow-kit.md` and `docs/research/workflow-audit.md` in Freeorbit.

## Install in a project

1. Add the package, pinned to a tag:

   ```sh
   pnpm add -D "freeorbit-workflow@git+https://github.com/freeorbit/freeorbit-workflow.git#v0.4.0"
   ```

2. Add the plugin for Claude Code, at project scope so everyone gets it:

   ```sh
   claude plugin marketplace add freeorbit/freeorbit-workflow --scope project
   claude plugin install core@freeorbit-workflow --scope project
   claude plugin install review@freeorbit-workflow --scope project   # optional modules
   claude plugin install testdata@freeorbit-workflow --scope project
   claude plugin install design@freeorbit-workflow --scope project
   claude plugin install stack-tauri-rust@freeorbit-workflow --scope project   # a Tauri and Rust app
   claude plugin install stack-web@freeorbit-workflow --scope project          # a web app: its servers and a headless Chromium
   claude plugin install e2e@freeorbit-workflow --scope project                # needs an app driver and testdata
   claude plugin install release@freeorbit-workflow --scope project
   ```

3. Start a committed `opencode.json` for OpenCode:

   ```json
   { "$schema": "https://opencode.ai/config.json" }
   ```

   Then run `npx wf ai:sync`, which adds each kit plugin's skills path and writes the OpenCode agents and commands.

4. Write `.workflow/config.json`: at least `project` and `people`, with `"team": "solo"` for one person. List the project's `areas` (each with its story prefix) and `scopes` (commit and branch prefixes). Run `npx wf docs sync`: it writes `AGENTS.md` with the Who decides block, and the workflow docs. Put `<!-- wf:index words -->`, `workflow`, and `logs` marker pairs in the docs index for its kit tables. Copy `templates/threat-model.md` to the file `review.threatModel` names when the first area reaches Step 3. `npx wf docs sync` writes `docs/workflow/config.md`, every setting with what it does, its default, and why, and `.workflow/config.schema.json`, which the config names as `$schema` so an editor shows the same on hover.

5. `npx wf ai:sync` also writes deny rules for secret files into the committed `.claude/settings.json` and into each OpenCode agent, from the one list in the core plugin's guard (`SECRET_GLOBS`: `.env`, `.env.*`, keys, certificates, and SSH keys), so no session or agent reads them (audit W-11). `npx wf ai:check` fails when one is missing.

## Guards

The core plugin's PreToolUse hook keeps the blind agents (`e2e-tester`, `test-data-designer`, `screen-reader`, `code-reviewer`) to what their prompts allow: what each may read and search, the tester's few commands, and the reviewer's advisory hosts (`review.webDomains`). A crash in the hook blocks the call: it exits 2, which blocks on any Claude Code build, and `onFailure: block` covers a hook that never starts. Each blind agent also starts without the project's CLAUDE.md. `hooks.blindness: false` turns it off. A guard needs a logged failure or an accepted audit item behind it (W-18).

`node scripts/smoke.mjs` runs a new project's first hour end to end with this checkout: init, the checks, the hooks, a question sheet, and the web driver. CI runs it on Linux and macOS.

## Commands

| Command | What it does |
| --- | --- |
| `wf doc:find <ID, date, or heading> [path]` | Prints each entry that starts with the query |
| `wf doc:facts [status \| growth]` | Where the work stands, and what the docs cost to load |
| `wf doc:check` | Links, the index, story IDs, chunk tables, block length, dates after today, and the project's extensions |
| `wf config` | The project's settings over the defaults, with reasons |
| `wf ai:sync`, `wf ai:check` | OpenCode agents and slash commands generated from the project's and the kit's, and the skill paths in `opencode.json` |
| `wf scan full \| diff <since> [--light]` | The review's scans, from `review.scans` in the config, into `.cache/review-scan`, with the scope list and the diff |
| `wf ledger <arguments>` | Changes the review ledger through `ledger.py` |
| `wf docs sync` | Writes the kit's workflow docs into `docs/workflow/` and its `AGENTS.md` and `CLAUDE.md` into the root, keeping the project's parts between each `wf:local` pair and filling `{{config}}` values and the Who decides block. Rewrites the docs index's `wf:index` tables (words, workflow, logs) |
| `wf testdata <step> <area> ...` | The project's test-data steps (route, stale, covered, index, journeys, e2e-files, refresh-close), from `testdata.commands` |
| `wf design render \| check \| storyboard \| annotate` | Design frames to review PNGs (`chromium`, Python 3), the frame checker at each window size, each area's storyboard, and labelled question sheets (`magick`), from `design` in the config |
| `wf app <start \| run \| stop \| ...>` | Drives the project's app on Linux under a memory cap, from `app` in the config, with the project's `app.hooks`: a Tauri app through WebKit's inspector (`app.kind` tauri), or a web app's servers and a headless Chromium through its debugging protocol (web) |
| `wf disk [--dry-run] [GB]` | Free disk space, and when short, removes only the leftovers in `disk`, cheapest first |
| `wf try [scenario] [--keep \| --dry-run \| --files]` | Opens the project's app for a person at a test-data scenario, in a throwaway folder: the dev command for a Tauri app, or the servers and a browser window of its own for a web app. The scenarios and questions come from the project's `app.hooks` |
| `wf screens <--light \| --deep \| names \| scope \| --brief \| --accept \| --check \| --gate>` | The screen review: shoots each screen's Reach through `wf app`, beside its frame, lists what changed since the last accept, and writes briefs for the `screen-reader` agent, from `screens` in the config |
| `wf release <next \| check \| set \| verify> ...` | The project's release commands, from `release.commands`, for the release skill |
| `wf github sync \| check \| ruleset` | The `.github` files the `github` switches turn on (pull request and issue templates, CODEOWNERS from roles, the check workflow, Dependabot), drift, and the ruleset to apply when the plan has them |
| `wf decision add <file> "<decision>" "<why>"`, `wf decision supersede <ID> <by ID>` | The decisions log, one short table per area and topic, newest on top: the next ID, the word limit, and moving a superseded row to its closed file. doc:check holds the IDs, the order, the lengths, and that every cited ID exists |
| `wf ready <quick \| chunk \| area> [chunk]`, `wf done ... [--agreed]` | A track's checks before work starts and before its pull request: OK, FAIL, or SKIP for each scripted one, then ASK lines to judge, from `tracks` in the config. A lane, such as `CH-01-fe`, also waits for the rows it waits on and runs the contract's checks from `lanes.contract` |
| `wf tools` | What this computer has of the tables in `tools.md`, failing only for a required tool, and whether the branch hooks are on |
| `wf check [--all]` | The project's checks from `check.steps`, one line each with test counts; a slow step runs only with `--all`, and each output is saved under `check.logs` |
| `wf hooks <install \| pre-commit \| pre-push>` | Writes two shims to `.workflow/hooks/` and points `core.hooksPath` at them; they refuse a commit or push to a protected branch (`branches.protected`) and a push of a branch not named `<scope>/<slug>` |
| `wf init <answers.json>` | Sets up a new project from the `workflow-init` skill's answers: the config, the logs, each area's first docs, the docs index, the package scripts, and the Claude Code settings, then the docs, agent settings, and hooks. It keeps every file that exists |
| `wf doctor` | Whether a project's set-up is whole: the config, the kit's pin and install, the plugins, the docs, the agent settings, the tools, the hooks, and GitHub |
| `wf question add <chunk \| none> "<question>" <needs> "<from>" [story]`, `wf question resolve <Q-ID> "<decision>"` | The open questions log, one table per chunk: the next Q-ID across both logs, and moving an answered row to the resolved log with the date and the decisions it led to. doc:check holds the shape, the IDs, the roles, and that nothing ticked stays open |
| `wf board <setup [--create] \| plan \| sync>` | The stories on the client's monday.com board, one way, from `board` in the config and the token in `board.tokenEnv`: setup checks the columns, labels, and Kanban view, including an Owner column assigned by hand that sync never touches; plan lists each change; sync writes only what differs, with each story's acceptance lines in a pinned comment, and never deletes. The design is in `docs/design/board-sync.md` |
| `wf signoffs [--bypass "<reason>"]` | The open questions under a chunk's heading, each waiting on its Needs role, and the `- [ ] needs <role>:` lines open in the pull request body; none in a solo project. `--bypass` lets a repository admin, one of `people`, merge past the open chunk questions with a line in the body, which counts only while gh confirms that admin |
| `wf roles [--write]` | The Who decides block from `people` and `decisions`, or write it between the `<!-- wf:roles -->` markers in `AGENTS.md` |

The review module's `structure-scan.py` is the scan for a Rust and TypeScript project; another stack lists its own under `review.scans.structure`.

A project adds its own checks and status lines with `extensions` in its config: modules that export `checks(context)` and `status(context)`.

## Upgrading

Each kit version that changes a project's own files says what to do here. After any upgrade, run `npx wf docs sync` and `npx wf doctor`.

### v0.31.0: open questions in tables

`npx wf doc:check` now fails a bullet question in `docs/log/open-questions.md` and an entry outside the table in `questions-resolved.md`. Move them by hand once, on the upgrade's branch:

1. Under each chunk heading and "Not tied to a chunk yet", put one table, `| ID | Question | Needs | From | Story | Raised |`, with the IDs `Q-001` upwards. A bullet's detail goes in a `- **Q-001.**` bullet under the table.
2. A ticked `- [x] needs ...` item is answered: put its answer in the decisions log, and its row in the resolved table.
3. `questions-resolved.md` takes one table, `| ID | Question | Needs | From | Story | Raised | Resolved | Decision |`, oldest first. Decision cites the D-IDs, or says `none: <why>`.
4. To upgrade first and move later, list the two files in `logs.looseQuestions`; only a ticked item fails until they come off it.

## Develop

```sh
npm test                                   # unit tests
claude plugin validate .                   # marketplace and plugins
```

Skill evals in `plugins/*/evals/` are off for now: no step or CI runs them. They run only by hand, `claude plugin eval plugins/core --runs 1`, at a few cents a case.

A release bumps `version` in `package.json` and in each changed plugin's `plugin.json`, then tags `v<version>`. Projects move to it by changing the tag they pin.
