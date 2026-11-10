// A live picker for `wf try`: arrow keys move, typing filters, Enter picks.
// Items come in groups, shown as headings. It uses only Node's own keypress
// events, and draws on the terminal's alternate screen, so the list leaves
// nothing behind. The pure parts (grouping, filtering, the view) are tested.

import { emitKeypressEvents } from "node:readline";

/** Items in groups by a field, in the order each group first appears; items without one go under `other`, last. */
export function groupBy(items, key, other = "Other") {
  const order = [];
  for (const item of items) {
    const name = item[key] || other;
    if (!order.includes(name)) order.push(name);
  }
  order.sort((a, b) => (a === other) - (b === other));
  return order.map((name) => ({ name, items: items.filter((item) => (item[key] || other) === name) }));
}

/** The groups with only the items whose text holds every word of the query. */
export function filterGroups(groups, query, text) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return groups
    .map((group) => ({ ...group, items: group.items.filter((item) => words.every((word) => text(item).toLowerCase().includes(word))) }))
    .filter((group) => group.items.length > 0);
}

/**
 * The lines to draw: the title and the filter, then the groups, with the
 * cursor's item marked, scrolled so it stays in view within `height` lines.
 */
export function view({ title, groups, query, cursor, height, line, width = 120 }) {
  const body = [];
  let at = 0;
  let cursorLine = 0;
  for (const group of groups) {
    body.push(`\x1b[1m${group.name}\x1b[0m (${group.items.length})`);
    for (const item of group.items) {
      if (at === cursor) cursorLine = body.length;
      const text = `${at === cursor ? "> " : "  "}${line(item)}`.slice(0, width - 2);
      body.push(at === cursor ? `\x1b[7m${text}\x1b[0m` : text);
      at += 1;
    }
    body.push("");
  }
  if (at === 0) body.push("  Nothing matches. Backspace or Esc to widen it.");
  const head = [`${title}  filter: ${query}█`, ""];
  const foot = ["", "↑↓ move · PgUp PgDn · type to filter · Enter pick · Esc clear, then quit"];
  const room = Math.max(3, height - head.length - foot.length);
  const top = Math.min(Math.max(0, cursorLine - Math.floor(room / 2)), Math.max(0, body.length - room));
  return [...head, ...body.slice(top, top + room), ...foot];
}

/** Every item in group order, as the cursor counts them. */
export const flatten = (groups) => groups.flatMap((group) => group.items);

/**
 * Pick one item. Resolves with the item, or null when the person quits.
 * `text` is what the filter searches, and `line` how a row is drawn.
 */
export function pick({ title, groups, text, line, input = process.stdin, output = process.stdout }) {
  return new Promise((done) => {
    let query = "";
    let cursor = 0;
    const shown = () => filterGroups(groups, query, text);
    const draw = () => {
      const lines = view({ title, groups: shown(), query, cursor, height: output.rows ?? 24, line, width: output.columns ?? 120 });
      output.write(`\x1b[H\x1b[J${lines.join("\n")}`);
    };
    const finish = (item) => {
      input.off("keypress", onKey);
      output.off("resize", draw);
      input.setRawMode(false);
      input.pause();
      output.write("\x1b[?25h\x1b[?1049l");
      done(item);
    };
    const onKey = (chunk, key = {}) => {
      const items = flatten(shown());
      const page = Math.max(1, (output.rows ?? 24) - 8);
      if (key.ctrl && key.name === "c") return finish(null);
      if (key.name === "return") return items.length ? finish(items[cursor]) : undefined;
      if (key.name === "escape") {
        if (!query) return finish(null);
        query = "";
        cursor = 0;
      } else if (key.name === "up") cursor = Math.max(0, cursor - 1);
      else if (key.name === "down") cursor = Math.min(items.length - 1, cursor + 1);
      else if (key.name === "pageup") cursor = Math.max(0, cursor - page);
      else if (key.name === "pagedown") cursor = Math.min(items.length - 1, cursor + page);
      else if (key.name === "home") cursor = 0;
      else if (key.name === "end") cursor = items.length - 1;
      else if (key.name === "backspace") {
        query = query.slice(0, -1);
        cursor = 0;
      } else if (chunk && !key.ctrl && !key.meta && chunk.length === 1 && chunk >= " ") {
        query += chunk;
        cursor = 0;
      }
      cursor = Math.max(0, cursor);
      draw();
    };
    emitKeypressEvents(input);
    input.setRawMode(true);
    input.resume();
    input.on("keypress", onKey);
    output.on("resize", draw);
    output.write("\x1b[?1049h\x1b[?25l");
    draw();
  });
}
