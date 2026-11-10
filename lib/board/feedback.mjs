// `wf board feedback` and `wf board reply`: the client's comments on the
// board, read back as open questions (docs/design/board-sync.md).
//
// A comment is the client's when its creator's kind is `guest`. monday's
// threads are one level deep, so a comment and the replies under it share a
// thread, the pinned acceptance comment's included. A guest's comment is
// handled once a bot reply (voice.mjs isBot) sits in its thread after it, so
// the repo keeps no state and the client sees no ids. A comment changed after
// its bot reply is listed apart, with the Q-IDs that reply named, and is never
// logged twice.

import { isBot, loggedReply, notedReply } from "./voice.mjs";

const after = (a, b) => String(a ?? "") > String(b ?? "");

/** Each guest comment on a synced item, as { pending, edited }. */
export function feedback(config, board, meId) {
  const pending = [];
  const edited = [];
  for (const item of board.items) {
    const story = item.column_values.find((value) => value.id === config.board.columns.storyId)?.text?.trim();
    if (!story) continue;
    // Any bot reply on the item, in any thread; the pinned comment is a top-level update, not a reply, so it never counts.
    const botReplied = item.updates.some((top) => (top.replies ?? []).some((reply) => isBot(reply, meId)));
    for (const top of item.updates) {
      const thread = [top, ...(top.replies ?? [])];
      const bots = thread.filter((update) => update !== top && isBot(update, meId));
      for (const comment of thread) {
        if (comment.creator?.kind !== "guest") continue;
        const entry = {
          story,
          retired: item.group?.title === config.board.retiredGroup,
          item: item.name,
          itemId: item.id,
          id: comment.id,
          threadId: top.id,
          where: comment === top ? "comment" : isBot(top, meId) ? "reply to the acceptance comment" : "reply",
          author: comment.creator?.name ?? "",
          date: comment.created_at ?? "",
          text: String(comment.text_body ?? "").trim(),
          botReplied,
        };
        const handledBy = bots.filter((bot) => after(bot.created_at, comment.created_at)).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))[0];
        if (!handledBy) pending.push(entry);
        else if (after(comment.updated_at, handledBy.created_at)) edited.push({ ...entry, qids: [...new Set(String(handledBy.text_body).match(/\bQ-\d{3}\b/g) ?? [])] });
      }
    }
  }
  return { pending, edited };
}

/** The feedback as lines a person reads. */
export function feedbackLines({ pending, edited }) {
  const block = (entry) => [
    `${entry.story}${entry.retired ? " (retired)" : ""}  ${entry.item}`,
    `  ${entry.where} ${entry.id} by ${entry.author || "a guest"}, ${entry.date.slice(0, 10)}`,
    ...entry.text.split("\n").map((line) => `  > ${line}`),
  ];
  const out = [];
  if (pending.length) out.push(`${pending.length} new from the client:`, "", ...pending.flatMap((entry) => [...block(entry), ""]));
  if (edited.length)
    out.push("Edited after it was logged; update its question by hand:", "", ...edited.flatMap((entry) => [...block(entry), `  logged as ${entry.qids.join(", ") || "nothing (noted)"}`, ""]));
  if (!pending.length && !edited.length) out.push("No new comments from the client.");
  return out;
}

/**
 * The reply to post for a pending comment: { itemId, threadId, body }.
 * `answer` is a list of Q-IDs, each open in the questions log, or "--noted".
 */
export function replyFor(config, found, updateId, answer, openIds) {
  const entry = found.pending.find((each) => each.id === String(updateId));
  if (!entry) {
    const edited = found.edited.find((each) => each.id === String(updateId));
    throw new Error(edited ? `${updateId} was logged already as ${edited.qids.join(", ") || "noted"}; update that question by hand` : `${updateId} is not a new client comment; run wf board feedback`);
  }
  const name = config.board.bot.name;
  const short = entry.botReplied;
  if (answer === "--noted") return { itemId: entry.itemId, threadId: entry.threadId, body: notedReply(name, { short }), entry };
  if (!answer.length) throw new Error("name the Q-IDs it was logged as, or --noted");
  for (const id of answer) {
    if (!/^Q-\d{3}$/.test(id)) throw new Error(`${id} is not a Q-ID such as Q-012`);
    if (!openIds.has(id)) throw new Error(`${id} is not in the open questions log; add it with wf question add first`);
  }
  return { itemId: entry.itemId, threadId: entry.threadId, body: loggedReply(name, answer, { short }), entry };
}
