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
   claude plugin install e2e@freeorbit-workflow --scope project                # needs an app driver and testdata
   claude plugin install release@freeorbit-workflow --scope project
   ```

3. Start a committed `opencode.json` for OpenCode:

   ```json
   { "$schema": "https://opencode.ai/config.json" }
   ```

   Then run `npx wf ai:sync`, which adds each kit plugin's skills path and writes the OpenCode agents and commands.

4. Write `.workflow/config.json`: at least `project` and `people`, with `"team": "solo"` for one person. List the project's `areas` (each with its story prefix) and `scopes` (commit and branch prefixes). Put the two markers in `AGENTS.md` and run `npx wf roles --write`, then `npx wf docs sync`. Run `npx wf config` to see every setting, its default, and why the default is what it is.

5. `npx wf ai:sync` also writes deny rules for secret files into the committed `.claude/settings.json` and into each OpenCode agent, from the one list in the core plugin's guard (`SECRET_GLOBS`: `.env`, `.env.*`, keys, certificates, and SSH keys), so no session or agent reads them (audit W-11). `npx wf ai:check` fails when one is missing.

## Guards

The core plugin's PreToolUse hook keeps the blind agents (`e2e-tester`, `test-data-designer`, `screen-reader`, `code-reviewer`) to what their prompts allow: what each may read and search, the tester's few commands, and the reviewer's advisory hosts (`review.webDomains`). A crash in the hook blocks the call: it exits 2, which blocks on any Claude Code build, and `onFailure: block` covers a hook that never starts. Each blind agent also starts without the project's CLAUDE.md. `hooks.blindness: false` turns it off. A guard needs a logged failure or an accepted audit item behind it (W-18).

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
| `wf docs sync` | Writes the kit's workflow docs into `docs/workflow/`, keeping the project's parts between each `wf:local` pair |
| `wf testdata <step> <area> ...` | The project's test-data steps (route, stale, covered, index, journeys, e2e-files, refresh-close), from `testdata.commands` |
| `wf design render \| check \| storyboard \| annotate` | Design frames to review PNGs (`chromium`, Python 3), the frame checker at each window size, each area's storyboard, and labelled question sheets (`magick`), from `design` in the config |
| `wf app <start \| run \| stop \| ...>` | Drives the project's Tauri app on Linux: systemd user units under a memory cap, WebKit's inspector, and run steps, from `app` in the config, with the project's `app.hooks` |
| `wf disk [--dry-run] [GB]` | Free disk space, and when short, removes only the leftovers in `disk`, cheapest first |
| `wf screens <--light \| --deep \| names \| scope \| --brief \| --accept \| --check \| --gate>` | The screen review: shoots each screen's Reach through `wf app`, beside its frame, lists what changed since the last accept, and writes briefs for the `screen-reader` agent, from `screens` in the config |
| `wf release <next \| check \| set \| verify> ...` | The project's release commands, from `release.commands`, for the release skill |
| `wf github sync \| check \| ruleset` | The `.github` files the `github` switches turn on (pull request and issue templates, CODEOWNERS from roles, the check workflow, Dependabot), drift, and the ruleset to apply when the plan has them |
| `wf decision add <file> "<decision>" "<why>"`, `wf decision supersede <ID> <by ID>` | The decisions log, one short table per area and topic, newest on top: the next ID, the word limit, and moving a superseded row to its closed file. doc:check holds the IDs, the order, the lengths, and that every cited ID exists |
| `wf signoffs` | The `- [ ] needs <role>:` lines open in the open questions log and the pull request body; none in a solo project |
| `wf roles [--write]` | The Who decides block from `people` and `decisions`, or write it between the `<!-- wf:roles -->` markers in `AGENTS.md` |

The review module's `structure-scan.py` is the scan for a Rust and TypeScript project; another stack lists its own under `review.scans.structure`.

A project adds its own checks and status lines with `extensions` in its config: modules that export `checks(context)` and `status(context)`.

## Develop

```sh
npm test                                   # unit tests
claude plugin validate .                   # marketplace and plugins
```

Skill evals in `plugins/*/evals/` are off for now: no step or CI runs them. They run only by hand, `claude plugin eval plugins/core --runs 1`, at a few cents a case.

A release bumps `version` in `package.json` and in each changed plugin's `plugin.json`, then tags `v<version>`. Projects move to it by changing the tag they pin.
