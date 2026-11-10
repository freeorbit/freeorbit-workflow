import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { merge } from "../lib/config.mjs";
import { DEFAULTS } from "../lib/defaults.mjs";
import { installSteps } from "../lib/github.mjs";
import { commentHtml, plan, planLines, runBoard, wanted } from "../lib/board/index.mjs";
import { mondayClient, retryNotFound, STATUS_COLORS, withLabels } from "../lib/board/monday.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(join(here, "fixtures/board", name), "utf8");
const config = (more = {}) => merge(DEFAULTS, { areas: [{ id: "app", prefix: "APP", docs: "docs/app" }], stories: { files: ["docs/app/user-stories.md"] }, board: { boardId: "42" }, ...more });
const files = { "docs/app/user-stories.md": fixture("user-stories.md"), "docs/log/build-order.md": fixture("build-order.md"), "docs/log/chunks-done.md": fixture("chunks-done.md") };
const context = (more) => ({ root: "/project", config: config(more), tracked: Object.keys(files), files: (path) => files[path] });
const STATUS = { id: "wf_status", title: "Build", type: "status", settings_str: JSON.stringify({ labels: { 0: "Drafting", 1: "Backlog", 2: "Planned", 3: "In progress", 4: "Checking", 6: "Built" } }) };
const REVIEW = { id: "client_review", title: "Client review", type: "status", settings_str: "{}" };
const COLUMNS = [["story_id", "text"], ["area", "text"], ["chunk", "text"], ["story", "long_text"], ["pr", "link"], ["owner", "people"], ["frames", "file"]].map(([id, type]) => ({ id, title: id, type, settings_str: "{}" }));

/**
 * A monday whose reads lag its writes: a call on an item or update made a
 * moment ago fails "not found" the first `lag` times. `dropStatus` leaves the
 * status empty on create, as Atlas NX's board did.
 */
function laggingMonday({ lag = 2, dropStatus = false, items = [], columns = [...COLUMNS, STATUS, REVIEW], portfolio = [] } = {}) {
  const state = { items: structuredClone(items), groups: [{ id: "topics", title: "Group Title" }], columns, ops: [], misses: new Map(), next: 1 };
  const fresh = (key) => {
    const seen = state.misses.get(key) ?? 0;
    if (seen < lag) {
      state.misses.set(key, seen + 1);
      return true;
    }
    return false;
  };
  const plain = (html) => html.replace(/<\/(p|li)>/g, "\n").replace(/<[^>]+>/g, "").replace(/\n+$/, "");
  const shown = (item) => ({ id: item.id, name: item.name, group: state.groups.find((group) => group.id === item.group), column_values: state.columns.map((column) => column.id).filter((id) => !portfolio.includes(id)).map((id) => ({ id, text: item.values[id] ?? "" })), updates: item.updates });
  const fetch = async (url, init) => {
    const { query, variables: v } = JSON.parse(init.body);
    const op = query.match(/\b(me|boards|create_group|create_item|change_multiple_column_values|create_update|edit_update|pin_to_top|update_status_column|create_column|create_view_table|change_column_title)\b/)[1];
    state.ops.push(op);
    const ok = (data) => ({ status: 200, text: async () => JSON.stringify({ data }) });
    const missing = (what) => ({ status: 200, text: async () => JSON.stringify({ errors: [{ message: `${what} not found` }] }) });
    const item = state.items.find((each) => each.id === v?.i);
    if (op === "me") return ok({ me: { id: "7" } });
    if (op === "boards") return ok({ boards: [{ id: "42", name: "Test board", board_kind: "share", columns: state.columns, groups: state.groups, views: [{ name: "Build" }, { name: "Client review" }], items_page: { cursor: null, items: state.items.map(shown) } }] });
    if (op === "create_group") {
      state.groups.push({ id: `g${state.next}`, title: v.n });
      return ok({ create_group: { id: `g${state.next++}` } });
    }
    if (op === "create_item") {
      const values = Object.fromEntries(Object.entries(JSON.parse(v.v)).map(([key, value]) => [key, typeof value === "object" ? (value.label ?? value.text ?? "") : value]));
      if (dropStatus) values.wf_status = "";
      const made = { id: `i${state.next++}`, name: v.n, group: v.g, values, updates: [] };
      state.items.push(made);
      return ok({ create_item: { id: made.id, column_values: v.c.map((id) => ({ id, text: values[id] ?? "" })) } });
    }
    if (op === "change_multiple_column_values") {
      if (fresh(`values ${v.i}`)) return missing("Item");
      for (const [key, value] of Object.entries(JSON.parse(v.v))) item.values[key] = typeof value === "object" ? (value.label ?? value.text ?? "") : value;
      return ok({ change_multiple_column_values: { id: v.i } });
    }
    if (op === "create_update") {
      if (fresh(`update on ${v.i}`)) return missing("Item");
      const update = { id: `u${state.next++}`, body: v.b, text_body: plain(v.b), creator_id: "7", pinned_to_top: [] };
      item.updates.unshift(update);
      return ok({ create_update: { id: update.id } });
    }
    if (op === "edit_update") return ok({ edit_update: { id: v.u } });
    if (op === "pin_to_top") {
      if (fresh(`pin ${v.u}`)) return missing("Update");
      state.items.flatMap((each) => each.updates).find((update) => update.id === v.u).pinned_to_top = [{ item_id: v.i }];
      return ok({ pin_to_top: { id: v.u } });
    }
    if (op === "update_status_column") {
      state.statusUpdate = v;
      return ok({ update_status_column: { id: v.id } });
    }
    if (op === "create_column") {
      state.columns.push({ id: v.id, title: v.t, type: v.ty, settings_str: v.d ?? "{}" });
      return ok({ create_column: { id: v.id } });
    }
    if (op === "create_view_table") return ok({ create_view_table: { id: "v1" } });
    if (op === "change_column_title") {
      state.titled = v;
      state.columns.find((column) => column.id === v.c).title = v.t;
      return ok({ change_column_title: { id: v.c } });
    }
    throw new Error(`lagging monday: ${op}`);
  };
  return { state, fetch };
}

async function run(args, monday, more) {
  const out = [];
  const sleeps = [];
  const code = await runBoard(context(more), args, { env: { MONDAY_API_TOKEN: "tok-0123456789abcdef" }, fetch: monday.fetch, log: (line) => out.push(line), git: () => "", sleep: async (ms) => sleeps.push(ms) });
  return { code, out, sleeps };
}

test("a call on something just made retries while monday says it is not found, then fails clearly", async () => {
  const sleeps = [];
  const client = { sleep: async (ms) => sleeps.push(ms) };
  let calls = 0;
  assert.equal(
    await retryNotFound(client, async () => {
      calls += 1;
      if (calls < 3) throw new Error("monday: Update not found");
      return "pinned";
    }),
    "pinned",
  );
  assert.deepEqual(sleeps, [500, 1000]);
  await assert.rejects(
    retryNotFound(client, async () => {
      throw new Error("monday: Item not found");
    }),
    /Item not found \(still, after waiting 7.5s for monday to catch up\)/,
  );
  let other = 0;
  await assert.rejects(
    retryNotFound(client, async () => {
      other += 1;
      throw new Error("monday: Column not found in this board's settings");
    }),
    /Column not found/,
  );
  assert.equal(other, 1, "an error that is not about something just made is never retried");
});

test("sync gets through monday's read lag: each pin and comment on a new item retries, then lands", async () => {
  const monday = laggingMonday({ lag: 2 });
  const { code, out, sleeps } = await run(["sync"], monday);
  assert.equal(code, 0, out.join("\n"));
  const one = monday.state.items.find((item) => item.values.story_id === "APP-01");
  assert.equal(one.values.wf_status, "Built");
  assert.deepEqual(one.updates[0].pinned_to_top, [{ item_id: one.id }]);
  assert.ok(monday.state.items.every((item) => item.updates.length === 1), "one comment an item, however many retries");
  assert.ok(sleeps.length >= 6 && sleeps.every((ms) => [500, 1000].includes(ms)), String(sleeps));
});

test("a value monday drops on create, such as the status, is sent again at once", async () => {
  const monday = laggingMonday({ lag: 0, dropStatus: true });
  const { code, out } = await run(["sync"], monday);
  assert.equal(code, 0, out.join("\n"));
  assert.ok(out.includes("set wf_status on APP-01 again, which create left empty"), out.join("\n"));
  assert.ok(!out.some((line) => line.startsWith("set ") && !line.startsWith("set wf_status ")), "a value sent empty, such as an unplanned story's chunk, is not sent again");
  assert.deepEqual(monday.state.items.map((item) => `${item.values.story_id} ${item.values.wf_status}`), ["APP-01 Built", "APP-02 Planned", "APP-04 In progress"]);
});

test("a run cut short is finished by the next: an unpinned acceptance comment is pinned, not posted again", async () => {
  const story = wanted(context())[0];
  const values = { story_id: "APP-01", area: "app", wf_status: "", chunk: story.values.chunk, story: story.values.story, pr: "" };
  const half = { id: "9", name: story.name, group: "g0", values, updates: [{ id: "u9", body: commentHtml(story.story), text_body: commentHtml(story.story).replace(/<\/(p|li)>/g, "\n").replace(/<[^>]+>/g, ""), creator_id: "7", pinned_to_top: [] }] };
  const monday = laggingMonday({ lag: 0, items: [half] });
  monday.state.groups.push({ id: "g0", title: "App · Sign in" });
  const planned = await run(["plan"], monday);
  assert.ok(planned.out.includes("update  APP-01  Build: (empty) → Built"), planned.out.join("\n"));
  assert.ok(planned.out.includes("comment APP-01  pin acceptance"), planned.out.join("\n"));
  const synced = await run(["sync"], monday);
  assert.equal(synced.code, 0, synced.out.join("\n"));
  const item = monday.state.items.find((each) => each.id === "9");
  assert.equal(item.updates.length, 1);
  assert.deepEqual(item.updates[0].pinned_to_top, [{ item_id: "9" }]);
  assert.ok(!monday.state.ops.includes("edit_update"), "the comment's text was right, so only the pin is sent");
  assert.ok(synced.out.includes("comment APP-01 pinned"));
  const again = await run(["plan"], monday);
  assert.ok(!again.out.some((line) => line.includes("APP-01")), again.out.join("\n"));
});

test("setup --create brings a board's own status column to the kit's: its title, Done renamed Built in place, and the labels it lacks", async () => {
  // A board's own status column, as Atlas NX's was: titled Status, with monday's three labels, Done marked done.
  const own = { id: "wf_status", title: "Status", type: "status", revision: "rev-1", settings_str: JSON.stringify({ labels: { 0: "Working on it", 1: "Done", 2: "Stuck" } }), settings: { labels: [{ id: 0, label: "Working on it", color: 0, index: 0 }, { id: 1, label: "Done", color: 1, index: 1, is_done: true }, { id: 2, label: "Stuck", color: 2, index: 2 }] } };
  const monday = laggingMonday({ lag: 0, columns: [...COLUMNS, own, REVIEW] });
  const listed = await run(["setup"], monday);
  assert.ok(listed.out.includes('column wf_status is titled "Status"; wf board setup --create renames it "Build"'), listed.out.join("\n"));
  assert.ok(listed.out.includes('column wf_status (Build) has label "Done" marked done; wf board setup --create renames it "Built"'));
  assert.ok(!listed.out.includes('column wf_status (Build) has no label "Built"; wf board setup --create adds it'), "Built comes from the rename, not a new label");
  const { out } = await run(["setup", "--create"], monday);
  assert.ok(out.includes('renamed column wf_status "Status" to "Build"'), out.join("\n"));
  assert.ok(out.includes('renamed label 1 of column wf_status "Done" to "Built", keeping its id'));
  assert.ok(out.includes('added "Drafting", "Backlog", "Planned", "In progress", "Checking" to column wf_status'));
  const sent = monday.state.statusUpdate;
  assert.equal(sent.r, "rev-1");
  assert.deepEqual(monday.state.titled, { b: "42", c: "wf_status", t: "Build" }, "the title by its own call, apart from the labels");
  assert.deepEqual(sent.s.labels.slice(0, 3), [
    { id: 0, label: "Working on it", color: "working_orange", index: 0, is_done: false },
    { id: 1, label: "Built", color: "done_green", index: 1, is_done: true },
    { id: 2, label: "Stuck", color: "stuck_red", index: 2, is_done: false },
  ]);
  assert.deepEqual(sent.s.labels.slice(3).map((label) => `${label.label} ${label.color} ${label.index}`), ["Drafting dark_blue 3", "Backlog purple 4", "Planned explosive 5", "In progress grass_green 6", "Checking bright_blue 7"]);
  assert.equal(new Set(sent.s.labels.map((label) => label.color)).size, sent.s.labels.length, "no two labels share a colour");
});

test("new labels take colours no label has, and too many is refused", () => {
  const settings = { labels: [{ id: 5, label: "Mine", color: 3, index: 4 }] };
  assert.deepEqual(withLabels(settings, ["A"]), [
    { id: 5, label: "Mine", color: "dark_blue", index: 4, is_done: false },
    { label: "A", color: "working_orange", index: 5 },
  ]);
  const full = { labels: STATUS_COLORS.map((name, i) => ({ id: i, label: name, color: i, index: i })) };
  assert.throws(() => withLabels(full, ["One more"]), /room for 0 more colours/);
  // A label someone turned off stays off, and a rename keeps the label's id.
  const kept = withLabels({ labels: [{ id: 1, label: "Done", color: 1, index: 1, is_done: true }, { id: 2, label: "Stuck", color: 2, index: 2, is_deactivated: true }] }, [], { 1: "Built" });
  assert.deepEqual(kept, [
    { id: 1, label: "Built", color: "done_green", index: 1, is_done: true },
    { id: 2, label: "Stuck", color: "stuck_red", index: 2, is_done: false, is_deactivated: true },
  ]);
});

test("the workflow installs with the project's own package manager, from its lockfile", () => {
  const dir = (file) => {
    const root = mkdtempSync(join(tmpdir(), "wf-lock-"));
    if (file) writeFileSync(join(root, file), "");
    return root;
  };
  assert.deepEqual(installSteps(dir("pnpm-lock.yaml")), ["npm install --global pnpm", "pnpm install --frozen-lockfile"]);
  assert.deepEqual(installSteps(dir("yarn.lock")), ["corepack enable", "yarn install --frozen-lockfile"]);
  assert.deepEqual(installSteps(dir("package-lock.json")), ["npm ci"]);
  assert.deepEqual(installSteps(dir(null)), ["npm install"]);
});

test("a column monday keeps off items, as a portfolio's own status, stops setup, plan, and sync", async () => {
  // As Atlas NX's project_status: the board lists it, but no item carries it.
  const made = laggingMonday({ lag: 0 });
  await run(["sync"], made);
  const monday = laggingMonday({ lag: 0, items: made.state.items, portfolio: ["wf_status"] });
  monday.state.groups = made.state.groups;
  const line = "column wf_status (Build) can't be set on items (portfolio-managed?); use a column of your own, such as wf board setup --create makes with board.titles.status";
  const setup = await run(["setup"], monday);
  assert.equal(setup.code, 1);
  assert.ok(setup.out.includes(line), setup.out.join("\n"));
  const planned = await run(["plan"], monday);
  assert.equal(planned.code, 1);
  assert.ok(planned.out.includes(`board   ${line}`));
  assert.ok(!planned.out.some((each) => each.includes("Build: (empty)")), "never the endless (empty) → Done");
  const before = monday.state.ops.length;
  assert.equal((await run(["sync"], monday)).code, 1);
  assert.deepEqual([...new Set(monday.state.ops.slice(before))].sort(), ["boards", "me"], "sync writes nothing");
});

test("a column's title comes from board.titles, and names its view", async () => {
  const monday = laggingMonday({ lag: 0, columns: COLUMNS });
  const titled = { board: { boardId: "42", titles: { status: "Story status" } } };
  const listed = await run(["setup"], monday, titled);
  assert.ok(listed.out.includes("column wf_status (Story status, status) is missing"), listed.out.join("\n"));
  assert.ok(listed.out.includes('view "Story status" is missing; wf board setup --create makes it, a table grouped by Story status'));
  const out = await run(["setup", "--create"], monday, titled);
  assert.ok(out.out.includes("created column wf_status (Story status, status)"), out.out.join("\n"));
  assert.ok(out.out.includes('created view "Story status", a table grouped by Story status'));
});
