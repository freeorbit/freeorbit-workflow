import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { merge } from "../lib/config.mjs";
import { DEFAULTS } from "../lib/defaults.mjs";
import { runBoard } from "../lib/board/index.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(join(here, "fixtures/board", name), "utf8");
const files = { "docs/app/user-stories.md": fixture("user-stories.md"), "docs/log/build-order.md": fixture("build-order.md"), "docs/log/chunks-done.md": fixture("chunks-done.md") };
// As Atlas NX: the template's own status column, project_status, is the kit's.
const context = () => ({
  root: "/project",
  config: merge(DEFAULTS, { areas: [{ id: "app", prefix: "APP", docs: "docs/app" }], stories: { files: ["docs/app/user-stories.md"] }, board: { boardId: "42", columns: { status: "project_status" } } }),
  tracked: Object.keys(files),
  files: (path) => files[path],
});
const LABELS = { 0: "Drafting", 3: "Backlog", 7: "Planned", 9: "In progress", 17: "Checking", 1: "Done" };

/**
 * A multi-level board, as monday's project template makes. While a status
 * column rolls up child items, monday leaves it out of every item and drops a
 * write to it; with the rollup off it is a plain status column. A status
 * column created there starts with the rollup on.
 */
function multiLevelMonday({ rollup = true, status = true } = {}) {
  const statusColumn = (id, title) => ({ id, title, type: "status", revision: "r1", settings_str: JSON.stringify({ labels: LABELS }), settings: { labels: [] }, capabilities: { calculated: { function: "COUNT_KEYS" } } });
  const others = [["story_id", "text"], ["area", "text"], ["chunk", "text"], ["story", "long_text"], ["pr", "link"], ["owner", "people"]].map(([id, type]) => ({ id, title: id, type, settings_str: "{}", capabilities: { calculated: null } }));
  const state = { columns: [...others], items: [], groups: [{ id: "topics", title: "Group Title" }], next: 1, ops: [], cleared: [] };
  if (status) {
    const own = statusColumn("project_status", "Status");
    if (!rollup) own.capabilities.calculated = null;
    state.columns.push(own);
  }
  const rolls = (id) => Boolean(state.columns.find((column) => column.id === id)?.capabilities?.calculated);
  const shown = (item) => ({
    id: item.id,
    name: item.name,
    group: state.groups.find((group) => group.id === item.group),
    column_values: state.columns.filter((column) => !(column.type === "status" && rolls(column.id))).map((column) => ({ id: column.id, text: item.values[column.id] ?? "" })),
    updates: item.updates,
  });
  const write = (item, values) => {
    for (const [key, value] of Object.entries(values)) {
      if (rolls(key)) continue;
      item.values[key] = typeof value === "object" ? (value.label ?? value.text ?? value.url ?? "") : value;
    }
  };
  const fetch = async (url, init) => {
    const { query, variables: v } = JSON.parse(init.body);
    const op = query.match(/\b(me|boards|create_group|create_item|change_multiple_column_values|create_update|pin_to_top|update_status_column|create_column)\b/)[1];
    state.ops.push(op);
    const ok = (data) => ({ status: 200, text: async () => JSON.stringify({ data }) });
    if (op === "me") return ok({ me: { id: "7" } });
    if (op === "boards") return ok({ boards: [{ id: "42", name: "Client board", board_kind: "share", hierarchy_type: "multi_level", columns: state.columns, groups: state.groups, views: [{ name: "Kanban" }], items_page: { cursor: null, items: state.items.map(shown) } }] });
    if (op === "create_group") {
      state.groups.push({ id: `g${state.next}`, title: v.n });
      return ok({ create_group: { id: `g${state.next++}` } });
    }
    if (op === "create_item") {
      const item = { id: `i${state.next++}`, name: v.n, group: v.g, values: {}, updates: [] };
      write(item, JSON.parse(v.v));
      state.items.push(item);
      return ok({ create_item: { id: item.id, column_values: shown(item).column_values.filter((value) => v.c.includes(value.id)) } });
    }
    const item = state.items.find((each) => each.id === v.i);
    if (op === "change_multiple_column_values") {
      write(item, JSON.parse(v.v));
      return ok({ change_multiple_column_values: { id: v.i } });
    }
    if (op === "create_update") {
      const update = { id: `u${state.next++}`, body: v.b, text_body: v.b.replace(/<\/(p|li)>/g, "\n").replace(/<[^>]+>/g, ""), creator_id: "7", pinned_to_top: [] };
      item.updates.unshift(update);
      return ok({ create_update: { id: update.id } });
    }
    if (op === "pin_to_top") {
      state.items.flatMap((each) => each.updates).find((update) => update.id === v.u).pinned_to_top = [{ item_id: v.i }];
      return ok({ pin_to_top: { id: v.u } });
    }
    if (op === "update_status_column") {
      if (query.includes("calculated: null")) {
        state.columns.find((column) => column.id === v.id).capabilities.calculated = null;
        state.cleared.push(v.id);
      }
      return ok({ update_status_column: { id: v.id } });
    }
    if (op === "create_column") {
      state.columns.push(statusColumn(v.id, v.t));
      return ok({ create_column: { id: v.id } });
    }
    throw new Error(`multi-level monday: ${op}`);
  };
  return { state, fetch };
}

async function run(args, monday) {
  const out = [];
  const code = await runBoard(context(), args, { env: { MONDAY_API_TOKEN: "tok-0123456789abcdef" }, fetch: monday.fetch, log: (line) => out.push(line), git: () => "", sleep: async () => {} });
  return { code, out };
}

const ROLLUP = "column project_status (Status) rolls up child items, so monday ignores writes; wf board setup --create turns the rollup off";

test("a status column that rolls up child items is the problem setup names, and plan and sync stop on it", async () => {
  const monday = multiLevelMonday({ rollup: true });
  const setup = await run(["setup"], monday);
  assert.equal(setup.code, 1);
  assert.deepEqual(setup.out, [ROLLUP, "1 to fix; wf board setup --create makes the missing columns."]);
  const planned = await run(["plan"], monday);
  assert.equal(planned.code, 1);
  assert.ok(planned.out.includes(`board   ${ROLLUP}`), planned.out.join("\n"));
  const before = monday.state.ops.length;
  assert.equal((await run(["sync"], monday)).code, 1);
  assert.deepEqual([...new Set(monday.state.ops.slice(before))].sort(), ["boards", "me"], "sync writes nothing");
});

test("setup --create turns the rollup off, and then sync writes the statuses and finds them in step", async () => {
  const monday = multiLevelMonday({ rollup: true });
  const fixed = await run(["setup", "--create"], monday);
  assert.equal(fixed.code, 0, fixed.out.join("\n"));
  assert.ok(fixed.out.includes("turned off column project_status's rollup of child items"));
  assert.deepEqual(monday.state.cleared, ["project_status"]);
  const synced = await run(["sync"], monday);
  assert.equal(synced.code, 0, synced.out.join("\n"));
  assert.deepEqual(monday.state.items.map((item) => `${item.values.story_id} ${item.values.project_status}`), ["APP-01 Done", "APP-02 Planned", "APP-04 In progress"]);
  assert.deepEqual((await run(["plan"], monday)).out, ["0 to create, 0 to update, 0 comments, 0 to retire, 3 unchanged."]);
});

test("a status column setup --create makes on a multi-level board has its rollup turned off in the same run", async () => {
  const monday = multiLevelMonday({ status: false });
  const made = await run(["setup", "--create"], monday);
  assert.equal(made.code, 0, made.out.join("\n"));
  assert.ok(made.out.includes("created column project_status (Status, status)"));
  assert.ok(made.out.includes("turned off column project_status's rollup of child items"));
  assert.equal(monday.state.columns.find((column) => column.id === "project_status").capabilities.calculated, null);
});

test("on a multi-level board, a column items lack is put down to a rollup first", async () => {
  const monday = multiLevelMonday({ rollup: false });
  await run(["sync"], monday);
  // A column with no rollup that items still lack, such as one a linked portfolio keeps.
  monday.state.columns.push({ id: "wf_status", title: "Story status", type: "status", settings_str: JSON.stringify({ labels: LABELS }), capabilities: { calculated: null } });
  const hidden = monday.state.columns.find((column) => column.id === "wf_status");
  const fetch = monday.fetch;
  monday.fetch = async (url, init) => {
    const reply = await fetch(url, init);
    const body = JSON.parse(await reply.text());
    for (const item of body.data?.boards?.[0]?.items_page?.items ?? []) item.column_values = item.column_values.filter((value) => value.id !== hidden.id);
    return { status: 200, text: async () => JSON.stringify(body) };
  };
  const out = [];
  const code = await runBoard({ ...context(), config: merge(context().config, { board: { columns: { status: "wf_status" }, titles: { status: "Story status" } } }) }, ["setup"], { env: { MONDAY_API_TOKEN: "tok-0123456789abcdef" }, fetch: monday.fetch, log: (line) => out.push(line), git: () => "" });
  assert.equal(code, 1);
  assert.ok(out.includes("column wf_status (Story status) can't be set on items; on this multi-level board a rollup of child items is the likely cause, else a portfolio's column, so use a column of your own"), out.join("\n"));
});
