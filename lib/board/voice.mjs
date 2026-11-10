// Everything the board's bot says, in one place. It posts with the owner's
// token, so it introduces itself by a name of its own, `board.bot.name`
// (Orbit by default), and stays friendly, in the background, and polite.
//
// Nothing finds the bot's words by their wording: a bot reply is one by the
// token's user that starts with the 🤖 MARK, and the pinned comment is the
// bot's top-level comment with a HEADING line. So this wording can change
// without breaking either.

export const MARK = "🤖";
/** The pinned comment's bold heading; sync finds the comment by it, so it never changes. */
export const HEADING = "Acceptance criteria";
/** The heading before v0.34.0, when it led the comment; a comment with it is still found, and edited to the new shape. */
const OLD_HEADING = `${MARK} ${HEADING}`;

/** Whether a top-level update is the pinned acceptance comment: the bot's, with a line that is the heading, old or new. */
export const isPinned = (update, meId) => isBot(update, meId) && String(update.text_body ?? "").split("\n").some((line) => [HEADING, OLD_HEADING].includes(line.trim()));

/** "Q-012", "Q-012 and Q-013", or "Q-012, Q-013 and Q-014". */
export const ids = (list) => (list.length < 2 ? list.join("") : `${list.slice(0, -1).join(", ")} and ${list.at(-1)}`);

// The bot's first reply on an item introduces it in full; once the item holds
// one, later replies there are short, so a busy thread is not flooded. Which
// form to use is worked out from the board each run, with no state in the repo.

/** The reply to a comment logged as one or more open questions; `short` once the item has a bot reply. */
export const loggedReply = (name, qids, { short = false } = {}) =>
  short
    ? `${MARK} ${name}: thanks! Logged as ${ids(qids)}, the team will reply here.`
    : `${MARK} Hi, I'm ${name}. Thanks for raising this! I've added it to the project's list as ${ids(qids)}, and someone from the team will reply here soon.`;

/** The reply to a comment that needs no question, so it stops showing as new; `short` once the item has a bot reply. */
export const notedReply = (name, { short = false } = {}) =>
  short ? `${MARK} ${name}: thanks, the team has seen this.` : `${MARK} ${name} here. Thanks, the team has seen this. Nothing to add to the list for this one, but every comment gets read.`;

/** The line under the pinned comment's heading. */
export const pinnedNote = (name) =>
  `I'm ${name}, and I keep this list matched to the project's records. Edits here get replaced, so for a question or a change, just reply below and the team will pick it up.`;

/** The thanks to a client who answered one of the team's questions. */
export const answeredReply = (name, qid) => `${MARK} ${name}: thanks! Your answer to ${qid} is with the team.`;

/** The marker line a delivery note ends with: the chunks it announces, so each is announced once. */
export const deliveredMarker = (chunks) => `(${chunks.join(", ")})`;

/** The chunks a bot comment has announced, from its marker line. */
export const deliveredChunks = (text) =>
  String(text ?? "")
    .split("\n")
    .map((line) => line.trim().match(/^\(((?:[A-Z]+-)?\d+[a-z]*(?:, (?:[A-Z]+-)?\d+[a-z]*)*)\)$/))
    .filter(Boolean)
    .flatMap((match) => match[1].split(", "));

const paragraphs = (parts) => parts.map((part) => `<p>${part}</p>`).join("");

/**
 * The note on a story's item when it is built: its chunks' For the client
 * sentences, already escaped, then the marker. Full on the bot's first comment
 * on the item, short after.
 */
export const deliveredNote = (name, lines, chunks, { short = false } = {}) =>
  short
    ? paragraphs([`${MARK} ${name}: built!`, ...lines, "Set Client review when you're ready.", deliveredMarker(chunks)])
    : paragraphs([`${MARK} Hi, I'm ${name}. Good news: this story is built.`, ...lines, "Have a look, and set Client review when you're ready.", deliveredMarker(chunks)]);

/** The team's question to the client, already escaped; its Q-ID in brackets is how it is found again. */
export const questionNote = (name, qid, question, { short = false } = {}) =>
  short
    ? `${MARK} ${name}: a question from the team (${qid}): ${question} Just reply here.`
    : `${MARK} Hi, I'm ${name}. The team has a question for you (${qid}): ${question} Just reply here.`;

/** The question a bot comment asks the client, by the Q-ID in brackets, or null. */
export const askedQuestion = (text) => String(text ?? "").match(/\((Q-\d{3})\)/)?.[1] ?? null;

/** Whether an update or reply is the bot's: by the token's user, starting with the marker. */
export const isBot = (update, meId) => String(update.creator_id) === String(meId) && String(update.text_body ?? "").trim().startsWith(MARK);
