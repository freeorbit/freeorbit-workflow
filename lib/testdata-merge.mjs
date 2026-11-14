// `wf testdata merge <folder> [--write]` and `wf testdata fold <file>
// <sibling> [--write]`: fewer test-data files, every row kept. A merge makes a
// flow area's folder one file, <folder>.md; a fold puts a small file into a
// sibling in its folder. Each table goes to the section its header names, in
// the formats doc's order, and tables with the same header in one section
// become one. A topic file's lead lines stay, under an italic topic label.
// Links are moved with the text, and every link in the repo's docs that
// pointed at a file now gone points at where its text went. Nothing is
// written unless the data rows before and after are the same in number, and
// nothing at all without --write. Only a flow area of a test-data folder is
// merged or folded, and a symbolic link is never read through or written.
//
// From the scripts Freeorbit wrote for its own merges (2026-11-14).

import path from "node:path";

import { anchor } from "./docs/shape.mjs";

/** A merge or fold refused on purpose: its message says why, in a sentence. */
export class MergeRefused extends Error {}

/** A flow area's sections, in test-data-formats.md's order. */
export const SECTIONS = ["Rules", "Datasets", "Checks", "Input classes", "Edge-case fixtures", "Journey states", "Gaps", "Proposed rules"];

/** A folder file named for one part, whose lead belongs to that part. */
export const BY_FILE = { "rules.md": "Rules", "data.md": "Datasets", "checks.md": "Checks", "states.md": "Journey states", "gaps.md": "Gaps" };

// A table's section, from its header's cells: the most specific first.
const BY_HEADER = [
  [["ID", "Check"], "Checks"],
  [["Input", "Class"], "Input classes"],
  [["Fixture", "Varies"], "Edge-case fixtures"],
  [["ID", "Kind", "Question"], "Gaps"],
  [["ID", "Category", "Rule"], "Rules"],
  [["State"], "Journey states"],
];

const isRow = (line) => /^\s*\|/.test(line);
const isRule = (line) => /^\s*\|(\s*:?-{3,}:?\s*\|)+\s*$/.test(line);
const cellsOf = (line) => line.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).map((c) => c.trim());
const trim = (lines) => {
  let a = 0;
  let b = lines.length;
  while (a < b && !lines[a].trim()) a++;
  while (b > a && !lines[b - 1].trim()) b--;
  return lines.slice(a, b);
};

/** The section a table's header line names, or null. */
export function sectionOf(header) {
  const cells = cellsOf(header);
  return BY_HEADER.find(([needs]) => needs.every((need) => cells.includes(need)))?.[1] ?? null;
}

/** Data rows in a text: table lines that are neither a header nor its rule line. */
export function dataRows(text) {
  const lines = String(text).split("\n");
  return lines.filter((line, i) => isRow(line) && !isRule(line) && !isRule(lines[i + 1] ?? "")).length;
}

/** A file as { title, lead: lines before the first ## heading, sections: Map(name, lines) }. */
function parse(text) {
  const lines = String(text).replace(/\n+$/, "").split("\n");
  const title = lines[0]?.startsWith("# ") ? lines.shift() : "";
  const lead = [];
  const sections = new Map();
  let current = null;
  let fenced = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    const heading = !fenced && /^## (.+)$/.exec(line);
    if (heading) {
      current = heading[1].trim();
      if (!sections.has(current)) sections.set(current, []);
    } else (current ? sections.get(current) : lead).push(line);
  }
  return { title, lead, sections };
}

/** Lines cut into blocks: each table one block, and the text between them another. */
function blocks(lines) {
  const out = [];
  let i = 0;
  while (i < lines.length) {
    if (isRow(lines[i]) && isRule(lines[i + 1] ?? "")) {
      let j = i;
      while (j < lines.length && isRow(lines[j])) j++;
      out.push({ table: true, lines: lines.slice(i, j) });
      i = j;
    } else {
      const start = i;
      while (i < lines.length && !(isRow(lines[i]) && isRule(lines[i + 1] ?? ""))) i++;
      out.push({ table: false, lines: lines.slice(start, i) });
    }
  }
  return out;
}

/** Parts joined with a blank line, a table straight after one with the same header joining it. */
function joinParts(parts) {
  const out = [];
  for (const part of parts.map(trim).filter((each) => each.length)) {
    const header = isRow(part[0]) && isRule(part[1] ?? "") ? part[0] : null;
    let start = out.length - 1;
    while (start >= 0 && isRow(out[start])) start--;
    const last = out.slice(start + 1);
    if (header && last.length > 1 && cellsOf(last[0]).join("|") === cellsOf(header).join("|")) {
      out.push(...part.slice(2));
      continue;
    }
    if (out.length) out.push("");
    out.push(...part);
  }
  return out;
}

const topicOf = (title) => {
  const topic = title.replace(/^#\s*/, "").replace(/^[^:]*:\s*/, "").trim();
  return topic ? topic[0].toUpperCase() + topic.slice(1) : "";
};

/**
 * One file's text, put into sections: its lead tables go to the section
 * their header names (or its file name's), its lead text goes to its named
 * section, or, for a topic file, above its first section under an italic
 * label. Returns { top: lines for the file's top, sections: Map }.
 */
function placed(name, file) {
  const sections = new Map([...file.sections].map(([k, v]) => [k, [v]]));
  const put = (section, lines, first = false) => {
    if (!sections.has(section)) sections.set(section, []);
    sections.get(section)[first ? "unshift" : "push"](lines);
  };
  const top = [];
  const whole = trim(file.lead);
  // A file named for one part, or one of datasets, goes whole: its tables belong to the text around them.
  const datasets = whole.some((line) => /^###\s+(DS-[A-Z]+-\d+|D\d+)\b/.test(line));
  if (whole.length && (datasets || BY_FILE[name])) {
    const section = datasets ? "Datasets" : BY_FILE[name];
    // A rules.md lead with no table is the area's shared-rules note, which reads best at the top.
    if (name === "rules.md" && !blocks(whole).some((b) => b.table)) top.push(...whole);
    else put(section, whole, true);
    return { top, sections };
  }
  // A topic file's tables of a known kind go to their sections; the rest of its lead stays as its lead.
  const text = [];
  const tables = [];
  for (const block of blocks(file.lead)) {
    const section = block.table ? sectionOf(block.lines[0]) : null;
    if (section) tables.push([section, block.lines]);
    else text.push(...block.lines, "");
  }
  for (const [section, lines] of tables.reverse()) put(section, lines, true);
  const lead = trim(text);
  if (lead.length) {
    const short = lead.filter((line) => line.trim()).length <= 2 && !lead.some((line) => /^[#|>-]|^\s*```/.test(line));
    const label = topicOf(file.title);
    const labelled = !label ? lead : short ? [`*${label}.* ${lead.filter((l) => l.trim()).map((l) => l.trim()).join(" ")}`] : [`*${label}.*`, "", ...lead];
    const first = firstSection(sections);
    if (first) put(first, labelled, true);
    else top.push(...labelled);
  }
  return { top, sections };
}

/** The first section a file's text goes to, in the formats doc's order. */
const firstSection = (sections) => SECTIONS.find((each) => sections.has(each)) ?? [...sections.keys()][0];

/** A text's lines, without its last newline. */
export const lineCount = (text) => String(text).replace(/\n$/, "").split("\n").length;

/** Sections as text, known ones in the formats doc's order, then the rest as they came. */
function render(title, top, sections) {
  const out = title ? [title, ""] : [];
  out.push(...trim(top));
  const names = [...SECTIONS.filter((each) => sections.has(each)), ...[...sections.keys()].filter((each) => !SECTIONS.includes(each))];
  for (const name of names) {
    const body = joinParts(sections.get(name));
    if (body.length) out.push("", `## ${name}`, "", ...body);
  }
  // One blank line between blocks, outside code.
  let fenced = false;
  const tidy = trim(out).filter((line, i, all) => {
    if (/^\s*```/.test(line)) fenced = !fenced;
    return fenced || line.trim() || all[i - 1]?.trim();
  });
  return `${tidy.join("\n")}\n`;
}

const appendSections = (into, from) => {
  for (const [name, parts] of from) into.set(name, [...(into.get(name) ?? []), ...parts]);
  return into;
};

/**
 * Each relative Markdown link to a .md file, outside code, replaced by
 * `swap(label, target, hash)`, which returns the new link text or null to
 * keep it. Fenced blocks and inline code are left as written.
 */
export function rewriteLinks(text, swap) {
  let fenced = false;
  return String(text).split("\n").map((line) => {
    if (/^\s*```/.test(line)) { fenced = !fenced; return line; }
    if (fenced) return line;
    return line.split(/(`[^`]*`)/).map((piece) => (piece.startsWith("`") ? piece : piece.replace(/\[([^\]]*)\]\(([^)\s#]+\.md)(#[^)\s]*)?\)/g, (all, label, target, hash = "") => {
      if (/^[a-z]+:/i.test(target) || target.startsWith("/")) return all;
      return swap(label, target, hash) ?? all;
    }))).join("");
  }).join("\n");
}

const resolve = (from, target) => path.posix.normalize(path.posix.join(path.posix.dirname(from), target));

/**
 * A text's relative links moved from `from` to `to`: a link to a file that
 * is now part of `to` points inside it, by its anchor, or becomes plain text.
 */
function moveLinks(text, from, to, gone) {
  return rewriteLinks(text, (label, target, hash) => {
    const abs = resolve(from, target);
    if (abs === to) return hash ? `[${label}](${hash})` : label;
    if (gone.has(abs)) {
      const { where, topic } = gone.get(abs);
      // A label that is only the file's name says nothing once the file is gone, so it takes the file's topic.
      const named = label === target || label === path.posix.basename(target) ? topic || label : label;
      return hash || where ? `[${named}](${hash || where})` : named;
    }
    return `[${label}](${path.posix.relative(path.posix.dirname(to), abs)}${hash})`;
  });
}

const firstLink = (line) => /^\|\s*\[[^\]]*\]\(([^)#\s]+)/.exec(line)?.[1] ?? null;

/**
 * Every other doc's links to the files now gone, pointed at `to`. In the
 * docs index, a row the relink made repeat another row's link is dropped;
 * no row it did not change is touched. Returns Map(path, text).
 */
function relinkRepo({ config, tracked, files }, gone, to, skip) {
  const out = new Map();
  for (const doc of tracked.filter((p) => p.endsWith(".md") && !gone.has(p) && !skip.has(p))) {
    const text = files(doc);
    if (!text.includes(".md")) continue;
    let next = rewriteLinks(text, (label, target, hash) => {
      const abs = resolve(doc, target);
      return gone.has(abs) ? `[${label}](${path.posix.relative(path.posix.dirname(doc), to)}${hash || gone.get(abs).where})` : null;
    });
    if (doc === config.docs?.index && next !== text) {
      const old = text.split("\n");
      const lines = next.split("\n");
      const kept = new Set(lines.filter((line, i) => line === old[i]).map(firstLink).filter(Boolean));
      next = lines.filter((line, i) => {
        if (line === old[i]) return true;
        const first = firstLink(line);
        if (first && kept.has(first)) return false;
        if (first) kept.add(first);
        return true;
      }).join("\n");
    }
    if (next !== text) out.set(doc, next);
  }
  return out;
}

/** Where a file's text goes in the file it joins, `where`: the anchor of its first section, or "" for the top; and its `topic`. */
function whereOf(name, text) {
  const file = parse(text);
  const first = firstSection(placed(name, file).sections);
  const topic = topicOf(file.title);
  return { where: first ? `#${anchor(first)}` : "", topic: topic && topic[0].toLowerCase() + topic.slice(1) };
}

/** The test-data folders of the areas, such as docs/plugins/uplink/test-data/. */
const testdataDirs = (config) => config.areas.filter((area) => area.docs).map((area) => `${area.docs}/test-data/`);

/** Refuse a path that is a symbolic link, which may point outside the project. */
function noLinks(ctx, paths) {
  const links = paths.filter((p) => ctx.links?.has(p));
  if (links.length) throw new MergeRefused(`${links.join(", ")} ${links.length === 1 ? "is a symbolic link" : "are symbolic links"}; move ${links.length === 1 ? "it" : "them"} by hand`);
}

/** The context without symbolic links, so no doc read or written is one. */
const withoutLinks = (ctx) => ({ ...ctx, tracked: ctx.tracked.filter((p) => !ctx.links?.has(p)) });

/**
 * A flow area's folder as one file. Returns `{ to, writes: Map(path, text),
 * removes: [path], before, after, lines }`; `before` and `after` are its data
 * rows, without the README's file table. With `relink` false it leaves the
 * repo's other docs alone, for doc:check's estimate.
 */
export function mergeFolder(ctx, folder, { relink = true } = {}) {
  const dir = folder.replace(/\/+$/, "");
  const home = testdataDirs(ctx.config).find((each) => `${dir}/`.startsWith(each));
  if (!home || dir.slice(home.length).includes("/") || !dir.slice(home.length)) throw new MergeRefused(`${dir}/ is not a flow area's folder in an area's test-data folder`);
  const paths = ctx.tracked.filter((p) => p.startsWith(`${dir}/`) && p.endsWith(".md") && !p.slice(dir.length + 1).includes("/"));
  if (!paths.length) throw new MergeRefused(`${dir}/ has no Markdown files`);
  const readmePath = `${dir}/README.md`;
  if (!paths.includes(readmePath)) throw new MergeRefused(`${dir}/ has no README.md`);
  noLinks(ctx, paths);
  const to = `${dir}.md`;
  if (ctx.tracked.includes(to) || ctx.exists?.(to)) throw new MergeRefused(`${to} is there already`);
  const repo = withoutLinks(ctx);
  const gone = new Map(paths.map((p) => [p, p === readmePath ? { where: "", topic: "" } : whereOf(path.posix.basename(p), ctx.files(p))]));
  // The README's file table only indexes the folder, so it goes.
  const noIndex = (lines) => blocks(lines).filter((b) => !(b.table && cellsOf(b.lines[0]).includes("File"))).flatMap((b) => [...b.lines, ""]);
  const raw = parse(ctx.files(readmePath));
  const readme = parse(moveLinks(ctx.files(readmePath), readmePath, to, gone));
  const top = trim(noIndex(readme.lead));
  const before = dataRows([...noIndex(raw.lead), ...[...raw.sections.values()].flat()].join("\n")) + paths.filter((p) => p !== readmePath).reduce((n, p) => n + dataRows(ctx.files(p)), 0);
  // The README's order of files, then the rest.
  const listed = [...ctx.files(readmePath).matchAll(/\]\(([^)#\s/]+\.md)/g)].map((m) => `${dir}/${m[1]}`).filter((p) => gone.has(p) && p !== readmePath);
  const order = [...new Set([...listed, ...paths.filter((p) => p !== readmePath).sort()])];
  let sections = new Map([...readme.sections].map(([k, v]) => [k, [v]]));
  for (const p of order) {
    const part = placed(path.posix.basename(p), parse(moveLinks(ctx.files(p), p, to, gone)));
    top.push("", ...part.top);
    sections = appendSections(sections, part.sections);
  }
  const text = render(readme.title, top, sections);
  const writes = new Map([[to, text], ...(relink ? relinkRepo(repo, gone, to, new Set([to])) : [])]);
  return { to, writes, removes: [...gone.keys()], before, after: dataRows(text), lines: lineCount(text) };
}

/**
 * A small file folded into a sibling in its folder. Returns the same shape
 * as mergeFolder; the folder README's row for the small file goes, and each
 * of its cells joins the sibling's row's cell under the same column.
 */
export function foldFile(ctx, small, sibling) {
  if (path.posix.dirname(small) !== path.posix.dirname(sibling)) throw new MergeRefused(`${small} and ${sibling} are not in one folder`);
  if (!testdataDirs(ctx.config).some((each) => small.startsWith(each))) throw new MergeRefused(`${small} is not in an area's test-data folder`);
  for (const p of [small, sibling]) if (!ctx.tracked.includes(p)) throw new MergeRefused(`${p} is not a tracked file`);
  if (small.endsWith("/README.md") || sibling.endsWith("/README.md")) throw new MergeRefused("a folder's README is not folded; merge the folder instead");
  noLinks(ctx, [small, sibling]);
  const repo = withoutLinks(ctx);
  const gone = new Map([[small, whereOf(path.posix.basename(small), ctx.files(small))]]);
  const target = parse(ctx.files(sibling));
  const part = placed(path.posix.basename(small), parse(moveLinks(ctx.files(small), small, sibling, gone)));
  const sections = appendSections(new Map([...target.sections].map(([k, v]) => [k, [v]])), part.sections);
  const text = moveLinks(render(target.title, [...target.lead, "", ...part.top], sections), sibling, sibling, gone);
  const before = dataRows(ctx.files(small)) + dataRows(ctx.files(sibling));
  const writes = new Map([[sibling, text]]);
  const readmePath = `${path.posix.dirname(small)}/README.md`;
  const skip = new Set([sibling]);
  if (repo.tracked.includes(readmePath)) {
    const name = path.posix.basename(small);
    const sib = path.posix.basename(sibling);
    const lines = ctx.files(readmePath).split("\n");
    const theirs = cellsOf(lines.find((line) => firstLink(line) === name) ?? "").slice(1);
    const next = lines.filter((line) => firstLink(line) !== name).map((line) => {
      if (!theirs.length || firstLink(line) !== sib) return line;
      // "Mail" joins as "mail", but an ID such as DS-GM-27 keeps its case.
      const cells = cellsOf(line).map((cell, i) => {
        const add = theirs[i - 1];
        if (!i || !add) return cell;
        return `${cell}; ${/^[A-Z][a-z]/.test(add) ? add[0].toLowerCase() + add.slice(1) : add}`;
      });
      return `| ${cells.join(" | ")} |`;
    });
    writes.set(readmePath, next.join("\n"));
    skip.add(readmePath);
  }
  for (const [p, t] of relinkRepo(repo, gone, sibling, skip)) writes.set(p, t);
  return { to: sibling, writes, removes: [small], before, after: dataRows(text), lines: lineCount(text) };
}

/**
 * A merge or fold as lines to print. `asked` is whether --write was given,
 * `write` whether it was done: a merge whose rows differ is never written.
 */
export function mergeLines(found, { from, asked = false, write = false, limit = 0, kept = [] }) {
  const lines = [`${from} → ${found.to}: ${found.lines} lines, data rows ${found.before} → ${found.after}.`];
  if (found.before !== found.after) lines.push("The rows differ, so nothing is written; merge this one by hand.");
  if (limit && found.lines > limit) lines.push(`It is over testdata.limits.lines (${limit}); a page is easier to read than this.`);
  const others = [...found.writes.keys()].filter((p) => p !== found.to);
  if (others.length) lines.push(`Links ${write ? "moved" : "to move"} in ${others.length} ${others.length === 1 ? "file" : "files"}: ${others.join(", ")}`);
  lines.push(`${found.removes.length} ${found.removes.length === 1 ? "file" : "files"} ${write ? "removed" : "to remove"}.`);
  if (kept.length) lines.push(`The folder stays, since it still holds ${kept.join(", ")}.`);
  if (!asked && found.before === found.after) lines.push("Nothing written; --write applies it. Then run npx wf doc:check.");
  return lines;
}
