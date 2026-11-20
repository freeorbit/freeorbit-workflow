// What the story sync (index.mjs) and the work sync (work.mjs) share: an
// item's column text, a diff line cut to fit, a pinned comment planned,
// written, compared with what monday kept, and checked after the writes, a
// value monday dropped on create, and the update, comment, and retire
// writes. The two differ only in what they want and which columns they
// compare.

import { changeValues, createUpdate, editUpdate, moveToGroup, pinUpdate, readUpdates, retryNotFound } from "./monday.mjs";

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
 * Our HTML as the text it shows: its tags gone first, then the three
 * entities escapeHtml writes decoded, so an escaped &lt;type&gt; stays as
 * words. Only our own HTML comes here; monday's text_body is text already.
 */
export const plainOfHtml = (html) =>
  String(html ?? "")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

/**
 * Plain text with bullets, backticks, and spacing gone, and curly quotes
 * straight, so two renderings of one comment compare equal. Its input is
 * text, such as monday's text_body, which holds <type> literally.
 */
export const flat = (text) =>
  String(text ?? "")
    .replace(/[`*•\s\u00a0]/g, "")
    .replace(/[’‘]/g, "'");

/** An HTML text's tags in order, without attributes, so a change of layout with the same words still shows. */
export const tags = (html) => [...String(html ?? "").matchAll(/<\/?([a-z0-9]+)/gi)].map((match) => match[0].toLowerCase()).join("");

/**
 * How a comment monday holds differs from the HTML we would send, or null:
 * "words …" from its text_body, which monday gives as plain text, or
 * "layout …" from its tags, without their attributes, when monday gives its
 * body.
 */
export function commentDiff(kept, html) {
  const [words, wanted] = [flat(kept.text_body), flat(plainOfHtml(html))];
  if (words !== wanted) return `words ${difference(words, wanted)}`;
  if (kept.body && tags(kept.body) !== tags(html)) return `layout ${difference(tags(kept.body), tags(html))}`;
  return null;
}

/**
 * The change a pinned comment needs, or null: added when `pinned` is
 * missing, else edited when its words or tags differ, and pinned again when a
 * run cut short left it unpinned. `kind` is the change's kind and `what` the
 * comment's name in the plan line, such as "acceptance" or "phase lead".
 */
export function pinnedChange(item, pinned, comment, { kind, id, what }) {
  const label = `${what} comment`;
  if (!pinned) return { kind, id, itemId: item.id, updateId: null, comment, label, what: `add ${what}` };
  const stale = commentDiff(pinned, comment) !== null;
  // monday lists where a comment is pinned, and an empty list is none.
  const unpinned = Array.isArray(pinned.pinned_to_top) && !pinned.pinned_to_top.some((pin) => String(pin.item_id) === String(item.id));
  if (!stale && !unpinned) return null;
  return { kind, id, itemId: item.id, updateId: pinned.id, comment, label, edit: stale, pin: unpinned, what: `${[stale && "edit", unpinned && "pin"].filter(Boolean).join(" and ")} ${what}` };
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

/** A comment posted and pinned on an item; resolves to its id. Each call retries while monday's reads catch up with the item. */
export async function postPinned(client, itemId, html) {
  const updateId = await retryNotFound(client, () => createUpdate(client, itemId, html));
  await retryNotFound(client, () => pinUpdate(client, updateId, itemId));
  return updateId;
}

/** How long checkKept waits between reads while monday's reads catch up with its writes. */
export const KEPT_WAITS = [500, 1000, 2000];
/** The most comments one read asks for. */
const KEPT_BATCH = 50;

/**
 * Each written comment monday did not keep as sent, as a problem line, read
 * back in batches after every write, again after each of KEPT_WAITS while
 * any still differs. monday ignores an edit that leaves what it keeps
 * unchanged, with no error, so a comment it keeps another way would be
 * edited on every run; this says so instead of a sync that reports success.
 * Each check is { id, updateId, html, label }.
 */
export async function checkKept(client, checks, waits = KEPT_WAITS) {
  let left = checks;
  const found = new Map();
  for (let attempt = 0; left.length; attempt += 1) {
    for (let i = 0; i < left.length; i += KEPT_BATCH) for (const kept of await readUpdates(client, left.slice(i, i + KEPT_BATCH).map((check) => check.updateId))) found.set(String(kept.id), kept);
    // A comment not read back yet is one monday's reads have not caught up with.
    left = left.filter((check) => !found.has(String(check.updateId)) || commentDiff(found.get(String(check.updateId)), check.html) !== null);
    if (!left.length || attempt >= waits.length) break;
    // A spread of a quarter either way, so runs started together do not read together.
    await client.sleep(Math.round(waits[attempt] * (0.75 + Math.random() / 2)));
  }
  return left.map((check) => {
    const kept = found.get(String(check.updateId));
    const how = kept ? commentDiff(kept, check.html) : "it could not be read back";
    return `${check.id}: monday kept its ${check.label} ${check.updateId} other than sent (${how}), so every sync would edit it again. If the words match, monday drops markup the kit sends: report this line against the kit`;
  });
}

/**
 * Write an update, comment, or retire change, a story's or a work item's
 * (`work-` before its kind). Resolves to the check of a comment it posted or
 * edited, for checkKept once every change is written, else null.
 */
export async function writeChange(client, config, change, groupId, log) {
  const kind = change.kind.replace(/^work-/, "");
  let check = null;
  if (kind === "update") {
    const values = { ...change.values, ...(change.name ? { name: change.name } : {}) };
    if (Object.keys(values).length) await changeValues(client, config.board.boardId, change.itemId, values);
    if (change.group) await moveToGroup(client, change.itemId, await groupId(change.group));
    log(`updated ${change.id}`);
  } else if (kind === "comment") {
    if (!change.updateId) check = { updateId: await postPinned(client, change.itemId, change.comment) };
    else {
      if (change.edit !== false) {
        await editUpdate(client, change.updateId, change.comment);
        check = { updateId: change.updateId };
      }
      if (change.pin) await retryNotFound(client, () => pinUpdate(client, change.updateId, change.itemId));
    }
    log(`comment ${change.id} ${!change.updateId ? "added and pinned" : [change.edit !== false && "edited", change.pin && "pinned"].filter(Boolean).join(" and ")}`);
  } else if (kind === "retire") {
    await moveToGroup(client, change.itemId, await groupId(change.group));
    log(`retired ${change.id}`);
  }
  return check && { ...check, id: change.id, html: change.comment, label: change.label };
}
