import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { test } from "node:test";

import { merge } from "../lib/config.mjs";
import { DEFAULTS } from "../lib/defaults.mjs";
import { syncGithub } from "../lib/github.mjs";
import { boardProblems, commentHtml, flat, HEADING, plan, runBoard } from "../lib/board/index.mjs";
import { feedback, feedbackLines, replyBatch, replyFor, replyGroups } from "../lib/board/feedback.mjs";
import { ids, isBot, loggedReply, notedReply, pinnedNote } from "../lib/board/voice.mjs";

const ME = "7";
const config = (board = {}) => merge(DEFAULTS, { areas: [{ id: "app", prefix: "APP", docs: "docs/app" }], stories: { files: ["docs/app/user-stories.md"] }, board: { boardId: "42", ...board } });
const at = (minute) => `2026-11-11T10:${String(minute).padStart(2, "0")}:00Z`;
const guest = (id, text, minute, { edited } = {}) => ({ id, text_body: text, creator_id: "50", creator: { name: "Dana Client", kind: "guest" }, created_at: at(minute), updated_at: at(edited ?? minute) });
const member = (id, text, minute) => ({ id, text_body: text, creator_id: "60", creator: { name: "Gim", kind: "member" }, created_at: at(minute), updated_at: at(minute) });
const bot = (id, text, minute) => ({ id, text_body: text, creator_id: ME, creator: { name: "Owner", kind: "member" }, created_at: at(minute), updated_at: at(minute) });
const item = (id, story, updates, group = "App · Sign in") => ({ id, name: `${story} · A story`, group: { title: group }, column_values: [{ id: "story_id", text: story }], updates });

/** A board with each kind of comment the rules tell apart. */
function board() {
  return {
    name: "Client board",
    columns: [],
    groups: [],
    views: [],
    items: [
      item("1", "APP-01", [
        // A top-level guest comment with no reply yet.
        guest("u1", "Should the lockout message say how long is left?", 1),
        // The pinned acceptance comment, with guest replies before and after the bot's.
        {
          ...bot("u2", `${HEADING}\n\n${pinnedNote("Orbit")}`, 0),
          replies: [guest("r1", "Line 3 reads oddly.", 2, { edited: 9 }), bot("r2", loggedReply("Orbit", ["Q-004"]), 3), guest("r3", "And the last line too.", 4)],
        },
        // A guest's thanks, noted by the bot, and a team member's own comment.
        { ...guest("u3", "Thanks, looks great!", 5), replies: [bot("r4", notedReply("Orbit"), 6)] },
        member("u4", "Team note: check with Dana.", 7),
      ]),
      item("2", "APP-07", [guest("u5", "Is this still coming?", 8)], "Retired"),
      // An item with no Story ID is the team's own.
      { id: "3", name: "Team item", group: { title: "Group Title" }, column_values: [], updates: [guest("u6", "Not a story", 8)] },
    ],
  };
}

test("the bot's words come from one place, with its name", () => {
  assert.equal(
    loggedReply("Orbit", ["Q-012"]),
    "🤖 Hi, I'm Orbit. Thanks for raising this! I've added it to the project's list as Q-012, and someone from the team will reply here soon.",
  );
  assert.match(loggedReply("Orbit", ["Q-012", "Q-013"]), /as Q-012 and Q-013, and/);
  assert.equal(ids(["Q-1", "Q-2", "Q-3"]), "Q-1, Q-2 and Q-3");
  assert.equal(notedReply("Orbit"), "🤖 Orbit here. Thanks, the team has seen this. Nothing to add to the list for this one, but every comment gets read.");
  assert.equal(
    pinnedNote("Orbit"),
    "I'm Orbit, and I keep this list matched to the project's records. Edits here get replaced, so for a question or a change, just reply below and the team will pick it up.",
  );
  assert.match(loggedReply("Pip", ["Q-001"]), /^🤖 Hi, I'm Pip\./);
  assert.equal(loggedReply("Orbit", ["Q-013"], { short: true }), "🤖 Orbit: thanks! Logged as Q-013, the team will reply here.");
  assert.equal(loggedReply("Orbit", ["Q-013", "Q-014"], { short: true }), "🤖 Orbit: thanks! Logged as Q-013 and Q-014, the team will reply here.");
  assert.equal(notedReply("Orbit", { short: true }), "🤖 Orbit: thanks, the team has seen this.");
  assert.equal(notedReply("Pip", { short: true }), "🤖 Pip: thanks, the team has seen this.");
});

test("the first Orbit reply on an item is full, later ones there are short, and the pinned comment never counts", () => {
  const open = new Set(["Q-013", "Q-014"]);
  const pinned = { ...bot("p1", `${HEADING}\n\n${pinnedNote("Orbit")}`, 0), replies: [guest("g1", "Is line 2 right?", 1)] };
  const first = { columns: [], groups: [], views: [], items: [item("1", "APP-01", [guest("g2", "When is this due?", 2), pinned])] };
  const body = (board, id, answer) => replyFor(config(), feedback(config(), board, ME), id, answer, open).body;
  assert.equal(body(first, "g1", ["Q-013"]), loggedReply("Orbit", ["Q-013"]), "only the pinned comment so far: still the full form");
  assert.equal(body(first, "g2", "--noted"), notedReply("Orbit"));
  // Once Orbit has replied anywhere on the item, every later reply there is short.
  pinned.replies.push(bot("b1", loggedReply("Orbit", ["Q-013"]), 3));
  const later = { ...first, items: [item("1", "APP-01", [{ ...guest("g2", "When is this due?", 2) }, pinned])] };
  assert.equal(body(later, "g2", ["Q-014"]), "🤖 Orbit: thanks! Logged as Q-014, the team will reply here.");
  assert.equal(body(later, "g2", "--noted"), "🤖 Orbit: thanks, the team has seen this.");
  // A second item's first reply is full again.
  const two = { ...later, items: [...later.items, item("2", "APP-02", [guest("g3", "Looks good.", 4)])] };
  assert.equal(body(two, "g3", "--noted"), notedReply("Orbit"));
  // A reply by the owner without the marker is theirs, not Orbit's, and does not count.
  const owner = { ...first, items: [item("1", "APP-01", [{ ...guest("g2", "When is this due?", 2), replies: [{ ...bot("o1", "I'll check, Dana.", 3) }] }])] };
  assert.equal(body(owner, "g2", "--noted"), notedReply("Orbit"));
});

test("a bot reply is found by the marker and the token's user, never by its wording", () => {
  assert.ok(isBot({ creator_id: ME, text_body: "🤖 Any new wording at all" }, ME));
  assert.ok(!isBot({ creator_id: ME, text_body: "The owner, writing as themself" }, ME));
  assert.ok(!isBot({ creator_id: "50", text_body: "🤖 A guest pasting the marker" }, ME));
});

test("feedback lists guest comments with no bot reply after them, and keeps edited ones apart", () => {
  const found = feedback(config(), board(), ME);
  assert.deepEqual(found.pending.map((entry) => `${entry.id} ${entry.story} ${entry.where}${entry.retired ? " retired" : ""}`), [
    "u1 APP-01 comment",
    "r3 APP-01 reply to the acceptance comment",
    "u5 APP-07 comment retired",
  ]);
  assert.deepEqual(found.edited.map((entry) => `${entry.id} ${entry.qids.join(",")}`), ["r1 Q-004"]);
  const entry = found.pending[0];
  assert.deepEqual([entry.author, entry.date, entry.text, entry.threadId, entry.itemId], ["Dana Client", at(1), "Should the lockout message say how long is left?", "u1", "1"]);
  assert.equal(found.pending[1].threadId, "u2", "a reply's reply goes in its thread");
  const lines = feedbackLines(found);
  assert.equal(lines[0], "3 new from the client:");
  assert.ok(lines.includes("APP-07 (retired)  APP-07 · A story"));
  assert.ok(lines.includes("  > Should the lockout message say how long is left?"));
  assert.ok(lines.includes("  logged as Q-004"));
  assert.deepEqual(feedbackLines({ pending: [], edited: [] }), ["No new comments from the client."]);
});

test("a reply names open Q-IDs, or notes the comment, and refuses anything else", () => {
  const found = feedback(config(), board(), ME);
  const open = new Set(["Q-012", "Q-013"]);
  const logged = replyFor(config(), found, "u1", ["Q-012", "Q-013"], open);
  assert.deepEqual([logged.itemId, logged.threadId], ["1", "u1"]);
  assert.equal(logged.body, "🤖 Orbit: thanks! Logged as Q-012 and Q-013, the team will reply here.", "the item has Orbit replies, so this one is short");
  assert.equal(replyFor(config({ bot: { name: "Pip" } }), found, "r3", "--noted", open).body, "🤖 Pip: thanks, the team has seen this.");
  assert.equal(replyFor(config(), found, "r3", "--noted", open).threadId, "u2");
  assert.throws(() => replyFor(config(), found, "u1", ["Q-099"], open), /Q-099 is not in the open questions log/);
  assert.throws(() => replyFor(config(), found, "u1", ["12"], open), /not a Q-ID/);
  assert.throws(() => replyFor(config(), found, "u1", [], open), /name the Q-IDs/);
  assert.throws(() => replyFor(config(), found, "u4", ["Q-012"], open), /u4 is not a new client comment/);
  assert.throws(() => replyFor(config(), found, "r1", ["Q-012"], open), /r1 was logged already as Q-004/);
});

test("wf board feedback and reply read the board and post in the comment's thread", async () => {
  const posted = [];
  const fetch = async (url, init) => {
    const { query, variables } = JSON.parse(init.body);
    const data = query.includes("me {")
      ? { me: { id: ME, name: "Owner" } }
      : query.includes("create_update")
        ? (posted.push(variables), { create_update: { id: "new" } })
        : { boards: [{ ...board(), id: "42", board_kind: "share", items_page: { cursor: null, items: board().items } }] };
    return { status: 200, text: async () => JSON.stringify({ data }) };
  };
  const questions = "## Not tied to a chunk yet\n\n| ID | Question | Needs | From | Story | Raised |\n| --- | --- | --- | --- | --- | --- |\n| Q-012 | Should the lockout say how long is left? | designer | client (monday) | APP-01 | 2026-11-11 |\n";
  const files = { "docs/log/open-questions.md": questions };
  const context = { root: "/project", config: config(), tracked: Object.keys(files), files: (path) => files[path] };
  const out = [];
  const io = { env: { MONDAY_API_TOKEN: "t" }, fetch, log: (line) => out.push(line), git: () => "" };
  assert.equal(await runBoard(context, ["feedback", "--json"], io), 0);
  assert.equal(JSON.parse(out.pop()).pending.length, 3);
  assert.equal(await runBoard(context, ["reply", "u1", "Q-012"], io), 0);
  assert.deepEqual(posted, [{ i: "1", p: "u1", b: loggedReply("Orbit", ["Q-012"], { short: true }) }]);
  assert.match(out.pop(), /^replied on APP-01 to Dana Client: 🤖 Orbit: thanks! Logged as Q-012/);
  assert.equal(await runBoard(context, ["reply", "u5", "Q-012"], io), 0);
  assert.equal(posted[1].b, loggedReply("Orbit", ["Q-012"]), "APP-07's item has no Orbit reply yet, so its first is full");
  await assert.rejects(runBoard(context, ["reply", "u1", "Q-013"], io), /Q-013 is not in the open questions log/);
  assert.equal(posted.length, 2, "nothing posted for a question that was not logged");
  assert.equal(await runBoard(context, ["reply", "u1"], io), 2);
});

test("the pinned comment's new wording edits each old one once, still found by its heading", () => {
  const story = { as: "As a user, I want it.", acceptance: [{ text: "It works.", sub: [] }] };
  const old = `${HEADING}\n\nKept in the project repo and updated automatically by the workflow bot. Please don't edit this comment.\n\n${story.as}\n\nIt works.`;
  const want = [{ id: "APP-01", name: "APP-01 · A story", group: "App · Sign in", values: { storyId: "APP-01", area: "app", status: "Done", chunk: "", story: story.as }, comment: commentHtml(story), pr: null }];
  const columns = ["story_id", "area", "chunk", "story", "pr", "owner"].map((id) => ({ id, type: { story: "long_text", pr: "link", owner: "people" }[id] ?? "text" }));
  columns.push({ id: "wf_status", type: "status", settings_str: JSON.stringify({ labels: { 0: "Drafting", 1: "Backlog", 2: "Planned", 3: "In progress", 4: "Checking", 6: "Done" } }) });
  const values = [["story_id", "APP-01"], ["area", "app"], ["wf_status", "Done"], ["chunk", ""], ["story", story.as], ["pr", ""]].map(([id, text]) => ({ id, text }));
  const on = (text) => ({ columns, views: [{ name: "Kanban" }], groups: [], items: [{ id: "1", name: "APP-01 · A story", group: { title: "App · Sign in" }, column_values: values, updates: [bot("p1", text, 0)] }] });
  const edit = plan(config(), want, on(old), ME).changes;
  assert.deepEqual(edit.map((change) => `${change.kind} ${change.updateId}`), ["comment p1"]);
  const now = commentHtml(story).replace(/<\/p>|<\/li>/g, "\n").replace(/<[^>]+>/g, "");
  assert.equal(flat(now), flat(commentHtml(story)));
  assert.equal(plan(config(), want, on(now), ME).changes.length, 0);
});

test("the board's names are checked before they reach a workflow or a shell", () => {
  assert.deepEqual(boardProblems(config()), []);
  const bad = config({ tokenEnv: "monday token; rm", environment: "board env", branch: "main;", bot: { name: "<b>Orbit</b>" } });
  const problems = boardProblems(bad);
  assert.equal(problems.length, 4, problems.join("\n"));
  assert.match(problems[0], /board.tokenEnv "monday token; rm" is not an environment variable name/);
  assert.ok(boardProblems(config({ tokenEnv: "9TOKEN" })).length === 1);
  assert.ok(boardProblems(config({ branch: "release/1.2" })).length === 0);
  const root = mkdtempSync(`${tmpdir()}/wf-board-names-`);
  const synced = syncGithub(root, bad, { write: true });
  assert.equal(synced.changed, 0);
  assert.match(synced.problems[0], /^\.workflow\/config\.json: board\.tokenEnv/);
});

test("one reply batch gives an item with no Orbit reply one full reply, then short ones, and checks all before posting", async () => {
  // APP-02's item has two client comments and no Orbit reply; APP-03's has one.
  const fresh = {
    name: "Client board",
    columns: [],
    groups: [],
    views: [],
    items: [item("1", "APP-02", [guest("a1", "Can sign out be on every page?", 1), guest("a2", "Thanks for this.", 2)]), item("2", "APP-03", [guest("b1", "Nice.", 3)])],
  };
  assert.deepEqual(replyGroups(["a1", "Q-012", "Q-013", "--", "a2", "--noted", "--", "b1", "--noted"]), [
    { id: "a1", answer: ["Q-012", "Q-013"] },
    { id: "a2", answer: "--noted" },
    { id: "b1", answer: "--noted" },
  ]);
  assert.throws(() => replyGroups(["a1", "--", "a2", "--noted"]), /a1: name the Q-IDs/);
  const open = new Set(["Q-012", "Q-013"]);
  const found = feedback(config(), fresh, ME);
  const bodies = replyBatch(config(), found, replyGroups(["a1", "Q-012", "Q-013", "--", "a2", "--noted", "--", "b1", "--noted"]), open).map((reply) => reply.body);
  assert.deepEqual(bodies, [loggedReply("Orbit", ["Q-012", "Q-013"]), notedReply("Orbit", { short: true }), notedReply("Orbit")]);
  assert.throws(() => replyBatch(config(), found, replyGroups(["a1", "Q-012", "--", "a1", "--noted"]), open), /a1 is named twice/);

  const posted = [];
  const fetch = async (url, init) => {
    const { query, variables } = JSON.parse(init.body);
    const data = query.includes("me {")
      ? { me: { id: ME, name: "Owner" } }
      : query.includes("create_update")
        ? (posted.push(variables), { create_update: { id: `n${posted.length}` } })
        : // Reads never show what this run posted, as monday's lag can.
          { boards: [{ ...fresh, id: "42", board_kind: "share", items_page: { cursor: null, items: fresh.items } }] };
    return { status: 200, text: async () => JSON.stringify({ data }) };
  };
  const questions = "## Not tied to a chunk yet\n\n| ID | Question | Needs | From | Story | Raised |\n| --- | --- | --- | --- | --- | --- |\n| Q-012 | Can sign out be on every page? | designer | client (monday) | APP-02 | 2026-11-11 |\n";
  const files = { "docs/log/open-questions.md": questions };
  const context = { root: "/project", config: config(), tracked: Object.keys(files), files: (path) => files[path] };
  const io = { env: { MONDAY_API_TOKEN: "t" }, fetch, log: () => {}, git: () => "" };
  await assert.rejects(runBoard(context, ["reply", "a1", "Q-012", "--", "a2", "Q-099"], io), /Q-099 is not in the open questions log/);
  assert.equal(posted.length, 0, "a bad reply anywhere in the batch posts none");
  assert.equal(await runBoard(context, ["reply", "a1", "Q-012", "--", "a2", "--noted"], io), 0);
  assert.deepEqual(posted.map((each) => [each.i, each.p, each.b]), [
    ["1", "a1", loggedReply("Orbit", ["Q-012"])],
    ["1", "a2", notedReply("Orbit", { short: true })],
  ]);
});
