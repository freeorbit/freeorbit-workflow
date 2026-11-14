// `wf testdata trace [area] [--all]`: how an area's test-data spec and the
// project's code point at each other, both ways. A spec row no code names
// (a rule, a check, a fixture, an input, a journey state, a dataset) is data nobody
// builds or checks yet; a test that names no row and no story checks
// something the spec does not say. Both are facts to judge, not failures:
// a row can wait for its chunk, and a test of plain code needs no row.

import { tableRows } from "./testdata.mjs";

const CODE = /\.(rs|ts|tsx|js|mjs|cjs|py|toml|json|ya?ml)$/;
const RUST_TEST = /^\s*#\[(?:tokio::)?test\b|^\s*#\[rstest\b/;
const RUST_FN = /^(\s*)(?:pub(?:\([a-z]+\))? )?(?:async )?fn (\w+)/;
const JS_TEST = /^(\s*)(?:it|test)(?:\.\w+)?\(\s*(["'`])(.*?)\2/;
const JS_TESTS = /\.test\.(ts|tsx|mjs|js)$/;

/** Every token a text holds, with each underscore also read as a hyphen, so `sweep_bad_dates` names `sweep-bad-dates`. */
function tokens(text) {
  const out = new Set();
  for (const t of String(text).match(/[A-Za-z0-9][A-Za-z0-9_-]*/g) ?? []) {
    out.add(t);
    out.add(t.replace(/_/g, "-"));
  }
  return out;
}
const bare = (cell) => String(cell ?? "").replace(/`/g, "").trim();

/** The ids an area's spec defines, by kind, each with where it is defined. */
export function specIds(paths, files) {
  const ids = [];
  const add = (kind, id, path, line) => { if (id && /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id)) ids.push({ kind, id, path, line }); };
  for (const path of paths) {
    const text = files(path);
    for (const { line, cells } of tableRows(text, ["ID", "Category", "Rule"])) add("rule", bare(cells.ID), path, line);
    // A check only the walk by hand can prove is not one code should name.
    for (const { line, cells } of tableRows(text, ["ID", "Check"])) if (!/\bwalk\b/i.test(cells.By ?? "")) add("check", bare(cells.ID), path, line);
    for (const { line, cells } of tableRows(text, ["Fixture", "Varies"])) add("fixture", bare(cells.Fixture), path, line);
    for (const { line, cells } of tableRows(text, ["Input", "Class"])) add("input", bare(cells.Input), path, line);
    for (const { line, cells } of tableRows(text, ["State"])) add("state", bare(cells.State), path, line);
    text.split("\n").forEach((each, i) => {
      const dataset = each.match(/^###\s+(D\d+)\b/);
      if (dataset) add("dataset", dataset[1], path, i + 1);
    });
  }
  // An input is one id however many classes it has.
  const seen = new Set();
  return ids.filter((each) => (seen.has(`${each.kind}:${each.id}`) ? false : seen.add(`${each.kind}:${each.id}`)));
}

/** Each test in a code file as `{ line, name, text }`: its body and the comment lines just above it. */
export function testsIn(path, text) {
  const lines = String(text).split("\n");
  const out = [];
  const above = (at) => { const kept = []; for (let i = at - 1; i >= 0 && i >= at - 4 && /^\s*(\/\/|#\[)/.test(lines[i]); i--) kept.push(lines[i]); return kept.join("\n"); };
  const body = (from, indent, close) => { const end = lines.findIndex((l, i) => i > from && l.startsWith(indent + close)); return lines.slice(from, end < 0 ? lines.length : end + 1).join("\n"); };
  lines.forEach((line, at) => {
    if (path.endsWith(".rs") && RUST_TEST.test(line)) {
      for (let next = at + 1; next < Math.min(at + 4, lines.length); next++) {
        const fn = lines[next].match(RUST_FN);
        if (fn) { out.push({ line: next + 1, name: fn[2], text: `${above(at)}\n${body(next, fn[1], "}")}` }); break; }
      }
    } else if (JS_TESTS.test(path)) {
      const t = line.match(JS_TEST);
      if (t) out.push({ line: at + 1, name: t[3], text: `${above(at)}\n${body(at, t[1], "})")}` });
    }
  });
  return out;
}

/**
 * The trace for one area, or every area with a docs folder: spec ids no code
 * file names, and tests that name no spec id and no story. `tracked` is every
 * tracked path, `files(path)` its text.
 */
export function trace({ config, tracked, files }, areaId = null) {
  const areas = config.areas.filter((a) => a.docs && (!areaId || a.id === areaId));
  if (areaId && !areas.length) throw new Error(`no area ${areaId} with a docs folder in .workflow/config.json`);
  const code = tracked.filter((p) => CODE.test(p) && !p.startsWith("docs/") && !/(^|\/)(node_modules|target|\.cache)\//.test(p));
  const named = new Set();
  for (const path of code) {
    for (const t of tokens(files(path))) named.add(t);
    for (const t of tokens(path)) named.add(t);
  }
  const all = [];
  const result = [];
  for (const area of areas) {
    const dir = `${area.docs}/test-data/`;
    const ids = specIds(tracked.filter((p) => p.startsWith(dir) && p.endsWith(".md")), files);
    all.push(...ids.map((each) => each.id));
    if (ids.length) result.push({ area: area.id, ids: ids.length, unnamed: ids.filter((each) => !named.has(each.id)) });
  }
  const specSet = new Set(all);
  const story = new RegExp(`\\b(?:${config.areas.map((a) => a.prefix).filter(Boolean).join("|") || "[A-Z]{1,6}"})-\\d+\\b`);
  const tests = [];
  for (const path of code) tests.push(...testsIn(path, files(path)).map((t) => ({ ...t, path })));
  const loose = tests.filter((t) => !story.test(t.text) && ![...tokens(t.text)].some((tok) => specSet.has(tok)));
  return { areas: result, tests: tests.length, loose };
}

/** The trace as lines to print: each area's unnamed rows by kind, then the tests that name nothing, by file. */
export function traceLines(found, { all = false } = {}) {
  const lines = [];
  const cap = (list) => (all ? list : list.slice(0, 12));
  for (const area of found.areas) {
    lines.push(`${area.area}: ${area.unnamed.length} of ${area.ids} spec ids are named in no code file${area.unnamed.length ? ":" : "."}`);
    const byKind = Map.groupBy ? Map.groupBy(area.unnamed, (each) => each.kind) : new Map();
    for (const [kind, list] of byKind) {
      lines.push(`  ${kind}s (${list.length}): ${cap(list).map((each) => each.id).join(", ")}${list.length > cap(list).length ? ", …" : ""}`);
    }
  }
  const byFile = new Map();
  for (const t of found.loose) byFile.set(t.path, [...(byFile.get(t.path) ?? []), t]);
  lines.push(`tests: ${found.loose.length} of ${found.tests} name no spec row and no story${found.loose.length ? ", most in:" : "."}`);
  for (const [path, list] of cap([...byFile].sort((a, b) => b[1].length - a[1].length))) lines.push(`  ${path}: ${list.length}`);
  if (!all) lines.push("--all lists every one. A row can wait for its chunk, and a test of plain code needs no row: judge each, nothing here fails.");
  return lines;
}
