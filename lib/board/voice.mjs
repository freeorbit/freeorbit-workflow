// Everything the board's bot says, in one place. It posts with the owner's
// token, so it introduces itself by a name of its own, `board.bot.name`
// (Orbit by default), and stays friendly, in the background, and polite.
//
// Nothing finds the bot's words by their wording: a bot reply is one by the
// token's user that starts with the 🤖 MARK, and the pinned comment is found
// by its HEADING. So this wording can change without breaking either.

export const MARK = "🤖";
/** The pinned comment's heading; sync finds the comment by it, so it never changes. */
export const HEADING = `${MARK} Acceptance criteria`;

/** "Q-012", "Q-012 and Q-013", or "Q-012, Q-013 and Q-014". */
export const ids = (list) => (list.length < 2 ? list.join("") : `${list.slice(0, -1).join(", ")} and ${list.at(-1)}`);

// The bot's first reply on an item introduces it in full; once the item holds
// one, later replies there are short, so a busy thread is not flooded. Which
// form to use is worked out from the board each run, with no state in the repo.

/** The reply to a comment logged as one or more open questions; `short` once the item has a bot reply. */
export const loggedReply = (name, qids, { short = false } = {}) =>
  short
    ? `${MARK} ${name}: thanks! Logged as ${ids(qids)}, the team will reply here.`
    : `${MARK} Hi, I'm ${name}, the team's automated helper. Thanks for raising this! I've added it to the project's list as ${ids(qids)}, and someone from the team will reply here soon.`;

/** The reply to a comment that needs no question, so it stops showing as new; `short` once the item has a bot reply. */
export const notedReply = (name, { short = false } = {}) =>
  short ? `${MARK} ${name}: thanks, the team has seen this.` : `${MARK} ${name} here, the team's automated helper. Thanks, the team has seen this. Nothing to add to the list for this one, but every comment gets read.`;

/** The line under the pinned comment's heading. */
export const pinnedNote = (name) =>
  `I'm ${name}, the team's automated helper, and I keep this list matched to the project's records. Edits here get replaced, so for a question or a change, just reply below and the team will pick it up.`;

/** Whether an update or reply is the bot's: by the token's user, starting with the marker. */
export const isBot = (update, meId) => String(update.creator_id) === String(meId) && String(update.text_body ?? "").trim().startsWith(MARK);
