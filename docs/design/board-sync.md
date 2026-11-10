# Board sync design

How the kit will show a project's stories on a monday.com board for its client, before any `wf board` code exists. The kit's developers read it; the parts a project needs move into a workflow doc as each is built.

## Direction

The repo is the source of truth, and the board only shows it.

- **One way.** `wf board sync` pushes stories to the board. Nothing on the board edits a story, a chunk, or a status.
- **Client comments come back as questions.** A comment on an item becomes an open-questions row, `From` `client (monday)`, through `wf question add`. It never edits the story.
- **Nothing is deleted.** A story marked Removed in its story file moves to a "Retired" group, with its item kept.

## The board

One item per story, grouped the way the story file groups them.

- **Item.** Named `<ID> · <title>`, such as `APP-01 · Sign in with work email and password`.
- **Group.** The area and the story file's `##` heading, such as `App · Sign in`. Retired items sit in "Retired".
- **View.** A Kanban view by Status. The product is monday Work Management, so there are no native sprints; the chunk column stands in for one.

| Column | Type | From |
| --- | --- | --- |
| Story ID | Text | The story heading's ID; how sync finds the item |
| Area | Text | The area's id |
| Status | Status | The build order, below |
| Chunk | Text | The chunk rows that list the story, such as `CH-01-fe, CH-01-be` |
| Story | Long text | The "As a…" sentence only, so it reads on the Kanban card |
| PR | Link | The pull request of the chunk that finished the story |

### Acceptance comment

The acceptance lines go in the item's first comment, pinned, where a list reads better than a text column.

- **Shape.** A bold "🤖 Acceptance criteria" heading, a line asking readers not to edit it, the "As a…" sentence, then one bullet per acceptance line, as written.
- **The line to readers.** "Kept in the project repo and updated automatically by the workflow bot. Please don't edit this comment: any change here is overwritten. For a question or a change, reply below."
- **Pinned.** `pin_to_top` keeps it above every client comment.
- **Kept current.** Sync finds it by its heading among the bot's updates and changes it with `edit_update` only when the lines differ, so a story change never posts a new comment.
- **Replies are feedback.** A guest's reply under it counts as a client comment, the same as one on the item.

## Trial

A run on 2026-11-10 against a throwaway board, as the owner's own token, at API version `2026-10`, the current one.

| Question | Finding |
| --- | --- |
| Plan tier | `pro`, from `account { tier }`<br>• `account { plan }` is null for a non-admin, so read `tier` |
| Guest access | Works on this account: `users(kind: guests)` lists two, each with `kind` `guest`<br>• Guests reach only a shareable board (`board_kind` `share`); the test board is `public` |
| Long text | 2,000 characters, counted as code points<br>• Longer text is cut to 2,000 with no error<br>• APP-01, the longest story, is 1,581 and came back exact, line breaks kept |
| Columns | `create_column` made each with a chosen id: `story_id`, `area`, `chunk`, `story`, `pr`, `wf_status`<br>• Status labels come from `defaults` |
| Item | `create_item` with all columns at once, then `change_multiple_column_values` to update |
| Find by Story ID | `items_page_by_column_values` on `story_id` found the item, with its group and columns |
| Replies | `create_update` with `parent_id` posts a reply; `updates { creator { kind } replies { … } }` reads them back |
| Acceptance comment | An HTML `create_update` shows a bold heading and a real bulleted list<br>• `pin_to_top` pinned it, and `edit_update` changed it in place<br>• APP-01's came to 1,800 bytes; a comment's own limit was not found |
| Rate limits | `ratelimit` and `ratelimit-policy` headers: 3,335 requests a minute, 200 at once, 10,000,000 complexity a minute<br>• The `complexity` field gives each query's cost |

- **The bot is the owner.** With a personal token, the bot's reply has the owner as creator, `kind` `member`. Feedback cannot tell the bot by its creator, so a comment is handled when a reply under it starts with the 🤖 marker.
- **A client comment is a guest's.** `creator { kind }` is `guest` for a client and `member` for the team, so the team's own comments are never logged as client questions.
- **An unknown label fails loudly.** With `create_labels_if_missing: false`, a label the column lacks is a `ColumnValueException` listing the labels it has. Sync always sends that flag, so the board's labels stay the config's.
- **Errors come back as HTTP 200.** A failed call has a 200 status and an `errors` list, so the client checks the body, not the status.
- **A column update is costly.** Each `change_multiple_column_values` cost about 30,000 complexity, so a minute holds about 330. A project's stories fit, but sync sends only the items that changed.
- **No Kanban from the API.** `create_view` offers table, form, dashboard, and app views. The Kanban view is made by hand once, and `wf board setup` only checks it is there.
- **The done label.** A new status column marks label 1 as done (`done_colors`). `wf board setup` sets Done as the done label, which the trial did not try.

## Status

A story's status comes from the build order, and the least-finished lane wins.

| Status | When |
| --- | --- |
| Drafting | The area's Stories step in the Areas table is not Done |
| Backlog | No chunk row, open or done, lists the story |
| Planned | Every row that lists it is Not started |
| In progress | Any row that lists it is In progress |
| Checking | No row is In progress, and one is Waiting |
| Done | Every row that lists it is in `chunks-done.md` |

- **Least finished wins.** A story in `CH-01-fe` (done) and `CH-01-be` (In progress) is In progress.
- **Mixed done and not started.** A story with one lane done and one Not started is Planned, since work on it is not under way.
- **The reader.** `chunkRows()` and `areaRows()` in `lib/docs/shape.mjs` already read these tables. A new story reader adds each story's title, `##` group, text, and Removed note, which nothing reads today.

## Commands

All in the core plugin, beside `wf question` and `wf decision`.

| Command | What it does |
| --- | --- |
| `wf board plan` | A dry run: each item it would create, change, or retire, with the fields that differ. Needs the token to read the board, never to write |
| `wf board sync` | Finds each item by its Story ID column and writes only the fields that changed. Runs in CI on every merge to `main` |
| `wf board setup` | Checks the board's columns and status labels against the config, and creates what is missing on a yes |
| `wf board feedback` | Lists client comments with no bot reply under them. No state is kept in the repo: the reply marks a comment handled |

- **The `board-feedback` skill.** For each real question in `wf board feedback`, it runs `wf question add <chunk \| none> "…" <needs> "client (monday)" <story>`, then replies on the item.
- **The reply says it is automated.** For example: "🤖 Logged automatically by the project workflow bot as Q-012 in the project repo. The team will answer here."
- **Finding feedback.** A comment, or a reply under the acceptance comment, is a client's when its creator's `kind` is `guest`. It is handled when a reply under it starts with the 🤖 marker, as the trial showed.
- **Testing.** Each command takes an injected `fetch`, as `wf doctor` takes an injected `gh`, so tests run on fixture Markdown and recorded responses, never the network.

## Config

An optional `board` section; a project without it has no board commands.

| Key | Default | Meaning |
| --- | --- | --- |
| `board.provider` | `"monday"` | The only provider for now |
| `board.boardId` | `""` | The board's number, from its address |
| `board.tokenEnv` | `"MONDAY_API_TOKEN"` | The environment variable holding the token. The token is never in config |
| `board.apiVersion` | `"2026-10"` | The monday API version every call sends |
| `board.columns` | the six above | Each field's column id on the board, filled by `wf board setup` |
| `board.statuses` | the six above | Each status's label text on the board |
| `board.show.deliveryNotes` | `true` | An update on each story's item when its chunk is done, from `chunks-done.md` |
| `board.show.frames` | `true` | The frame PNG on the item, later a screenshot of the built screen |
| `board.show.clientQuestions` | `true` | Open questions the client answers, as updates on their stories |
| `board.show.analysisSamples` | `false` | Synthetic analysis output, for a product that makes it |

- **Each extra can be switched off.** The `show` keys are separate so a client sees only what the owner chose.
- **To confirm: `client` as a Needs value.** Open questions would allow `client` in Needs, meaning the client answers on the board. Today Needs is a role from `roles`, and `wf signoffs` treats every chunk row as waiting on one.

## Token and where sync runs

- **The token.** The owner's personal monday API token, kept as a GitHub Actions secret and a local environment variable, named by `board.tokenEnv`.
- **CI.** `wf github` writes a workflow that runs `wf board sync` on every merge to `main`. `wf board plan` runs locally.
- **Never logged.** The token goes only into the Authorization header. No command prints it, and errors leave it out.

## What never goes on the board

The board shows stories, not the project's internals.

- **On the board.** The "As a…" sentence and the acceptance lines as written, status, chunk, the pull request link, and the extras `show` turns on.
- **Never.** The threat model, review findings, SEC rules, decisions, test-data specs, and anything under `docs/research/`.

## Risks

- **Text over 2,000 characters.** monday cuts a long-text column with no error.
  - Only the "As a…" sentence goes there now, far under the limit; `wf board plan` and `sync` still fail one over it by name.
  - The acceptance comment's own limit is unknown. If a story's list ever exceeds it, the fallback is a Doc column.
- **A client edits the acceptance comment.** The next sync overwrites it, as the comment itself warns. `wf board plan` lists the edit first, so it is seen.
- **Edits may notify.** An `edit_update` may notify the item's followers. Stories change only in the repo, so edits are rare, but what monday sends is not checked.
- **Whole-board permissions.** A guest sees every item and column of a shareable board, and every update on it.
  - The client board holds stories only, as in "What never goes on the board", and the team talks about internals elsewhere.
  - Making a shareable board may need an admin; the owner is not one. Not tried.
- **One person's token.** The bot acts as the owner, so every reply and change shows their name, and it stops when they leave. A service account would fix both, at the cost of a seat.
- **API versions.** monday retires a version about a year after it is current. `board.apiVersion` pins one, and `wf doctor` warns when monday lists it as deprecated.
- **A guest edits the board.** One way means sync overwrites a guest's change to a synced column on the next run. `wf board plan` lists each such change first, so it is seen, not lost silently.

## Build order

1. The trial against a test board, in this doc.
2. The story reader, and `wf board plan` and `sync`, tested with fixtures and a fake fetch.
3. The CI workflow, through `wf github`.
4. `wf board feedback` and the `board-feedback` skill.
5. Frames, then screenshots of the built screens.
