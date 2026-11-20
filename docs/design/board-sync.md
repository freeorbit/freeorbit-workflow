# Board sync design

How the kit will show a project's stories on a monday.com board for its client, before any `wf board` code exists. The kit's developers read it; the parts a project needs move into a workflow doc as each is built.

## Direction

The repo is the source of truth, and the board only shows it.

- **One way.** `wf board sync` pushes stories to the board. Nothing on the board edits a story, a chunk, or a status.
- **Client comments come back as questions.** A comment on an item becomes an open-questions row, `From` `client (monday)`, through `wf question add`. It never edits the story.
- **Nothing is deleted.** A story marked Removed in its story file moves to a "Retired" group, with its item kept.
- **A removed line is left out.** An acceptance line marked Removed keeps its place in the story file, so no line's ID moves, and the pinned comment shows only the lines still promised.

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
| Owner | People | Assigned by hand on the board. `wf board setup` makes it, and sync never reads or writes it on a story. On a work item it is sync's, as in [Work items](#work-items) |
| Client review | Status | The client's and the team's say, as in [Client review](#client-review). `wf board setup` makes it once, and sync never reads or writes it |
| Frames | File | Every frame picture whose screen-list row names the story, in order, as in [Frames](#frames). Sync owns it, while `board.show.frames` is on |
| Built screens | File | The built app's picture of each screen-list row naming the story, once its Build is Built, as in [Built screens](#built-screens). Sync owns it, while `board.show.screenshots` is on |

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
- **A client comment is a guest's.** `creator { kind }` is `guest` for a client and `member` for the team, so the team's own comments are never logged as client questions, with two exceptions:
  - A member's reply in a thread where the bot asked one of the team's questions is the answer to it. The owner often holds the answer (Atlas NX, 2026-11-16).
  - A member's comment that starts with the bot's name and a colon, in any case, such as `Orbit: the client said on the call…`, is for the repo: a client's words relayed from a call or an email. Not `@Orbit`, which opens monday's mentions, and the bot is no monday user.
- **An unknown label fails loudly.** With `create_labels_if_missing: false`, a label the column lacks is a `ColumnValueException` listing the labels it has. Sync always sends that flag, so the board's labels stay the config's.
- **Errors come back as HTTP 200.** A failed call has a 200 status and an `errors` list, so the client checks the body, not the status.
- **A column update is costly.** Each `change_multiple_column_values` cost about 30,000 complexity, so a minute holds about 330. A project's stories fit, but sync sends only the items that changed.
- **No Kanban from the API.** `create_view` offers table, form, dashboard, and app views (checked again 2026-11-11). `create_view_table` takes `settings.group_by.conditions`, so setup makes the Build and Client review views as tables grouped by their columns, and a Kanban is made by hand once. `wf board setup` only checks it is there.
- **The done label.** A new status column marks label 1 as done (`done_colors`). `wf board setup` marks each status column's last label done: `board.statuses.done` (Built) on Build, and `board.reviewDone` on Client review. A board set up before v0.35.0 has Done there, renamed in place.

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
| `wf board plan` | A dry run: each item it would create, change, or retire, with the fields that differ, and each acceptance comment, delivery note, restyled note, and client question it would post or edit. Needs the token to read the board, never to write |
| `wf board sync` | Finds each item by its Story ID column and writes only the fields that changed. Runs in CI on every merge to `main` |
| `wf board setup [--create]` | Checks the board's columns and status labels against the config; with `--create`, it creates what is missing |
| `wf board feedback [--json]` | Lists client comments with no bot reply after them, and apart, those edited after they were logged. No state is kept in the repo: the reply marks a comment handled |
| `wf board feedback --brief` | Writes the same comments, with the config's role names and the board's story IDs, to `.cache/board/feedback.json` for the blind `feedback-reader` agent, and prints only what is not their words: IDs, stories, and who wrote each |
| `wf board drafts <file>` | Checks the reader's drafts against their shapes and prints each as a line, or every problem. Reads no board |
| `wf board reply <id> <Q-ID ...>` | Posts the bot's reply naming the open questions a comment was logged as, in its thread. Refuses a Q-ID not in the open questions log |
| `wf board reply <id> --noted` | Posts the bot's "noted" reply to a comment that needs no question, so it stops showing as new |
| `wf board reply <id> --answered <Q-ID>` | Posts the bot's thanks to a client's answer to one of the team's questions |
| `wf board reply <id> … -- <id> …` | Several replies in one batch, each checked before the first is posted |

- **One batch, one full reply an item.** monday's reads lag its writes, so separate calls could each give an item the full first reply. A batch knows what it posted, and gives the rest on that item the short form.

- **The `board-feedback` skill.** Run only as `/board-feedback`, since it posts to the client.
  - The session that runs it holds Bash and edits, so it never reads the comments (SB-3, SEC-MODEL). The core plugin's `feedback-reader` agent does: it reads only `.cache/board/feedback.json`, the guard refuses it every other file and tool, and it returns one draft a comment as JSON.
  - Each draft is a question to log, with its Needs role from `decisions` and chunk `none` by default, a note, or an answer to the Q-ID its comment replies to. `wf board drafts` checks each against its shape, the config's roles, and the board's story IDs before anything is logged or posted.
  - It shows the whole batch in chat, and on a yes runs `wf question add … "client (monday)" <story>`, then one `wf board reply` with every reply.
- **Finding feedback.** A comment, or a reply under the acceptance comment, is a client's when its creator's `kind` is `guest`, as the trial showed. A member's counts on the two exceptions above, marked `from: team`, and gets the bot's team wording: "logged as", "noted", or "noted as the team's answer to".
  - monday's threads are one level deep, so a comment is handled when a bot reply sits in its thread after it. A later guest comment there is new again.
  - A comment whose `updated_at` is after its bot reply is listed as edited, with the Q-IDs the reply named, and is never logged twice.

### Frames

Each story's item holds the design frames that show it, so the client sees the screens beside the story.

- **Which.** Every row of a screens.md table headed Frame whose Stories name the story, in screen-list order. A table headed Screen has no picture.
- **The picture.** `<design.review>/<area>/<section>/<frame>.png`, found under its area. Only a .png inside `design.review` is read, never through a link, and one over `board.frameMaxBytes` is skipped with a note.
- **Kept in step.** Each upload is named `<frame>.<sha8>.png`, from the picture's sha256. When the names on the item differ from the wanted ones, in set, order, or content, sync clears the column and uploads the set again.
- **In plan.** `frames  APP-01 3 to upload (sign-in, sign-in-wait, home)`, `frames  APP-02 clear` when no frame names it any more, and a `skip` note for a frame with no picture.
- **Cost.** An upload took 2 to 3 seconds and about 100,000 complexity on 2026-11-11, so about 100 a minute; a clear, 30,000. monday removes cleared files from the item.

### Built screens

Once a story is Built, its item also holds the built app's screens that show it, so the client sees what was made beside what was drawn.

- **Which.** Every screen-list row whose Stories name the story, Frame and Screen rows, in screen-list order. `board.screenshots.rows` `"framed"` keeps Frame rows only, if a story's count grows too long.
- **When.** Only while the story's Build is Built. A story not Built shows none, and one that held some, such as a reopened chunk's, is cleared.
- **The picture.** `<design.built>/<area>/<screen>.png`, committed, so CI's board sync can upload it. Only a .png inside `design.built` is read, never through a link, and `board.frameMaxBytes` applies.
- **Where it comes from.** `wf screens --accept` copies each screen's Default picture from that run, `<screen>-wide-default.png`, while the board shows screenshots.
  - Only screens shot in that run are copied, so the others keep their last accepted picture.
  - A screen no longer on the screen list, or no longer picked by `rows`, has its picture removed.
  - The pictures show synthetic test data only, as every screen run does.
- **Kept in step.** As with frames: `<screen>.<sha8>.png` names, and clear-and-upload on any difference. Plan says `screenshots APP-01 3 to upload (sign-in, home, deep-link)`, `screenshots APP-02 clear`, and a `skip` note for a row with no picture.

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

## Work items

Weeks of work can come before any story of an area can be built: profiling documents, rounds of questions with a domain expert, a trial, the architecture. Work items show that work to the client, so they see the complexity behind a short list of stories, and a step that waits on them has an item to reply on. Built in v1.8.0; Atlas NX's document-analysis area asked for it (2026-11-20).

- **One kind each.** A piece of work is on the board once, as a story or as a work item.
  - A **story** is a promise someone can check by using the product. It is unchanged.
  - A **work item** leaves behind knowledge, a decision, or a tool. It comes from the area's plan doc, never from a stories file.
- **Off by default.** A work item exists only for an area listed in `board.workItems.plans`. With none listed, nothing here runs and no query changes.
- **Why not by hand.** A trial on Atlas NX's board, a group with an item per phase and a pinned comment listing its steps, failed twice over.
  - The status sat in three places, the plan doc, the label, and the comment, kept in step by hand.
  - Three phases were "build these stories", so that work showed once as a phase and again as stories.

### The plan doc

One Markdown file per area, defined in the workflow's [writing-docs.md](../workflow/writing-docs.md#plan-docs), with a template in `templates/plan.md`. It holds only work that is not a story, and ends where the build order takes over.

- **A phase.** A `## Phase N. Title` heading, a one-sentence lead, and a table with one row per step. Other `##` sections, such as "Where we are", are the team's and never read.
- **A step row.** `ID`, `Step`, `Who`, and `Status`, with `Leaves behind` and `Unblocks` optional, in any order after `ID`.
  - `Step` is its number and text, such as `1.7 Get four sets of documents`, its number under the phase's.
  - `Status` starts with a status word, then, after a comma or colon, anything the client should read, such as `Later: after 1.7`.
- **The status words.** Done, Now (in hand), Next (can start once someone picks it up), Later (waits on an earlier step), and Waiting, always `Waiting on <name>`, for a step that waits on a person outside the work, such as the client.
- **Checked.** `wf doc:check` checks each listed plan doc's shape, and `wf board plan` refuses to write while any check fails.
  - The client reads the lead, the step text, Who, and Status, so none may hold an ID, a link, a backtick, or a file path: no decision or question IDs, no paths, no code names.
  - A story ID in a step's text fails too: a step that builds a story belongs to the build order, and one it unblocks names it under `Unblocks`. This is the one scripted check of "only work that is not a story"; it raises an alarm only where an ID would leak anyway.

### IDs

A step's ID is its own, `W-<prefix>-<nn>` (the owner's call, 2026-11-20), in the row's first cell, so `wf id` finds where it is defined. A phase's is `W-<prefix>-P<n>`, from its heading's number.

- **Kept when renumbered.** A step renumbered from 1.7 to 1.8 keeps its ID, so its item is renamed in place and the client's replies on it stay. An ID is never reused.
- **A phase keeps its number.** A new phase goes last.
- **Moving to another phase needs a new ID** on a multi-level board: monday's API at `2026-10` cannot move a subitem under another parent. `wf board plan` says so, and the old ID retires.

### On the board

- **One group per plan.** Titled by `board.workItems.group`, "<Area> · Behind the scenes", where `<Area>` is the name the area's stories' groups use.
- **Multi-level board.** Each phase is an item, and its steps are its subitems, made with `create_subitem`. Atlas NX's board is multi-level.
- **Flat board.** One group per phase, `<group> · Phase N. Title`, with the phase's item first and each step an item beside it.
- **A phase's item.** Named `Phase 1. Understand the documents`. Its Work status is worked out from its steps: Done when all are, else Waiting, Now, or Next when any step is, else Later.
- **The lead.** In the phase item's pinned comment, written by sync as the acceptance comment is: the bot's line to readers in a quote block, a bold "About this phase" heading, and the lead. Found by that heading, edited when it differs, pinned again when it is not.
- **A step's item.** Named by its `Step` cell. Its own columns:

| Column | Type | From |
| --- | --- | --- |
| Work ID | Text | The step's ID; how sync finds the item. Never the Story ID column |
| Work status | Status | The step's status word, as `board.workStatuses` labels it. Build stays for stories |
| Who | Text | The `Who` cell, as written |
| Status note | Text | The whole `Status` cell when it says more than its word, such as "Waiting on Glen: asked 2026-11-20" |
| Unblocks | Text | The `Unblocks` cell's story IDs, such as "ANL-03, ANL-04" |
| Owner | People | While the step is Waiting on someone in `board.workItems.people`, that person, so monday tells them. Otherwise empty |

- **Not shown.** `Leaves behind` is the team's: it names files and decisions (the owner's call, 2026-11-20).
- **Owner.** With `board.workItems.people` set, Owner on a work item is sync's: it puts in the waited-on person and takes them out when the step stops waiting, sending `null` to clear. Owner on a story stays the team's, never written.
- **Unblocks** names live stories only; `wf board plan` refuses one that is not (the owner's call, 2026-11-20).
- **Setup.** `wf board setup` checks and `--create` makes the Work ID, Work status, Who, Status note, and Unblocks columns while a plan is listed, with Work status's labels and Done marked done, and its rollup off on a multi-level board, as for Build.

### Sync

`wf board plan` and `sync` read each listed plan doc and treat its phases and steps as they treat stories.

- **Found by Work ID.** Across the board's items and, on a multi-level board, the subitems of every item with no Story ID, read 25 parents at a time with `items(ids:)`; a retired step is never a parent. Two items with one Work ID are a problem.
  - Only a Work ID of a listed area's shape counts, and feedback takes a Story ID or Work ID only in the kit's own shape. A guest can type into either column, and that text would otherwise move an item or reach a `wf question add` line.
  - A plan line shows board text cut to 60 characters, with control characters replaced, as a story's does.
- **The story sync cannot reach them.** It finds items by Story ID and skips one without, so its retire rule never moves a work item, and the work sync never touches an item with a Story ID.
- **Idempotent.** Only what differs is written: the name, each column, the group, the pinned lead.
- **Nothing written while a problem stands.** A plan doc that fails its checks, an Unblocks that names no live story, or a step moved under another phase stops the whole sync, stories too.
- **A run cut short** is finished by the next: each phase, step, and lead is found again by its Work ID or its heading.
  - A phase item left with no Work ID is still found by its steps' IDs, and its ID is set again.
- **Retired, never deleted.** A phase or step no longer in its plan doc moves to `board.retiredGroup`. A retired phase takes its steps with it.
  - On a multi-level board a retired step leaves its phase and becomes an item of its own in that group, as monday does with a subitem moved to another group. So a step put back in the doc needs a new ID, as one moved to another phase does.
- **In plan.** `create  W-ANL-07 1.7 Get four sets of documents  [under W-ANL-P1]`, `update  W-ANL-07  Work status: Now → Waiting`, `comment W-ANL-P1  add phase lead`, `retire  W-ANL-09  → Retired`, then a count of its own: `Work items: 3 to create, 1 to update, 1 lead comment, 0 to retire, 12 unchanged.`

### Replies

- **Feedback.** `wf board feedback` reads a comment on a work item, a phase's or a step's, as it reads one on a story, so the client can answer a blocker where it sits. The entry's story is the Work ID.
- **Logged against it.** An open question's Story cell takes a Work ID, so `wf question add … W-ANL-07` logs the reply against its step.
- **Not yet.** A client question naming a work item is not posted there; that waits for a project to ask for it.

## Config

An optional `board` section; a project without it has no board commands.

| Key | Default | Meaning |
| --- | --- | --- |
| `board.provider` | `"monday"` | The only provider for now |
| `board.boardId` | `""` | The client's shareable board's number, from its address |
| `board.tokenEnv` | `"MONDAY_API_TOKEN"` | The environment variable holding the token, a name such as `MONDAY_API_TOKEN`, also read from a gitignored `.env` at the repo root. The token is never in config |
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
| `board.show.frames` | `true` | The Frames column and its pictures; off, sync neither checks the column nor uploads |
| `board.columns.frames`, `board.titles.frames`, `board.frameMaxBytes` | `"frames"`, `"Frames"`, 5,000,000 | The Frames column, and the largest frame or screen picture uploaded |
| `board.show.screenshots` | `true` | The Built screens column and its pictures; off, sync neither checks the column nor uploads, and `wf screens --accept` copies nothing |
| `board.columns.screenshots`, `board.titles.screenshots` | `"built_screens"`, `"Built screens"` | The Built screens column |
| `board.screenshots.rows` | `"all"` | The rows a Built story's screens come from: `"all"`, or `"framed"` for Frame rows only |
| `design.built` | `"docs/design/built"` | Where `wf screens --accept` keeps each screen's built picture, as `<area>/<screen>.png` |
| `board.show.clientQuestions` | `true` | Open questions the client answers, as updates on their stories |
| `board.show.analysisSamples` | `false` | Synthetic analysis output, for a product that makes it |
| `board.workItems.plans` | `{}` | Each area with a plan doc, by its id, and the doc's path, such as `{ "document-analysis": "docs/areas/document-analysis/playbook.md" }`. Empty turns work items off |
| `board.workItems.group` | `"{area} · Behind the scenes"` | The group title of an area's work items; `{area}` is the area's name as its stories' groups show it |
| `board.workItems.people` | `{}` | Names a `Waiting on <name>` may give, each with their monday user id, so Owner tells them. Empty, and sync never writes Owner |
| `board.columns.workId` … `unblocks`, `board.titles.*` | `work_id` "Work ID", `work_status` "Work status", `work_who` "Who", `work_note` "Status note", `unblocks` "Unblocks" | The work item columns |
| `board.workStatuses` | Done, Now, Next, Later, Waiting | Each status word's label on Work status; `done` is marked done |

- **The client board.** Guests reach only a shareable board (`board_kind` `share`), and making one may need the account's admin.
  - For Atlas NX, the owner asks the restivegroup.monday.com admin for one and invites the client there as a guest; `boardId` points at it.
  - The throwaway test board stays for developing the commands.
- **Each extra can be switched off.** The `show` keys are separate so a client sees only what the owner chose.
- **`client` as a Needs value.** Open questions allow `client` in Needs, meaning the client answers on the board.
  - A client question never blocks a merge: `wf signoffs` skips rows whose Needs is `client`.
  - When one truly blocks a chunk, the team adds its own row, with the owner in Needs, to chase the answer.

## Token and where sync runs

- **The token.** The owner's personal monday API token, named by `board.tokenEnv`: locally an environment variable or a gitignored `.env`, and in CI a secret of the `board.environment` GitHub Environment, never a repository-wide secret.
  - Locally, `wf board` reads it from the environment, else from a `.env` at the repo root. It reads the `.env` only when git ignores it and does not track it, and writes nothing to the environment.
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
3. With the token in `MONDAY_API_TOKEN`, run `npx --no wf board setup --create`. A board command runs with the token set, so it is `npx --no wf`: when the kit is not installed it stops, and never fetches the unrelated package called `wf` from npm.
   - A column it says can't be set on items belongs to a portfolio, such as a project template's status. Point `board.columns` at an id of the project's own, with its title in `board.titles`, and run it again.
   - Then add a Kanban view grouped by Build, and one by Client review, on the board by hand, if cards suit better than the tables setup makes.
4. Run `npx --no wf board plan`, and check what it would write.
5. In GitHub, create the `board` environment, set its deployment branches to `main` only, and add `MONDAY_API_TOKEN` to it as a secret.
6. Run `npx wf github sync`, and merge the workflow it writes. The merge runs the first sync.

To show an area's work items too, once its stories are on the board:

1. Copy the kit's `templates/plan.md` into the area's folder, or bring its plan doc to that shape, and give each step an ID.
2. List it in `board.workItems.plans`, and run `npx wf doc:check` until it passes.
3. To have Owner tell the person a step waits on, add them to `board.workItems.people` with their monday user id.
4. Run `npx --no wf board setup --create`, then `npx --no wf board plan`, and check what it would write. Items made by hand for the same work are not touched; delete them on the board.

`wf github` writes files only, so step 5 is by hand, or with `gh`:

```bash
gh api -X PUT repos/{owner}/{repo}/environments/board -F "deployment_branch_policy[protected_branches]=false" -F "deployment_branch_policy[custom_branch_policies]=true"
gh api -X POST repos/{owner}/{repo}/environments/board/deployment-branch-policies -f name=main -f type=branch
gh secret set MONDAY_API_TOKEN --env board
```

## What never goes on the board

The board shows stories and work items, not the project's internals.

- **On the board.** The "As a…" sentence and the acceptance lines as written, status, chunk, the pull request link, and the extras `show` turns on. For a work item, its phase's lead and its step's text, Who, Status, and Unblocks, each checked to hold no ID, link, or path.
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
- **Work items on a live board.** Tried on Atlas NX's board on 2026-11-20 with dummy items only, `ZZT-01` and `W-ZZT-*`, nothing else touched:
  - Setup made the five columns, and turned off the rollup monday gave the new Work status.
  - Create, a second plan with nothing to do, a renumbered step renamed in place, a status and the lead edited, and Owner set and cleared all held.
  - A subitem moved to the Retired group left its phase and became a top-level item there, so the next plan found nothing to retire. A retired phase kept its step.
  - monday kept a parent's values when its first subitem was made, and copied none to it.
  - A comment on a subitem posted, and feedback read it back.
  - Not tried: assigning a guest in a People column, which the docs list only for people and teams. The test assigned the token's own user.

## Build order

1. The trial against a test board, in this doc.
2. The story reader, and `wf board plan` and `sync`, tested with fixtures and a fake fetch. Built in v0.32.0, with `wf board setup`, and run against the test board.
3. The CI workflow, through `wf github`, and the PR column from git history. Built in v0.33.0; the workflow is checked by tests only until a project turns it on.
4. `wf board feedback`, `wf board reply`, and the `board-feedback` skill. Built in v0.34.0; the guest path is checked by tests, since the token's own user posts as a member.
5. Frames, then screenshots of the built screens. Frames built in v0.37.0, and built screens in v0.38.0.
6. Work items from a plan doc, in [Work items](#work-items). Built in v1.8.0, and tried on Atlas NX's board with dummy items, as under Risks.
