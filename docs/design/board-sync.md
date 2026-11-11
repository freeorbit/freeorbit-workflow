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
- **Views.** Two, which `wf board setup --create` makes, each a table grouped by its column: Build and Client review. monday's API makes no Kanban, so a Kanban of each is added by hand once. The product is monday Work Management, so there are no native sprints; the chunk column stands in for one.

| Column | Type | From |
| --- | --- | --- |
| Story ID | Text | The story heading's ID; how sync finds the item |
| Area | Text | The area's id |
| Build | Status | The build order, below; its last step is Built, not Done |
| Chunk | Text | The chunk rows that list the story, such as `CH-01-fe, CH-01-be` |
| Story | Long text | The "As a…" sentence only, so it reads on the Kanban card |
| PR | Link | The pull request of the story's lane finished last, as in [PR links](#pr-links) |
| Owner | People | Assigned by hand on the board. `wf board setup` makes it, and sync never reads or writes it |
| Client review | Status | The client's and the team's say, as in [Client review](#client-review). `wf board setup` makes it once, and sync never reads or writes it |
| Frames | File | Every frame picture whose screen-list row names the story, in order, as in [Frames](#frames). Sync owns it, while `board.show.frames` is on |

### Client review

Build says what the repo knows: whether a story is built. Whether the client accepts it is theirs to say, so it has a column of its own.

- **Made once.** `wf board setup --create` makes it with starter labels, `board.reviewLabels`: Not ready, Ready for review, Approved (marked done), and Changes requested.
- **Then the people's.** Setup checks only that it is there and is a status column. The team and the client add labels as they need, and setup never checks them.
- **Never synced.** Sync never reads or writes it, not even a starting value, and a missing one never stops a sync, as with Owner.

### Acceptance comment

The acceptance lines go in the item's first comment, pinned, where a list reads better than a text column.

- **Shape.** The bot's line to readers in a quote block starting with 🤖, a bold "Acceptance criteria" heading, the "As a…" sentence, then one bullet per acceptance line, as written.
  - The owner chose the quote block from three styles tried on the test board on 2026-11-11.
  - Sync compares the comment's words and its tags, without their attributes, so a new layout with the same words still reaches the board.
- **The line to readers.** "I'm Orbit, and I keep this list matched to the project's records. Edits here get replaced, so for a question or a change, just reply below and the team will pick it up." The name is `board.bot.name`.
- **Pinned.** `pin_to_top` keeps it above every client comment.
- **Kept current.** Sync finds it as the bot's top-level comment with a line that is the heading, "Acceptance criteria" or the older "🤖 Acceptance criteria", and changes it with `edit_update` only when the lines differ, so a story change never posts a new comment.
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
- **No Kanban from the API.** `create_view` offers table, form, dashboard, and app views (checked again 2026-11-11). `create_view_table` takes `settings.group_by.conditions`, so setup makes the Build and Client review views as tables grouped by their columns, and a Kanban is made by hand once. `wf board setup` only checks it is there.
- **The done label.** A new status column marks label 1 as done (`done_colors`). `wf board setup` sets Done as the done label, which the trial did not try.

## Status

A story's status comes from the build order: once any of its lanes has started, it is In progress until every lane is done.

| Status | When |
| --- | --- |
| Drafting | The area's Stories step in the Areas table is not Done |
| Backlog | No chunk row, open or done, lists the story |
| Planned | Every row that lists it is Not started |
| In progress | A row has started or finished, and another is In progress or Not started |
| Checking | Every row is Waiting or done, and one is Waiting |
| Built | Every row that lists it is in `chunks-done.md`. Whether the client approves is Client review's, not this |

- **Started means In progress.** A story in `CH-01-fe` (done) and `CH-01-be` (Not started) is In progress, since work on it is under way.
- **Planned means no lane has started.** A story moves out of Planned when its first lane does.
- **The reader.** `chunkRows()` and `areaRows()` in `lib/docs/shape.mjs` already read these tables. A new story reader adds each story's title, `##` group, text, and Removed note, which nothing reads today.

## Commands

All in the core plugin, beside `wf question` and `wf decision`.

| Command | What it does |
| --- | --- |
| `wf board plan` | A dry run: each item it would create, change, or retire, with the fields that differ. Needs the token to read the board, never to write |
| `wf board sync` | Finds each item by its Story ID column and writes only the fields that changed. Runs in CI on every merge to `main` |
| `wf board setup` | Checks the board's columns and status labels against the config, and creates what is missing on a yes |
| `wf board feedback [--json]` | Lists client comments with no bot reply after them, and apart, those edited after they were logged. No state is kept in the repo: the reply marks a comment handled |
| `wf board reply <id> <Q-ID ...>` | Posts the bot's reply naming the open questions a comment was logged as, in its thread. Refuses a Q-ID not in the open questions log |
| `wf board reply <id> --noted` | Posts the bot's "noted" reply to a comment that needs no question, so it stops showing as new |
| `wf board reply <id> --answered <Q-ID>` | Posts the bot's thanks to a client's answer to one of the team's questions |
| `wf board reply <id> … -- <id> …` | Several replies in one batch, each checked before the first is posted |

- **One batch, one full reply an item.** monday's reads lag its writes, so separate calls could each give an item the full first reply. A batch knows what it posted, and gives the rest on that item the short form.

- **The `board-feedback` skill.** Run only as `/board-feedback`, since it posts to the client.
  - It drafts each comment as a question to log, with its Needs role from `decisions` and chunk `none` by default, or as noted.
  - It shows the whole batch in chat, and on a yes runs `wf question add … "client (monday)" <story>`, then one `wf board reply` with every reply.
- **Finding feedback.** A comment, or a reply under the acceptance comment, is a client's when its creator's `kind` is `guest`, as the trial showed.
  - monday's threads are one level deep, so a comment is handled when a bot reply sits in its thread after it. A later guest comment there is new again.
  - A comment whose `updated_at` is after its bot reply is listed as edited, with the Q-IDs the reply named, and is never logged twice.

### Frames

Each story's item holds the design frames that show it, so the client sees the screens beside the story.

- **Which.** Every row of a screens.md table headed Frame whose Stories name the story, in screen-list order. A table headed Screen has no picture.
- **The picture.** `<design.review>/<area>/<section>/<frame>.png`, found under its area. Only a .png inside `design.review` is read, never through a link, and one over `board.frameMaxBytes` is skipped with a note.
- **Kept in step.** Each upload is named `<frame>.<sha8>.png`, from the picture's sha256. When the names on the item differ from the wanted ones, in set, order, or content, sync clears the column and uploads the set again.
- **In plan.** `frames  APP-01 3 to upload (sign-in, sign-in-wait, home)`, `frames  APP-02 clear` when no frame names it any more, and a `skip` note for a frame with no picture.
- **Cost.** An upload took 2 to 3 seconds and about 100,000 complexity on 2026-11-11, so about 100 a minute; a clear, 30,000. monday removes cleared files from the item.

### Delivery notes and client questions

Sync speaks for the team on two more things, each on its `board.show` switch.

- **Delivery notes.** When a story's Build first reaches Built, sync posts a note on its item with the For the client sentences of its done chunks, deduped, in order.
  - Each chunk's sentence is the done list's "For the client" cell, written at chunk end. An empty cell, as on chunks done before v0.36.0, announces nothing.
  - The note ends with its chunks, such as "(CH-01)", so each is announced once, and a story a later chunk builds again gets a note for that chunk alone.
- **Client questions.** An open question whose Needs is `client` is asked once on each story its Story cell names, found again by its Q-ID. One with Story `none` is not posted; plan says so.
  - A guest's reply in that thread is listed by `wf board feedback` as the answer to its Q-ID, and the skill suggests resolving the question, not a new row.
  - A client question never holds a merge: `wf signoffs` skips it.
- **In plan.** `note    APP-01 delivered (CH-01)` and `ask     APP-02 Q-012`, then sync posts them after each item's own changes.

### The bot

The bot posts with the owner's token, so it signs as a helper of its own, friendly, in the background, and polite.

- **Its name.** `board.bot.name`, "Orbit" by default, in every reply and the pinned comment's line.
- **Logged.** "🤖 Hi, I'm Orbit. Thanks for raising this! I've added it to the project's list as Q-012, and someone from the team will reply here soon."
- **Noted.** "🤖 Orbit here. Thanks, the team has seen this. Nothing to add to the list for this one, but every comment gets read."
- **Built.** "🤖 Hi, I'm Orbit. Good news: this story is built." Then the story's For the client sentences, "Have a look, and set Client review when you're ready.", and its chunks, such as "(CH-01)".
- **Asking.** "🤖 Hi, I'm Orbit. The team has a question for you (Q-012): <question> Just reply here."
- **Thanks for an answer.** "🤖 Orbit: thanks! Your answer to Q-012 is with the team."
- **Short after the first.** Those are its first word on an item. Once the item holds anything from Orbit but the pinned comment, a reply, a note, or a question, later ones there are short, so a busy item is not flooded:
  - Logged: "🤖 Orbit: thanks! Logged as Q-013, the team will reply here."
  - Noted: "🤖 Orbit: thanks, the team has seen this."
  - Built: "🤖 Orbit: built!" Then the sentences, "Set Client review when you're ready.", and the chunks.
  - Asking: "🤖 Orbit: a question from the team (Q-012): <question> Just reply here."
  - It is worked out from the board each run, with no state in the repo, and a second item's first word is full again.
- **Quiet.** Its replies and delivery notes sit in a quote block, which monday shows grey and italic, like the pinned comment's line. Only a question to the client is plain, so it stands out and gets answered.
  - A delivery note posted plain, before v0.36.1, is edited into the quote in place, its words kept, found by its chunks; plan shows `note    APP-01 restyle delivered (CH-01)`.
- **One place.** All of its words are in the kit's `lib/board/voice.mjs`, with tests.
- **Found by its marker, not its words.** A bot reply is one by the token's user that starts with 🤖, and the pinned comment is the bot's comment with the heading line. So the wording can change without breaking either.
- **Testing.** Each command takes an injected `fetch`, as `wf doctor` takes an injected `gh`, so tests run on fixture Markdown and recorded responses, never the network.

## Config

An optional `board` section; a project without it has no board commands.

| Key | Default | Meaning |
| --- | --- | --- |
| `board.provider` | `"monday"` | The only provider for now |
| `board.boardId` | `""` | The client's shareable board's number, from its address |
| `board.tokenEnv` | `"MONDAY_API_TOKEN"` | The environment variable holding the token, a name such as `MONDAY_API_TOKEN`. The token is never in config |
| `board.bot.name` | `"Orbit"` | The name the bot signs with |
| `board.apiVersion` | `"2026-10"` | The monday API version every call sends |
| `board.branch` | `"main"` | The branch whose pushes run the board-sync workflow |
| `board.environment` | `"board"` | The GitHub Environment holding the token, limited to `board.branch` |
| `board.columns` | the six above | Each field's column id on the board, filled by `wf board setup` |
| `board.titles` | the titles above | Each column's title, which `wf board setup --create` gives it. A board from monday's project template already has a Status, so its own is titled another way, such as "Story status" |
| `board.statuses` | the six above | Each status's label text on the board. The last, `done`, is "Built" |
| `board.columns.clientReview`, `board.titles.clientReview` | `"client_review"`, `"Client review"` | The Client review column, never synced |
| `board.reviewLabels`, `board.reviewDone` | the four above, `"Approved"` | Client review's labels when setup makes it, and the one marked done |
| `board.show.deliveryNotes` | `true` | A note on each story's item when its Build first reaches Built, from the done list's For the client cells |
| `board.show.frames` | `true` | The Frames column and its pictures; off, sync neither checks the column nor uploads. Later, a screenshot of the built screen |
| `board.columns.frames`, `board.titles.frames`, `board.frameMaxBytes` | `"frames"`, `"Frames"`, 5,000,000 | The Frames column, and the largest picture uploaded |
| `board.show.clientQuestions` | `true` | Open questions the client answers, as updates on their stories |
| `board.show.analysisSamples` | `false` | Synthetic analysis output, for a product that makes it |

- **The client board.** Guests reach only a shareable board (`board_kind` `share`), and making one may need the account's admin.
  - For Atlas NX, the owner asks the restivegroup.monday.com admin for one and invites the client there as a guest; `boardId` points at it.
  - The throwaway test board stays for developing the commands.
- **Each extra can be switched off.** The `show` keys are separate so a client sees only what the owner chose.
- **`client` as a Needs value.** Open questions allow `client` in Needs, meaning the client answers on the board.
  - A client question never blocks a merge: `wf signoffs` skips rows whose Needs is `client`.
  - When one truly blocks a chunk, the team adds its own row, with the owner in Needs, to chase the answer.

## Token and where sync runs

- **The token.** The owner's personal monday API token, named by `board.tokenEnv`: a local environment variable, and in CI a secret of the `board.environment` GitHub Environment, never a repository-wide secret.
- **Why an environment.** A repository secret is readable by a workflow on any branch a team member pushes. An environment whose deployment branches are only `board.branch` is not.
- **CI.** `wf github sync` writes `.github/workflows/board-sync.yml` while `board.boardId` is set, and removes it when it is emptied.
  - It runs `wf board sync` on each push to `board.branch`, and by hand.
  - It reads with `contents: read` only, and queues runs in one `concurrency` group, so two merges never sync at once.
  - The secret reaches only the sync step. With none, the step fails naming the environment to add it to.
- **No pull-request runs.** `wf board plan` runs locally, never in a pull request's checks, where a branch could change the workflow and print the token.
- **Never logged.** The token goes only into the Authorization header. No command prints it, and errors leave it out.

### PR links

The PR column links the pull request of the story's lane finished last, from git history.

- **From the done list's history.** A chunk's pull request is the squash commit that added its row to `chunks-done.md`, whose subject ends `(#N)`; a merge commit's `Merge pull request #N` counts too.
  - So `wf board plan` shows the same links locally, every past chunk has one, and CI needs no GitHub permission for them.
  - CI checks out the whole history (`fetch-depth: 0`) for it.
- **Which one.** Once any lane of a story is done, the link is that of its lane finished last, such as `#12` for Atlas's CH-01.
- **Never cleared.** A chunk merged by rebase has no number, and a run with no repository address finds none. Sync then leaves the cell as it is.
- **The address.** GitHub Actions' `GITHUB_SERVER_URL` and `GITHUB_REPOSITORY` in CI, else the `origin` remote.

### Turn it on

For a project on the kit, once its stories are ready for the client.

1. Ask the monday account's admin for a shareable board, and invite the client there as a guest.
2. Set `board.boardId` in `.workflow/config.json` to the board's number, from its address.
3. With the token in `MONDAY_API_TOKEN`, run `npx wf board setup --create`.
   - A column it says can't be set on items belongs to a portfolio, such as a project template's status. Point `board.columns` at an id of the project's own, with its title in `board.titles`, and run it again.
   - Then add a Kanban view grouped by Build, and one by Client review, on the board by hand, if cards suit better than the tables setup makes.
4. Run `npx wf board plan`, and check what it would write.
5. In GitHub, create the `board` environment, set its deployment branches to `main` only, and add `MONDAY_API_TOKEN` to it as a secret.
6. Run `npx wf github sync`, and merge the workflow it writes. The merge runs the first sync.

`wf github` writes files only, so step 5 is by hand, or with `gh`:

```bash
gh api -X PUT repos/{owner}/{repo}/environments/board -F "deployment_branch_policy[protected_branches]=false" -F "deployment_branch_policy[custom_branch_policies]=true"
gh api -X POST repos/{owner}/{repo}/environments/board/deployment-branch-policies -f name=main -f type=branch
gh secret set MONDAY_API_TOKEN --env board
```

## What never goes on the board

The board shows stories, not the project's internals.

- **On the board.** The "As a…" sentence and the acceptance lines as written, status, chunk, the pull request link, and the extras `show` turns on.
- **Never.** The threat model, review findings, SEC rules, decisions, test-data specs, and anything under `docs/research/`.

## Risks

- **Text over 2,000 characters.** monday cuts a long-text column with no error.
  - Only the "As a…" sentence goes there now, far under the limit; `wf board plan` and `sync` still fail one over it by name.
  - The acceptance comment's own limit is unknown. If a story's list ever exceeds it, the fallback is a Doc column.
- **A client edits the acceptance comment.** The next sync overwrites it, as the comment itself warns. `wf board plan` lists the edit first, so it is seen.
- **Multi-level boards.** A board from monday's project template has `hierarchy_type` `multi_level` (developer.monday.com/api-reference/docs/status).
  - Its status columns roll up child items (`calculated.function` `COUNT_KEYS`). monday then leaves the column out of every item's `column_values`, and accepts a write to it and drops it.
  - `wf board setup` reports the rollup, and `--create` clears it with `calculated: null`, the template's own Status and any status column it makes alike. Then the column reads and writes as a plain status.
  - Atlas NX's board showed it on 2026-11-11: with the rollup off, its `project_status` took and read back "Done".
- **monday's reads lag its writes.** Atlas NX's first sync failed "Update not found" pinning a comment it had just posted (2026-11-11).
  - Each call on a group, item, or comment made a moment ago retries after 0.5, 1, 2, and 4 seconds, then fails naming the wait.
  - A value monday leaves empty on create is sent again at once, and a comment left unpinned is pinned on the next run, which `wf board plan` shows as `pin acceptance`.
- **Edits may notify.** An `edit_update` may notify the item's followers. Stories change only in the repo, so edits are rare, but what monday sends is not checked.
- **Whole-board permissions.** A guest sees every item and column of a shareable board, and every update on it.
  - The client board holds stories only, as in "What never goes on the board", and the team talks about internals elsewhere.
  - Making a shareable board may need an admin; the owner is asking theirs, as in "The client board" under Config.
- **One person's token.** The bot acts as the owner, so every reply and change shows their name, and it stops when they leave. A service account would fix both, at the cost of a seat.
- **API versions.** monday retires a version about a year after it is current. `board.apiVersion` pins one, and `wf doctor` warns when monday lists it as deprecated.
- **A guest edits the board.** One way means sync overwrites a guest's change to a synced column on the next run. `wf board plan` lists each such change first, so it is seen, not lost silently.

## Build order

1. The trial against a test board, in this doc.
2. The story reader, and `wf board plan` and `sync`, tested with fixtures and a fake fetch. Built in v0.32.0, with `wf board setup`, and run against the test board.
3. The CI workflow, through `wf github`, and the PR column from git history. Built in v0.33.0; the workflow is checked by tests only until a project turns it on.
4. `wf board feedback`, `wf board reply`, and the `board-feedback` skill. Built in v0.34.0; the guest path is checked by tests, since the token's own user posts as a member.
5. Frames, then screenshots of the built screens.
