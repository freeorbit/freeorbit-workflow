// A small monday.com GraphQL client for `wf board`. It takes an injected
// fetch, so tests never reach the network, and the token only goes into the
// Authorization header: no message or error it makes includes it. monday
// answers a failed call with HTTP 200 and an `errors` list, so every reply's
// body is checked, not only its status.

export const ENDPOINT = "https://api.monday.com/v2";

const ITEM_FIELDS = (columns) => `id name group { id title }
  column_values(ids: ${JSON.stringify(columns)}) { id text }
  updates(limit: 100) { id body text_body creator_id creator { name kind } created_at updated_at pinned_to_top { item_id }
    replies { id text_body creator_id creator { name kind } created_at updated_at } }`;

/** The waits, in milliseconds, before each retry of a call on something just made. */
export const NOT_FOUND_WAITS = [500, 1000, 2000, 4000];

/**
 * `fn()`, tried again after each wait while monday says what it names is not
 * found. monday's reads lag its writes, so an update or item made a moment ago
 * may not be found yet: Atlas NX's first sync failed "Update not found" on the
 * pin right after its comment was posted (2026-11-11). Any other error, and the
 * last not-found, is thrown as it is, naming how long it waited.
 */
export async function retryNotFound(client, fn, waits = NOT_FOUND_WAITS) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      if (!/\b(update|item|group|board) not found\b/i.test(error.message)) throw error;
      if (attempt >= waits.length) throw new Error(`${error.message} (still, after waiting ${waits.reduce((sum, wait) => sum + wait, 0) / 1000}s for monday to catch up)`);
      await client.sleep(waits[attempt]);
    }
  }
}

/** A client: `call(query, variables)` resolves to the reply's data, or throws with monday's messages. */
export function mondayClient({ token, apiVersion, fetch = globalThis.fetch, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
  if (!token) throw new Error("no monday token");
  async function call(query, variables = {}) {
    let res;
    try {
      res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: token, "API-Version": apiVersion },
        body: JSON.stringify({ query, variables }),
      });
    } catch (error) {
      throw new Error(`monday did not answer: ${error.message}`);
    }
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error(`monday answered ${res.status} with no JSON`);
    }
    const errors = body.errors ?? (body.error_message ? [{ message: body.error_message }] : []);
    if (res.status !== 200 || errors.length) {
      const messages = errors.map((error) => error.message).join("; ") || `HTTP ${res.status}`;
      throw new Error(`monday: ${messages.replaceAll(token, "<token>")}`);
    }
    return body.data;
  }
  return { call, sleep };
}

/** Who the token belongs to. */
export async function whoAmI(client) {
  return (await client.call("query { me { id name } }")).me;
}

/** The board's columns, groups, views, and every item, read page by page. */
/** The board's columns, groups, views, and every item, read page by page. */
export async function readBoard(client, boardId, columnIds) {
  const first = await client.call(
    `query ($b: [ID!]) { boards(ids: $b) { id name board_kind hierarchy_type
      columns { id title type settings_str settings revision capabilities { calculated { function } } } groups { id title } views { name type }
      items_page(limit: 200) { cursor items { ${ITEM_FIELDS(columnIds)} } } } }`,
    { b: [String(boardId)] },
  );
  const board = first.boards?.[0];
  if (!board) throw new Error(`monday has no board ${boardId} this token can see`);
  const items = [...board.items_page.items];
  let cursor = board.items_page.cursor;
  while (cursor) {
    const next = await client.call(`query ($c: String!) { next_items_page(limit: 200, cursor: $c) { cursor items { ${ITEM_FIELDS(columnIds)} } } }`, { c: cursor });
    items.push(...next.next_items_page.items);
    cursor = next.next_items_page.cursor;
  }
  // A board from monday's project template is multi-level, where a new status column rolls up child items.
  return { id: board.id, name: board.name, kind: board.board_kind, multiLevel: board.hierarchy_type === "multi_level", columns: board.columns, groups: board.groups, views: board.views ?? [], items };
}

export const createGroup = async (client, boardId, name) =>
  (await client.call("mutation ($b: ID!, $n: String!) { create_group(board_id: $b, group_name: $n) { id } }", { b: String(boardId), n: name })).create_group.id;

/** Create an item; resolves to { id, texts }, the text monday kept for each column sent, so a value it dropped shows. */
export async function createItem(client, boardId, groupId, name, values) {
  const made = (
    await client.call(
      "mutation ($b: ID!, $g: String, $n: String!, $v: JSON, $c: [String!]) { create_item(board_id: $b, group_id: $g, item_name: $n, column_values: $v, create_labels_if_missing: false) { id column_values(ids: $c) { id text } } }",
      { b: String(boardId), g: groupId, n: name, v: JSON.stringify(values), c: Object.keys(values) },
    )
  ).create_item;
  return { id: made.id, texts: Object.fromEntries((made.column_values ?? []).map((value) => [value.id, value.text ?? ""])) };
}

export const changeValues = (client, boardId, itemId, values) =>
  client.call("mutation ($b: ID!, $i: ID, $v: JSON!) { change_multiple_column_values(board_id: $b, item_id: $i, column_values: $v, create_labels_if_missing: false) { id } }", {
    b: String(boardId),
    i: String(itemId),
    v: JSON.stringify(values),
  });

export const moveToGroup = (client, itemId, groupId) => client.call("mutation ($i: ID, $g: String!) { move_item_to_group(item_id: $i, group_id: $g) { id } }", { i: String(itemId), g: groupId });

export const createUpdate = async (client, itemId, body) =>
  (await client.call("mutation ($i: ID!, $b: String!) { create_update(item_id: $i, body: $b) { id } }", { i: String(itemId), b: body })).create_update.id;

export const replyTo = async (client, itemId, parentId, body) =>
  (await client.call("mutation ($i: ID!, $p: ID, $b: String!) { create_update(item_id: $i, parent_id: $p, body: $b) { id } }", { i: String(itemId), p: String(parentId), b: body })).create_update.id;

export const editUpdate = (client, updateId, body) => client.call("mutation ($u: ID!, $b: String!) { edit_update(id: $u, body: $b) { id } }", { u: String(updateId), b: body });

export const pinUpdate = (client, updateId, itemId) => client.call("mutation ($u: ID!, $i: ID) { pin_to_top(id: $u, item_id: $i) { id } }", { u: String(updateId), i: String(itemId) });

/**
 * monday's status colours in the order its API lists them; a label's
 * `color` number in a column's settings is its place here (checked
 * 2026-11-11: 3 is dark_blue, 17 american_gray).
 */
export const STATUS_COLORS =
  "working_orange done_green stuck_red dark_blue purple explosive grass_green bright_blue saladish egg_yolk blackish dark_red sofia_pink lipstick dark_purple bright_green chili_blue american_gray brown dark_orange sunset bubble peach berry winter river navy aquamarine indigo dark_indigo pecan lavender royal steel orchid lilac tan sky coffee teal".split(
    " ",
  );

/**
 * A label's colour by the API's name, or null. A colour's number is its place in
 * STATUS_COLORS only for monday's first colours; a board's labels can use newer
 * ones, such as Atlas NX's 105 and 108 (2026-11-11), which the API's enum cannot
 * name. Resending such a label would recolour it, so nothing is resent then.
 */
export const colorName = (label) => (Number.isInteger(label.color) && label.color < STATUS_COLORS.length ? STATUS_COLORS[label.color] : null);

/** The labels of a status column whose colour the API cannot name. */
export const unnamedColors = (settings) => (settings?.labels ?? []).filter((label) => !colorName(label));

/**
 * A status column's labels with `missing` added: every existing label keeps its
 * id, colour, and place, and each new one takes a colour no label has, since
 * monday refuses two labels of one colour. Throws when no colour is left.
 */
export function withLabels(settings, missing, renames = {}, { done } = {}) {
  const unnamed = unnamedColors(settings);
  if (unnamed.length) throw new Error(`labels ${unnamed.map((label) => `"${label.label}"`).join(", ")} use colours monday's API cannot name, so their column's labels are not resent`);
  // A renamed label keeps its id, so every item set to it stays set and reads the new name.
  // A deactivated label is sent as deactivated, or monday would bring it back.
  const existing = (settings?.labels ?? []).map((label) => ({
    id: label.id,
    label: renames[label.id] ?? label.label,
    color: colorName(label),
    index: label.index,
    // `done` marks the label so named done, as a column made with its own labels starts with none.
    is_done: done ? (renames[label.id] ?? label.label) === done || Boolean(label.is_done) : Boolean(label.is_done),
    ...(label.is_deactivated ? { is_deactivated: true } : {}),
  }));
  const used = new Set((settings?.labels ?? []).map((label) => label.color));
  const free = STATUS_COLORS.filter((name, i) => !used.has(i));
  if (missing.length > free.length) throw new Error(`the status column has room for ${free.length} more colours, not ${missing.length}`);
  const next = Math.max(-1, ...existing.map((label) => label.index)) + 1;
  return [...existing, ...missing.map((label, i) => ({ label, color: free[i], index: next + i }))];
}

/**
 * Change a status column: add `labels` (from withLabels), and with `noRollup`
 * turn off the rollup a multi-level board gives a new status column, whose
 * writes monday otherwise accepts and drops. Its function enum has only
 * COUNT_KEYS, so the rollup is cleared with null, not a NONE.
 */
export function updateStatusColumn(client, boardId, columnId, revision, { labels, noRollup = false, title } = {}) {
  const parts = [labels ? "settings: $s" : "", noRollup ? "capabilities: { calculated: null }" : "", title ? "title: $t" : ""].filter(Boolean).join(", ");
  const args = [labels ? ", $s: UpdateStatusColumnSettingsInput!" : "", title ? ", $t: String!" : ""].join("");
  return client.call(`mutation ($b: ID!, $id: String!, $r: String!${args}) { update_status_column(board_id: $b, id: $id, revision: $r, ${parts}) { id } }`, {
    b: String(boardId),
    id: columnId,
    r: revision,
    ...(labels ? { s: { labels } } : {}),
    ...(title ? { t: title } : {}),
  });
}

export const changeColumnTitle = (client, boardId, columnId, title) =>
  client.call("mutation ($b: ID!, $c: String!, $t: String!) { change_column_title(board_id: $b, column_id: $c, title: $t) { id } }", { b: String(boardId), c: columnId, t: title });

/**
 * A table view grouped by a column, one block of rows per label. monday's API
 * makes no Kanban views (ViewKind is DASHBOARD, TABLE, FORM, or APP, checked
 * 2026-11-11), so this is the closest a setup can make; a Kanban is added by hand.
 */
export const createGroupedView = (client, boardId, name, columnId) =>
  client.call("mutation ($b: ID!, $n: String!, $s: TableViewSettingsInput) { create_view_table(board_id: $b, name: $n, settings: $s) { id } }", {
    b: String(boardId),
    n: name,
    s: { group_by: { conditions: [{ columnId }] } },
  });

export const createColumn = (client, boardId, { id, title, type, defaults }) =>
  client.call("mutation ($b: ID!, $id: String, $t: String!, $ty: ColumnType!, $d: JSON) { create_column(board_id: $b, id: $id, title: $t, column_type: $ty, defaults: $d) { id } }", {
    b: String(boardId),
    id,
    t: title,
    ty: type,
    d: defaults ? JSON.stringify(defaults) : undefined,
  });
