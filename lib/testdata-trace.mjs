// `wf testdata trace [area] [--all]`: how an area's test-data spec and the
// project's code point at each other, both ways. A spec row no code names
// (a rule, a check, a fixture, an input, a journey state, a dataset) is data nobody
// builds or checks yet; a test that names no row and no story checks
// something the spec does not say. Both are facts to judge, not failures:
// a row can wait for its chunk, and a test of plain code needs no row.
//
// `wf testdata trace --chunk <id>` is the one part that fails: the checks and
// accepted rules of a chunk's stories, each proven by a test, walked by hand,
// left to a later open chunk, or disputed. `wf done chunk` waits on it.

import { chunkRows, chunkStories, storiesIn } from "./docs/shape.mjs";
import { CHECK_OR_RULE_IN_TEXT } from "./ids.mjs";
import { CHUNK_ID, chunkId } from "./lanes.mjs";
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
        // The comments between #[test] and fn are the test's too, such as a `// C-GM-41` citing what it proves.
        if (fn) { out.push({ line: next + 1, name: fn[2], text: `${above(at)}\n${lines.slice(at, next).join("\n")}\n${body(next, fn[1], "}")}` }); break; }
      }
    } else if (JS_TESTS.test(path)) {
      const t = line.match(JS_TEST);
      if (t) out.push({ line: at + 1, name: t[3], text: `${above(at)}\n${body(at, t[1], "})")}` });
    }
  });
  return out;
}

const codeFiles = (tracked) => tracked.filter((p) => CODE.test(p) && !p.startsWith("docs/") && !/(^|\/)(node_modules|target|\.cache)\//.test(p));
// A test or a scenario file as a whole: a fixture the generator writes may list IDs it proves nothing about.
const TEST_FILE = /(^|\/)(tests?|e2e|scenarios?)\/|[._-](test|spec)\.[a-z]+$|_tests?\.rs$/;

/**
 * The tokens code names. With `tests`, only what a test or a scenario
 * names: each test's body and the comments above it, and every file under a
 * tests, e2e, or scenarios folder. Without, any code file, and its path.
 */
export function namedInCode({ tracked, files }, { tests = false } = {}) {
  const named = new Set();
  for (const path of codeFiles(tracked)) {
    if (!tests) {
      for (const t of tokens(files(path))) named.add(t);
      for (const t of tokens(path)) named.add(t);
    } else if (TEST_FILE.test(path) && !/(^|\/)fixtures\//.test(path)) for (const t of tokens(files(path))) named.add(t);
    else for (const each of testsIn(path, files(path))) for (const t of tokens(each.text)) named.add(t);
  }
  return named;
}

/**
 * The trace for one area, or every area with a docs folder: spec ids no code
 * file names, and tests that name no spec id and no story. `tracked` is every
 * tracked path, `files(path)` its text.
 */
export function trace({ config, tracked, files }, areaId = null) {
  const areas = config.areas.filter((a) => a.docs && (!areaId || a.id === areaId));
  if (areaId && !areas.length) throw new Error(`no area ${areaId} with a docs folder in .workflow/config.json`);
  const code = codeFiles(tracked);
  const named = namedInCode({ tracked, files });
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
/**
 * A chunk's checks and accepted rules: those naming one of its `stories`, or
 * whose By names this chunk. Each is sorted into `proven` (a test or a
 * scenario cites it, or By says `walked <a done chunk>`), `walk` (for the
 * owner's sign-off page), `later` (By names another open chunk), `disputed`
 * (an open gap of kind `dispute` names it), or `unproven`. A By naming no
 * open chunk, or `walked` a chunk not done, proves nothing: it is unproven,
 * with `bad` saying why. `open` and `done` are the build order's and the done
 * list's chunk ids.
 */
export function chunkChecks({ config, tracked, files }, chunk, stories, { open = [], done = [] } = {}) {
  const same = (a, b) => a.toLowerCase() === b.toLowerCase();
  const mine = new Set(stories);
  const named = namedInCode({ tracked, files }, { tests: true });
  const out = { chunk, stories: [...mine], proven: [], walk: [], later: [], disputed: [], unproven: [] };
  for (const area of config.areas.filter((a) => a.docs)) {
    const dir = `${area.docs}/test-data/`;
    const ids = specIds(tracked.filter((p) => p.startsWith(dir) && p.endsWith(".md")), files);
    // An open dispute is a gap row of kind `dispute` that names the check or rule: the next refresh answers it.
    const disputes = new Map();
    for (const gap of ids.filter((each) => each.kind === "gap" && each.gapKind === "dispute")) for (const id of gap.text.match(CHECK_OR_RULE_IN_TEXT) ?? []) disputes.set(id, gap.id);
    // Checks, and accepted rules: a proposed rule is the reviewer's to accept first.
    for (const row of ids.filter((each) => each.kind === "check" || (each.kind === "rule" && !/^new$/i.test(each.accepted ?? "")))) {
      const by = row.by ?? "";
      const byChunk = CHUNK_ID.test(by) ? by : null;
      const walked = /^walked\s+(\S+)/i.exec(by)?.[1] ?? null;
      // Ours: it names one of the chunk's stories (By may hand it to a later chunk), or its By names this chunk.
      const ours = (byChunk && same(byChunk, chunk)) || storiesIn(row.stories).some((s) => mine.has(s));
      if (!ours) continue;
      const at = { id: row.id, kind: row.kind, path: row.path, line: row.line, by };
      if (named.has(row.id)) out.proven.push(at);
      else if (walked && done.some((id) => same(id, walked))) out.proven.push(at);
      else if (walked) out.unproven.push({ ...at, bad: `By says walked ${walked}, which is not a done chunk` });
      else if (/^walk$/i.test(by)) out.walk.push(at);
      else if (disputes.has(row.id)) out.disputed.push({ ...at, gap: disputes.get(row.id) });
      else if (byChunk && !same(byChunk, chunk) && open.some((id) => same(id, byChunk))) out.later.push(at);
      else if (byChunk && !same(byChunk, chunk)) out.unproven.push({ ...at, bad: `By names ${byChunk}, which is not an open chunk` });
      else out.unproven.push(at);
    }
  }
  return out;
}

/**
 * The chunk view from the build order: `{ found }`, or `{ noRow: true }`
 * when neither the build order nor the done list has the chunk. `read(path)`
 * gives a file's text.
 */
export function chunkTrace(ctx, chunk, read) {
  const order = read(ctx.config.buildOrder.file);
  const doneText = read(ctx.config.buildOrder.done);
  const stories = chunkStories(chunk, [order, doneText]);
  if (!stories) return { noRow: true };
  const ids = (text) => chunkRows(text).map((row) => chunkId(row.chunk));
  return { found: chunkChecks(ctx, chunk, stories, { open: ids(order), done: ids(doneText) }) };
}

/** A chunk's checks as lines to print; the unproven ones are what its end waits on. */
export function chunkLines(found) {
  const ids = (list) => list.map((each) => each.id).join(", ");
  const all = [...found.proven, ...found.walk, ...found.later, ...found.disputed, ...found.unproven];
  const count = (kind) => all.filter((each) => each.kind === kind).length;
  const lines = [`${found.chunk}: ${count("check")} checks and ${count("rule")} rules name its stories (${found.stories.join(", ") || "none"}).`];
  lines.push(`  proven by a test or a scenario, or walked in a done chunk: ${found.proven.length}`);
  if (found.walk.length) lines.push(`  for the sign-off page, a walk by hand each: ${ids(found.walk)}`);
  if (found.later.length) lines.push(`  left to a later chunk: ${found.later.map((each) => `${each.id} (${each.by})`).join(", ")}`);
  if (found.disputed.length) lines.push(`  disputed, for the next refresh: ${found.disputed.map((each) => `${each.id} (${each.gap})`).join(", ")}`);
  if (found.unproven.length) {
    lines.push(`  proven by nothing: ${found.unproven.length}`);
    for (const each of found.unproven) lines.push(`    ${each.id}  ${each.path}:${each.line}${each.bad ? `  (${each.bad})` : ""}`);
    lines.push("  For each: cite it in the test that already shows it; a new test only where none does, never one just to cite (CS-TEST).");
    lines.push("  Else By: walk, By: <a later open chunk>, or a dispute row in its gaps table. A rule is tested where it lives, citing its ID.");
  }
  return lines;
}
