import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { merge } from "../lib/config/config.mjs";
import { DEFAULTS } from "../lib/config/defaults.mjs";
import { readStories } from "../lib/docs/stories.mjs";
import { statusOf, storiesDone, storyRows } from "../lib/board/status.mjs";
import { mondayClient } from "../lib/board/monday.mjs";
import { commentHtml, difference, flat, tags, LONG_TEXT_LIMIT, plan, runBoard, setupProblems, wanted } from "../lib/board/index.mjs";
import { HEADING } from "../lib/board/voice.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(join(here, "fixtures/board", name), "utf8");
const TOKEN = "tok-secret-123";
const config = (more = {}) =>
  merge(DEFAULTS, { areas: [{ id: "app", prefix: "APP", docs: "docs/app" }], stories: { files: ["docs/app/user-stories.md"] }, board: { boardId: "42" }, ...more });

/** A project context over the fixtures, with any text replaced. */
function context(texts = {}, more = {}) {
  const all = {
    "docs/app/user-stories.md": fixture("user-stories.md"),
    "docs/log/build-order.md": fixture("build-order.md"),
    "docs/log/chunks-done.md": fixture("chunks-done.md"),
    ...texts,
  };
  return { root: "/project", config: config(more), tracked: Object.keys(all), files: (path) => all[path] };
}

// ---- the story reader and status ----

test("the reader takes each story's ID, title, group, sentence, and acceptance lines", () => {
  const stories = readStories(fixture("user-stories.md"), ["APP"], "docs/app/user-stories.md");
  assert.deepEqual(stories.map((story) => `${story.id} | ${story.title} | ${story.group} | ${story.removed}`), [
    "APP-01 | Sign in with work email and password | Sign in | false",
    "APP-02 | Sign out | Sign in | false",
    "APP-03 | Remember me | Sign in | true",
    "APP-04 | See my jobs | Jobs | false",
  ]);
  const [one, , removed, four] = stories;
  assert.match(one.as, /^As a Field User, I want to sign in .* the jobs I work on\.$/);
  assert.equal(one.acceptance.length, 5);
  assert.deepEqual(one.acceptance[3].sub, ["While that email is slowed down, Sign in is turned off until the wait ends."]);
  assert.equal(removed.as, "");
  assert.equal(four.acceptance[0].text, "The list shows each open job with its address and due date, newest first.", "a wrapped line joins its bullet");
  assert.equal(stories[0].line, 11);
});

test("a heading in a fenced block is not a story, and a ### under no ## has no group", () => {
  const text = "### APP-09. Loose\n\nAs a user, I want it.\n\n```\n### APP-10. Example\n```\n";
  assert.deepEqual(readStories(text, ["APP"]).map((story) => `${story.id}:${story.group}`), ["APP-09:"]);
  assert.deepEqual(readStories(text, []), []);
});

test("status follows the build order: started means In progress until every lane is done", () => {
  const rows = (...states) => states.map((state, i) => ({ chunk: `CH-0${i}`, state }));
  assert.equal(statusOf(false, rows("done")), "drafting");
  assert.equal(statusOf(true, []), "backlog");
  assert.equal(statusOf(true, rows("Not started", "Not started")), "planned");
  assert.equal(statusOf(true, rows("done", "Not started")), "inProgress");
  assert.equal(statusOf(true, rows("In progress", "Waiting")), "inProgress");
  assert.equal(statusOf(true, rows("done", "Waiting")), "checking");
  assert.equal(statusOf(true, rows("done", "done")), "done");
  const cfg = config();
  const lanes = storyRows(cfg, fixture("build-order.md"), fixture("chunks-done.md"));
  assert.deepEqual(lanes.get("APP-04").map((lane) => `${lane.chunk} ${lane.state}`), ["CH-02-be In progress", "CH-02-fe Not started", "CH-02-contract done"]);
  assert.equal(storiesDone(fixture("build-order.md"), "app"), true);
  assert.equal(storiesDone(fixture("build-order.md"), "jobs"), false);
});

test("the wanted items carry the name, group, columns, and comment", () => {
  const want = wanted(context());
  assert.deepEqual(want.map((story) => `${story.name} | ${story.group} | ${story.values.status} | ${story.values.chunk}`), [
    "APP-01 · Sign in with work email and password | App · Sign in | Built | CH-01-fe, CH-01-be",
    "APP-02 · Sign out | App · Sign in | Planned | CH-03",
    "APP-03 · Remember me | App · Sign in | Backlog | ",
    "APP-04 · See my jobs | App · Jobs | In progress | CH-02-be, CH-02-fe, CH-02-contract",
  ]);
  const html = want[0].comment;
  assert.ok(html.startsWith(`<blockquote><p>🤖 I'm Orbit`));
  assert.match(html, /<\/blockquote><p><strong>Acceptance criteria<\/strong><\/p><p>As a Field User/);
  assert.match(html, /<li>Given 5 failed tries.*<ul><li>While that email is slowed down/);
  assert.match(html, /<code>plain text<\/code>/);
  assert.match(html, /&quot;|"Email or password is incorrect"/);
  const drafting = wanted(context({ "docs/log/build-order.md": fixture("build-order.md").replace("| Done 2026-11-01 |", "| In progress 2026-11-01 |") }));
  assert.ok(drafting.every((story) => story.values.status === "Drafting"));
});

test("a comment compares equal to monday's plain text of it", () => {
  const story = readStories(fixture("user-stories.md"), ["APP"])[0];
  const asMondayShows = `🤖 I’m Orbit, and I keep this list matched to the project’s records. Edits here get replaced, so for a question or a change, just reply below and the team will pick it up.\n\n${HEADING}\n\n${story.as}\n\n${story.acceptance
    .flatMap((line) => [line.text, ...line.sub])
    .join("\n")}`;
  assert.equal(flat(asMondayShows), flat(commentHtml(story)));
  assert.notEqual(flat(asMondayShows.replace("15 minutes", "20 minutes")), flat(commentHtml(story)));
});

// ---- a fake monday behind fetch ----

const COLUMNS = [
  { id: "name", title: "Name", type: "name", settings_str: "{}" },
  { id: "story_id", title: "Story ID", type: "text", settings_str: "{}" },
  { id: "area", title: "Area", type: "text", settings_str: "{}" },
  { id: "wf_status", title: "Build", type: "status", settings_str: JSON.stringify({ labels: { 0: "Drafting", 1: "Backlog", 2: "Planned", 3: "In progress", 4: "Checking", 6: "Built" } }) },
  { id: "client_review", title: "Client review", type: "status", settings_str: JSON.stringify({ labels: { 0: "Not ready", 1: "Approved" } }) },
  { id: "chunk", title: "Chunk", type: "text", settings_str: "{}" },
  { id: "story", title: "Story", type: "long_text", settings_str: "{}" },
  { id: "pr", title: "PR", type: "link", settings_str: "{}" },
  { id: "owner", title: "Owner", type: "people", settings_str: "{}" },
  { id: "frames", title: "Frames", type: "file", settings_str: "{}" },
  { id: "built_screens", title: "Built screens", type: "file", settings_str: "{}" },
];

/** An in-memory board that answers the queries the client sends, and a log of each operation. */
function fakeMonday({ columns = COLUMNS, views = [{ name: "Build" }, { name: "Client review" }], items = [], errorOn = null } = {}) {
  const state = { columns: structuredClone(columns), groups: [{ id: "topics", title: "Group Title" }], views, items: structuredClone(items), next: 100, ops: [], auth: [], sent: [] };
  const id = () => String((state.next += 1));
  const shown = (item) => ({
    id: item.id,
    name: item.name,
    group: state.groups.find((group) => group.id === item.group),
    // monday returns every column an item has, empty or not.
    column_values: [...new Set([...state.columns.map((column) => column.id).filter((id) => id !== "name"), ...Object.keys(item.values)])].map((key) => ({ id: key, text: item.values[key] ?? "" })),
    updates: [...item.updates].reverse(),
  });
  const textOf = (value) => (value && typeof value === "object" ? (value.label ?? value.text ?? value.url ?? "") : String(value ?? ""));
  const plain = (html) => html.replace(/<\/(p|li)>/g, "\n").replace(/<[^>]+>/g, "").replace(/\n+$/, "");
  const fetch = async (url, init) => {
    state.auth.push(init.headers.Authorization);
    const { query, variables: v } = JSON.parse(init.body);
    const op = query.match(/(me|boards|next_items_page|create_group|create_item|change_multiple_column_values|move_item_to_group|create_update|edit_update|pin_to_top|create_column|create_view_table|update_status_column)\b/)[1];
    state.ops.push(op);
    const reply = (data) => ({ status: 200, text: async () => JSON.stringify({ data }) });
    if (op === errorOn) return { status: 200, text: async () => JSON.stringify({ errors: [{ message: `refused, token ${TOKEN}` }] }) };
    if (op === "me") return reply({ me: { id: "7", name: "Owner" } });
    if (op === "boards") return reply({ boards: [{ id: "42", name: "Test board", board_kind: "share", columns: state.columns, groups: state.groups, views: state.views, items_page: { cursor: state.items.length > 2 ? "c1" : null, items: state.items.slice(0, 2).map(shown) } }] });
    if (op === "next_items_page") return reply({ next_items_page: { cursor: null, items: state.items.slice(2).map(shown) } });
    if (op === "create_group") {
      const group = { id: `g${id()}`, title: v.n };
      state.groups.push(group);
      return reply({ create_group: { id: group.id } });
    }
    if (op === "create_item") {
      const values = Object.fromEntries(Object.entries(JSON.parse(v.v)).map(([key, value]) => [key, textOf(value)]));
      const item = { id: id(), name: v.n, group: v.g, values, updates: [] };
      state.items.push(item);
      return reply({ create_item: { id: item.id } });
    }
    const item = state.items.find((each) => each.id === v.i);
    if (op === "change_multiple_column_values") {
      state.sent.push(...Object.keys(JSON.parse(v.v)));
      for (const [key, value] of Object.entries(JSON.parse(v.v))) {
        if (key === "name") item.name = value;
        else item.values[key] = textOf(value);
      }
      return reply({ change_multiple_column_values: { id: item.id } });
    }
    if (op === "move_item_to_group") {
      item.group = v.g;
      return reply({ move_item_to_group: { id: item.id } });
    }
    if (op === "create_update") {
      const update = { id: `u${id()}`, text_body: plain(v.b), creator_id: "7" };
      item.updates.push(update);
      return reply({ create_update: { id: update.id } });
    }
    if (op === "edit_update") {
      const update = state.items.flatMap((each) => each.updates).find((each) => each.id === v.u);
      update.text_body = plain(v.b);
      return reply({ edit_update: { id: update.id } });
    }
    if (op === "pin_to_top") return reply({ pin_to_top: { id: v.u } });
    if (op === "create_column") {
      const labels = v.d ? Object.entries(JSON.parse(v.d).labels ?? {}) : [];
      state.columns.push({ id: v.id, title: v.t, type: v.ty, revision: "new", settings_str: v.d ? JSON.stringify(JSON.parse(v.d)) : "{}", settings: { labels: labels.map(([id, label]) => ({ id: Number(id), label, color: Number(id), index: Number(id), is_done: false })) } });
      return reply({ create_column: { id: v.id } });
    }
    if (op === "update_status_column") {
      state.statusUpdates = [...(state.statusUpdates ?? []), v];
      return reply({ update_status_column: { id: v.id } });
    }
    if (op === "create_view_table") {
      state.views.push({ name: v.n, groupBy: v.s.group_by.conditions[0].columnId });
      return reply({ create_view_table: { id: `v${state.views.length}` } });
    }
    throw new Error(`fake monday: ${op}`);
  };
  return { state, fetch };
}

async function run(args, monday, texts = {}, more = {}) {
  const out = [];
  const code = await runBoard(context(texts, more), args, { env: { MONDAY_API_TOKEN: TOKEN }, fetch: monday.fetch, log: (line) => out.push(line) });
  return { code, out };
}

test("plan on an empty board lists each live story to create, and writes nothing", async () => {
  const monday = fakeMonday();
  const { code, out } = await run(["plan"], monday);
  assert.equal(code, 0, out.join("\n"));
  assert.deepEqual(out.slice(0, 3), [
    "create  APP-01 · Sign in with work email and password  [App · Sign in]",
    "create  APP-02 · Sign out  [App · Sign in]",
    "create  APP-04 · See my jobs  [App · Jobs]",
  ]);
  assert.equal(out.at(-1), "3 to create, 0 to update, 0 comments, 0 to retire, 0 unchanged.");
  assert.deepEqual([...new Set(monday.state.ops)], ["boards", "me"], "plan only reads");
});

test("sync creates the items, groups, and pinned comments; a second run finds nothing to do", async () => {
  const monday = fakeMonday();
  const first = await run(["sync"], monday);
  assert.equal(first.code, 0, first.out.join("\n"));
  assert.deepEqual(monday.state.groups.map((group) => group.title), ["Group Title", "App · Sign in", "App · Jobs"]);
  const one = monday.state.items.find((item) => item.values.story_id === "APP-01");
  assert.equal(one.values.wf_status, "Built");
  assert.match(one.values.story, /^As a Field User/);
  assert.equal(one.updates.length, 1);
  assert.ok(one.updates[0].text_body.startsWith("🤖 I'm Orbit") && one.updates[0].text_body.split("\n").includes(HEADING));
  assert.equal(monday.state.ops.filter((op) => op === "pin_to_top").length, 3);
  const second = await run(["sync"], monday);
  assert.deepEqual(second.out, ["0 to create, 0 to update, 0 comments, 0 to retire, 3 unchanged.", "Test board is in step."]);
  assert.ok(monday.state.auth.every((value) => value === TOKEN), "the token goes only in the Authorization header");
});

test("sync sends only what changed, edits the comment in place, and retires a removed story", async () => {
  const monday = fakeMonday();
  await run(["sync"], monday);
  // A stray item for APP-03, from before it was removed, and one the team made with no Story ID.
  monday.state.items.push({ id: "900", name: "APP-03 · Remember me", group: "topics", values: { story_id: "APP-03" }, updates: [] });
  monday.state.items.push({ id: "901", name: "Team note", group: "topics", values: {}, updates: [] });
  const moved = fixture("build-order.md").replace("| CH-03 | Sign out | developer | APP-02 | app | | Not started |", "");
  const order = moved.replace("### Waiting\n\nNone.", "### Waiting\n\n| Chunk | Title | Who | Stories | Area | Waits on | Status |\n| --- | --- | --- | --- | --- | --- | --- |\n| CH-03 | Sign out | developer | APP-02 | app | | Waiting |");
  const stories = fixture("user-stories.md").replace("then I see the sign-in page.\n", "then I see the sign-in page.\n- Signing out ends this sign-in only.\n");
  const texts = { "docs/log/build-order.md": order, "docs/app/user-stories.md": stories };
  const before = monday.state.ops.length;
  const planned = await run(["plan"], monday, texts);
  assert.deepEqual(planned.out.slice(0, 3), ["update  APP-02  Build: Planned → Checking", "comment APP-02  edit acceptance", "retire  APP-03  → Retired"]);
  const synced = await run(["sync"], monday, texts);
  assert.equal(synced.code, 0, synced.out.join("\n"));
  const ops = monday.state.ops.slice(before).filter((op) => !["boards", "next_items_page", "me"].includes(op));
  assert.deepEqual(ops, ["change_multiple_column_values", "edit_update", "create_group", "move_item_to_group"]);
  const two = monday.state.items.find((item) => item.values.story_id === "APP-02");
  assert.equal(two.updates.length, 1, "edited, not a second comment");
  assert.match(two.updates[0].text_body, /Signing out ends this sign-in only/);
  assert.equal(monday.state.groups.find((group) => group.id === monday.state.items.find((item) => item.id === "900").group).title, "Retired");
  assert.equal(monday.state.items.find((item) => item.id === "901").group, "topics", "an item with no Story ID is never touched");
});

test("a story over the long-text limit, or a missing column, stops sync before any write", async () => {
  const long = fixture("user-stories.md").replace("so that I know where to go next.", `so that ${"x".repeat(LONG_TEXT_LIMIT)}.`);
  const monday = fakeMonday();
  const { code, out } = await run(["sync"], monday, { "docs/app/user-stories.md": long });
  assert.equal(code, 1);
  assert.ok(out.some((line) => /^board {3}APP-04: the "As a…" sentence has \d+ characters, over monday's 2000/.test(line)), out.join("\n"));
  assert.match(out.at(-1), /1 problem: sync writes nothing until each is fixed/);
  assert.deepEqual([...new Set(monday.state.ops)], ["boards", "me"]);
  const bare = fakeMonday({ columns: COLUMNS.filter((column) => column.id !== "chunk") });
  const missing = await run(["sync"], bare);
  assert.equal(missing.code, 1);
  assert.ok(missing.out.some((line) => line.includes("column chunk (Chunk, text) is missing")));
});

test("two items with one Story ID is a problem, not a guess", async () => {
  const item = (id) => ({ id, name: "APP-02 · Sign out", group: "topics", values: { story_id: "APP-02" }, updates: [] });
  const { code, out } = await run(["plan"], fakeMonday({ items: [item("1"), item("2")] }));
  assert.equal(code, 1);
  assert.ok(out.some((line) => line.includes("two items hold Story ID APP-02: 1 and 2")));
});

test("setup lists what is missing, and --create makes the columns, with Built marked done, and the two views", async () => {
  const monday = fakeMonday({ columns: [COLUMNS[0]], views: [] });
  const listed = await run(["setup"], monday);
  assert.equal(listed.code, 1);
  assert.ok(listed.out.includes("column wf_status (Build, status) is missing"));
  assert.ok(listed.out.includes("column client_review (Client review, status) is missing"));
  assert.ok(listed.out.includes('view "Build" is missing; wf board setup --create makes it, a table grouped by Build'));
  assert.ok(listed.out.includes('view "Client review" is missing; wf board setup --create makes it, a table grouped by Client review'));
  const created = await run(["setup", "--create"], monday);
  assert.equal(monday.state.ops.filter((op) => op === "create_column").length, 10);
  assert.equal(monday.state.columns.find((column) => column.id === "owner").type, "people");
  // monday marks label 1 done in a new column, so the done label takes id 1.
  assert.deepEqual(JSON.parse(monday.state.columns.find((column) => column.id === "wf_status").settings_str).labels, { 0: "Drafting", 1: "Built", 2: "Backlog", 3: "Planned", 4: "In progress", 5: "Checking" });
  assert.deepEqual(JSON.parse(monday.state.columns.find((column) => column.id === "client_review").settings_str).labels, { 0: "Not ready", 1: "Approved", 2: "Ready for review", 3: "Changes requested" });
  assert.deepEqual(monday.state.views.map((view) => `${view.name} by ${view.groupBy}`), ["Build by wf_status", "Client review by client_review"]);
  // monday marks none of a new column's own labels done, so setup marks Built and Approved.
  assert.deepEqual(monday.state.statusUpdates.map((each) => `${each.id}: ${each.s.labels.filter((label) => label.is_done).map((label) => label.label)}`), ["wf_status: Built", "client_review: Approved"]);
  assert.ok(created.out.includes('marked "Built" done on column wf_status'));
  assert.ok(created.out.includes("  for cards, add a Kanban view grouped by Build on the board by hand; monday's API cannot make one"));
  assert.equal(created.code, 0, created.out.join("\n"));
  assert.equal(created.out.at(-1), "The board is set up.");
  const labels = setupProblems(config(), { columns: [{ ...COLUMNS[3], settings_str: JSON.stringify({ labels: { 0: "Built" } }) }], views: [] });
  assert.ok(labels.lines.includes('column wf_status (Build) has no label "Planned"; wf board setup --create adds it'));
});

test("the commands refuse with no board, no token, or a bad use; monday's errors keep the token out", async () => {
  const out = [];
  const log = (line) => out.push(line);
  assert.equal(await runBoard(context({}, { board: { boardId: "" } }), ["plan"], { env: { MONDAY_API_TOKEN: TOKEN }, log }), 1);
  assert.match(out.pop(), /board.boardId is not set/);
  assert.equal(await runBoard(context(), ["plan"], { env: {}, log }), 1);
  assert.match(out.pop(), /set MONDAY_API_TOKEN/);
  assert.equal(await runBoard(context(), ["plan", "--now"], { env: { MONDAY_API_TOKEN: TOKEN }, log }), 2);
  await assert.rejects(run(["plan"], fakeMonday({ errorOn: "boards" })), (error) => /monday: refused, token <token>/.test(error.message) && !error.message.includes(TOKEN));
});

test("the client treats an errors list in a 200 reply as a failure", async () => {
  const client = mondayClient({ token: TOKEN, apiVersion: "2026-10", fetch: async () => ({ status: 200, text: async () => JSON.stringify({ errors: [{ message: "Column not found" }] }) }) });
  await assert.rejects(client.call("query { me { id } }"), /monday: Column not found/);
  const down = mondayClient({ token: TOKEN, apiVersion: "2026-10", fetch: async () => ({ status: 500, text: async () => "<html>" }) });
  await assert.rejects(down.call("query { me { id } }"), /answered 500 with no JSON/);
  assert.throws(() => mondayClient({ token: "", apiVersion: "x" }), /no monday token/);
  assert.equal(plan(config(), [], { columns: COLUMNS, views: [], items: [], groups: [] }, "7").changes.length, 0);
});

test("the Owner column is the team's: a missing one never stops sync, and sync never writes it", async () => {
  const monday = fakeMonday({ columns: COLUMNS.filter((column) => column.id !== "owner") });
  const listed = await run(["setup"], monday);
  assert.ok(listed.out.includes("column owner (Owner, people) is missing"));
  const synced = await run(["sync"], monday);
  assert.equal(synced.code, 0, synced.out.join("\n"));
  const assigned = fakeMonday();
  await run(["sync"], assigned);
  for (const item of assigned.state.items) item.values.owner = "Gim Yong";
  const again = await run(["sync"], assigned, { "docs/app/user-stories.md": fixture("user-stories.md").replace("### APP-02. Sign out", "### APP-02. Sign out now") });
  assert.equal(again.code, 0, again.out.join("\n"));
  assert.ok(assigned.state.items.every((item) => item.values.owner === "Gim Yong"), "an assigned owner stays");
  assert.ok(!JSON.stringify(assigned.state).includes('"owner":""'));
});

test("sync writes only the configured columns, so the team's own columns on the board stay as they are", async () => {
  const monday = fakeMonday();
  await run(["sync"], monday);
  for (const item of monday.state.items) Object.assign(item.values, { file_mm8zg4zv: "test-differences.png", notes: "Ask the client on Friday" });
  const stories = fixture("user-stories.md").replace("### APP-01. Sign in with work email and password", "### APP-01. Sign in with a work email").replace("so that only I can reach the jobs I work on.", "so that only I can reach my jobs.");
  const order = fixture("build-order.md").replace("| CH-03 | Sign out | developer | APP-02 | app | | Not started |", "| CH-03b | Sign out | developer | APP-02 | app | | Not started |");
  monday.state.sent.length = 0;
  const { code, out } = await run(["sync"], monday, { "docs/app/user-stories.md": stories, "docs/log/build-order.md": order });
  assert.equal(code, 0, out.join("\n"));
  assert.deepEqual([...new Set(monday.state.sent)].sort(), ["chunk", "name", "story"]);
  assert.ok(monday.state.items.every((item) => item.values.file_mm8zg4zv === "test-differences.png" && item.values.notes === "Ask the client on Friday"));
});

test("a long field's change shows where the texts first differ", () => {
  const start = "As a Governance User, I want to sign in with my work email and password, ";
  assert.equal(difference("short", "shorter"), "short → shorter");
  assert.equal(difference("", "CH-01"), "(empty) → CH-01");
  const shown = difference(`${start}so that only I can reach the reviews.`, `${start}so that only I can reach the reviews I work on.`);
  assert.match(shown, /^….*reviews\. → ….*reviews I work on\.$/);
});

test("a pinned comment with the same words in another layout is edited to the kit's", () => {
  const story = readStories(fixture("user-stories.md"), ["APP"])[0];
  const want = commentHtml(story);
  const bubble = want.replace("<blockquote><p>", '<p><span style="background-color:rgb(229, 244, 255)">').replace("</p></blockquote>", "</span></p>");
  assert.equal(flat(bubble), flat(want), "the same words");
  assert.notEqual(tags(bubble), tags(want));
  assert.equal(tags(want.replaceAll("<li>", '<li style="color:red">')), tags(want), "monday's own attributes do not count");
});
