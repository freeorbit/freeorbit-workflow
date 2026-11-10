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

import { answeredReply, askedQuestion, isBot, isPinned, loggedReply, notedReply } from "./voice.mjs";

const after = (a, b) => String(a ?? "") > String(b ?? "");

/**
 * Whether the bot has said anything on an item, so its next word there is short:
 * a reply in any thread, a delivery note, or a question. The pinned comment never counts.
 */
export const hasBotReply = (item, meId) => item.updates.some((top) => (isBot(top, meId) && !isPinned(top, meId)) || (top.replies ?? []).some((reply) => isBot(reply, meId)));

/** Each guest comment on a synced item, as { pending, edited }. */
export function feedback(config, board, meId) {
  const pending = [];
  const edited = [];
  for (const item of board.items) {
    const story = item.column_values.find((value) => value.id === config.board.columns.storyId)?.text?.trim();
    if (!story) continue;
    const botReplied = hasBotReply(item, meId);
    for (const top of item.updates) {
      const thread = [top, ...(top.replies ?? [])];
      const bots = thread.filter((update) => update !== top && isBot(update, meId));
      const asked = isBot(top, meId) && !isPinned(top, meId) ? askedQuestion(top.text_body) : null;
      for (const comment of thread) {
        if (comment.creator?.kind !== "guest") continue;
        const entry = {
          story,
          retired: item.group?.title === config.board.retiredGroup,
          item: item.name,
          itemId: item.id,
          id: comment.id,
          threadId: top.id,
          where: comment === top ? "comment" : isPinned(top, meId) ? "reply to the acceptance comment" : asked ? `answer to ${asked}` : "reply",
          // A reply in a thread the bot opened with a team question answers it.
          answers: comment !== top ? asked : null,
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

/**
 * `wf board reply`'s arguments as groups, one per comment, split on `--`:
 * `<id> Q-012 Q-013 -- <id2> --noted`. Each group is { id, answer }.
 */
export function replyGroups(args) {
  const groups = [];
  let current = [];
  for (const arg of [...args, "--"]) {
    if (arg !== "--") current.push(arg);
    else if (current.length) {
      const [id, ...rest] = current;
      if (!rest.length) throw new Error(`${id}: name the Q-IDs it was logged as, or --noted`);
      if (rest[0] === "--answered") {
        if (rest.length !== 2) throw new Error(`${id}: --answered takes the one Q-ID the comment answers`);
        groups.push({ id, answer: { answered: rest[1] } });
      } else groups.push({ id, answer: rest.length === 1 && rest[0] === "--noted" ? "--noted" : rest });
      current = [];
    }
  }
  return groups;
}

/**
 * Every reply in one batch, checked before any is posted. The second and later
 * replies on an item are short, from what the batch itself posts, so the read
 * lag never gives one item two full replies.
 */
export function replyBatch(config, found, groups, openIds) {
  const seen = new Set();
  const repliedItems = new Set();
  return groups.map(({ id, answer }) => {
    if (seen.has(id)) throw new Error(`${id} is named twice`);
    seen.add(id);
    const reply = replyFor(config, found, id, answer, openIds, { repliedItems });
    repliedItems.add(reply.itemId);
    return reply;
  });
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
export function replyFor(config, found, updateId, answer, openIds, { repliedItems = new Set() } = {}) {
  const entry = found.pending.find((each) => each.id === String(updateId));
  if (!entry) {
    const edited = found.edited.find((each) => each.id === String(updateId));
    throw new Error(edited ? `${updateId} was logged already as ${edited.qids.join(", ") || "noted"}; update that question by hand` : `${updateId} is not a new client comment; run wf board feedback`);
  }
  const name = config.board.bot.name;
  // Short once the item holds a bot reply, or got one earlier in this batch, which monday's reads may not show yet.
  const short = entry.botReplied || repliedItems.has(entry.itemId);
  if (answer === "--noted") return { itemId: entry.itemId, threadId: entry.threadId, body: notedReply(name, { short }), entry };
  if (answer?.answered) {
    if (entry.answers !== answer.answered) throw new Error(`${updateId} answers ${entry.answers ?? "no question of the team's"}, not ${answer.answered}`);
    return { itemId: entry.itemId, threadId: entry.threadId, body: answeredReply(name, answer.answered), entry };
  }
  if (!answer.length) throw new Error("name the Q-IDs it was logged as, or --noted");
  for (const id of answer) {
    if (!/^Q-\d{3}$/.test(id)) throw new Error(`${id} is not a Q-ID such as Q-012`);
    if (!openIds.has(id)) throw new Error(`${id} is not in the open questions log; add it with wf question add first`);
  }
  return { itemId: entry.itemId, threadId: entry.threadId, body: loggedReply(name, answer, { short }), entry };
}
