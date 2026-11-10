// A small monday.com GraphQL client for `wf board`. It takes an injected
// fetch, so tests never reach the network, and the token only goes into the
// Authorization header: no message or error it makes includes it. monday
// answers a failed call with HTTP 200 and an `errors` list, so every reply's
// body is checked, not only its status.

export const ENDPOINT = "https://api.monday.com/v2";

const ITEM_FIELDS = (columns) => `id name group { id title }
  column_values(ids: ${JSON.stringify(columns)}) { id text }
  updates(limit: 100) { id text_body creator_id creator { name kind } created_at updated_at
    replies { id text_body creator_id creator { name kind } created_at updated_at } }`;

/** A client: `call(query, variables)` resolves to the reply's data, or throws with monday's messages. */
export function mondayClient({ token, apiVersion, fetch = globalThis.fetch }) {
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
  return { call };
}

/** Who the token belongs to. */
export async function whoAmI(client) {
  return (await client.call("query { me { id name } }")).me;
}

/** The board's columns, groups, views, and every item, read page by page. */
export async function readBoard(client, boardId, columnIds) {
  const first = await client.call(
    `query ($b: [ID!]) { boards(ids: $b) { id name board_kind
      columns { id title type settings_str } groups { id title } views { name type }
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
  return { id: board.id, name: board.name, kind: board.board_kind, columns: board.columns, groups: board.groups, views: board.views ?? [], items };
}

export const createGroup = async (client, boardId, name) =>
  (await client.call("mutation ($b: ID!, $n: String!) { create_group(board_id: $b, group_name: $n) { id } }", { b: String(boardId), n: name })).create_group.id;

export const createItem = async (client, boardId, groupId, name, values) =>
  (
    await client.call(
      "mutation ($b: ID!, $g: String, $n: String!, $v: JSON) { create_item(board_id: $b, group_id: $g, item_name: $n, column_values: $v, create_labels_if_missing: false) { id } }",
      { b: String(boardId), g: groupId, n: name, v: JSON.stringify(values) },
    )
  ).create_item.id;

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

export const createColumn = (client, boardId, { id, title, type, defaults }) =>
  client.call("mutation ($b: ID!, $id: String, $t: String!, $ty: ColumnType!, $d: JSON) { create_column(board_id: $b, id: $id, title: $t, column_type: $ty, defaults: $d) { id } }", {
    b: String(boardId),
    id,
    t: title,
    ty: type,
    d: defaults ? JSON.stringify(defaults) : undefined,
  });
