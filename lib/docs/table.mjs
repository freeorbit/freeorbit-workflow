// The two things every Markdown table the kit writes or checks needs: a
// value made safe for one cell, and a cell's length in words.

/** Text for one table cell: its pipes escaped and its whitespace, line breaks too, one space. */
export const cell = (text) => String(text).replaceAll("|", "\\|").replace(/\s+/g, " ").trim();

/** How many words a cell holds, for the docs.cellWords limit. */
export const words = (text) => String(text ?? "").trim().split(/\s+/).filter(Boolean).length;

/** A cell without its backticks and spaces. */
export const bare = (cell) => String(cell ?? "").replace(/`/g, "").trim();

/** A Markdown table's separator line, such as | --- | :---: |. */
export const isSeparator = (line) => /^\s*\|(\s*:?-{3,}:?\s*\|)+\s*$/.test(line);

/** A table line's cells, an escaped \\| staying inside its cell. */
export const cellsOf = (line) => String(line).trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map((c) => c.trim());
