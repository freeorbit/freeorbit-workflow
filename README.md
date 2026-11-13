# freeorbit-workflow

The Freeorbit agent workflow as installable Claude Code plugins, the scripts they run, and the same skills for OpenCode. The plan and the audit behind it are `docs/research/workflow-kit.md` and `docs/research/workflow-audit.md` in Freeorbit.

For how the plugins, the `wf` command, the docs, GitHub, the app, and the client board fit together, start with [docs/workflow/overview.md](docs/workflow/overview.md).

## Install in a project

1. Add the package, pinned to the latest tag, the top `### vX.Y.Z` under Upgrading below:

   ```sh
   pnpm add -D "freeorbit-workflow@git+https://github.com/freeorbit/freeorbit-workflow.git#vX.Y.Z"
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
| `wf doc:check` | Links, the index (where a folder's README row stands for the files it links), story IDs and Risk lines, chunk tables, block length, dates after today, the kinds, and the project's extensions. It warns, without failing, for a test-data file past one screen, a flow area past its size, and a rule category on no list |
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
| `wf screens <--light \| --deep \| --defer \| names \| scope \| --sheets \| --brief \| --accept \| --check \| --gate>` | The screen review: shoots each screen's Reach through `wf app`, beside its frame, lists what changed since the last accept, and writes briefs for the `screen-reader` agent, from `screens` in the config |
| `wf release <next \| check \| set \| verify> ...` | The project's release commands, from `release.commands`, for the release skill. Without `next`, the kit lists the versions that may follow from the tags |
| `wf github sync \| check \| ruleset` | The `.github` files the `github` switches turn on (pull request and issue templates, CODEOWNERS from roles, the check workflow, Dependabot), the board-sync workflow while `board.boardId` is set, drift, and the ruleset to apply when the plan has them |
| `wf decision add <file> "<decision>" "<why>"`, `wf decision supersede <ID> [<ID> ...] <by ID>` | The decisions log, one short table per area and topic, newest on top: the next ID, the word limit, and moving each superseded row to its closed file, in date order. doc:check holds the IDs, the order, the lengths, and that every cited ID exists |
| `wf ready <quick \| chunk \| area> [chunk]`, `wf done ... [--agreed]` | A track's checks before work starts and before its pull request: OK, FAIL, or SKIP for each scripted one, then ASK lines to judge, from `tracks` in the config. A lane, such as `CH-01-fe`, also waits for the rows it waits on and runs the contract's checks from `lanes.contract` |
| `wf tools` | What this computer has of the tables in `tools.md`, failing only for a required tool, and whether the branch hooks are on |
| `wf check [--all]` | The project's checks from `check.steps`, one line each with test counts; a slow step runs only with `--all`, a step with `paths` only when the branch changes a matching file, and each output is saved under `check.logs` |
| `wf hooks <install \| pre-commit \| pre-push>` | Writes two shims to `.workflow/hooks/` and points `core.hooksPath` at them; they refuse a commit or push to a protected branch (`branches.protected`) and a push of a branch not named `<scope>/<slug>` |
| `wf init <answers.json>` | Sets up a new project from the `workflow-init` skill's answers: the config, the logs, each area's first docs, the docs index, the package scripts, and the Claude Code settings, then the docs, agent settings, and hooks. It keeps every file that exists |
| `wf doctor` | Whether a project's set-up is whole: the config, the kit's pin and install, the plugins, the docs, the agent settings, the tools, the hooks, and GitHub |
| `wf question add <chunk \| none> "<question>" <needs> "<from>" [story IDs ...] [--revisit "<when>"]`, `wf question resolve <Q-ID> "<decision>"` | The open questions log, one table per chunk: the next Q-ID across both logs, and moving an answered row to the resolved log with the date and the decisions it led to. doc:check holds the shape, the IDs, the roles, and that nothing ticked stays open. `--revisit` gives an untied question its trigger, which `wf doc:facts status` lists |
| `wf board feedback [--json]`, `wf board reply <id> <Q-ID ...> \| --noted [-- <id> ...]` | The client's comments on the board with no bot reply yet, read only, and the bot's replies to them in one batch: the open questions each was logged as, or noted. The `board-feedback` skill turns them into open questions after a yes in chat. The bot signs as `board.bot.name`, Orbit by default |
| `wf board <setup [--create] \| plan \| sync>` | The stories on the client's monday.com board, one way, from `board` in the config and the token in `board.tokenEnv`: setup checks the columns, labels, and Kanban view, including an Owner column assigned by hand that sync never touches; plan lists each change; sync writes only what differs, with each story's acceptance lines in a pinned comment and its pull request from git history, and never deletes. CI runs sync on each merge, with the token in a GitHub Environment limited to `board.branch`. The design, and the steps to turn it on, are in `docs/design/board-sync.md` |
| `wf signoffs [--bypass "<reason>"]` | The open questions under a chunk's heading, each waiting on its Needs role, and the `- [ ] needs <role>:` lines open in the pull request body; none in a solo project. `--bypass` lets a repository admin, one of `people`, merge past the open chunk questions with a line in the body, which counts only while gh confirms that admin |
| `wf roles [--write]` | The Who decides block from `people` and `decisions`, or write it between the `<!-- wf:roles -->` markers in `AGENTS.md` |

The review module's `structure-scan.py` is the scan for a Rust and TypeScript project; another stack lists its own under `review.scans.structure`.

A project adds its own checks and status lines with `extensions` in its config: modules that export `checks(context)` and `status(context)`.

## Upgrading

Each kit version that changes a project's own files says what to do here. After any upgrade, run `npx wf docs sync` and `npx wf doctor`.

### v0.48.0: test data in one-screen tables, a story check, and project kinds

- The `test-data-designer` has a `check` mode that returns only gaps and contradictions, as questions for the story's owner. Its rules, gaps, checks, and fixtures come back as tables with rule IDs and a category, and a flow area too long for one screen becomes a folder of one-screen files. Edge-case fixtures go only to stories with a `Risk: high (<why>)` line.
- The formats are in a new synced doc, `test-data-formats.md`, which the designer may read, with the kit's eight rule categories. A project adds its own in `testdata.categories`, each `{ name, use }`.
- `kind` names what the project is, `app` by default, and an area can set its own. `project-kinds.md` describes each kind, and Step 0 source analysis, outside registers, and packs for a domain product. Nothing else reads the kind yet but the designer.
- `wf doc:check` takes one index row for a folder's README that links its files, and fails a story's `Risk:` line that says neither high nor low. It warns for a test-data file past `testdata.limits.lines` (40), a flow area past `testdata.limits.areaKB` (40), and a rules table's category on no list. List files not yet split in `testdata.limits.loose`.
- `wf decision supersede` keeps the closed file newest on top, and takes several IDs before the one that replaces them, moving none when one is wrong. `wf question add` keeps every story ID given.
- After upgrading, run `npx wf docs sync`, then `npx wf doc:check`. Add each category its warnings name to `testdata.categories`, or rename it to the kit's, and list long test-data files in `testdata.limits.loose` until they are split. A folder's own index rows can then go. The project's `wf testdata` tool should read rules as the table in `test-data-formats.md`, finding columns by header.

### v0.47.0: the doctor checks the installed Claude Code plugins

- `wf doctor` reads Claude Code's own `plugins/installed_plugins.json` and `known_marketplaces.json`, under `CLAUDE_CONFIG_DIR` or `~/.claude`, not only `.claude/settings.json`. It fails for each kit plugin turned on in the settings but not installed for this project, or installed at a version other than the pin, and prints the `claude plugin` command that fixes each one. It also notes a known marketplace at another ref than the pin.
- Without those files, as in CI or with OpenCode only, the check is a SKIP. After upgrading, run `npx wf doctor` and the commands it prints, then `npx wf docs sync`.

### v0.46.0: notes on the GitHub Release, and check steps by path

- `release.notes`, `"changelog"` by default, says where the release notes go. `"github"` puts every release's notes on its tag's GitHub Release, with `gh release create --notes-file --verify-tag` (`--prerelease` for a pre-release) on the releaser's yes, and leaves the changelog alone. A kind `release.prepare` turns off now gets drafted notes on its GitHub Release in either mode, where v0.45.0 dropped them.
- With `"github"`, or for an unprepared kind, the project's `release.commands.check` and `verify` must pass without notes in the changelog, at most a WARN.
- A `check.steps` entry can take `paths`, globs such as `["infra/**"]`: `wf check` runs it only when the branch changes a matching file since its merge-base with `design.base`, committed or not, and prints SKIP otherwise. `--all` runs it, and so does a clone where the base cannot be found. Keep `slow` for steps that take long.
- The generated `check.yml` checks out the whole history, `fetch-depth: 0`, so path steps see the base on a pull request. Run `npx wf github sync` to write it, then `npx wf docs sync`.

### v0.45.0: a prepare pull request only for the kinds that want one

- `release.prepare`, `{ "preRelease": true, "stable": true }` by default, says which kinds of release go through the prepare pull request. Nothing changes for a project that leaves it out.
- A kind set to `false` is verified on an up-to-date `main` with `npx wf release verify <tag>` and tagged from it: `set` does not run, no notes are drafted, and the version in the project's files stays as it is. A project that deploys each pre-release for testing can set `"release": { "prepare": { "preRelease": false } }`.
- Before turning a kind off, make the project's `release.commands.check` and `verify` accept it: missing notes are a WARN, not a FAIL, and the files' version need not match the tag. Then run `npx wf docs sync`.

### v0.44.0: releases for projects without installers

- The `release` skill is run by whoever holds `decisions.release`, `owner` by default, and asks that person's yes before each step; `npx wf roles` says who it is. A project where any developer cuts a release sets `"decisions": { "release": "developer" }`.
- An empty `release.workflows.build`, `sign`, or `publish` skips its step, and the skill says so instead of running `gh workflow run` with no workflow. The runbook, `release.doc`, can name what comes after the tag, such as a deploy workflow, and the skill offers it with its own yes.
- `npx wf release next` works without `release.commands.next`: the kit reads the tags by `release.tagPrefix` and `release.preRelease` and lists the next pre-release and stable version of each open line, then a new patch, minor, and major line. A project's own `next` still wins.
- After upgrading, run `npx wf docs sync`. A project whose `next` command only did this tag arithmetic can drop it.

### v0.43.0: the kit's code grouped by job, and failures that say so

- Internal files moved. `lib/` keeps nine files at the top and groups the rest in `config/`, `logs/`, `setup/`, and `docs/`; `wf app` is split into `lib/app/appsettings.mjs`, `inspector.mjs`, `start.mjs`, `steps.mjs`, and `stitch.mjs`; one DevTools client and the browser helpers are in `lib/browser/`. `lib/screens/list.mjs` and `lib/design/frames.mjs` stay where they were. A project that imports any other kit file by path points it at the new place.
- `wf design check` and `annotate` time out on a hung frame instead of hanging, and a frame script that throws fails the check, naming its frame.
- The review's `ledger.py` writes nothing when a change would put the ledger out of step, and `direct-outdated.py` lists a failed `cargo search` apart instead of calling every dep behind.
- `wf try`'s repeat command quotes a `~` in a flag's value. Nothing to do after upgrading beyond the usual `npx wf docs sync`.

### v0.42.0: a tighter blind-agent guard, pinned workflows, fenced client comments

- The e2e tester's Bash guard reads a command as the shell does, refuses anything the shell would expand (`$`, `~`, `*`, `?`, braces), allows only flags that read no other file, and checks every path, through links, against its folders and the secret names. Quoting no longer hides `--real`, `db`, `logs`, or `reset`. Read, Grep, and Glob check where a path leads, and a Glob pattern or Grep glob may not leave its folder or pick out secret files.
- `wf app` saves a `shot`, `page`, or `screenshot` only as a `.png` under the run's state folder, `.cache/e2e/`, or `.cache/screens/`, never through a link.
- The generated check and board-sync workflows pin `actions/checkout` and `actions/setup-node` by commit, and install the pnpm that `package.json`'s `packageManager` names. `wf github check` flags any workflow `uses:` not pinned to a full commit SHA.
- `wf board feedback` cuts each client comment at 2000 characters and prints it fenced as data; `wf design annotate` takes only labels of one to three capital letters or digits, and escapes text for ImageMagick.
- After upgrading, run `npx wf github sync`, then `npx wf github check`, and pin any `uses:` it lists. A pnpm project with a board needs `packageManager` in `package.json`.

### v0.41.0: an overview of how the pieces fit

- `docs/workflow/overview.md` shows, in four diagrams, how the plugins, the `wf` command, the docs, GitHub, the app, and the client board fit together, an area's four steps, a chunk from start to the client board, and the board's feedback loop.
- After upgrading, run `npx wf docs sync`, which writes it and lists it in the docs index.

### v0.40.0: the monday token from a gitignored .env

- `npx wf board` reads `board.tokenEnv` (`MONDAY_API_TOKEN`) from the environment, else from a `.env` at the repo root, so local board commands need no prefix.
- It reads the `.env` only when git ignores it and does not track it; otherwise it stops and says why. Nothing is written to the environment, and CI still uses the `board` environment's secret.
- After upgrading, add `.env` to `.gitignore`, then put `MONDAY_API_TOKEN=...` in `.env`, readable only by you.

### v0.39.0: revisit triggers for untied questions

- A question under "Not tied to a chunk yet" can say when to ask it again: a `Revisit when: ...` line in its `- **Q-NNN.**` detail, or `npx wf question add none ... --revisit "<when>"`. No table changes, so existing logs still pass.
- `npx wf doc:facts status` lists each trigger as `Revisit Q-NNN (<role>) when: ...`, and names the untied questions with none. Chunk start and the code review read them, and move a question whose trigger holds under the chunk.
- After upgrading, run `npx wf docs sync`, then give each untied question its trigger.

### v0.38.0: built screens on story items

- Once a story's Build is Built, its item shows the built app's picture of each screen-list row naming it, in a Built screens file column that sync owns, while `board.show.screenshots` is on, as it is by default.
- `npx wf board setup --create` makes the column; until then, sync stops with it reported missing.
- `npx wf screens --accept` now copies each screen's Default picture to `docs/design/built/<area>/<screen>.png` (`design.built`). Commit them, so CI's sync can upload them.
- `board.screenshots.rows` `"framed"` drops the Screen rows. `board.show.screenshots` `false` turns it all off.

### v0.37.0: frames on story items

- Each story's item shows the frame pictures whose screen-list row names it, in a Frames file column that sync owns, while `board.show.frames` is on, as it is by default.
- With it on, `npx wf board setup` reports the Frames column missing, and sync stops until `npx wf board setup --create` makes it. The first sync then uploads each story's frames.
- A board the client should not see frames on yet sets `board.show.frames` to `false`: no column, no check, and no uploads.

### v0.36.1: Orbit speaks quietly

- Orbit's replies and delivery notes now sit in a quote block, which monday shows grey and italic. Its questions to the client stay plain.
- The first `npx wf board sync` after the upgrade edits each delivery note posted plain into the quote, in place, with its words kept. `npx wf board plan` lists each as `restyle delivered`.
- Replies posted plain before stay as they are, and are still told apart as Orbit's.

### v0.36.0: delivery notes and client questions

- `chunks-done.md` takes a "For the client" column after Detail, and `npx wf doc:check` fails a done table without it. Add the column; leave old rows empty, or fill one for each done chunk the client should hear about.
- Each filled cell is posted once, on its stories' items, when they are built. The first sync after the upgrade posts those for chunks already done.
- `client` is now a Needs value for an open question the client answers. Sync asks it on its story's item, and it never holds a merge.

### v0.35.0: Build and Client review

The board's status splits in two, so the client can review a story before anything is called done.

- The kit's status column is now titled Build, and its last label is Built, not Done. A new Client review column is the client's and the team's, and sync never touches it.
- For a board set up before, run `npx wf board setup`. It reports the old title and the Done label, and plan and sync stop until they are fixed.
- Then run `npx wf board setup --create` once. It renames the column to Build, and its Done label to Built in place, keeping the label's id, so every item set to it stays set and reads Built.
  - It makes Client review with its starter labels, and two views, Build and Client review, each a table grouped by its column.
  - monday's API makes no Kanban, so add one of each by hand if cards suit better.
- A project that set `board.statuses.done` or `board.titles.status` keeps its own.

### v0.34.2: boards made from monday's project template

A board made from monday's project template is multi-level, and its status columns roll up child items.

- monday leaves a rolled-up status out of every item, and accepts a write to it and drops it. That is what v0.34.1 took for a portfolio's column.
- `npx wf board setup` now names the rollup, and `npx wf board setup --create` turns it off, as it does for a status column it makes on such a board.
- So the template's own Status can be the kit's: set `board.columns.status` to `"project_status"`, with no title of its own, and run `npx wf board setup --create`.

### v0.34.1: the board sync finishes what a cut-short run left

For a project with `board.boardId` set:

- Run `npx wf github sync` once. The board-sync workflow now installs with the project's lockfile, pnpm, yarn, or npm, instead of always `npm ci`.
- The next `npx wf board sync` finishes an item a failed run left half made. `npx wf board plan` shows it, as `Status: (empty) → …` and `pin acceptance`.
- A board whose own status column lacks the kit's labels gets them from `npx wf board setup --create`, with its own labels kept.
- A board made from monday's project template has a status that a linked portfolio keeps, not its items, so sync can neither set nor read it. `wf board setup` now says so, and plan and sync refuse to run on it.
  - Point `board.columns.status` at a column of the project's own, such as `"wf_status"`, and set `board.titles.status` to a title the board has not got, such as `"Story status"`.
  - Then run `npx wf board setup --create`, which makes it with the kit's labels.

### v0.34.0: the board's bot signs as Orbit

For a project with `board.boardId` set:

- The pinned acceptance comment now opens with the bot's 🤖 line in a quote block, then a plain bold "Acceptance criteria". The first `npx wf board sync` after the upgrade edits every pinned comment once, and `npx wf board plan` lists each as `edit acceptance`.
  - Sync still finds a comment with the old "🤖 Acceptance criteria" heading, so it edits that one in place and posts no second one.
- `wf board`, `wf github sync`, and doc:check now fail a `board.tokenEnv` that is not an environment variable name, such as `MONDAY_API_TOKEN`.

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
