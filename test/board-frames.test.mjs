import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

import { merge } from "../lib/config.mjs";
import { DEFAULTS } from "../lib/defaults.mjs";
import { runBoard } from "../lib/board/index.mjs";
import { fileNames, readPicture, wantedFrames } from "../lib/board/frames.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(join(here, "fixtures/board", name), "utf8");
const SCREENS = `# app screens

## Sign in

| Frame | Stories | Reach | What it shows |
| --- | --- | --- | --- |
| \`sign-in\` | APP-01 | \`fresh › go /sign-in\` | The empty form. |
| \`sign-in-wait\` | APP-01 | \`locked › go /sign-in\` | After 5 tries. |
| \`sign-in-gone\` | APP-01 | \`fresh › go /x\` | A frame with no picture. |

## Home

| Frame | Stories | Reach | What it shows |
| --- | --- | --- | --- |
| \`home\` | APP-01, APP-02 | \`signed-in › go /\` | Signed in. |

## Screens with no frame

| Screen | Stories | Reach | What it shows |
| --- | --- | --- | --- |
| \`deep-link\` | APP-01 | \`deep › go /r\` | No picture, by design. |
`;
const PICTURES = { "docs/design/review/app/sign-in/sign-in.png": "png-a", "docs/design/review/app/sign-in/sign-in-wait.png": "png-b", "docs/design/review/app/home/home.png": "png-c" };
const config = (board = {}) => merge(DEFAULTS, { areas: [{ id: "app", prefix: "APP", docs: "docs/app" }], stories: { files: ["docs/app/user-stories.md"] }, board: { boardId: "42", ...board } });

/** A project whose screen list names its frames, with pictures as plain bytes. */
function context(more = {}, { screens = SCREENS, pictures = PICTURES } = {}) {
  const all = { "docs/app/user-stories.md": fixture("user-stories.md"), "docs/log/build-order.md": fixture("build-order.md"), "docs/log/chunks-done.md": fixture("chunks-done.md"), "docs/app/design/screens.md": screens };
  return { root: "/project", config: config(more), tracked: [...Object.keys(all), ...Object.keys(pictures)], files: (path) => all[path], pictures };
}

/** A board whose file column takes multipart uploads, appending, and clears on clear_all. */
function monday() {
  const columns = [["story_id", "text"], ["area", "text"], ["chunk", "text"], ["story", "long_text"], ["pr", "link"], ["owner", "people"], ["frames", "file"]].map(([id, type]) => ({ id, title: id, type, settings_str: "{}" }));
  columns.push({ id: "wf_status", title: "Build", type: "status", settings_str: JSON.stringify({ labels: { 0: "Drafting", 1: "Built", 2: "Backlog", 3: "Planned", 4: "In progress", 6: "Checking" } }) }, { id: "client_review", title: "Client review", type: "status", settings_str: "{}" });
  const state = { columns, items: [], groups: [], next: 1, uploads: [], clears: [] };
  const shown = (item) => ({
    id: item.id,
    name: item.name,
    group: state.groups.find((group) => group.id === item.group),
    column_values: columns.map((column) => (column.id === "frames" ? { id: "frames", text: "", value: JSON.stringify({ files: item.files.map((name) => ({ name })) }) } : { id: column.id, text: item.values[column.id] ?? "" })),
    updates: item.updates,
  });
  const fetch = async (url, init) => {
    const ok = (data) => ({ status: 200, text: async () => JSON.stringify({ data }) });
    if (url.endsWith("/v2/file")) {
      // The multipart upload: the query names the item and column, the file part its name.
      const query = init.body.get("query");
      const file = init.body.get("variables[file]");
      const itemId = query.match(/item_id: (\d+)/)[1];
      const item = state.items.find((each) => each.id === itemId);
      item.files.push(file.name);
      state.uploads.push({ item: item.values.story_id, name: file.name, bytes: Buffer.from(await file.arrayBuffer()).toString() });
      return ok({ add_file_to_column: { id: `f${state.next++}`, name: file.name } });
    }
    const { query, variables: v } = JSON.parse(init.body);
    const op = query.match(/\b(me|boards|create_group|create_item|create_update|pin_to_top|change_column_value)\b/)[1];
    if (op === "me") return ok({ me: { id: "7" } });
    if (op === "boards") return ok({ boards: [{ id: "42", name: "Test", board_kind: "share", columns, groups: state.groups, views: [{ name: "Build" }, { name: "Client review" }], items_page: { cursor: null, items: state.items.map(shown) } }] });
    if (op === "create_group") {
      state.groups.push({ id: `g${state.next}`, title: v.n });
      return ok({ create_group: { id: `g${state.next++}` } });
    }
    if (op === "create_item") {
      const values = Object.fromEntries(Object.entries(JSON.parse(v.v)).map(([key, value]) => [key, typeof value === "object" ? (value.label ?? value.text ?? "") : value]));
      const item = { id: String(state.next++), name: v.n, group: v.g, values, files: [], updates: [] };
      state.items.push(item);
      return ok({ create_item: { id: item.id, column_values: v.c.map((id) => ({ id, text: values[id] ?? "" })) } });
    }
    const item = state.items.find((each) => each.id === v.i);
    if (op === "create_update") {
      const update = { id: `u${state.next++}`, body: v.b, text_body: v.b.replace(/<[^>]+>/g, " "), creator_id: "7", pinned_to_top: [] };
      item.updates.unshift(update);
      return ok({ create_update: { id: update.id } });
    }
    if (op === "pin_to_top") {
      item.updates.find((update) => update.id === v.u).pinned_to_top = [{ item_id: v.i }];
      return ok({ pin_to_top: { id: v.u } });
    }
    if (op === "change_column_value") {
      assert.match(query, /clear_all/);
      item.files = [];
      state.clears.push(item.values.story_id);
      return ok({ change_column_value: { id: v.i } });
    }
    throw new Error(`frames monday: ${op}`);
  };
  return { state, fetch };
}

async function run(args, board, more, project) {
  const ctx = context(more, project);
  const out = [];
  const code = await runBoard(ctx, args, { env: { MONDAY_API_TOKEN: "tok-0123456789abcdef" }, fetch: board.fetch, log: (line) => out.push(line), git: () => "", sleep: async () => {}, readBytes: (path) => Buffer.from(ctx.pictures[path]) });
  return { code, out };
}

test("each story shows every frame its screen-list row names, in order, a frame with no picture noted", async () => {
  const board = monday();
  const planned = await run(["plan"], board);
  assert.ok(planned.out.includes("frames  APP-01 3 to upload (sign-in, sign-in-wait, home)"), planned.out.join("\n"));
  assert.ok(planned.out.includes("frames  APP-02 1 to upload (home)"));
  assert.ok(planned.out.includes("skip    frame sign-in-gone has no PNG under docs/design/review/app/, so APP-01 shows the rest"));
  assert.ok(!planned.out.some((line) => line.includes("deep-link")), "a Screen row has no picture");
  const synced = await run(["sync"], board);
  assert.equal(synced.code, 0, synced.out.join("\n"));
  assert.deepEqual(board.state.uploads.filter((each) => each.item === "APP-01").map((each) => each.name.replace(/\.[0-9a-f]{8}\.png$/, "")), ["sign-in", "sign-in-wait", "home"]);
  assert.match(board.state.uploads[0].name, /^sign-in\.[0-9a-f]{8}\.png$/);
  assert.deepEqual(board.state.clears, [], "a new item's column has nothing to clear");
  const again = await run(["plan"], board);
  assert.ok(!again.out.some((line) => line.startsWith("frames ")), again.out.join("\n"));
});

test("a changed picture sends the whole set again, and a story no frame names any more is cleared", async () => {
  const board = monday();
  await run(["sync"], board);
  const changed = { ...PICTURES, "docs/design/review/app/sign-in/sign-in-wait.png": "png-b2" };
  const planned = await run(["plan"], board, {}, { pictures: changed });
  assert.deepEqual(planned.out.filter((line) => line.startsWith("frames ")), ["frames  APP-01 3 to upload (sign-in, sign-in-wait, home)"]);
  const before = board.state.uploads.length;
  await run(["sync"], board, {}, { pictures: changed });
  assert.deepEqual(board.state.clears, ["APP-01"]);
  assert.deepEqual(board.state.uploads.slice(before).map((each) => each.bytes), ["png-a", "png-b2", "png-c"], "the set again, in order");
  const unnamed = SCREENS.replace("| `home` | APP-01, APP-02 |", "| `home` | APP-01 |");
  const cleared = await run(["plan"], board, {}, { screens: unnamed, pictures: changed });
  assert.ok(cleared.out.includes("frames  APP-02 clear"), cleared.out.join("\n"));
  await run(["sync"], board, {}, { screens: unnamed, pictures: changed });
  assert.deepEqual(board.state.items.find((item) => item.values.story_id === "APP-02").files, []);
});

test("with board.show.frames off there is no column check, no plan line, and no upload", async () => {
  const board = monday();
  board.state.columns.splice(board.state.columns.findIndex((column) => column.id === "frames"), 1);
  const off = { show: { frames: false } };
  assert.deepEqual((await run(["setup"], board, off)).out, ["The board is set up."]);
  const planned = await run(["plan"], board, off);
  assert.ok(!planned.out.some((line) => /^frames |frame /.test(line)), planned.out.join("\n"));
  await run(["sync"], board, off);
  assert.deepEqual(board.state.uploads, []);
  assert.equal(DEFAULTS.board.show.frames, true, "on by default");
  const on = await run(["setup"], board);
  assert.ok(on.out.includes("column frames (Frames, file) is missing"));
});

test("a picture over board.frameMaxBytes is skipped with a note", () => {
  const ctx = context({ frameMaxBytes: 4 });
  const { byStory, notes } = wantedFrames(ctx, { readBytes: (path) => Buffer.from(ctx.pictures[path]) });
  assert.equal(byStory.size, 0);
  assert.ok(notes.includes("frame sign-in is 5 bytes, over board.frameMaxBytes 4, so it is not uploaded"), notes.join("\n"));
  assert.deepEqual(fileNames('{"files":[{"name":"a.1.png"},{"name":"b.2.png"}]}'), ["a.1.png", "b.2.png"]);
  assert.deepEqual(fileNames("not json"), []);
});

test("only a real .png inside the review folder is ever read", () => {
  const root = mkdtempSync(join(tmpdir(), "wf-frames-"));
  mkdirSync(join(root, "docs/design/review/app"), { recursive: true });
  writeFileSync(join(root, "docs/design/review/app/ok.png"), "png");
  writeFileSync(join(root, "secret.png"), "secret");
  writeFileSync(join(root, "docs/design/review/app/note.txt"), "text");
  symlinkSync(join(root, "secret.png"), join(root, "docs/design/review/app/link.png"));
  assert.equal(readPicture(root, "docs/design/review", "docs/design/review/app/ok.png").toString(), "png");
  assert.throws(() => readPicture(root, "docs/design/review", "docs/design/review/app/link.png"), /is a link/);
  assert.throws(() => readPicture(root, "docs/design/review", "docs/design/review/../../../secret.png"), /outside docs\/design\/review/);
  assert.throws(() => readPicture(root, "docs/design/review", "docs/design/review/app/note.txt"), /is not a \.png/);
});
