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
| `wf doc:check` | Links, the index (where a folder's README row stands for the files it links), story IDs and Risk lines, chunk tables, block length, dates after today, the kinds, and the project's extensions. It warns, without failing, for a test-data file past a page, a flow area past its size or small enough for one file, an ID without its area prefix, and a rule category on no list |
| `wf config` | The project's settings over the defaults, with reasons |
| `wf ai:sync`, `wf ai:check` | OpenCode agents and slash commands generated from the project's and the kit's, and the skill paths in `opencode.json` |
| `wf scan full \| diff <since> [--light]` | The review's scans, from `review.scans` in the config, into `.cache/review-scan`, with the scope list and the diff |
| `wf ledger <arguments>` | Changes the review ledger through `ledger.py` |
| `wf docs sync` | Writes the kit's workflow docs into `docs/workflow/` and its `AGENTS.md` and `CLAUDE.md` into the root, keeping the project's parts between each `wf:local` pair and filling `{{config}}` values and the Who decides block. Rewrites the docs index's `wf:index` tables (words, workflow, logs) |
| `wf testdata <step> <area> ...` | The project's test-data steps (route, stale, covered, index, journeys, e2e-files, refresh-close), from `testdata.commands`; and the kit's own `trace [area]` (spec rows no code names, and tests that name no row or story) `ids <area>` (an ID for every check without one), and `rename-ids [area] [--write]` (old IDs qualified with the area's prefix), and `merge <folder>` / `fold <file> <sibling>` (fewer files, every row kept) |
| `wf id <ID> [--all]` | What an ID is, where it is defined, and each line that cites it, in docs and code; the patterns are in `docs/workflow/ids.md` |
| `wf ask templates \| example \| page \| wait \| answers \| record \| export \| import \| live \| reply \| history` | Ask pages: any number of questions on one page in the browser pane, from twelve templates or the project's own in `.workflow/ask-templates/`, with pictures, boxes, pins, compare views, paging, bulk answers, and colour themes. `wait` blocks until the answers are sent and prints them; `record` writes "Later" answers and marked decisions to the logs; `export` makes one offline HTML file; `live` updates a status page while a step runs, `reply` answers under a question, and `history` lists every round sent. The `ask-page` skill has the spec |
| `wf view serve \| stop \| setup` | The shared `question-pictures` server: one per machine on 127.0.0.1, serving each project's `.cache/view` at its own key, with an inbox of every ask at `/`, and taking answers with a per-run token. `serve` starts or joins it, `stop` ends it, `setup` writes it into `.claude/launch.json` |
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

The review module's `structure-scan.py` is the scan for a Rust and TypeScript project, including tests of one shape that one table could hold; another stack lists its own under `review.scans.structure`.

A project adds its own checks and status lines with `extensions` in its config: modules that export `checks(context)` and `status(context)`.

## Upgrading

Each kit version that changes a project's own files says what to do here. After any upgrade, run `npx wf docs sync` and `npx wf doctor`.

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
