// HTML the kit writes, for the board's comments and the design sheets' pages.

const ENTITIES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };

/**
 * Text made safe inside an HTML element. Quotes stay as they are, since the
 * board compares a comment's text with what monday shows (flat), and
 * monday shows no &quot;.
 */
export const escapeHtml = (text) => String(text).replace(/[&<>]/g, (c) => ENTITIES[c]);

/** Text made safe inside a double-quoted HTML attribute too. */
export const escapeAttribute = (text) => String(text).replace(/[&<>"]/g, (c) => ENTITIES[c]);
