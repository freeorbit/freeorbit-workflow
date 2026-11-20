// HTML the kit writes: the ask pages, the board's comments, and the design sheets' pages.

const ENTITIES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };

/**
 * Text made safe inside an HTML element. Quotes stay as they are: inside an
 * element they need no escaping, and the board's comparison of a comment
 * with what monday kept (plainOfHtml in lib/board/items.mjs) decodes only
 * the three entities this writes.
 */
export const escapeHtml = (text) => String(text).replace(/[&<>]/g, (c) => ENTITIES[c]);

/** Text made safe inside a double-quoted HTML attribute too. */
export const escapeAttribute = (text) => String(text).replace(/[&<>"]/g, (c) => ENTITIES[c]);
