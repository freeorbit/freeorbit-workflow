// `wf testdata trace [area] [--all]`: how an area's test-data spec and the
// project's code point at each other, both ways. A spec row no code names
// (a rule, a check, a fixture, an input, a journey state, a dataset) is data nobody
// builds or checks yet; a test that names no row and no story checks
// something the spec does not say. Both are facts to judge, not failures:
// a row can wait for its chunk, and a test of plain code needs no row.

import { specIds } from "./testdata.mjs";

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
    // A check only the walk by hand proves is no code's to name.
    const ids = specIds(tracked.filter((p) => p.startsWith(dir) && p.endsWith(".md")), files, { walk: false });
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

// A chunk id as the build order writes it: CH-12, 37d, or 19j.
const CHUNK_ID = /^(?:[A-Z]+-)?\d+[a-z]*$/i;

/** The story IDs a cell names, a range such as DR-01 to DR-20 (or DR-01–DR-20) giving each one between. */
export function storiesIn(text, prefixes) {
  if (!prefixes.length) return [];
  const p = prefixes.join("|");
  const out = new Set();
  const range = new RegExp(`\\b(${p})-(\\d{2})\\s*(?:to|–|—|-)\\s*(?:\\1-)?(\\d{2})\\b`, "g");
  for (const m of String(text).matchAll(range)) for (let n = Number(m[2]); n <= Number(m[3]); n++) out.add(`${m[1]}-${String(n).padStart(2, "0")}`);
  for (const m of String(text).matchAll(new RegExp(`\\b(${p})-(\\d{2})\\b`, "g"))) out.add(`${m[1]}-${m[2]}`);
  return [...out];
}

/**
 * A chunk's checks and accepted rules: those naming one of its stories, or set `By: <this
 * chunk>`, each sorted into `proven` (a code file names it, or By says
 * `walked <chunk>`: signed off there), `walk` (only a
 * walk by hand proves it, for the sign-off page), `later` (By names a later
 * chunk), `disputed` (an open gap of kind `dispute` names it), or `unproven`.
 * `stories` are the chunk's story IDs, from its build-order row.
 */
export function chunkChecks({ config, tracked, files }, chunk, stories) {
  const prefixes = config.areas.map((a) => a.prefix).filter(Boolean);
  const mine = new Set(stories);
  const code = tracked.filter((p) => CODE.test(p) && !p.startsWith("docs/") && !/(^|\/)(node_modules|target|\.cache)\//.test(p));
  const named = new Set();
  for (const path of code) for (const t of tokens(files(path))) named.add(t);
  const out = { chunk, stories: [...mine], proven: [], walk: [], later: [], disputed: [], unproven: [] };
  for (const area of config.areas.filter((a) => a.docs)) {
    const dir = `${area.docs}/test-data/`;
    const ids = specIds(tracked.filter((p) => p.startsWith(dir) && p.endsWith(".md")), files);
    // An open dispute is a gap row of kind `dispute` that names the check: the next refresh answers it.
    const disputes = new Map();
    for (const gap of ids.filter((each) => each.kind === "gap" && each.gapKind === "dispute")) for (const c of gap.text.match(/\b[CR]-(?:[A-Z]+-)?\d+\b/g) ?? []) disputes.set(c, gap.id);
    // Checks, and accepted rules: a proposed rule is the reviewer's to accept first.
    for (const check of ids.filter((each) => each.kind === "check" || (each.kind === "rule" && !/^new$/i.test(each.accepted ?? "")))) {
      const byChunk = CHUNK_ID.test(check.by) ? check.by.toUpperCase() : null;
      // Ours: it names one of the chunk's stories (By may hand it to a later chunk), or its By names this chunk.
      const ours = byChunk === chunk.toUpperCase() || storiesIn(check.stories, prefixes).some((s) => mine.has(s));
      if (!ours) continue;
      const at = { id: check.id, kind: check.kind, path: check.path, line: check.line, by: check.by };
      // Walked and signed off in an earlier chunk: proven, so no later chunk asks for it again.
      if (named.has(check.id) || /^walked\b/i.test(check.by)) out.proven.push(at);
      else if (/\bwalk\b/i.test(check.by)) out.walk.push(at);
      else if (disputes.has(check.id)) out.disputed.push({ ...at, gap: disputes.get(check.id) });
      else if (byChunk && byChunk !== chunk.toUpperCase()) out.later.push(at);
      else out.unproven.push(at);
    }
  }
  return out;
}

/** A chunk's checks as lines to print; the unproven ones are what its end waits on. */
export function chunkLines(found) {
  const ids = (list) => list.map((each) => each.id).join(", ");
  const all = [...found.proven, ...found.walk, ...found.later, ...found.disputed, ...found.unproven];
  const count = (kind) => all.filter((each) => each.kind === kind).length;
  const lines = [`${found.chunk}: ${count("check")} checks and ${count("rule")} rules name its stories (${found.stories.join(", ") || "none"}).`];
  lines.push(`  proven by a test or a scenario: ${found.proven.length}`);
  if (found.walk.length) lines.push(`  for the sign-off page, a walk by hand each: ${ids(found.walk)}`);
  if (found.later.length) lines.push(`  left to a later chunk: ${found.later.map((each) => `${each.id} (${each.by})`).join(", ")}`);
  if (found.disputed.length) lines.push(`  disputed, for the next refresh: ${found.disputed.map((each) => `${each.id} (${each.gap})`).join(", ")}`);
  if (found.unproven.length) {
    lines.push(`  proven by nothing: ${found.unproven.length}`);
    for (const each of found.unproven) lines.push(`    ${each.id}  ${each.path}:${each.line}`);
    lines.push("  For each: a test that cites it, By: walk, By: <a later chunk>, or a dispute row in its gaps table. A rule is tested where it lives, citing its ID.");
  }
  return lines;
}
