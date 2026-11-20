// What the story sync (index.mjs) and the work sync (work.mjs) share: an
// item's column text, a diff line cut to fit, a pinned comment planned and
// written, a value monday dropped on create, and the update, comment, and
// retire writes. The two differ only in what they want and which columns
// they compare.

import { changeValues, createUpdate, editUpdate, moveToGroup, pinUpdate, retryNotFound } from "./monday.mjs";
import { flat, tags } from "./wanted.mjs";

/** An item's text in one column, trimmed, or "". */
export const columnText = (item, columnId) => item?.column_values?.find((value) => value.id === columnId)?.text?.trim() ?? "";

/** Board text as one printable line: control characters, a guest's included, cannot move the terminal or fake a line. */
const printable = (text) => String(text ?? "").replace(/\s+/g, " ").replace(/[\x00-\x1f\x7f-\x9f]/g, "�");

/** "from → to", each cut to the part around where they first differ, so two long texts that share a start still show their change. */
export function difference(from, to, width = 60) {
  const [a, b] = [from, to].map(printable);
  if (!a || !b || (a.length <= width && b.length <= width)) return `${a.slice(0, width) || "(empty)"}${a.length > width ? "…" : ""} → ${b.slice(0, width) || "(empty)"}${b.length > width ? "…" : ""}`;
  let same = 0;
  while (same < a.length && same < b.length && a[same] === b[same]) same += 1;
  const start = Math.max(0, same - 20);
  const cut = (text) => `${start ? "…" : ""}${text.slice(start, start + width)}${text.length > start + width ? "…" : ""}`;
  return `${cut(a)} → ${cut(b)}`;
}

/**
 * The change a pinned comment needs, or null: added when `pinned` is
 * missing, else edited when its words or tags differ, and pinned again when a
 * run cut short left it unpinned. `kind` is the change's kind and `what` the
 * comment's name in the plan line, such as "acceptance" or "phase lead".
 */
export function pinnedChange(item, pinned, comment, { kind, id, what }) {
  if (!pinned) return { kind, id, itemId: item.id, updateId: null, comment, what: `add ${what}` };
  const stale = flat(pinned.text_body) !== flat(comment) || Boolean(pinned.body && tags(pinned.body) !== tags(comment));
  // monday lists where a comment is pinned, and an empty list is none.
  const unpinned = Array.isArray(pinned.pinned_to_top) && !pinned.pinned_to_top.some((pin) => String(pin.item_id) === String(item.id));
  if (!stale && !unpinned) return null;
  return { kind, id, itemId: item.id, updateId: pinned.id, comment, edit: stale, pin: unpinned, what: `${[stale && "edit", unpinned && "pin"].filter(Boolean).join(" and ")} ${what}` };
}

/** Whether a value was sent with something in it: a label, a text, a link, or a plain value. */
const sent = (value) => (value && typeof value === "object" ? Boolean(value.label || value.text || value.url || value.personsAndTeams?.length) : Boolean(value));

/**
 * Send again, at once, each value monday left empty on create, such as Atlas
 * NX's status on 2026-11-11. `texts` is what monday kept for each column sent.
 */
export async function resendDropped(client, config, item, values, id, log) {
  const dropped = Object.fromEntries(Object.entries(values).filter(([columnId, value]) => sent(value) && columnId in item.texts && !item.texts[columnId]));
  if (!Object.keys(dropped).length) return;
  await retryNotFound(client, () => changeValues(client, config.board.boardId, item.id, dropped));
  log(`set ${Object.keys(dropped).join(", ")} on ${id} again, which create left empty`);
}

/** Write an update, comment, or retire change, a story's or a work item's (`work-` before its kind). */
export async function writeChange(client, config, change, groupId, log) {
  const kind = change.kind.replace(/^work-/, "");
  if (kind === "update") {
    const values = { ...change.values, ...(change.name ? { name: change.name } : {}) };
    if (Object.keys(values).length) await changeValues(client, config.board.boardId, change.itemId, values);
    if (change.group) await moveToGroup(client, change.itemId, await groupId(change.group));
    log(`updated ${change.id}`);
  } else if (kind === "comment") {
    if (!change.updateId) {
      const updateId = await createUpdate(client, change.itemId, change.comment);
      await retryNotFound(client, () => pinUpdate(client, updateId, change.itemId));
    } else {
      if (change.edit !== false) await editUpdate(client, change.updateId, change.comment);
      if (change.pin) await retryNotFound(client, () => pinUpdate(client, change.updateId, change.itemId));
    }
    log(`comment ${change.id} ${!change.updateId ? "added and pinned" : [change.edit !== false && "edited", change.pin && "pinned"].filter(Boolean).join(" and ")}`);
  } else if (kind === "retire") {
    await moveToGroup(client, change.itemId, await groupId(change.group));
    log(`retired ${change.id}`);
  }
}
