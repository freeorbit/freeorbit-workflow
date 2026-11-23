// The Markdown an ask page draws: a text block, and the agent's replies when
// a person asks for more. The page parses it as it draws (80-blocks.js), so a
// better parser shows pages built before; the kit loads this same file to
// check it (lib/ask/markdown.mjs). It gives plain nodes, never HTML, and the
// page builds each node as an element, so no Markdown brings markup of its own.
//
// What it reads, after CommonMark and GitHub's tables, kept small:
//   blocks:  # to ###### headings, paragraphs, - * + and 1. 1) lists (nested,
//            holding paragraphs and code), > quotes, --- rules, ``` and ~~~
//            fences (indented; ```ts:42 names the language and first line),
//            and | tables | with a delimiter row
//   inline:  **bold** __bold__ *italic* _italic_ ~~struck~~ `code`, [links](url)
//            to https: or mailto: and bare https:// addresses, \ escapes; a _ inside a word stays
//
// Blocks: { k: "h", level, kids } { k: "p", kids } { k: "pre", text, lang, start }
//   { k: "ul", items } { k: "ol", start, items } (each item a list of blocks)
//   { k: "quote", kids } { k: "hr" } { k: "table", align, head, rows }
// Inline: { t: "text", s } { t: "code", s } { t: "b" | "i" | "del", kids } { t: "a", href, kids }
window.wfMarkdown = (() => {
  "use strict";
  // Quotes and lists inside each other go this deep; past it, the rest is a paragraph.
  const DEPTH = 20;
  const FENCE = /^( {0,3})(`{3,}|~{3,})(.*)$/;
  const HEADING = /^ {0,3}(#{1,6})(?=[ \t]|$)/;
  const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
  const QUOTE = /^ {0,3}> ?/;
  const ITEM = /^( {0,3})([-*+]|\d{1,9}[.)])([ \t]+|$)(.*)$/;
  const DELIMITER = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;
  const blank = (line) => !line.trim();
  const indentOf = (line) => line.match(/^ */)[0].length;

  /** A line's cells, split on pipes outside code spans and escapes. */
  function cells(line) {
    let s = line.trim();
    if (s.startsWith("|")) s = s.slice(1);
    if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
    const out = [];
    let cell = "";
    let ticks = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === "\\" && s[i + 1] === "|") { cell += "|"; i++; continue; }
      if (c === "`") {
        let n = 1;
        while (s[i + n] === "`") n++;
        ticks = ticks === n ? 0 : ticks || n;
        cell += s.slice(i, i + n);
        i += n - 1;
        continue;
      }
      if (c === "|" && !ticks) { out.push(cell.trim()); cell = ""; continue; }
      cell += c;
    }
    out.push(cell.trim());
    return out;
  }

  /** A line that opens a fence: its indent, its mark, and what follows; a backtick fence names no backtick. */
  function fenceOf(line) {
    const m = line.match(FENCE);
    return m && !(m[2][0] === "`" && m[3].includes("`")) ? { pad: m[1].length, mark: m[2], info: m[3] } : null;
  }
  /** Whether a line closes a fence opened with `mark`: the same kind of mark, at least as long, and nothing after. */
  const closesFence = (line, mark) => {
    const m = line.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
    return Boolean(m) && m[1][0] === mark[0] && m[1].length >= mark.length;
  };
  /**
   * Whether a line starts a block that ends a paragraph. A list interrupts
   * one only with an item that says something, and a numbered one only from
   * 1, so "in\n2024. Then" stays a sentence.
   */
  const startsBlock = (line) => {
    if (fenceOf(line) || HEADING.test(line) || RULE.test(line) || QUOTE.test(line)) return true;
    const m = line.match(ITEM);
    return Boolean(m) && m[4].trim() !== "" && (!/\d/.test(m[2]) || Number.parseInt(m[2], 10) === 1);
  };

  /** The blocks of some lines. */
  function blocks(lines, depth) {
    const out = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (blank(line)) { i++; continue; }
      let m;
      const fence = fenceOf(line);
      if (fence) {
        const code = [];
        let closed = false;
        for (i++; i < lines.length; i++) {
          if (closesFence(lines[i], fence.mark)) { i++; closed = true; break; }
          code.push(lines[i].replace(new RegExp(`^ {0,${fence.pad}}`), ""));
        }
        const named = fence.info.trim().match(/^([A-Za-z0-9_+#.-]{0,20})(?::(\d{1,7}))?/);
        // A fence left open runs to the end; the kit's check says so (lib/ask/markdown.mjs).
        out.push({ k: "pre", text: code.join("\n"), lang: named?.[1] ?? "", start: named?.[2] ? Number(named[2]) : null, ...(closed ? {} : { open: true }) });
        continue;
      }
      if ((m = line.match(HEADING))) {
        // The words after the marks, less a closing run of #s; by hand, as a pattern would backtrack over long runs of spaces.
        let words = line.slice(m[0].length).trim();
        let end = words.length;
        while (end > 0 && words[end - 1] === "#") end--;
        if (end < words.length && (end === 0 || words[end - 1] === " " || words[end - 1] === "\t")) words = words.slice(0, end).trimEnd();
        out.push({ k: "h", level: m[1].length, kids: inline(words) });
        i++;
        continue;
      }
      if (RULE.test(line)) { out.push({ k: "hr" }); i++; continue; }
      if (QUOTE.test(line) && depth < DEPTH) {
        const inner = [];
        // A quote runs over its marked lines, and a line that carries its paragraph on.
        while (i < lines.length && (QUOTE.test(lines[i]) || (!blank(lines[i]) && inner.length && !blank(inner.at(-1)) && !startsBlock(lines[i])))) {
          inner.push(lines[i].replace(QUOTE, ""));
          i++;
        }
        out.push({ k: "quote", kids: blocks(inner, depth + 1) });
        continue;
      }
      if ((m = line.match(ITEM)) && depth < DEPTH) {
        const list = listAt(lines, i, depth);
        out.push(list.node);
        i = list.end;
        continue;
      }
      if (line.includes("|") && i + 1 < lines.length && DELIMITER.test(lines[i + 1]) && lines[i + 1].includes("-")) {
        const head = cells(line);
        const align = cells(lines[i + 1]).map((c) => (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : c.startsWith(":") ? "left" : ""));
        if (align.length === head.length) {
          const rows = [];
          for (i += 2; i < lines.length && !blank(lines[i]) && lines[i].includes("|") && !startsBlock(lines[i]); i++) {
            const row = cells(lines[i]);
            rows.push(head.map((_, n) => inline(row[n] ?? "")));
          }
          out.push({ k: "table", align, head: head.map((c) => inline(c)), rows });
          continue;
        }
      }
      // A paragraph: its lines up to a blank one, or one that starts another block.
      const para = [line.trim()];
      for (i++; i < lines.length && !blank(lines[i]) && !startsBlock(lines[i]) && !(lines[i].includes("|") && DELIMITER.test(lines[i + 1] ?? "") && (lines[i + 1] ?? "").includes("-")); i++) para.push(lines[i].trim());
      out.push({ k: "p", kids: inline(para.join(" ")) });
    }
    return out;
  }

  /** The list that starts at line `at`: its items, each its own blocks, and the line after it. */
  function listAt(lines, at, depth) {
    const first = lines[at].match(ITEM);
    const ordered = /\d/.test(first[2]);
    const node = ordered ? { k: "ol", start: Number.parseInt(first[2], 10), items: [] } : { k: "ul", items: [] };
    let i = at;
    for (;;) {
      const m = lines[i]?.match(ITEM);
      if (!m || /\d/.test(m[2]) !== ordered || indentOf(lines[i]) >= 4) break;
      // The item's own lines are those indented at least as far as its text starts.
      const gap = m[3].length;
      const content = m[1].length + m[2].length + (m[4] === "" ? 1 : gap > 4 ? 1 : gap);
      const own = [m[4] === "" ? "" : gap > 4 ? `${" ".repeat(gap - 1)}${m[4]}` : m[4]];
      // The mark of a fence open in the item: it holds every line, indented or not, until the same rule as blocks() closes it.
      let fenced = fenceOf(own[0])?.mark ?? null;
      // The next line that is not blank, found once for each run of blank lines.
      let after = -1;
      for (i++; i < lines.length; i++) {
        const line = lines[i];
        if (blank(line)) {
          if (after <= i) { after = i; while (after < lines.length && blank(lines[after])) after++; }
          // A blank line ends the item when what follows is not indented into it.
          const next = lines[after];
          if (!fenced && (next == null || indentOf(next) < content)) break;
          own.push("");
          continue;
        }
        const body = indentOf(line) >= content ? line.slice(content) : null;
        if (fenced) {
          // A fence opened in the item closes there, also on a line at the margin, as agents often write it.
          const at = body ?? line.trimStart();
          if (closesFence(at, fenced)) fenced = null;
          own.push(at);
          continue;
        }
        if (body != null) {
          fenced = fenceOf(body)?.mark ?? null;
          own.push(body);
          continue;
        }
        // A line that carries the item's paragraph on, not one that starts a block.
        // Any item mark at the margin ends this item, and only a paragraph carries on, not a fence just closed.
        const last = own.at(-1);
        if (!blank(last) && !ITEM.test(line) && !startsBlock(line) && !fenceOf(last) && !/^ {0,3}(`{3,}|~{3,})[ \t]*$/.test(last)) { own.push(line.trim()); continue; }
        break;
      }
      node.items.push(blocks(own, depth + 1));
      // A blank line between items is part of the list.
      let j = i;
      while (j < lines.length && blank(lines[j])) j++;
      // A rule such as * * * is a rule, not an item.
      if (j < lines.length && RULE.test(lines[j])) break;
      const again = lines[j]?.match(ITEM);
      if (!again || /\d/.test(again[2]) !== ordered || indentOf(lines[j]) >= 4) break;
      i = j;
    }
    return { node, end: i };
  }

  // --- inline -------------------------------------------------------------------------
  const PUNCT = /[\p{P}\p{S}]/u;
  // Only a web address over TLS, or a mail address, is a link (SECURITY.md).
  const SAFE = /^(https:\/\/|mailto:)/i;

  // An address longer than this is no link: so a run of unclosed ( costs each [ a bounded scan.
  const HREF = 1000;
  /** A link's destination after `(` at `at`: `{ href, end }`, or null. */
  function destination(s, at) {
    let i = at;
    while (s[i] === " ") i++;
    let href = "";
    let depth = 0;
    if (s[i] === "<") {
      const close = s.indexOf(">", i);
      if (close < 0) return null;
      href = s.slice(i + 1, close);
      i = close + 1;
    } else {
      for (; i < s.length; i++) {
        if (i - at > HREF) return null;
        const c = s[i];
        if (c === "\\" && i + 1 < s.length) { href += s[++i]; continue; }
        if (c === "(") depth++;
        else if (c === ")") { if (!depth) break; depth--; }
        else if (/\s/.test(c)) break;
        href += c;
      }
    }
    while (s[i] === " ") i++;
    // A title, which the page does not show.
    if (s[i] === '"' || s[i] === "'") {
      const close = s.indexOf(s[i], i + 1);
      if (close < 0) return null;
      i = close + 1;
      while (s[i] === " ") i++;
    }
    return s[i] === ")" ? { href, end: i + 1 } : null;
  }

  /** Where each `[` closes, past code spans and escapes, in one pass: a map from its place to its `]`'s. */
  function brackets(s) {
    const close = new Map();
    const open = [];
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (c === "\\") { i++; continue; }
      if (c === "`") {
        let n = 1;
        while (s[i + n] === "`") n++;
        const end = s.indexOf("`".repeat(n), i + n);
        i = (end >= 0 ? end + n : i + n) - 1;
        continue;
      }
      if (c === "[") open.push(i);
      else if (c === "]" && open.length) close.set(open.pop(), i);
    }
    return close;
  }

  /**
   * A line's inline nodes. First code spans, links, escapes, and runs of
   * marks, in order; then the runs are paired into bold, italic, and struck
   * by CommonMark's rules on which side of a word a run is on.
   */
  function inline(s, inLink = false) {
    const items = [];
    const closes = s.includes("[") && !inLink ? brackets(s) : null;
    let buf = "";
    const flush = () => { if (buf) items.push({ t: "text", s: buf }); buf = ""; };
    for (let i = 0; i < s.length; ) {
      const c = s[i];
      if (c === "\\" && i + 1 < s.length && PUNCT.test(s[i + 1])) { buf += s[i + 1]; i += 2; continue; }
      if (c === "`") {
        let n = 1;
        while (s[i + n] === "`") n++;
        const run = "`".repeat(n);
        let end = s.indexOf(run, i + n);
        while (end >= 0 && s[end + n] === "`") { let m = end; while (s[m] === "`") m++; end = s.indexOf(run, m); }
        if (end < 0) { buf += run; i += n; continue; }
        let code = s.slice(i + n, end);
        if (code.length > 2 && code.startsWith(" ") && code.endsWith(" ") && code.trim()) code = code.slice(1, -1);
        flush();
        items.push({ t: "code", s: code });
        i = end + n;
        continue;
      }
      const picture = c === "!" && s[i + 1] === "[";
      if ((c === "[" || picture) && !inLink) {
        const open = picture ? i + 1 : i;
        const close = closes.get(open) ?? -1;
        const dest = close >= 0 && s[close + 1] === "(" ? destination(s, close + 2) : null;
        if (dest) {
          const kids = inline(s.slice(open + 1, close), true);
          flush();
          // Only a web or mail address is a link; a picture, or any other address, is its words.
          if (!picture && SAFE.test(dest.href)) items.push({ t: "a", href: dest.href, kids });
          else items.push(...kids);
          i = dest.end;
          continue;
        }
      }
      if (!inLink && (c === "h" || c === "H") && /^https:\/\//i.test(s.slice(i, i + 8)) && (i === 0 || /[\s(]/.test(s[i - 1]))) {
        let href = s.slice(i).match(/^[^\s<>`]+/)[0];
        // Trailing punctuation ends the sentence, not the address; a ) closes it only when it opened in it.
        let opens = 0;
        let shuts = 0;
        for (const ch of href) { if (ch === "(") opens++; else if (ch === ")") shuts++; }
        let end = href.length;
        for (;;) {
          const last = href[end - 1];
          if (".,:;!?'\"*_~".includes(last) && end > 8) end--;
          else if (last === ")" && opens < shuts) { end--; shuts--; }
          else break;
        }
        href = href.slice(0, end);
        flush();
        items.push({ t: "a", href, kids: [{ t: "text", s: href }] });
        i += href.length;
        continue;
      }
      if (c === "*" || c === "_" || c === "~") {
        let n = 1;
        while (s[i + n] === c) n++;
        const before = i ? s[i - 1] : " ";
        const after = i + n < s.length ? s[i + n] : " ";
        const ws = (x) => /\s/.test(x);
        const left = !ws(after) && (!PUNCT.test(after) || ws(before) || PUNCT.test(before));
        const right = !ws(before) && (!PUNCT.test(before) || ws(after) || PUNCT.test(after));
        const open = c === "_" ? left && (!right || PUNCT.test(before)) : left;
        const close = c === "_" ? right && (!left || PUNCT.test(after)) : right;
        flush();
        // A ~ run marks only in twos; one ~ is a ~.
        if (c === "~" && n !== 2) items.push({ t: "text", s: "~".repeat(n) });
        else items.push({ t: "run", c, n, open, close });
        i += n;
        continue;
      }
      buf += c;
      i++;
    }
    flush();
    pair(items);
    return merged(items.map((x) => (x.t === "run" ? { t: "text", s: x.c.repeat(x.n) } : x)));
  }

  /** Pair the runs of marks, closers first, each with the nearest opener of its mark before it. */
  function pair(items) {
    for (let c = 0; c < items.length; c++) {
      const closer = items[c];
      if (closer.t !== "run" || !closer.close) continue;
      let o = c - 1;
      for (; o >= 0; o--) {
        const opener = items[o];
        if (opener.t !== "run" || opener.c !== closer.c || !opener.open) continue;
        // CommonMark's rule of three: a run that both opens and closes pairs only where the sums allow.
        if ((opener.close || closer.open) && (opener.n + closer.n) % 3 === 0 && (opener.n % 3 || closer.n % 3)) continue;
        break;
      }
      if (o < 0) continue;
      const opener = items[o];
      const n = closer.c === "~" ? 2 : opener.n >= 2 && closer.n >= 2 ? 2 : 1;
      const kids = items.slice(o + 1, c).map((x) => (x.t === "run" ? { t: "text", s: x.c.repeat(x.n) } : x));
      const node = { t: closer.c === "~" ? "del" : n === 2 ? "b" : "i", kids: merged(kids) };
      opener.n -= n;
      closer.n -= n;
      const keep = [...(opener.n ? [opener] : []), node, ...(closer.n ? [closer] : [])];
      items.splice(o, c - o + 1, ...keep);
      // Go on from the node, so a closer left over can close an opener before it.
      c = o + keep.indexOf(node);
    }
  }

  /** Neighbouring text nodes as one. */
  function merged(items) {
    const out = [];
    for (const x of items) {
      if (x.t === "text" && out.at(-1)?.t === "text") out.at(-1).s += x.s;
      else if (!(x.t === "text" && !x.s)) out.push(x);
    }
    return out;
  }

  /** The blocks of some Markdown. */
  function parse(source) {
    return blocks(String(source ?? "").replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n"), 0);
  }
  return { parse, inline };
})();
