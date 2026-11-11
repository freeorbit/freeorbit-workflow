// The two things every Markdown table the kit writes or checks needs: a
// value made safe for one cell, and a cell's length in words.

/** Text for one table cell: its pipes escaped and its whitespace, line breaks too, one space. */
export const cell = (text) => String(text).replaceAll("|", "\\|").replace(/\s+/g, " ").trim();

/** How many words a cell holds, for the docs.cellWords limit. */
export const words = (text) => String(text ?? "").trim().split(/\s+/).filter(Boolean).length;
