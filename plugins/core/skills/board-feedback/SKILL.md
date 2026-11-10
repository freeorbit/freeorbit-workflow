---
name: board-feedback
description: >-
  Turns the client's comments on the project's monday.com board into open
  questions, and replies to each as the board's bot, after the person's yes in
  chat. Use only when someone invokes /board-feedback.
disable-model-invocation: true
---

# Board feedback

The client comments on the board; the repo keeps the questions. This skill reads each new comment, drafts what to do with it, and only after a yes logs the questions and posts the bot's replies. Replies reach the client, so nothing is posted without that yes.

The board's design, and the bot's name and words, are in the kit's `docs/design/board-sync.md`. The bot's wording lives in the kit; never write a reply by hand or type a 🤖 line on the board.

## 1. Read

Run `npx wf board feedback --json`. It needs the token in the variable `board.tokenEnv` names (`npx wf config` prints it).

- `pending` holds each client comment with no bot reply after it: its story, item, comment `id`, author, date, and text.
- `edited` holds comments changed after they were logged, with the Q-IDs they were logged as.
- With both empty, say there is nothing new, and stop.

## 2. Draft

For each pending comment, choose one:

- **Log it.** A real question, a request, or an issue with what the story says or shows.
  - Write the question as one short sentence of at most 30 words, in the team's words, not a quote.
  - **Needs.** The role from `decisions` in `.workflow/config.json` for its kind: design or wording on a screen → `design`; scope, a new feature, or a priority → `scope`; how something works → `architecture`; anything unclear → `missing-information`. Never `client`: here the client asks, and the team answers.
  - **Chunk.** `none` by default, since a client question never blocks. Propose the story's open chunk only for a defect in work under way, and say that the row would then hold that chunk's merge (`wf signoffs`).
  - **Story.** The comment's story ID.
  - One comment can hold two questions; log each as its own row.
- **Note it.** Thanks, small talk, or something already answered on the board. It gets the bot's short "noted" reply, so it stops showing as new.

For each edited comment, show what changed and suggest updating its question row by hand. It is never logged twice, and gets no second reply.

## 3. Ask

Show the whole batch in one message: for each comment, its story, the author, a short quote, and the draft, such as:

- APP-01, Dana: "Should the lockout message say how long is left?" → log "Should the lockout message show the minutes left?", Needs designer, chunk none
- APP-02, Dana: "Thanks, looks great!" → note

Ask once whether to go ahead. Change any line the person corrects. Wait for the yes.

## 4. Log and reply

On the yes, for each comment in order:

1. Each question: `npx wf question add <chunk | none> "<question>" <needs> "client (monday)" <story>`. It prints the new Q-ID.
2. The reply: `npx wf board reply <comment id> <Q-ID> [<Q-ID> ...]` with the IDs from step 1.
3. A noted comment: `npx wf board reply <comment id> --noted`.

When a command fails, stop and report it; a reply already posted stays. Never post a reply for a question that was not added.

## 5. Report

List each comment with what was done: the Q-IDs added, or noted. The open questions log changed, so the rows go in this branch's next commit, with the `commit` skill.
