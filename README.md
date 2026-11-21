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

5. `npx wf ai:sync` also writes deny rules for secret files into the committed `.claude/settings.json` and into each OpenCode agent, from the one list in the core plugin's guard (`SECRET_GLOBS`: `.env`, `.env.*`, keys, certificates, keystores, SSH keys, `.npmrc`, `.netrc`, `.git-credentials`, `.pgpass`, `credentials.json`), so no session or agent opens them with Read, Grep, or Glob (audit W-11). A main session's shell is not covered; SECURITY.md says what is. `npx wf ai:check` fails when one is missing.

## Guards

The core plugin's PreToolUse hook keeps the blind agents (`e2e-tester`, `test-data-designer`, `screen-reader`, `code-reviewer`, `feedback-reader`) to what their prompts allow: what each may read and search, the tester's few commands, the feedback reader's one file and no other tool, and the reviewer's advisory hosts (`review.webDomains`). A crash in the hook blocks the call: it exits 2, which blocks on any Claude Code build, and `onFailure: block` covers a hook that never starts. Each blind agent also starts without the project's CLAUDE.md. `hooks.blindness: false` turns it off. A guard needs a logged failure or an accepted audit item behind it (W-18).

`node scripts/smoke.mjs` runs a new project's first hour end to end with this checkout: init, the checks, the hooks, a question sheet, and the web driver. CI runs it on Linux and macOS.

## Commands

| Command | What it does |
| --- | --- |
| `wf doc:find <ID, date, or heading> [path]` | Prints each entry that starts with the query |
| `wf doc:facts [status \| growth]` | Where the work stands, and what the docs cost to load |
| `wf doc:check` | Links, the index (where a folder's README row stands for the files it links), story IDs and Risk lines, chunk tables, block length, dates after today, the kinds, and the project's extensions. It warns, without failing, for a test-data file past a page, a flow area past its size or small enough for one file, an ID without its area prefix, and a rule category on no list |
| `wf config` | The project's settings over the defaults, with reasons |
| `wf ai:sync`, `wf ai:check` | OpenCode agents and slash commands generated from the project's and the kit's, and the skill paths in `opencode.json` |
| `wf scan full \| diff <since> [--light]` | The review's scans, from `review.scans` in the config, into `.cache/review-scan`, with the scope list and the diff |
| `wf ledger <arguments>` | Changes the review ledger through `ledger.py`; `wf ledger migrate` moves a ledger from before v1.3.0 into its folder |
| `wf docs sync` | Writes the kit's workflow docs into `docs/workflow/` and its `AGENTS.md` and `CLAUDE.md` into the root, keeping the project's parts between each `wf:local` pair and filling `{{config}}` values and the Who decides block. Rewrites the docs index's `wf:index` tables (words, workflow, logs) |
| `wf testdata <step> <area> ...` | The project's test-data steps (route, stale, covered, index, journeys, e2e-files, refresh-close), from `testdata.commands`; and the kit's own `trace [area]` (spec rows no code names, and tests that name no row or story) `budget <area> [ids] [--check]` and `delta <area> <file>` (the designer's budgets, held by the tool), `prune <area> [--write]` (check rows no code cites, out of the spec), `rename-ids [area] [--write]` (old IDs qualified with the area's prefix), and `merge <folder>` / `fold <file> <sibling>` (fewer files, every row kept) |
| `wf id <ID> [--all]` | What an ID is, where it is defined, and each line that cites it, in docs and code; the patterns are in `docs/workflow/ids.md` |
| `wf ask templates \| example \| page \| wait \| answers \| record \| export \| import \| live \| reply \| history` | Ask pages: any number of questions on one page in the browser pane, from twelve templates or the project's own in `.workflow/ask-templates/`, with pictures, boxes, pins, compare views, paging, bulk answers, and colour themes. `wait` blocks until the answers are sent and prints them; `record` writes "Later" answers and marked decisions to the logs; `export` makes one offline HTML file; `live` updates a status page while a step runs, `reply` answers under a question, and `history` lists every round sent. The `ask-page` skill has the spec |
| `wf view serve \| stop \| setup` | The shared `ask-pages` server: one per machine on 127.0.0.1, serving each project's `.cache/view` at its own key, with an inbox of every ask at `/`, and taking answers with a per-run token. `serve` starts or joins it, `stop` ends it, `setup` writes it into `.claude/launch.json` |
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
| `wf board feedback [--json \| --brief]`, `wf board drafts <file>`, `wf board reply <id> <Q-ID ...> \| --noted [-- <id> ...]` | The client's comments on the board with no bot reply yet, read only, and the bot's replies to them in one batch: the open questions each was logged as, or noted. `--brief` writes the comments for the blind `feedback-reader` agent and prints none of their words; `drafts` checks the agent's drafts against their shapes. The `board-feedback` skill turns them into open questions after a yes in chat. The bot signs as `board.bot.name`, Orbit by default |
| `wf board <setup [--create] \| plan \| sync>` | The stories on the client's monday.com board, one way, from `board` in the config and the token in `board.tokenEnv`: setup checks the columns, labels, and Kanban view, including an Owner column assigned by hand that sync never touches; plan lists each change; sync writes only what differs, with each story's acceptance lines in a pinned comment and its pull request from git history, and never deletes. CI runs sync on each merge, with the token in a GitHub Environment limited to `board.branch`. The design, and the steps to turn it on, are in `docs/design/board-sync.md` |
| `wf signoffs [--bypass "<reason>"]` | The open questions under a chunk's heading, each waiting on its Needs role, and the `- [ ] needs <role>:` lines open in the pull request body; none in a solo project. `--bypass` lets a repository admin, one of `people`, merge past the open chunk questions with a line in the body, which counts only while gh confirms that admin |
| `wf roles [--write]` | The Who decides block from `people` and `decisions`, or write it between the `<!-- wf:roles -->` markers in `AGENTS.md` |

The review module's `structure-scan.py` is the scan for a Rust and TypeScript project, including tests of one shape that one table could hold; another stack lists its own under `review.scans.structure`.

The performance pass's scans go under `review.scans.perf`, and run only when the pass runs. The review module has three. Each writes measured facts, not findings, which the reviewer judges against the hot-paths doc:

- **`perf-scan.py`** (Rust and TypeScript, no compiler): loops that await, call the backend, or do I/O each turn; blocking work in an async fn or a sync Tauri command; whole files read into memory; timers and sleep loops. It leaves out tests and folders that do not ship, such as `tools/`.
- **`perf-clippy.py`** (Rust): Clippy's perf group and the other lints that name a cost, such as `redundant_clone`, `needless_collect`, `large_futures`, and `await_holding_lock`, with every other lint off.
- **`bundle-size.py`** (web, and a Tauri app's frontend): what the build ships by kind, raw and gzipped, the largest files, and what grew, is new, or went since the last measure, kept in `.cache/perf/`. Run the build first.

```json
"perf": [
  { "name": "perf-scan", "run": "python3 -I \"$KIT/plugins/review/scripts/perf-scan.py\" $SCAN $FILES" },
  { "name": "perf-clippy", "run": "python3 -I \"$KIT/plugins/review/scripts/perf-clippy.py\" $SCAN $FILES > $SCAN/perf-clippy.err 2>&1" },
  { "name": "bundle-size", "run": "pnpm build > $SCAN/build.txt 2>&1 && python3 -I \"$KIT/plugins/review/scripts/bundle-size.py\" $SCAN dist" }
]
```

A web app can add Lighthouse CI from its own dev dependencies, such as `pnpm exec lhci autorun --upload.target=filesystem --upload.outputDir=$SCAN/lighthouse`, with its budgets in `lighthouserc`.

A project adds its own checks and status lines with `extensions` in its config: modules that export `checks(context)` and `status(context)`.

## Upgrading

Each kit version that changes a project's own files says what to do here. After any upgrade, run `npx wf docs sync` and `npx wf doctor`.

### v1.13.0: IDs checked across open branches, and a lost designer return refused

From Freeorbit's efficiency check: branches made side by side took the same next free IDs twice, and one renumbering touched about 30 files; and a designer's return saved empty passed `wf testdata delta` as "within its caps".

- **`npx wf id --clashes`** lists each ID this branch adds, such as a decision, a finding, a question, a chunk, or a rule, that main or another open branch adds too, by a different line, naming the branch. It fetches first, and leaves out a branch this one is built on and work already merged by the same row. `wf done` runs it for the quick and chunk tracks and fails on a clash, and the `pull-request` skill runs it before it proposes.
- **`wf testdata delta`** fails a file left empty, a delta with no `Need: none | spec | rules | both` line, and one cut off after its `Need:` line, so a return not saved whole is never applied as nothing to do.

### v1.12.0: a screen run on an old build stops before it shoots

Freeorbit shot two full deep runs, about 35 minutes, on an app built before a schema change: every screen failed with only systemd's "Consumed … CPU" line, and a run by name then replaced the good run before it was accepted.

- **`app.build`:** a shell command that builds the app, such as `cargo build -p app`, which `wf screens` runs before it shoots. Without it, **`app.sources`**, globs of what the binary is built from, makes a run refuse a binary older than one of them, unless `--stale-app`.
- **Why a start failed:** a failed start, in `wf app start` and each screen of a run, now names the app's own cause first, such as a panic's message and place, read from enough of its log to get past a backtrace. Once starts on two different scenarios in a row fail the same way, an app's other screens are not tried.
- **A review run is kept:** a run by name, `--chunk`, `--all`, or `--area` refuses while a light or deep run is not yet accepted, since it would replace it as the run to accept. Accept what was read first, with `--accept --except <screen>` to keep some back, then shoot them; `--replace` drops the run.
- **Upgrading:** a Tauri project sets `app.build` in `.workflow/config.json`, such as `"build": "cargo build -p <app>"` under `app`, or `app.sources`.

### v1.11.0: data standards, and data models that read at a glance

Freeorbit and Atlas NX each made their schemas with no shared conventions, such as tables named singular and plural side by side, and dates and flags as unchecked text and numbers.

- **`docs/workflow/data-standards.md`:** the `DATA-` rules for any database: names, keys, types, integrity, lifecycle, and migrations, from the Postgres, SQLite, MySQL, and MongoDB docs and well-known style guides. The structure pass of the code review reads it, through `review.dataRubric`.
- **A project's own database:** `templates/data-engines/` holds the conventions of Postgres, SQLite, MySQL, and MongoDB. When Step 3 picks a store, its file is copied into the doc's project part, where the project also picks singular or plural table names.
- **Data models that read at a glance:** `templates/data-model.md` now starts with At a glance, splits the tables into parts with a small diagram each, and keeps one-row tables in one table per part. `doc:check` warns when a model has no At a glance section or a diagram of more than 12 tables.
- **Upgrading:** run `npx wf docs sync`, then copy the conventions of the project's database into `data-standards.md`'s project part, and pick table names. A project that lists `docs.synced` adds `data-standards` to it; `wf doctor` says when a rubric file is missing. An existing data model is only warned about; reshape it when it is next changed.

### v1.10.0: archive an ask

- **An ask can be archived from the inbox,** such as one asked for a test or no longer relevant: its Archive button, or A on the current row, with Undo for a moment. It leaves the inbox and the asks menu until it is asked again.
- **Show archived** lists the archived asks, each with Restore. Nothing is deleted: the page, its answers, and its history stay.
- **An ask an agent is blocked on stays,** with no Archive button, since hiding it would hide what the agent waits for; an archived ask an agent starts waiting on shows again.
- The inbox no longer redraws every row each few seconds, only when something changed or once a minute, and the row or button with the focus keeps it.

### v1.9.1: a pinned comment with code in it is no longer edited on every sync

A story whose text held a backtick, such as Atlas NX's INF-01, was planned as `comment … edit acceptance` on every `wf board plan` and sync, forever. monday drops `<code>` from a comment and keeps its words, so what sync sent never matched what monday kept, and monday ignored each edit as a no-op.

- **Code goes as its words.** A story's `` `x` `` reaches the pinned comment as plain `x`, which is what the client saw anyway.
- **Angle brackets compare equal.** `<type>` inside backticks, which monday gives back literally, matches what sync sends escaped. A phase lead with `<` gets the same fix.
- **What sync writes is checked.** Once every change is written, sync reads back each comment it posted or edited. One monday did not keep as sent fails the sync with a `board` line naming it and whether its words or layout differ, instead of reporting success.
- Nothing to do: the next sync leaves those comments as they are.

### v1.9.0: accepted screens stay accepted after the commit, and Step 3 designs the data

- **Screens shot with uncommitted changes.** A chunk end reviews its screens before its commit, so an accept marked the commit before the chunk's work, and the same screens showed due again once it was committed. Now such a run is shot at a snapshot of the working tree, a local commit under `refs/wf/screens/`, and the accept marks it. Commit as usual; nothing to do first.
  - A plain push sends branches only, so the snapshots stay on this computer; a mirror push, or a refspec of `refs/*`, would send them. An untracked file whose name may hold a secret, or one over 5 MB, is left out of a snapshot. An accept drops a snapshot no mark names after 14 days.
  - A project's `screens.scope` module must count the working tree and untracked files in what changed since a mark, as `git diff --name-only <mark>` plus `git ls-files --others --exclude-standard` does. Atlas NX's and Freeorbit's already do.
- **A data model in Step 3.** Each area designs its data before any chunk builds it, in its own `data-model.md` from `templates/data-model.md`: where it lives, entities and relations, tables, the indexes each hot path needs, sensitive fields, keeping and deleting, and migrations. An area that stores nothing says so in one line.
  - `npx wf doc:check` fails while an area past Step 3 has none, or still the template. An area whose Architecture step is dated before 2026-11-21, or not dated, is only warned: write its data model when you next touch its data, or one line if it stores nothing.
  - The code review checks a schema against it, by the new CS-DATA rule in code-standards.md.

After upgrading, run `npx wf docs sync`.

### v1.8.0: work items on the client's board

An area's preparation work, such as research, rounds of questions with a domain expert, or a trial, can now show on the board beside its stories, from a plan doc in the area's folder. Off until a project lists a plan; a project that lists none sees no change.

- **A story or a work item, never both.** A story is a promise someone can check by using the product. A work item leaves behind knowledge, a decision, or a tool, and comes from the plan doc. The plan holds only work that is not a story, and ends where the build order takes over.
- **The plan doc.** `## Phase N. Title` sections, each with a one-sentence lead and a table of steps: `ID`, `Step`, `Who`, `Status`, and optional `Leaves behind` and `Unblocks`. Status starts Done, Now, Next, Later, or `Waiting on <name>`. Start one from `templates/plan.md`; the shape is in writing-docs.md, Plan docs, and `npx wf doc:check` checks it.
- **Its own IDs.** A step's is `W-<prefix>-<nn>`, kept when it is renumbered; a phase's is `W-<prefix>-P<n>`. `npx wf id` finds both.
- **On the board.** One group per plan. On a multi-level board each phase is an item with its steps as subitems; on a flat one each phase gets a group. A work item has its own Work ID and Work status columns, so Build and the story sync never touch it. The phase's lead is a pinned comment sync writes, and `Leaves behind` never shows.
- **Owner.** With `board.workItems.people`, a step waiting on a named person puts them in Owner, so monday tells them, and takes them out when it stops waiting.
- **Replies.** `wf board feedback` reads a comment on a work item as it reads one on a story, and an open question's Story cell takes a Work ID.

To turn it on, as in the kit's docs/design/board-sync.md, Turn it on:

1. Bring the area's plan doc to the shape, give each step an ID, and list it in `board.workItems.plans`, such as `{ "document-analysis": "docs/areas/document-analysis/playbook.md" }`.
2. Run `npx wf docs sync`, then `npx wf doc:check` until it passes.
3. Run `npx --no wf board setup --create`, which adds the Work ID, Work status, Who, Status note, and Unblocks columns, then `npx --no wf board plan`.

### v1.7.0: frames render as full pages

`wf design render` shot each frame as one window, so a key screen drawn as a full page, such as a 1440×1720 one, lost everything below the window.

- **A frame's picture is a full page** at `design.size`'s width, as tall as its content and never shorter than `design.size`'s height. Fonts load before it is measured.
- **The window stays `design.size`,** so what sizes itself by the window (100vh, min-height: 100%) lays out as on that screen: a sign-in page is not stretched. A fixed bar, such as a footer at `bottom: 0`, sits at that window's bottom, partway down a taller picture.
- **A page area that scrolls on its own** (`design.check.page`), or sits in a box that does, is the exception: the window grows by what it hides, so the whole page shows. One of a fixed height that does not follow the window is shot as it shows, and render says how much it hides.
- **A frame taller than 20,000px** fails on its own, and the frames after it still render.
- **Render runs in Node** through Chromium's debugging protocol, as `wf design check` does; `plugins/design/scripts/render.py` is gone.
- **With `design.source` png,** `wf design check` takes a picture at `design.size`'s width and any height at or above its height.
- **The screen review** pairs the app's window shot with the frame's top, as tall as that shot, and hashes that top, so a full-page frame is not read as different from a window.
- Nothing to change in a project: run `npx wf design render` to redraw the frames at their full height. The next screen review reads each framed screen once more, since its frame is drawn anew.

### v1.6.0: each screen keeps its own mark

The screen review kept one mark for the whole app. A light run never took a screen off the deep list, and a run of one area, a chunk, or some screens moved nothing, so only a deep run cleared the backlog.

- **A mark per picture.** Each screen's pictures keep the commit they were last accepted at, and a screen is due when a change that reaches it landed after its own mark. An accept marks what it took, at the commit the run was shot at, whatever the run: light, deep, one area, a chunk, or some screens.
- **A light run takes its screens off the deep list.** The deep list is every screen due; what only shared code reaches stays on it until a run takes it. The "light runs waiting" count is gone, and the choice page recommends deep when shared code alone reaches as many screens as the light list.
- **A partial accept leaves the rest due.** A changed screen left out, or one that failed to shoot, keeps its mark and stays due until accepted. Pictures nothing has reached since their marks move forward with an accept, so the marks stay a few commits. `scope --names open` is gone; `scope` says how many commits the marks span.
- **Nothing to do in a project.** Its `screens.scope` module is unchanged: the kit asks it once for each commit the marks name. The first accept turns the old record into marks. A screen on the old deep list keeps the deep mark, any other the last one, and a screen left open stays due until accepted.

### v1.5.0: ask-page settings that stay, and Later for someone

Nothing in a project's own files changes.

- **Settings stay across sessions.** The ask pages kept their look (theme, accent, light or dark, density, size, motion, folding, zoom, compare), notifications, and the inbox's filters in the browser, which a new session's pane or Orca's browser may not have. The ask-pages server now keeps them for this user, in `ask-settings.json` in its state folder, and puts them in every page it serves, so a page opens with them. A browser's own settings from before go up the first time a page opens; an exported page still uses its browser alone.
- **Later, for someone.** Picking Later on a question shows a For list: each role with the names of the people who hold it, and the client. It starts on the question's own role. `npx wf ask record <id>` logs the open question for whoever is picked, with the answer's note under it.
- The server restarts on the new kit by itself, the next time a page is built.

### v1.4.1: a teammate's board comment can be logged

- The board-feedback skill logs a teammate's comment as a question from `team (monday)`, but `wf question add` and `doc:check` took only a role or `client (<channel>)`, so it was refused. A question's From may now be `team (<channel>)` too. Nothing in a project changes.

### v1.4.0: performance standards for databases, services, and screens

The performance pass had 8 rules, mostly about loops and blocking. It now has 18, from the database, service, and web guidance the rules cite, each one general and checkable in code.

- **Their own doc:** the `PERF-` rules move to `docs/workflow/performance-standards.md`, which only the performance pass reads, so the security and structure passes read 2 KB less. `code-standards.md` keeps the severity table and points there.
- **New rules:**
  - Databases: PERF-INDEX, PERF-HOLD (short transactions and locks), PERF-CONN (pooled connections, SQLite's write-ahead log), and PERF-MIGRATE (online schema changes).
  - Services: PERF-RETRY (capped backoff with jitter, safe to repeat) and PERF-FLOW (a limit on fan-out, and backpressure).
  - Screens: PERF-LAYOUT, PERF-INPUT, PERF-MEDIA (a guideline), and PERF-LIFECYCLE (tear down what you set up, pause while hidden).
- **Additions to the existing rules:**
  - Keyset paging, expiring caches, and a cancel that reaches the work below it.
  - No `SELECT *` on a hot path, and no regex that can backtrack forever on outside text.
  - Code-split routes, and stable props for memoized children.
- **The perf scan** also lists fan-out with no limit, layout read in a loop, listeners and observers with no take-down in the file, `SELECT *`, and paging by offset.
- **Upgrading:** run `npx wf docs sync`. A project's own rules in code-standards' performance part move to the new doc on that sync. A project that names `docs.synced` adds `performance-standards` to it.

### v1.3.0: the review ledger in its own folder

The closed findings' file held every closed finding's details, and kept growing (430 KB in Freeorbit). The ledger now has its own folder, and the closed details are split by the week they closed in.

- **New layout:**
  - `docs/log/review/findings.md` is the open and fixed ledger, as before.
  - `docs/log/review/closed.md` holds only the closed summary, each row linking to its details.
  - `docs/log/review/closed/2026-W46.md` and so on hold the details, one file per ISO week. Only the newest file grows.
- **Closing a finding** stamps a Closed row with the date, which picks its file. A finding that comes back loses the stamp.
- **Settings:** `logs.ledgerClosedDetails` names the folder, and `logs.ledgerClosedPeriod` is `week` or `month`. A project that closes few findings can set `month`.
- **To upgrade:**
  1. Run `npx wf ledger migrate` once. It moves both files, files each closed finding by its close date or, before this version, its found date, and rewrites the links to them in the project's Markdown.
  2. Run `npx wf docs sync`, then commit.
  3. The migrate lists any other file that names an old path, such as a script; change those by hand.
- Until then, `wf ledger` and `wf doctor` say to migrate. A project that set `logs.ledger` and `logs.ledgerClosed` itself keeps its paths; the migrate moves only the details out of its closed file.

### v1.2.0: choice pages read faster and say more

Nothing in a project's own files changes.

- **The details panel follows the pointer at once** and holds a steady height, scrolling inside, so the page never moves under the pointer. A chip says whether it shows the run you point at, the one you picked, or the recommended one. On a window 1000 px or narrower, the panel sits under the run it shows.
- **The why sits in the recommended run's card.** A launch page has no outline rail and no select-all row, and its button says "Take the recommendation".
- **Chunk start** shows the build order's log lines that name the chunk. It offers only well-formed chunk ids and lists the rest under "Not offered here". A chunk with nothing linked says so in one line.
- **Every choice page** puts the choice first and the facts after it. A release page with both kinds prepared the same way says so once.
- **Safer reads:** the release, end-to-end, and chunk pages read the project through its own reader, so a link that leads out of the project is never read.
- **`ask.open` set to orca** prints the address outside Orca unless `ORCA_CLI_COMMAND` names the command, so GNOME's screen reader never starts.
- An exported page now carries the pictures in a pictures block and in a run's details.

### v1.1.1: a launch page's details panel stays still

- Pointing at a run with little to show, such as a chunk with no stories, shrank the panel. That moved the page under the pointer onto another run and back, and the panel jittered. The panel now keeps the tallest height it has had. It also follows the pointer only after a moment, so passing over a run on the way to another does not redraw it.

### v1.1.0: chunk start shows what each chunk builds

Picking the next chunk showed an ID and a command. Now the page says what each chunk is before you pick it.

- **A details panel beside the runs.** Point at a chunk, or pick it, and the panel shows what it delivers (the build order's For the client, Who, and what it waits on), its numbers (stories, acceptance lines and the high-risk ones, frames and how many no scenario reaches, open questions), its frames as pictures, a table of its stories with each one's "As a…" line, and the questions still open on it.
- **An overview above:** chunks by area (done, in progress, not started) and the next chunks in the build order.
- **The recommendation passes over a chunk waiting on open questions** when one after it can start with none, and says so.
- **For any launch page:** a run may carry `details`, blocks the page shows beside the runs, and a new `pictures` block shows up to 12 pictures side by side, each opening full size.

### v1.0.0: the first stable version

The kit's first major version: the same code as v0.100.0, released as stable. From here a major version marks a change that asks something of a project, such as a setting renamed or a step it must run; a minor one adds what a project may use; a patch fixes. Each still says here what to do.

- **Nothing to change** coming from v0.100.0. Pin `v1.0.0` in `package.json` and `.claude/settings.json`, as for any version.
- Coming from an older version, follow each entry below since the one the project pins.

### v0.100.0: choice pages for chunk start, a release, and an end-to-end test

The launch pages `wf choose review` and `wf choose screens` began, for three more points where a choice needs the project's state in front of it.

- **`npx wf choose chunk`**: each chunk that can start, from the build order (nothing it waits on left undone), any in progress, and a quick fix, each with its `npx wf ready` command and its stories, owner, and open questions. Chunk start in `four-steps.md` asks on it when the person has not named the chunk.
- **`npx wf choose release`**: each version `wf release next` lists, with the newest tag, the commits since, the open lines, and whether the Unreleased notes are written; the answer is `npx wf release check <version>`. The release skill's first step asks on it.
- **`npx wf choose e2e`**: each area with its journeys counted from its test-data spec; the answer is `npx wf testdata journeys <area>`, where the e2e-test skill starts. It recommends none: the area is the person's to name.
- **One way is no choice.** A point with a single run, such as e2e in a one-area project, prints `Nothing to choose: …` with its command on stderr and exits 3, so a pipe into `wf ask page` stops before it asks.

### v0.99.0: the kit in Orca, and wherever Claude Code runs

A developer runs Claude Code inside Orca, an agent IDE with its own terminals, worktrees, and a browser per worktree, and no desktop browser pane.

- **`npx wf ask open <id>`** opens an ask page where the person looks: a tab of Orca's browser in Orca, the browser pane in Claude's desktop app, the system's browser in a terminal. `ask.open` (`auto`, `pane`, `orca`, `system`, `print`) forces one. The ask-page skill opens every page with it, and `wf ask page` names it as the next step.
- **In Orca, an agent waiting on a page** also puts the unread dot on its workspace, beside the desktop notification.
- **A harness's own branch name**, such as Orca's or `claude/…`, is refused at push with the command that renames it: `git branch -m <scope>/<slug>`.
- Orca is known by the `ORCA_*` variables in its terminals; outside them a bare `orca` never runs, since on Linux it is often GNOME's screen reader.

### v0.98.0: test data, the review gate, the board, and the guard, each in its place

The last structure findings from the 2026-11-17 review. Nothing to change in a project; nothing a command does changes, except that `wf testdata trace --chunk` with no chunk now says it needs one.

- **Test data is a folder**, `lib/testdata/`: `index.mjs` (the project's steps and how a spec reads), `checks.mjs` (doc:check's test-data checks), `cli.mjs`, and the steps, each a file. `wf testdata` chooses its step in one place, `runTestdataCommand`; `bin/wf.mjs` no longer holds the merge, fold, rename, and trace steps.
- **Whether the code review covers HEAD** is one function in `lib/review.mjs`, `reviewCoversHead`, which the screen review, the track gates, and the choice page share. The retired `screens.*` keys' translation sits with the config's other retired keys.
- **The board's code** is three files: `setup.mjs` (columns, labels, views), `wanted.mjs` (what the board should hold), and `index.mjs` (plan, writes, and the command).
- **The guard's `decide`** chooses a function per tool, and Read, Grep, and Glob share one path check.

### v0.97.0: the ask pages' code, each part where it belongs

From the 2026-11-17 review's structure findings. Nothing to change in a project; nothing a page or a command does changes.

- **An ask page's files on disk** (its id, folder, answers path, and spec reader) live in `lib/ask/store.mjs`, not in the HTTP server, which imports them. Writing a file whole is `lib/files.mjs`, shared with the screen review's record.
- **`wf view`** is `lib/view/command.mjs`, not part of `wf ask`. Its `notify` and the server's notifier walk the notifiers in one place, `notifyNow` in `desktop.mjs`.
- **The server's routes** share one page lookup and one capped JSON body read.
- **`lib/ask/spec.mjs`**, 811 lines, is five files by job: `spec.mjs` (normalize and the hash), `templates.mjs`, `questions.mjs`, `fieldnames.mjs`, and `advice.mjs`.

### v0.96.0: structure fixes from the kit's first full review, the small ones

The smaller structure findings the owner accepted from the 2026-11-17 review. Nothing to change in a project.

- **One `git()` and one `flagValue()`** in `lib/process.mjs`. git's output is read with a 64 MiB cap everywhere, so a large project's file list no longer fails with ENOBUFS, and a flag given with no value says so, as `wf screens --gate` with no chunk now does.
- **A JSON file that is not JSON is named**, with what to do: `.workflow/config.json`, an answers file, `wf init`'s answers, and the guard's read of the config.
- **A board sync that monday cuts short** says the changes before it are written and to run sync again, which finishes it.
- **`wf screens` returns its own exit code** from each step, not through `process.exitCode`.
- **A tauri start that fails stops its app**, as a web start does, and takes the same memory and time caps.
- **The headless browser says when a page never loaded**, after 9 seconds, in place of measuring a half-loaded page.
- **The board's column titles come from `board.titles` alone**; the code no longer keeps its own, which disagreed.
- **The test-data drop log dates by the local day**, as every other log.
- **The review scanners share `scanlib.py`**: one rule for what a test file is, the tracked files, and Rust's lines above its tests.
- **Smaller:** the page-settle wait has tests; usage lines name `--answered` and `setup --create`; three header comments are fixed.

### v0.95.1: the ask pages tested in a real browser

The kit's own tests now drive the ask pages in headless Chromium, so `npm test` in the kit needs Chromium or Chrome, as its design checks do. Nothing to change in a project.

### v0.95.0: performance fixes from the kit's first full review

The accepted performance findings from the 2026-11-17 review. Nothing to change in a project.

- **The ask-pages server reads a page again only when its files change.** Each inbox line is kept with the time, inode, and size of the page's spec, answers, and live status, and the registry is kept by its own; a poll stats files and parses none that did not change. A page answered more than 30 days ago leaves the inbox; its answers stay in `wf ask history`.
- **An open page asks for a short list** (`/__hub/inbox?limit=30`: every waiting ask, then the newest others), and **a tab out of view polls every 30 s**, not every 4 or 5. Coming back into view polls at once, and a hidden tab's title still shows an agent waiting.
- **`wf` loads a command's modules only when it runs.** A git hook's `wf` start drops from about 80 ms to about 25 ms, and a `wf screens` run of a few hundred screens starts its many `wf app` calls that much faster.
- **`wf screens` walks the frames once a run**, not once a screen, and **`wf doc:check` and board plan look frames and pictures up by name**, not by a scan of every tracked file for each row.
- monday calls end after 60 s (v0.93.0).
### v0.94.0: a blind agent reads the board's comments

`/board-feedback` had the main session read monday guests' comments, in a session that holds Bash and edits (review finding SB-3, SEC-MODEL). Now it never sees them.

- **`wf board feedback --brief`** writes the comments to `.cache/board/feedback.json`, with the config's role names and the board's story IDs, and prints only IDs, stories, and who wrote each.
- **The core plugin's `feedback-reader` agent** reads that one file and returns one draft a comment as JSON: a question with its role and story, a note, an answer to the Q-ID its comment replies to, or what changed in an edited one. The guard refuses it every other file and every other tool.
- **`wf board drafts <file>`** checks the drafts before anything is logged or posted: the keys of each kind, roles from `roles` in the config, story IDs on the board, the right Q-ID, and each text one line within its words, with no `"`, `$`, backtick, `|`, or backslash. The skill shows the person the checked lines and still waits for a yes before any post.
- In a project that uses OpenCode, run `npx wf ai:sync` to add the agent. `.cache/` is already gitignored by `wf init`. Nothing else to change.

### v0.93.0: security fixes from the kit's first full review

A blind review of the whole kit (security, structure, and performance, verified on another model) found 54 findings on 2026-11-17. This release holds the security ones the owner accepted.

- **SECURITY.md says what the kit really does.** It names each network call (`wf board` to monday.com, `gh`), each place outside the project it reads or writes, where an agent's limits hold, and two accepted risks: the ask-pages server does not tell one local account from another, and setup installs by tag.
- **`wf app`'s `/tmp/<app>-agent` run folder** is made for this user alone (0700), and refused when another account owns it or it is a link. Its pid files and logs sit in it.
- **More secret names.** `SECRET_GLOBS` adds keystores (`*.jks`, `*.keystore`), `.npmrc`, `.netrc`, `.git-credentials`, `.pgpass`, and `credentials.json`. Run `npx wf ai:sync` to write the new deny rules; `npx wf ai:check` fails until then.
- **A blind agent's Grep over a folder** that holds such a file needs a glob or a type that leaves it out.
- **Board commands run as `npx --no wf`** in the generated board-sync workflow and the docs, so with the token set they never fetch the unrelated npm package `wf`. Run `npx wf github sync` to rewrite the workflow.
- **CI checkouts keep no token** (`persist-credentials: false`), in the kit's own workflow and the generated ones.
- **monday calls refuse a redirect** and end after 60 s (180 s for a picture) with a plain error.
- **A link that leads out of the project** is not listed or read by the kit's checks, so board sync never sends outside text.
- **Smaller:** a pin's kind must be one of the kinds, not an inherited name; notification text is escaped for notify-send's markup; the ask tests' made-up key is allowed in `.gitleaks.toml`; the project's file list is read with a 64 MiB cap, not 1 MiB.

### v0.92.0: choice pages for the code review and the screen review

The light, deep, or defer question went through the question tool, four short options at most, so the backlog, the light runs waiting, the hot paths touched, and the kit's other options stayed out of sight.

- **A `launch` ask template.** One question, Which run?, each run with what it covers, its time or cost, and its command; then options that add to the run: a toggle, a choice, or typed words, each shown only for the runs it fits. A row above Send shows the command the answers make, and the answers start with `Command:`, so what runs is what was shown.
- **`npx wf choose review`** and **`npx wf choose screens`** write a launch spec from the project's state, for `npx wf ask page -`. Review: light, deep, full, or defer, with the backlog, the light runs, the deferrals, and the hot paths touched, and the performance and verify passes as options. Screens: light, deep, or defer, with both lists and their times, the screens left open, and whether the code review covers HEAD, and where the apps show, the areas, the narrow and stress pictures, and `--force` as options.
- **The `code-review-ledger` and `screen-review` skills** ask on these pages at chunk end, and run the command they return.
- **`wf scan`** takes `--performance on|off` and `--verify` or `--no-verify` for one run, and says `Verify pass: on|off`.
- **Take all recommendations** also answers the follow-ups that its answers bring into view.
- More choice points can follow as modules in `lib/choose/`.
- **Smaller fixes on every page:** a group whose questions are all hidden follow-ups hides too; a page placed in several sections no longer gets the "no groups" advice; a triage item's answer line gives its ID once.

### v0.91.0: you can tell when an agent is waiting on an ask page

With the browser on another screen, or the pane tucked in the sidebar, nothing showed that the chat was waiting on a page until the whole reply was read. A page's own notifications had to be turned on, and worked only while a page was open.

- **`wf ask wait` marks the page while it runs.** The page's header shows "Agent waiting" with how long, its tab title starts with ●, and its tab icon carries a dot. The inbox marks the row, and its title starts with ● too. The marks go when the page is sent or `wait` stops.
- **A desktop notification when `wait` starts**, and one reminder after `ask.remind` minutes, 10 by default, through the ask-pages server. It is on by default where the machine has a notifier; `ask.notify: false` turns it off. A page's own notice of the same ask is shown once, not twice.
- **The skill** brings the browser pane into view where the harness can, and starts its line in the chat with **Waiting on the ask page:**.
- `off: ["waiting"]` takes the marks off one page.

### v0.90.0: scans for the performance pass

The review module has three scans for `review.scans.perf`; the review section above gives the entries to copy.

- **`perf-scan.py`** lists loops that wait or do I/O each turn, blocking work in async code and in sync Tauri commands, whole-file reads, and polling, in Rust and TypeScript.
- **`perf-clippy.py`** runs Clippy's performance lints only, whatever the project's own lint settings.
- **`bundle-size.py`** measures what a web build ships and what changed since the last measure.
- Add the ones that fit the stack. Nothing runs until they are listed.

### v0.89.0: the code review checks performance

The review had a security pass and a structure pass; only CS-LIST and a line of CS-STATE said anything about cost. Now a third pass walks the paths where the product spends its time.

- **The rubric's new Performance section** holds the `PERF-` rules: no I/O or call per item in a loop, a limit on every read and queue, nothing blocking the UI thread or an async runtime, IPC sized to what is shown, renders, startup, allocation on hot paths, and a new dependency's size. Run `npx wf docs sync` to get it.
- **A hot-paths doc**, `review.hotPaths`, plays the threat model's part: the budgets, how large the data gets, and each hot path with its files as globs. Draft one from the kit's `templates/hot-paths.md`, beside the threat model, and set `review.hotPaths` to it. `wf init` writes it for a new project. Without one, the pass walks the `PERF-` rules on the changes alone.
- **`review.performance`** says when the pass runs: `deep`, the default, on every deep run and on a light run whose changes touch a hot path's files; `always`; or `off`. `wf scan` says on its `Performance pass:` line whether it runs and which paths it walks.
- **`review.scans.perf`** holds scans that measure cost, such as performance lints or bundle sizes, run only when the pass runs. Empty by default.
- **A finding names its scale**: the data size or the budget it breaks. A `PERF-` finding can be closed as `accepted-cost`, and the doc lists it under Known costs.

### v0.88.0: board feedback takes the team's answers and relayed comments

`wf board feedback` read only a guest's comments. When the owner answered one of Orbit's questions in its thread, the answer was dropped without a word (Atlas NX, 2026-11-16).

- **A team member's reply in a thread where Orbit asked a question** is now listed as its answer, the same as a guest's.
- **A team member's comment that starts with Orbit's name and a colon**, in any case, such as `Orbit: the client said on the call…`, is listed too, with the name cut. Not `@Orbit`, which opens monday's mentions. Any other team comment stays out, as before.
- **Each entry says `from`**: `guest` or `team`. The skill logs a team comment's question with the source `team (monday)`, and notes when a teammate answered for the client.
- **Orbit's reply to a teammate is short**, with no thanks for raising it: "logged as Q-012", "noted", or "noted as the team's answer to Q-011". A guest's reply is unchanged.
- Tell your team: start a comment with `Orbit:` to have it picked up.

### v0.87.1: a virtual display leaves your KWin scripts alone

A `virtual` screen run started each KWin virtual display with the person's own KWin config and D-Bus session. So it ran their KWin scripts, and a tiling script such as Krohnkite registered its shortcuts from inside it, and they stopped working on the person's desktop.

- Each virtual display now starts with an empty config folder, so it runs no KWin script, and with its own D-Bus session (`dbus-run-session`), so nothing it registers reaches the person's desktop.
- The app's window is no longer tiled by a script inside the virtual display either.
- Nothing to change in a project. If your shortcuts already stopped working, turn the script off and on in System Settings, or log out and in.

### v0.87.0: each kind of screen run says where it shows and how many at once

`screens.headless` only switched a web app's browser, and on Linux with `kwin_wayland` a run went to virtual displays whatever it said, so `false` did not put a run on the person's screen. Three settings and `--jobs 1` answered one question.

- **`screens.runs`** replaces `screens.headless`, `screens.jobsMax`, and `screens.display`. Each kind of run, `review` (a chunk-end `--light` or `--deep`) and `build` (named screens, `--chunk`, `--all`), has its own `show` and `jobs`:
  - `show` is `screen` (one app on the person's screen), `virtual` (each app on its own KWin virtual display), `headless` (a web app's browser, no window), or `auto`, the default: headless for a web app, virtual for any other.
  - `jobs` is the most apps at once with `virtual` or `headless`, held to the number of cores, 8 by default. `screen` is always one app.
- **`--show`** overrides where one run shows; `--jobs` how many. `--jobs` above one with `screen` is an error that says to add `--show virtual`.
- **Every run says on its first line** where it shows and how many apps. A `virtual` run without `kwin_wayland` shows on the person's screen, one at a time, and says so.
- **A value the kit cannot use stops every command**, such as `headless` for a Tauri app, or `jobs` above one with `screen`.
- **The old keys still load and do nothing.** `wf screens` and `wf doctor` print the `screens.runs` to write in their place, worked out from them: a `false` becomes `screen`, `true` becomes `headless` for a web app or `virtual` for any other, and `jobsMax` becomes each `jobs`. Copy it into `.workflow/config.json` and remove the old keys.
- **`docs/workflow/config.md` is JSON with comments.** It starts with a contents list, and each section is its defaults as the JSON a project writes, with what each setting does, the words it takes, and why, as comments above it. A developer copies the part they change. The editor's hover and the schema list a setting's words too. Run `npx wf docs sync` to take it.

### v0.86.0: the launch.json server is `ask-pages`

The server that shows ask pages was still called `question-pictures`, from when it only served pictures. And `npx wf view setup` looked for it by that name only, so in a project where the entry had been renamed it added a second one on the same port.

- **The entry in `.claude/launch.json` is now `ask-pages`.** Run `npx wf view setup` once: it renames your entry in place and keeps its options, such as `--port`. The skills and `wf doctor` say `ask-pages`.
- **`wf view setup`** finds the entry by what it runs, `wf view serve`, whatever its name, and removes a second one.
- **`wf doctor`** still passes an entry under the old name in this version, with a note to run setup. It fails when the server is under any other name, or there more than once.
- A preview server already started as `question-pictures` keeps running; the name only matters the next time it is started from `launch.json`.

### v0.85.1: a picture beside its answer stays above the footer

Found on a real page: with a two-line question above it, the bottom of a picture beside its answer ran under the footer.

- The picture leaves more room for what is above it, and on a wide window the question's own line runs the page's width, so a long one stays on one line.
- Nothing to change in a project.

### v0.85.0: ask pages use a wide window

On a wide window an ask page kept a 780 px column, so a picture sat in a small box that scrolled both ways.

- **A page with a picture or a block takes the window's width**, up to 2080 px. Its questions, options, and text keep the 780 px reading width; tables, charts, and pictures get the room. A page of plain questions is as it was.
- **On a window 1500 px or wider, a question's picture sits beside its answer**: the picture on the left, the options on the right. Fit then takes the window's height in place of a third of it, so a 1280×800 picture shows whole with nothing to scroll.
- **Paged reviews** (`compare`, `frame-review`, `storyboard`) go up to 2080 px in place of 1240, and **table pages** up to 1600.
- Narrower windows are unchanged. Nothing to change in a project or a spec.

### v0.84.0: a screen review can accept part of a run

A run where some screens wait on a fix no longer holds back the ones that are fine.

- **`wf screens --accept <screen> ...`** takes only those of the last run's screens, and **`--accept --except <screen> ...`** all but those. Either takes `@<file>`, one name a line. A name the run did not shoot is an error, and accepts nothing.
- **Left open.** After a light or deep run the marks move as for a whole accept, and the changed screens left out are kept in the state as `open`. They stay listed to read and on the deep list until an accept takes them, so `scope` counts only what is still owed.
- **`wf screens scope --names open`** lists them, so a fix can run just those: `npx wf screens $(npx wf screens scope --names open)`.
- **The `screen-review` skill's** accept step says when a partial accept is right, and what each screen left out needs.
- A project's `screens.scope` module needs no change: the kit adds the open screens to the deep list itself. The state gains an `open` key; an older state file reads as none open.

### v0.83.0: a screen-reader reads up to 24 pictures

- **`wf screens --brief`** fills each brief by pictures, up to 24, in place of eight screens. Eight was set when a screen had up to four pictures; a Default-only run has one, so a 244-screen review starts 11 readers in place of 31. A run with narrow and stress pictures splits about as before.
- Still one `screen-reader` a brief. Nothing to change in a project.

### v0.82.2: test-data instructions say each thing once

- **The `design-test-data` skill** keeps its every-run commands at the top; the one-off ones (`prune`, `merge`, `fold`, `rename-ids`) moved to a Maintenance table at the end, and the section on specs from before v0.69.0 is left to the test-data doc.
- **`test-data-process.md`** points to the skill for the budget commands instead of repeating them.

### v0.82.1: instructions that had drifted from the kit

The audit's stale and contradicting lines, each checked against the code:

- **The e2e tester** checks the narrow window only when `screens.narrow` is set, saves pictures only under `.cache/e2e/`, and no longer lists `lines` as a command. The e2e skill finds `### DS-<prefix>-<n>.` journeys, and a deferred journey becomes an open question.
- **Test data:** a gap is numbered from the Budget block, the example rule ID is `R-GM-112`, `delta` names what is over and cuts nothing, and the check on rows no code names yet, gone since v0.76.0, is out of the skill.
- **App testing:** the web skill's `fits` follows a `size` step, and both skills name `npx wf check`.
- **Workflow docs:** `ai-tools.md` no longer names a command the kit never had or says the kit is still moving; `overview.md` lists `ask-page`; `branches.md` gives a branch example the hooks accept; `tools.md` drops a Chromium rule the kit outgrew.
- **Skills:** `workflow-init` shows the answers file's shape, which it could not read before the kit is installed, and three manual-only skills no longer claim to start on a request.

Run `npx wf docs sync` to take the docs.

### v0.82.0: chunk start and chunk end as ordered steps

The audit found the order of a chunk's end spread over six paragraphs, and `wf ready` and `wf done` named once, outside both sections.

- **`four-steps.md`** ends chunk start with `npx wf ready chunk`, adds the test-data `stale` run to it, and opens chunk end with its eight steps in order, from the screen gate to `npx wf done chunk` and the pull request.
- **The `screen-review` skill** starts its chunk-end steps with the rebuild, and gives the built pictures their own step.
- **The `code-review-ledger` skill** says how a new finding is added, copies outside files after the scan empties its folder, and passes the rubric, threat model, and logs to the `code-reviewer` agent, which has no shell and could not read the kit's defaults.

Run `npx wf docs sync` to take the new `four-steps.md`.

### v0.81.0: the ask page's steps carry the pictures, and the open

An audit of Freeorbit's sessions found agents loading the `ask-page` skill and still building a frame-against-app page from pictures cropped by hand, with no boxes, and annotating a picture without opening it. The rule was stated, but outside the steps an agent follows.

- **The `ask-page` skill's steps** now hold the pictures (`wf design annotate --ask`), reading the advice `wf ask page` prints, opening the page every time, and waiting again after a rebuild. What the person sees on the page, such as keys and themes, moved to a reference file.
- **`wf ask page` advises** on a compare pair with no box.
- **`AGENTS.md`** splits the picture rule into with a pane and without, and says to open a picture that is only shown. It now says `<scope>/<slug>` for a branch, lists what counts as installing a package, and gives Status its own bullet. The test for what stays in `AGENTS.md` moved to `writing-docs.md`.
- **`asking.md`** points to the skill instead of repeating it, and the `design-frames` skill keeps only how to make a picture.

Run `npx wf docs sync` to take the new `AGENTS.md` and docs.

### v0.80.0: narrow and stress pictures are a project's own

- **`screens.narrow` is empty by default**, where it was `"800x560"`, and **`screens.stress` stays empty**. While either is empty, the project has no such picture: `--narrow` or `--stress` stops and names the setting, and the skill never offers it. A project without a narrow layout or a stress look, such as a web app with neither, sees only Default.
- **A project that takes narrow pictures sets the size** in `.workflow/config.json`:

  ```json
  { "screens": { "narrow": "800x560" } }
  ```
- **From the review of v0.78.0:** a project in a folder of its repository keeps its record in that folder of the main checkout, as before, and not at the repository's top; two worktrees accepting at once no longer lose one's screens; and a light run after the state fell back to `origin/main` names its range in full.

### v0.79.0: a screen review by area

- **`--area <id>`** narrows any `wf screens` run to that area's screens: `--deep --area uplink`, `--chunk 38 --area app`, or `--area uplink` alone for every uplink screen. Several areas are joined by commas.
- **`wf screens scope --area <id>`** shows that area's part of the light and deep lists, and how long each takes.
- **A light or deep run narrowed to an area** is accepted like any other, but does not move the state: the other areas' screens stay listed until a whole run.

### v0.78.0: worktrees share one screen-review record

- **An accept in a worktree counts everywhere.** The accepted pictures and the review's state, light and deep, were kept in each checkout's own `.cache/screens`, so a review accepted in a worktree was lost with it, and a new worktree saw every screen as new. Both now live in the main checkout's `.cache/screens`, which every worktree reads and writes. Each run's pictures stay in its own checkout.
- **A run recorded at a commit since removed**, such as a deleted worktree's branch, counts from `origin/main` instead of failing.

Nothing to move: the main checkout's record is the one already there. A worktree's own old record is no longer read.

### v0.77.0: a screen review takes Default only

- **Light, deep, and named screens take Default only**, the app's window as a new install shows it. Deep took four pictures a screen, Narrow and the stress look of both too; named screens took Default and the narrow picture in the stress look.
- **The skill asks one question**, light, deep, or defer, and no longer asks which pictures. When the designer wants another picture, name every viewport to take: `--wide --narrow` for both, with `--stress` for the stress look too.

A screen's narrow and stress pictures stay accepted, and are not taken again unless asked for.

### v0.76.2: a narrow whole-page picture shows each thing once

The tauri kind's narrow pictures are shot a window at a time and joined. Freeorbit's screen readers flagged about 12 screens for three things the joining drew and the app does not:

- **Fixed elements were drawn again in every window.** A fixed button at the top showed again lower down, and a dialog or a drawer two or three times. Now, after the first window, fixed elements are hidden and a modal's backdrop too, and a sticky header stays where it stands in the page.
- **Beside the later windows was black.** It is now the colour that stood there, such as the sidebar's.
- **A tab with its own scroller came out narrower than the window**, 767 instead of 800, so its buttons at the right looked cut off. The picture is now as wide as the window.

Every narrow picture of a page longer than one window changes, so `wf screens` reports it as changed: accept the new ones with `wf screens --accept` once you have looked. The screen reader's brief says what the joining now looks like.

### v0.76.1: an ask page no longer shows the word null

- **The receipt** of a page with eight or fewer agreements ended in a stray "null", from v0.72.0.
- **A form** with no required field showed "null" under its fields.

Nothing to do; ask pages pick it up when they are next built.

### v0.76.0: the chunk end holds only high-risk lines to a proof

Freeorbit's open chunks had 363 acceptance lines proven by nothing, 272 of them low-risk, and closing one chunk's 8 took 7 new tests. Gating every line made the risk tags buy nothing.

- **`testdata.chunkScope`**, `"high"` by default: `wf done chunk` waits on the lines tagged `Risk: high`, every line of a story tagged high as a whole, and the product and safety rules, as before. `"all"` holds every line, as v0.69.0 to v0.75.0 did.
- **What is lost:** a low-risk line is no longer guaranteed a test. `npx wf testdata trace --chunk <id>` prints their count, `--all` lists them, and `wf done chunk` carries the count.
- **A proof row is honoured for any line.** A low-risk line whose row says `walk` still goes on the sign-off page, and a row that proves nothing still fails. The low-risk lines with no test and no row get one line of text on the sign-off page, with no check each.
- **What changes in a project.** Run `npx wf docs sync`. Nothing to set for the new gate; set `testdata.chunkScope` to `"all"` to keep the old one. A project that eased in with `testdata.chunkChecks: "warn"` can go back to `"fail"` once its high-risk lines are proven.

### v0.75.0: the ask server restarts itself after an upgrade, and a test for new parts

- **No more `npx wf view stop` after an upgrade.** `wf ask page`, `wait`, and `wf view serve` now stop a question-pictures server older than the kit and start it again on the kit. A newer server is left alone, so two projects on different kit versions never take turns.
- **Open pages still send.** A server that starts again takes the token it ran with before, from the state folder, so a page open in the browser keeps its own token. Before, any restart made an open page's Send fail until it was reloaded.
- **A test for new parts.** `test/ask-parts.test.mjs` fails when a block, a question type, or a template lacks its drawing, its `fields` line, its reference row, or its example. `docs/design/ask-blocks.md` lists the places under Adding a part.
- **What changes in a project.** Nothing. The first `wf ask page` after this upgrade restarts the server by itself.

### v0.74.0: ask page examples build as printed, with `fields` and `--check`

- **Every example builds as it is.** In a project, `npx wf ask example <template>` writes a stand-in picture for each screen the example names, under `.cache/view/example-pictures/`, and prints the spec with those paths. Before, 5 of the 12 examples failed on pictures a project does not have.
- **`npx wf ask fields <part>`** prints one template's, question type's, or block's fields and limits, from the lists the spec check uses. With no part it lists them all. An agent reads a few lines in place of the skill and its references.
- **`npx wf ask page <spec> --check`** checks a spec, finds its pictures, and prints the advice, and builds nothing: the page that is open stays, and nobody is told.
- **What changes in a project.** Nothing. `.cache/view` is already out of the repository.

### v0.73.0: a review's verdicts stay in view, and pictures have one row of controls

- **A paged review takes the window's width**, up to 1240 px, with no rail beside it: the strip already lists the frames. This covers `compare`, `frame-review`, and `storyboard`.
- **The verdicts stay in view** above the footer while the picture scrolls under them. Before, they sat below the window. On a window narrower than 700 px they stay under the picture, so they never cover it.
- **One row of controls.** One picture's label, name, and size sit in its bar with Fit, Comment, Full size, and Expand, in place of a bar and a caption. A compare's two sizes moved from the bar to the line above the pictures, and its comment button is always "Comment".
- **What changes in a project.** Rebuild open ask pages, or reload them after `npx wf view stop`.

### v0.72.0: long ask pages show how far you are

- **Each table counts its rows**, such as 18 of 20, beside its heading.
- **A filter on a table page** shows All, Open, or Not as recommended. It is applied when you pick it, so a row does not leave as you answer it; a table with no row to show leaves with its heading.
- **The receipt leads with what differs.** Past eight answers that are plainly the recommendation, the receipt counts them, lists the other answers first, and folds the agreements under one line. A table's row is named by its first cell as well as its ID.
- **One rule.** What counts as a plain agreement is the same for the receipt and the agent's brief answers: the recommended choice with no note, text, owner, pin, or reply.
- **What changes in a project.** Rebuild open ask pages, or reload them after `npx wf view stop`.

### v0.71.2: small ask page changes from the review

- **The fold bar shows from four questions up.** Select all, Expand all, Fold answered, and Collapse all no longer sit above a page of one to three questions. Their keys still work.
- **The first Tab goes to the current question's answer.** Before, it went to the header's All asks link, with the first question many Tabs away.
- **Suggested edits read more easily.** Added words keep the text's own colour on a stronger green, with more space after a removed word.
- **Form fields take the theme.** Number, date, and select fields looked like the browser's own, white in a dark page.
- **Small things take a click on more room.** The previous and next ask arrows are at least 28 px wide, and a select box takes a click on 30 px while looking the same.
- **What changes in a project.** Rebuild open ask pages, or reload them after `npx wf view stop`.

### v0.71.1: ask page fixes from the review

- **The wheel scrolls the page** over a picture, or over a table that fits its box. Before, a box with nothing more to show still kept the wheel, so the page stood still under the mouse.
- **The keys work in Expand.** A verdict's key, the arrows, C, Z, and F did nothing while the pictures filled the window. Now they work, the next frame opens expanded too, and the bar says which frame it is, such as 2 of 3.
- **R takes a table row's recommendation.** It said the row had none.
- **The agent's answers carry local time**, as the page shows it. They carried UTC with no mark, so an evening send read as the day before.
- **Wording.** "1 question", "Send it as", and "Leave it open" where there is one. After a status page with no questions is built, the next step printed is `wf ask live`, not `wait`.
- **What changes in a project.** Rebuild open ask pages, or reload them after `npx wf view stop`.

### v0.71.0: ask pages answer in brief, and name a field they do not know

- **Brief answers.** `wf ask wait`, `answers`, and `import` now start with a count: how many were answered, how many as recommended with nothing added, and how many are open. Past eight plain agreements, only the other answers are listed. A 117-row review comes back in about 10 lines in place of 145.
- **`npx wf ask answers <id> --all`** lists every answer, as before. The JSON file, the export, and the history do not change.
- **An unknown field stops the build.** A field the kit does not know, on the spec, an item, an option, or a picture, is a problem that names the nearest field, such as "no field typ; did you mean type?". Before, a misspelt field was dropped and the page built without it.
- **What changes in a project.** A spec that carried an extra field now fails once and says which; take the field out. A project's own template names its items' fields itself, so its items are not checked.

### v0.70.0: ask pages leave room for the answer

From a review of the ask pages on every template and a 117-row test-data page.

- **Short options sit in one row.** Options with no description, such as a plan's Approve and Change or a sign-off's Done and Object, are one row in place of a stack. A four-step plan fits one screen in place of two.
- **Shared options are described once.** Three or more questions with the same described options, such as a triage's verdicts, say what each means once above the questions, then show one row each. The left and right arrow keys move along a row.
- **A picture leaves room for its answer.** Beside a question's answer, Fit is about a third of the window, so the options are on the same screen. Expand (F) and the paged reviews keep their room.
- **A table page takes the window's width**, up to 1240 px, with no rail of row ids beside it. A test-data review shows seven rules a screen in place of four.
- **What changes in a project.** Rebuild open ask pages, or reload them after `npx wf view stop`.

### v0.69.2: acceptance lines are plain for the client

- **No date or decision ID in an acceptance line.** The lines go to the client's board, so a note such as "(added 2026-11-14, D-GM-047)" moves to the area's `story-changes.md`, `| Line | Change | Date | Decision |`. doc:check warns for a line that holds one.
- **The board leaves out a line marked Removed.** It keeps its place in the story so no ID moves, and the client is shown only what is promised.
- **A proof row may name a rule**, such as `| GM-07.8 | R-GM-27 |`: one test of that rule covers the line in every state, so each story's "the step finishes with AI off" needs no test or walk of its own.
- **Chunk ids like `38h2`** are accepted by `wf ready`, `wf done`, lanes, and the screen list; before, a digit after the letters was refused.
- **What changes in a project.** Run `npx wf docs sync`, then move each line's note to `story-changes.md` as doc:check lists them. The next board sync rewrites the pinned comments without Removed lines.

### v0.69.1: the last of Levels and tags is gone

- **Gone from the kit:** a check's Level and Setup columns and everything that read them, `npx wf testdata tag`, `npx wf testdata ids`, the "moved by the tags" table on a review page, and `prune --owner`. A check row is `| ID | Check | Stories | Rules | By |`, and is only read so a test that cites it still names it.
- **`prune` takes every check row nothing cites**, for built stories. It no longer keeps a row for being tagged core or `+harm`.
- **Fixed:** `test-data-formats.md` repeated its sections from Rules to Edge-case fixtures in v0.69.0. `npx wf testdata` with no step now prints its usage; it had thrown since v0.68.0.
- **What changes in a project.** Run `npx wf docs sync`. Take the `Setup` and `Level` columns out of any check table that still has them; nothing reads them.

### v0.69.0: acceptance lines are the checks, and the designer designs data within a budget

Freeorbit's spec had grown to 560 checks and 308 rules for 105 stories. Half were cited by no code, one story's 7 acceptance lines were named in 61 spec rows, and every limit was a warning.

- **Acceptance lines are the checks.** Each has an ID by its place in its story, such as `GM-07.3`, and a test or a scenario cites the line it proves. `npx wf id GM-07.3` finds it.
  - A new line goes last, and a line taken out stays as `- Removed (<date>).`, so no other line's ID moves.
  - A line no test can prove has a row in the area's proof table, `| Line | By |`, with `walk`, `walked <chunk>`, or a later chunk.
- **The chunk gate** is on the acceptance lines of the chunk's stories, and their product and safety rules. `wf done chunk` no longer reads check rows.
- **The designer designs data**: datasets, journey states, input classes, and edge-case fixtures. It writes no checks, no Levels, and no product rules, and its tag mode is gone.
  - What it thinks a story forgot it proposes as an acceptance line, at most two a story, for the story's owner.
- **Budgets are held by the tool.**
  - `npx wf testdata budget <area> [ids]` prints each story's fixtures against its cap, as the `Budget:` block the skill pastes into the designer's prompt.
  - `npx wf testdata delta <area> <file>` fails a return with more than 5 questions, more than 2 proposed lines a story, or any check row. What is over is cut, and the designer is not run again.
  - `refresh-close` refuses when a refresh took a story over its fixture cap; an overage from before it only warns, in doc:check. `testdata.limits.allow` names the owner's exceptions.
- **Risk goes on the line.** An acceptance line ends `Risk: high (<why>)`; a story's own Risk line still marks every line.
  - Fixtures: five for a story tagged whole, two for each high-risk line, none for a low-risk story.
  - doc:check warns when more than a third of an area's acceptance lines are high (`testdata.limits.highShare`).
- **Solo review is one page.** With `team: "solo"`, `npx wf testdata review <area>` puts the craft rules on the owner's page as one row. Review pages hold rules only.
- **A rule's Type comes from its category** where it can: Stand-ins and Data markers are craft, Never sent or stored is safety. Only the rest warn as untyped.
- **Check rows stay readable.** A test that cites `C-GM-41` still names it. Nothing gates, budgets, or reviews them. `npx wf testdata prune <area> [--write]` takes out those no code cites, for built stories.
- **Gone:** `testdata.limits.checks`, the check budgets and their warnings, and the "no ID" and "rare check" warnings. `npx wf testdata tag` and `ids` remain for a spec that still uses them.
- **What changes in a project.**
  1. Run `npx wf docs sync`. A config that still sets `testdata.limits.checks` keeps working; the key does nothing, so take it out when convenient.
  2. Set `testdata.chunkChecks` to `"warn"` for chunks in flight, whose tests cite check IDs. From the next chunk, tests cite acceptance lines.
  3. Run `npx wf testdata prune <area>` for each area, read the list, then `--write`.
  4. As stories come up, move `Risk: high` from the story to the lines that are.

### v0.68.0: the owner can drop a check or rule at any review

- **Drop**, beside Fine, A gap, and Wrong on a test-data review page, is for a row not worth testing at all. The note says why. Before, a row could be turned down only while it was proposed.
- **`npx wf testdata drop <area> --from <ask id> [--write]`** applies a page's Drops. `drop <area> <ID>... --why "<why>"` drops rows by ID. It is a dry run without `--write`.
  - Each row leaves the spec, its proposed edits too, with no designer round trip, since the owner decides it.
  - It joins a `## Dropped` table in the area's README, `| ID | What | Why | Dropped |`.
  - It names the code that cites each row, for the citation to come out, or the test when proving that row was all it did.
- **Dropped stays dropped.** The designer reads the Dropped table and never proposes those rows again. A dropped ID is never reused; `wf testdata ids` numbers past it. doc:check fails a row that brings one back, and says "was dropped" for a cited one.
- A review page's option may carry its own `glyph`, where its kind's would mislead: Drop shows ✕.
- **What changes in a project.** Run `npx wf docs sync`. After a review page is sent, run `npx wf testdata drop <area> --from <its id> --write`.

### v0.67.3: long tables scroll in their own box

- **A long or wide table** on an ask page (a test-data review, a grid question, a table block) now scrolls inside a box at most 70% of the window tall, both ways, with its header kept in view. Before, its sideways scroll bar sat at the table's foot, a page or more below.
- **Every text column wraps.** Only the select box, the verdict, and the note keep to one line, so a review row with two text columns no longer runs off to the right.
- **The review page's moved table** shows "Reworded as" only when the tags reworded the row, in place of repeating it.
- **What changes in a project.** Rebuild open ask pages, or reload them after `npx wf view stop`.

### v0.67.2: a Glob may name its folder in the pattern

- A blind agent's Glob that names its folder in the pattern, such as `docs/app/test-data/**/*.md` with no path, was judged as a search of the whole project and refused. The guard now reads the folder from the pattern's start, or the one file when it has no wildcard, and checks that. A pattern naming a folder off the agent's list is still refused.
- **What changes in a project.** Move the pin to `v0.67.2`, then restart Claude Code so the hook reloads.

### v0.67.1: a blind agent may search a file it may read

- The blind agents' guard refused the test-data designer's search of `user-stories.md` for Risk lines in tag mode, since searches were allowed only in the test-data folders. A blind agent may now search any one file it may read, which shows nothing reading it would not. A folder is still searched only from its own list.
- **What changes in a project.** Move the pin to `v0.67.1`, then restart Claude Code so the hook reloads.

### v0.67.0: the owner reviews only what is theirs, in plain words

- **Who a row is for.** Each check gets a Level, and each rule a Type:
  - Levels are `core` (the story's promise), `likely` (what users often hit), `rare` (unusual input or timing), and `polish` (help text and labels). Any Level takes `+harm` where breaking it would leak or lose data, send something wrongly, or give legally wrong advice.
  - Types are `product` (how the app behaves), `safety` (a privacy or safety promise), and `craft` (how test data and stand-ins are built).
  - A sample of Freeorbit's spec read 28% core, 39% likely, 12% rare, and 21% polish; its rules read 10% product, 25% safety, and 65% craft.
- **The owner's rows** are core and `+harm` checks, product rules, and safety rules (one yes/no list), with the area's new `glossary.md` of domain words in plain terms. **The team's** are the rest; when the owner is also the developer, they accept those in bulk.
- **Plain words.** A checks table gains a `Setup` column for scenario, fixture, and token names, so the Check cell reads as a person would say it. doc:check fails code names in a core or `+harm` check, and warns in a product rule.
- **`npx wf testdata review <area> [--chunk <id>] [--team]`** prints the ask page of the owner's rows, by story and plain, or the team's. Pipe it to `npx wf ask page -`. Every row is recommended Fine, so Take all recommendations accepts a table, and only a doubted row needs a mark. A `testdata` page's rows may now carry `recommended` and `why`.
- **Budgets by Level.** `testdata.limits.checks` gains `core: 3` and `likely: 5` a story. Rare checks go only on a story with `Risk: high`, and doc:check warns otherwise. An untagged check counts against the old `story: 8`.
- **The chunk gate by Level.** `wf done chunk` fails on the owner's rows proven by nothing. A likely check warns. Rare checks and craft rules are the team's and not gated: a craft rule is proven by one sweep test in the generator, a rare check by its input class's test (CS-TEST). A polish check is walked at sign-off.
- **Tagging a spec written before Levels.**
  - The designer's new tag mode returns each row's Level or Type, a plain Check and its Setup where needed, and the area's `glossary.md`, changing no row's meaning.
  - `npx wf testdata tag <area> <tags.md> [--write]` applies that table, adding the columns.
  - Each row a tag moves off the owner's side (a likely, rare, or polish check, or a craft rule) is listed in `.cache/testdata/moved-<area>.md`. The owner's review pages show those rows once, to confirm in bulk or take back, so no model judgment removes a row from them unseen.
  - `testdata.untagged` is `warn` for this release: an untagged row is the owner's and gated, as before. The next release makes it `fail`.
- **Supersedes:**
  - the per-story check budget of eight (v0.62.0), now per Level;
  - the review of rules "a category at a time" (v0.48.0), now product and safety rules for the owner and craft rules for the team;
  - "every check is gated" (v0.66.0), now the owner's rows only.
- **What changes in a project.**
  1. Run `npx wf docs sync`.
  2. For each area, run the designer in tag mode, then `npx wf testdata tag <area> <tags.md> --write`, and save its glossary.
  3. Review the owner's page once with `npx wf testdata review <area> | npx wf ask page -`. That first use is also the check that the tags are right.
  4. A generator that fingerprints the spec leaves out `## Rules` and `## Gaps`.

### v0.66.1: cite first, then write

- **CS-TEST, "Cite first, then write."** To prove a check or rule, cite it in the test that already shows it; one test, or one table's rows, may cite several. A new test is only for what no test shows, never one written only to carry a citation.
- `wf testdata trace --chunk` and the chunk-end step say the same. The code reviewer flags a test that adds nothing but an ID.
- **What changes in a project.** Run `npx wf docs sync`.

### v0.66.0: every check and rule is proven, walked, left to a named chunk, or disputed

- **A chunk's checks.** `npx wf testdata trace --chunk <id>` sorts the checks of the chunk's stories, read from its build-order row (a range such as `DR-01 to DR-20` counts each story):
  - proven: a test or a scenario cites its ID (a test's body or the comments above it, or a file under tests, e2e, or scenarios; a mention in app code, or in a fixture the generator writes, proves nothing), or By says `walked <a done chunk>`;
  - walk: for the owner's sign-off page;
  - later: By names another open chunk, a lane such as `CH-01-fe` included; a By naming no open chunk is unproven, and says so;
  - disputed: a `dispute` row in its gaps table;
  - proven by nothing.
- **Chunk end** (`wf done chunk`) fails while any is proven by nothing, and fails whenever the trace cannot run, in warn mode too. `testdata.chunkChecks` is `fail` by default, or `warn` or `off` for a project whose tests do not cite check IDs yet. On Freeorbit, chunk 38f has 191 checks: 13 to walk, and 178 that no test cites yet.
- **Walk checks reach the sign-off page**, one row each by ID. Once signed off, By becomes `walked <chunk>`, so a later chunk sharing the story never asks again. Proof is a citation, never a rerun, so a check proven once stays proven.
- **The e2e tester** reads the Checks table for a journey's stories, cites a check's ID in a finding, and finds datasets by `### DS-<prefix>-<n>.` as well as the old `### D<n>.`. It looked only for the old heading, which v0.64.0's rename removed.
- **A disputed check.** When a test shows a check is wrong, the main agent adds a `dispute` row to the area's gaps table, naming the check, and never edits the check by hand. The next refresh answers it.
- **Rules too.**
  - The chunk view and its gate include the accepted rules of the chunk's stories. On Freeorbit, chunk 38f has 105 rules beside its 191 checks, and 23 of the 296 are proven by a test today.
  - A rules table may have a `By` column: a later chunk's id parks a rule until then, in place of "Parked until" in the Accepted cell.
  - An accepted rule is never edited in place. A change is proposed under Proposed rules with its own ID and Accepted `edit`, and accepting it sets a new date, so the date always covers the words. A dispute row may name a rule.
- **doc:check fails** a table whose rows a blank line cuts from its header, since no tool reads them. It also fails a rule or check that a check, fixture, input class, or dispute cites but no spec defines. On Freeorbit it finds one cut table, in `downlink/test-data/prepare/README.md`, which hides R-DR-64, 86, and 88.
- **doc:check warns** for proposed rules waiting on the reviewer, and for a rule two flow areas cite that is not in `core.md`, the 10 on Freeorbit.
- **What changes in a project.** Run `npx wf docs sync`. Remove the blank line doc:check names. Set `testdata.chunkChecks` to `warn` until tests cite check and rule IDs, if that is far off. Move "Parked until" out of an Accepted cell into `By`.

### v0.65.3: pictures expand to the window, and nothing scrolls the page sideways

- **The page no longer scrolls sideways.** A question's column took its content's width, so a picture at 100%, or a wide table or diff, made the whole page wider with its own scroll bar. Now each scrolls in its own box.
- **Expand (F)** shows a question's pictures in the whole window, over the header and footer, where Fit is as big as the screen allows. The compare views, zoom, comments, and the verdicts work there; Esc or Close puts it back.
- **Swipe past Fit.** The line and where the pictures are cut now agree at any zoom: the overlay was the box's width while the cut was the picture's.
- **Drag to move** around a picture past Fit, with a grab cursor. On Swipe, where a drag moves the line, the scroll bars or the wheel move it.
- **What changes in a project.** Rebuild open ask pages, or reload them after `npx wf view stop`.

### v0.65.2: macOS notifications fall back to osascript

- **terminal-notifier that macOS has not allowed** exits with "Notifications are not allowed for this application", as CI's macOS runner showed. The server now tries `osascript` next, and uses it from then on; `wf view notify` tries them in the same order.
- **The macOS test** runs `osascript` itself, which every Mac has.
- **What changes in a project.** `npx wf view stop`, so the server restarts on the new kit.

### v0.65.1: ask pages leave no choice in the chat, and notify in the built-in browser

- **No lingering choice.** The `ask-page` skill and `AGENTS.md` now say to end the turn after `wf ask wait`, with no question, buttons, or "Sent it" choice in the chat. `wait` wakes the agent when the page is sent; a choice in the chat stayed open after the answers went.
- **Notifications in Claude's built-in browser.** The pane shows no web notification, so the question-pictures server now shows them on the desktop, with `notify-send` on Linux or `osascript` on macOS. The browser's own notifications are the fallback.
  - The server only takes a notification from its own pages, each with its token; the inbox has one too.
  - It shows at most one a second, and the same one once a minute, as short plain text.
- **On macOS**, `terminal-notifier` is used when it is installed (`brew install terminal-notifier`), else `osascript`. macOS lists osascript's notifications as Script Editor's, so Script Editor must be allowed in System Settings, Notifications. CI's macOS job runs the real command.
- **`npx wf view notify`** sends one notification now, through the same command, and says what to check when none appears. A failed notification is logged by the server.
- **Told while you are away.** A reply, or a live page finishing, is told when the page lacks focus: another tab, or the chat beside the pane. Before, a visible pane never told.
- **What changes in a project.** Run `npx wf docs sync`, and `npx wf view stop` so the server restarts on the new kit. Then turn on "Tell me when an agent asks" in a page's ⋯ menu, or Notify me on the inbox.

### v0.65.0: `wf testdata merge` and `fold`, from Freeorbit's scripts

- **`npx wf testdata merge <folder> [--write]`** makes a flow area's folder one file, `<folder>.md`.
  - Each table goes to the section its header names, in the formats doc's order, and tables with the same header in one section become one.
  - A datasets file, or a file named for one part (`rules.md`, `data.md`, `states.md`, `gaps.md`, `checks.md`), goes whole, so a dataset keeps its own table.
  - A topic file's lead stays, under an italic label of its topic. The README's file table goes.
- **`npx wf testdata fold <file> <sibling> [--write]`** puts a small file into a sibling in its folder. The folder README's row for it joins the sibling's.
- **Links.** A link inside the moved text is rewritten for its new place. A link to a sibling points at the section its text went to, labelled with that file's topic when the label was only its name. Every other doc's link to a file now gone points at the new one, and the docs index keeps one row for it.
- **Safe by default.**
  - Both are a dry run without `--write`. Nothing is written unless the data rows before and after are the same, and a merge never overwrites a file, ignored ones included.
  - They work only on an area's test-data flow areas, and refuse a symbolic link. Links inside code are left as written.
  - In the docs index, only a row the move made repeat another is dropped.
- **doc:check** names the command. "Make it one file" comes only when the merge itself fits `testdata.limits.lines`. A fold names a sibling with room, a topic file before a named one.
- **Measured on Freeorbit**, from before its own merges: 14 merges and 31 folds took the spec from 230 files to 128 (App 66 to 15, Uplink 90 to 69, Downlink 74 to 44), with every row kept and doc:check passing. Its own scripts reached 141.
- **What changes in a project.** Run `npx wf docs sync`. Then run each command doc:check names, a dry run first, and commit per area.

### v0.64.1: rename-ids fixed from Freeorbit's first run, and a deep review

- **rename-ids.**
  - In an area's docs folder, an old ID is that area's, defined now or retired. Before, `D10` in Uplink's history became the App's `DS-APP-10`, and a retired `D16` was left as it was.
  - In code only comments and string literals change, so `const D23` and `D27::Tiny` still compile. A JS template's `${…}` counts as code.
  - Left alone: product data files (JSON, TOML, YAML outside tests and fixtures), symbolic links, and the kit's own docs.
  - Where the path names no area, a story or decision ID on the same line can name it. An ID the path's area does not know, which another area defines, is listed for a person.
- **doc:check.**
  - `C-GM-49` no longer reads as story `GM-49`.
  - A deleted file that is not yet staged no longer crashes it.
  - "Make it one file" comes only when that file, without its README, fits `testdata.limits.lines`.
- **The blind agents' guard** takes a chunk worktree as its root, so the test-data designer can read there. Only the project, or a git worktree of the same repository, can be the root: a parent folder's config, or a fixture's, never sets the policy.
- **One pattern source.** doc:check, the story checks, `wf id`, and `rename-ids` build their ID patterns from `lib/ids.mjs`. A story is two digits everywhere. A project with no area prefixes has no area kinds. `wf id` shows a line's terminal escapes as `�`.
- **What changes in a project.** Run `npx wf docs sync`, then follow v0.64.0's steps. On Freeorbit the dry run renames 4,626 mentions in 363 files, and lists 212 for a person. Its generator must read `### DS-<prefix>-NN.` headings, since tests holding sample spec text are renamed too.

### v0.64.0: every ID is unique across the app, and `wf id` finds one

- **Area-qualified IDs.** A rule, check, gap, or dataset ID now carries its area's prefix: `R-GM-119`, `C-GM-41`, `G-GM-03`, and `### DS-GM-27.`. The letter says the kind (Rule, Check, Gap, DataSet); the prefix says the area.
  - Before, two areas could both have an `R-76`: on Freeorbit, 87 rule IDs were in both plugins, datasets D23 to D34 in both, and `C-01` in every area.
  - Fixture, state, and input names are unique across the app too.
- **`docs/workflow/ids.md`** lists every kind of ID, its pattern, an example, and where it is defined. The patterns live in one table in the kit (`lib/ids.mjs`) that every command reads, and a kit test keeps the doc in step with it. `AGENTS.md` points at it.
- **`npx wf id <ID> [--all]`** says what an ID is, where it is defined, and each line that cites it, as spec, docs, logs, tests, and code. It matches whole IDs only, and finds a name written with underscores too. Use it before searching by hand.
- **`npx wf testdata rename-ids [area] [--write] [--all]`** qualifies the old IDs, in the spec and wherever they are cited.
  - An ID one area defines is that area's anywhere.
  - One several define is told apart by its place: the area's docs folder, a path with the area's id as a folder or file name, or its `code` paths.
  - Anything else is listed for a person, never guessed. It is a dry run without `--write`.
- **doc:check.** It fails an ID defined twice in the app, or with another area's prefix. It warns for old IDs, and for a name defined in two areas.
- **Bigger files, fewer of them.** `testdata.limits.lines` goes from 40 to 100, about a page. At 40, Freeorbit had 230 spec files averaging 19 lines; at 100 its move area went from 12 files to 4 with every row kept.
  - New `testdata.limits.folder` (150): doc:check advises making a flow area's folder one file when it is all under that.
  - New `testdata.limits.small` (15): it advises folding a file under that into a sibling.
  - The designer writes to the new sizes.
- **What changes in a project.**
  1. Run `npx wf docs sync`.
  2. Run `npx wf testdata rename-ids` and read the dry run. On Freeorbit it renames 935 IDs across 430 files, and lists 147 mentions for a person, 69 of them in one research file.
  3. Run it again with `--write`, settle the listed ones by hand, and commit that alone.
  4. Then merge the folders doc:check names, one flow area at a time, as their refresh comes.

### v0.63.0: every check has an ID

- **Check IDs.** A checks table is now `| ID | Check | Stories | Rules | By |`.
  - Each check has `C-NN`, the area's next free number, never reused or renumbered, as rules have `R-NN`.
  - A test cites the check it proves, such as `// C-41`, so `npx wf testdata trace` lists the checks nothing proves.
  - `By: walk` marks a check only the walk through the app by hand can prove; the trace leaves it out.
- **`npx wf testdata ids <area>`** gives every check without an ID its own, in file order, and adds the ID column where a table has none. A second run changes nothing.
- **doc:check.** It fails a check ID used twice in an area. It warns, once per area, for checks with no ID.
- **The designer and deltas** name checks by ID.
- **What else is indexed.** Every other thing a test or a delta points at already has an ID: stories, rules, datasets, decisions, gaps, open questions, and named fixtures, states, and inputs.
  - Acceptance lines and input classes keep none. A check is the testable form of an acceptance, and a test reads an input's classes as data.
- **What changes in a project.** Run `npx wf docs sync`, then `npx wf testdata ids <area>` for each area. On Freeorbit that numbers 527 checks in 61 files. Until tests cite them, the trace lists every check as unproven; that list is the gap to close as tests are touched.

### v0.62.0: checks say what rules do not, the spec comes just in time, and a trace

- **Checks.** A check now says what a flow shows that no rule already says.
  - A rule that holds everywhere (nothing in a log, AI off, a restart) lives once in `core.md`, with one test across every state.
  - `testdata.limits.checks` allows about 8 checks a story and 30 a flow area.
  - doc:check warns past those, and when one check is written in 3 or more files.
- **Just in time.** A first draft covers the stories of this chunk and the next. A later chunk's flow areas are written when it starts, so no spec is refreshed for code not yet begun.
- **`npx wf testdata trace [area] [--all]`** lists the spec rows no code names (rules, fixtures, inputs, states, datasets), and the tests that name no row and no story. It reports facts, and nothing fails.
- **CS-TEST** adds three lines:
  - a test reads the spec's values, never retypes them, and cites what it proves;
  - a skip for a missing tool is a failure in the full check;
  - the tests a change touches run first, and changed-line coverage may report what a change left untested.
- **On Freeorbit.** doc:check now warns for 7 flow areas over 30 checks, and for "all of the above with AI off and no model" in 14 files. The trace finds 78 spec ids no code names (the Guides tab is not built yet), and tests that still cite retired ids, such as `asst-page-injection`.
- Run `npx wf docs sync`.

### v0.61.0: every template has its moment

- **One table.** The `ask-page` skill's "Which part for which question" now covers every template, question type, and block. Each template's items moved to the skill's `reference/templates.md`. For example:
  - `batch` for several roles;
  - `triage` for the open questions, or review findings with their verdicts;
  - `rank` for an order, `plan` to approve, and `signoff` to close a chunk;
  - `naming` for words, and `testdata` for rule rows;
  - `compare`, `frame-review`, or `storyboard` for screens, and `status` while a step runs.
- **Each moment names its template:**
  - chunk start: a `batch` page by role, the order a `rank` question, open questions on `triage`, and a plan on `plan`;
  - what the owner checks by hand at chunk end: `signoff`;
  - the build order: `rank`;
  - a story check: `batch`;
  - test-data rules: a `testdata` page;
  - code review and E2E verdicts: `triage` with their verdicts;
  - screen-review differences: a `compare` page from `annotate --ask`.

  The e2e skill no longer asks in fixed batches of five; it follows the asking rules.
- **Template advice.** `wf ask page` now prints it:
  - a decision page asking several roles (batch);
  - open questions (triage), or the same accept or reject on many items (triage with verdicts);
  - pictures each given a verdict (frame-review or compare);
  - a question that judges several rules at once (testdata).

  On Freeorbit it names `38f-rules`, where each category's rules are accepted together.
- Run `npx wf docs sync` for the workflow docs.

### v0.60.0: ask pages use their parts for pictures

- **`wf design annotate <spec> --ask`.** For an ask page, it draws no joined sheet.
  - It writes each picture on its own, plus `<out>.ask.json`: the spec's pictures with their boxes as data.
  - A frame followed by its app picture is one compare pair, or the pairs `pairs` names.
  - The page then draws the numbered boxes, zooms, compares by swipe, onion skin, or difference, and takes pins.
- **The rules.** `AGENTS.md` and the design skill now say never to put the joined sheet on an ask page; the sheet is for the chat. The `ask-page` skill gains "Which part for which question":
  - a frame against the app is a compare pair;
  - several frames are a frame review;
  - where to look is boxes as data;
  - numbers are tiles or charts, logs are tables, text changes are diffs, and context is a text block;
  - the choice is its own question after the evidence.
- **Pictures advice.** `wf ask page` now prints it, beside the grouping advice:
  - a picture that looks like several frames joined in one sheet;
  - a question that names a box its pictures do not have, or that shows no picture;
  - a frame against the app with no compare pair.

  On Freeorbit's `38f2-review` page it names all three.
- **Settings are kept.** Questions now start expanded (Expand all).
  - How they fold, the zoom, and the compare view join the look in this browser's saved settings. Before, they were kept for one tab, and folding for one page.
  - Every choice is kept until **Reset settings** in the ⋯ menu or the command list. Reset puts back the look, folding, zoom, compare view, inbox filters, and notifications, with an Undo.
- Run `npx wf docs sync` for the new `AGENTS.md` lines.

### v0.59.0: fewer, plainer unit tests

- **CS-TEST** in `code-standards.md` now says:
  - a rule is tested where it lives, and a caller gets one test that it uses the rule;
  - tests that differ only in their values are one table (rstest or test-case in Rust, a loop or `test.each` in JavaScript), each row saying what it shows;
  - a rule that holds for every input gets a property test (proptest, fast-check);
  - a project that runs a mutation tool in `review.scans.full`, such as cargo-mutants or Stryker, prunes the tests that kill no mutant another test leaves alive.
- **The structure scan** (`structure-scan.py`) adds two facts for the structure review:
  - the tests in one file that differ only in their values, which one table could hold;
  - the files with the most tests.

  On Freeorbit it finds two such groups, in `dates.rs` and `takeout/archive.rs`. Its other tests vary in what they set up and check.
- Run `npx wf docs sync` for the new CS-TEST lines.

### v0.58.0: test data lists an input's classes once

- **Input classes.** A new table in the test-data formats: `| Input | Class | Values | Expect | Stories | Rules |`, one row a class of one input, such as a pasted address or an imported file. The unhappy paths (empty, at and past a limit, malformed, duplicated, encodings, dates) are listed once, for the input, in `formats.md` or the one flow that has it, and tested once where the rule lives, with no fixture file and no journey state.
- **Fixtures are for the flow.** An edge-case fixture now shows only what a flow alone can: a state, an order, an interruption, a restart. A case that varies one input's value is a class.
- **A budget.** About five fixtures a story, fifteen a flow area, and four on one rule, in `testdata.limits.fixtures`. The designer merges rows, or asks the reviewer about a row kept past it.
- **doc:check warns.** It now warns for:
  - an input class listed twice;
  - a fixture that reaches `unit`;
  - fixtures past a budget.

  They are warnings, never failures.
- **What changes in a project.** Nothing breaks: existing fixture tables still parse. A spec written before this warns where it is over budget, which is the list to prune. Freeorbit's spec gives 69 such warnings today. Run `npx wf docs sync` for the new formats doc.

### v0.57.0: ask pages group their questions

- **The rule.** `AGENTS.md` now asks the agent to group what it asks: one page for what blocks the same piece of work, related questions together under what they decide, and questions of the same shape as one. The `ask-page` skill has a Grouping section on how.
- **The advice.** `wf ask page` prints Grouping advice, and still builds the page:
  - more than eight questions with no groups or sections;
  - three or more written-out questions with the same options, which could be one grid;
  - more than about fifteen answers, which could go step by step or on a second page.
- **The skill.** A project's own templates and many sessions moved to the skill's `reference/`.
- Run `npx wf docs sync` to bring the new `AGENTS.md` line in.

### v0.56.0: ask pages move smoothly

- **What glides.** Rank items, bucket cards, sorted or filtered table rows, and inbox rows glide to their new place instead of jumping.
- **What opens and closes.** Follow-ups open and close in place, steps slide in from the side, and popovers fade as they close.
- **What draws in.** Charts draw themselves in the first time they come into view: bars grow, lines run, and a diagram's boxes come in before its arrows. A live page's bar eases, its numbers count up, new log lines slide in, and a block already there no longer flashes on an update.
- **What else.** A new theme, accent, or light or dark cross-fades, and buttons give a little under a press.
- **The Motion setting.** Motion in the ⋯ menu is System by default, which follows the computer's setting for less motion. Full, Subtle (fades only), or Off is the person's own choice and wins over the computer. `off: ["motion"]` or `ask.off` turns it off for a page or a project.
- **How it moves.** One motion part, `lib/ask/browser/motion.js`, holds the timings (140, 220, and 320 ms) and the moves. Only position, size, and opacity move, and nothing waits on a move.
- Nothing to change in a project. Rebuild any open ask page with `npx wf ask page`.

### v0.55.0: live ask pages

- **A live page.** A `status` page, or one with `"live": true`, shows where a step stands while it runs: its state, step, progress, log, and blocks. It redraws in place as the agent runs `npx wf ask live <id> --step … --progress 3/12 --log … --blocks …`.
- **Replies.** `npx wf ask reply <id> <question> <text>` puts the agent's reply under a question. The page asks again, and the person's reply comes back with the answers.
- **History.** Every send keeps a round. `npx wf ask history [<id>]` lists them, the page's ⋯ menu shows Earlier answers, and `wf ask export` adds them as Markdown.
- **Changes.** A page asked again marks its New and Changed questions and lists what was removed.
- **Steps.** `"steps": true` shows one section at a time, each a step. A `questions` block with a `group` or `ids` places those questions, so each step asks its own.
- **Waiting.** A served page's tab shows how many asks wait. The person can turn on a browser notification for a new ask, a reply, or a live page finishing.
- **Off.** Each of these turns off with `off` or `ask.off`: `live`, `replies`, `history`, `changes`, `notify`, and `tabcount`.
- **The skill.** The `ask-page` skill keeps its steps and spec in `SKILL.md`, now under 10 KB. Blocks, answer types, and live pages moved to `reference/`, which it reads when a page needs them.
- Nothing to change in a project. Rebuild any open ask page with `npx wf ask page`, and restart the server with `npx wf view stop` so it serves the new routes.

### v0.54.1: fixes from the code review of blocks and richer answers

- **Exports.** A CSV export no longer carries spreadsheet formulas. A cell starting with `=`, `+`, `-`, `@`, a tab, or a return opens as text, unless it is a plain number.
- **Ledger tables.** A `ledger` table shows only open findings: proposed, accepted, or deferred, as the ledger's own script counts them. Fixed findings are left out.
- **Scale numbers.** A scale's number box takes only a number on its step, by the same rule the server checks, so a send is never refused for 2.5 on a whole-number scale.
- **Limits.** Limits are checked before the work they guard: more than 60 blocks, 30 edits, or a diagram over 40 boxes or 80 links is refused before anything is worked out, and a long chain of boxes cannot overflow the stack. A word diff's limit counts what it compares.
- **Log paths.** A table's named source reads its log only inside the project, through no link that leads out.
- **Inside the kit.**
  - Each block kind is one record, in the spec checks (`BLOCK_DATA`) and on the page (`BLOCKS`).
  - The page's styles are parts under `lib/ask/browser/style/`.
  - The page and the record share one count of how far a grid, a sort, or edits has got.
- Nothing to change in a project. Rebuild any open ask page with `npx wf ask page`.

### v0.54.0: the review's verify pass is optional, and off by default

- `review.verify` in `.workflow/config.json` turns on the third review pass, which tries to disprove each draft finding on another model before the reviewer sees them. It is `false` by default: the security and structure passes' drafts go to the reviewer as written, and the run's summary says no verify pass ran.
- A project that wants the verify pass back sets `"review": { "verify": true }`. `review.models` still names the verify model for when it is on.

### v0.53.0: ask pages draw charts and diagrams

- New blocks: `chart` (bar, stacked bar, or line, one axis, with a tooltip, the arrow keys, and a table view), `diagram` (boxes and arrows the kit lays out), `timeline` (done, now, and next), and `board` (cards in columns, read only). A stats tile's `trend` draws a sparkline.
- A chart saves as SVG or CSV and copies as Markdown; a diagram saves as SVG or copies as Mermaid; a timeline and a board copy as Markdown.
- Each turns off with `off` or `ask.off`, like the other blocks.
- Nothing to change in a project. Rebuild any open ask page with `npx wf ask page`.

### v0.52.0: ask pages take richer answers

- A question can ask for a rating, a slider, or a number (`scale`), a choice for each row (`grid`), a sort into buckets (`buckets`), accepting or rejecting suggested edits (`edits`), or a small form whose fields are checked as they are filled (`form`). Each recommends in the advised templates, and R takes it.
- `showIf` makes a follow-up that shows only when an earlier answer fits; one not shown is not asked. `owners` lets the person assign a question. In comment mode a drag draws a box on a picture.
- `off` and `ask.off` take the new types, and `followups`, `owners`, and `regions`.
- Nothing to change in a project. Rebuild any open ask page with `npx wf ask page`.

### v0.51.0: ask pages show blocks

- A page can be made of `sections` of blocks around its questions: text, number tiles, tables, and before-and-after diffs. A table can read the open questions, the decisions, or the review ledger by name. A part kept in `.workflow/ask-parts/` is reused across pages. Each block exports its data as CSV, Markdown, or a diff.
- `off` on a page, or `ask.off` in `.workflow/config.json`, leaves out a block kind or a page feature: bulk answers, the outline, the command palette, pins, or the compare views.
- Each section is now one panel by default, its questions split by hairlines; Cards is still in the settings.
- Nothing to change in a project. The design and the phases still to come are in `docs/design/ask-blocks.md`.

### v0.50.1: fixes from the first code review of ask pages

- The kit's blind code reviewer read v0.48.2..v0.50.0, and every finding it kept was fixed. The question-pictures server now gives each ask page its own write token and serves every other file sandboxed, so no file under `.cache/view` can answer a page. Answers and its state files are written for the user alone. One broken `spec.json` no longer stops the server for every session.
- A failed send's retry can no longer send again later. Bulk answers make the same change as each question's own controls. New comment kinds are read without a restart. `wf doctor` and `wf view setup` now agree on the server entry.
- The server's code moved to `lib/view/`, and the page's script into parts under `lib/ask/browser/`.
- Nothing to change in a project. Rebuild any open ask page with `npx wf ask page`, and stop the old server with `npx wf view stop` so the new one starts.

### v0.50.0: ask pages, polished

- One layout for every ask page: a sticky header with who asked, the draft, the other waiting asks, and progress; an outline of the questions; answered ones folded to a line; and a footer with Send. A receipt after sending shows exactly what was sent.
- Keyboard first: J/K, 1–9, R, D, L, N, Enter to the next open question, Ctrl+K commands, Ctrl+Z undo, [ and ] between asks. Reviews add verdict keys that move to the next frame, comment mode for pins, and a filmstrip of verdict colours.
- The page's colours are Claude Desktop's tokens: it follows the installed Claude Desktop theme and offers every palette the app bundles, or one of six kit themes, each light and dark and checked for WCAG contrast. Nine accents or a colour of your own, four text sizes, and two densities.
- Each question is a card, with Sections, Lines, and Bands as other ways to set them apart. Expand all, Collapse all, Fold answered, and Select all above the questions. Folding, menus, dialogs, the send panel, the receipt, and moving between frames are animated, and still for reduced motion.
- `wf ask page` refuses over-long wording; `explain: true` on a question gives its reasons room.
- Nothing to change in a project. Rebuild any open ask page with `npx wf ask page`.

### v0.49.1: many sessions ask at once

- The `question-pictures` server is now one per machine, started on its own by `wf ask page` or `wf design annotate` and kept running apart from any session. Each project or worktree is served at `http://127.0.0.1:8765/<key>/`, so two sessions, projects, or worktrees no longer clash on the port or open each other's pages.
- `http://127.0.0.1:8765/` is an inbox of every ask, waiting first, with the repository, branch or worktree, and session that asked. A page another session still waits on is not replaced without `--replace`.
- Nothing to change in a project. Rebuild any open ask page with `npx wf ask page`, since its address now has the project's key. `npx wf view stop` stops the server.

### v0.49.0: ask pages

- `wf ask` builds a page of questions from a JSON spec and one of eleven templates: decision, batch, compare, frame review, storyboard, triage, rank, naming, test data, plan, and sign-off. It has no four-question limit; every option says what it means, choices carry a recommendation, and a bulk bar answers many at once. Pictures have boxes, pins, paging, and swipe, onion-skin, and difference compares. A project may add templates of its own, as data, in `.workflow/ask-templates/`. The answers come back to the agent through `wf ask wait`.
- The `question-pictures` server is now `npx wf view serve`, which takes the answers. Run `npx wf view setup` to replace the old python entry in `.claude/launch.json`, then restart that server in the browser pane. `wf doctor` checks it.
- Run `npx wf docs sync`: AGENTS.md's asking rules send more than four questions, or any visual question, to an ask page, and `asking.md` gains an Ask pages section.

### v0.48.2: a page shot that takes more than one window is joined again

- On the tauri kind, a `page <file>` step that needed more than one window, such as `wf screens`' narrow picture with the stress look, failed with `sh is not a function`: the part files were written, but the step that joins them with ImageMagick was handed a driver with no `sh`. The join now uses the kit's own.
- Nothing to change in a project. A screen run that skipped its narrow-stress pictures can shoot them again; leftover `*.part<N>.png` files under `.cache/screens/` can be deleted.

### v0.48.1: the review gate passes with the ledger edit committed

- `wf done chunk` and a chunk-end screen review passed only when the ledger's `Last reviewed` or `Deferred` line named HEAD itself, so committing the ledger edit with the chunk, as the `code-review-ledger` skill says, always failed the gate. They now also pass when the named commit is on HEAD's history and every commit after it changes only `logs.ledger` or `logs.ledgerClosed`. A change to any other file after it still needs another run or a deferral.
- Nothing to change in a project. Commit the ledger edit with the chunk, as the skill says; a ledger edit left uncommitted to get past the gate can now be committed.

### v0.48.0: test data in one-screen tables, a story check, and project kinds

- The `test-data-designer` has a `check` mode that returns only gaps and contradictions, as questions for the story's owner. Its rules, gaps, checks, and fixtures come back as tables with rule IDs and a category, and a flow area too long for one screen becomes a folder of one-screen files. Edge-case fixtures go only to stories with a `Risk: high (<why>)` line.
- The formats are in a new synced doc, `test-data-formats.md`, which the designer may read, with the kit's eight rule categories. A project adds its own in `testdata.categories`, each `{ name, use }`.
- `kind` names what the project is, `app` by default, and an area can set its own. `project-kinds.md` describes each kind, and Step 0 source analysis, outside registers, and packs for a domain product. Nothing else reads the kind yet but the designer.
- `wf doc:check` takes one index row for a folder's README that links its files, and fails a story's `Risk:` line that says neither high nor low. It warns for a test-data file past `testdata.limits.lines` (40), a flow area past `testdata.limits.areaKB` (40), a rules table's category on no list, an input class listed twice, a fixture that reaches `unit`, and fixtures past `testdata.limits.fixtures`. List files not yet split in `testdata.limits.loose`.
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
