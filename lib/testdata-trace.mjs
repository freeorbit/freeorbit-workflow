// `wf testdata trace [area] [--all]`: how an area's test-data spec and the
// project's code point at each other, both ways. A spec row no code names
// (a rule, a check, a fixture, an input, a journey state, a dataset) is data nobody
// builds or checks yet; a test that names no row and no story checks
// something the spec does not say. Both are facts to judge, not failures:
// a row can wait for its chunk, and a test of plain code needs no row.
//
// `wf testdata trace --chunk <id>` is the one part that fails: the acceptance
// lines and accepted rules of a chunk's stories, each proven by a test that
// cites it (`// GM-07.3`), walked by hand, left to a later open chunk, or
// disputed. `wf done chunk` waits on it. A checks table, from before
// v0.69.0, is counted and never gated.

import { chunkRows, chunkStories, storiesIn } from "./docs/shape.mjs";
import { matcher } from "./config/config.mjs";
import { readStories, riskLines } from "./docs/stories.mjs";
import { ACCEPTANCE_IN_TEXT, CHECK_OR_RULE_IN_TEXT, prefixesOf } from "./ids.mjs";
import { CHUNK_ID, chunkId } from "./lanes.mjs";
import { forOwner, proofRows, specIds } from "./testdata.mjs";

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
  // An acceptance line's ID holds a dot, which no other token does: GM-07.3.
  for (const t of String(text).match(ACCEPTANCE_IN_TEXT) ?? []) out.add(t);
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

/** The code files that name each ID: Map(id, [path]). */
export function citingFiles({ tracked, files }, ids) {
  const out = new Map(ids.map((id) => [id, []]));
  for (const path of codeFiles(tracked)) {
    const text = files(path);
    if (!ids.some((id) => text.includes(id))) continue;
    const named = tokens(text);
    for (const id of ids) if (named.has(id)) out.get(id).push(path);
  }
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
  const code = codeFiles(tracked);
  const named = namedInCode({ tracked, files });
  const all = [];
  const result = [];
  for (const area of areas) {
    const dir = `${area.docs}/test-data/`;
    // A check only the walk by hand proves is no code's to name.
    const ids = specIds(tracked.filter((p) => p.startsWith(dir) && p.endsWith(".md")), files, { walk: false }).filter((each) => each.kind !== "dropped");
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

/**
 * A chunk's acceptance lines and accepted rules: the lines of its `stories`,
 * and the rules naming one of them or whose By names this chunk. Each is
 * sorted into `proven` (a test or a scenario cites it, or By says `walked <a
 * done chunk>`), `walk` (for the owner's sign-off page), `later` (By names
 * another open chunk), `disputed` (an open gap of kind `dispute` names it),
 * or, proven by nothing, `unproven` (a high-risk line, or a product, safety,
 * or untyped rule, which the chunk end waits on), `low` (a low-risk line,
 * only counted, unless `testdata.chunkScope` is "all"), or `ungated` (a craft
 * rule). A line's By
 * is its row in the area's proof table, `| Line | By |`; a By that names a
 * rule proves the line once a test cites that rule. A By naming no open
 * chunk, or `walked` a chunk not done, proves nothing: it is unproven, with
 * `bad` saying why. `legacy` counts the check rows naming the stories, and
 * how many a test cites; none is gated. `open` and `done` are the build
 * order's and the done list's chunk ids.
 */
export function chunkChecks({ config, tracked, files }, chunk, stories, { open = [], done = [] } = {}) {
  const same = (a, b) => a.toLowerCase() === b.toLowerCase();
  const mine = new Set(stories);
  const named = namedInCode({ tracked, files }, { tests: true });
  const out = { chunk, stories: [...mine], proven: [], walk: [], later: [], disputed: [], unproven: [], ungated: [], low: [], legacy: { checks: 0, cited: 0 } };
  // "high" holds a chunk to its high-risk lines; "all" to every line, as before v0.76.0.
  // Any other value holds every line too: a mistyped setting never relaxes the gate, and doc:check names it.
  const everyLine = (config.testdata.chunkScope ?? "high") !== "high";
  const sort = (at, by, disputes, gated) => {
    const byChunk = CHUNK_ID.test(by) ? by : null;
    const walked = /^walked\s+(\S+)/i.exec(by)?.[1] ?? null;
    // A By that proves nothing is a fault in the proof table, whatever the line's risk.
    const leftOpen = (each) => (each.bad || gated ? out.unproven : each.kind === "line" ? out.low : out.ungated).push(each);
    // A line a rule covers, such as "the step finishes with AI off", is proven by that rule's one test.
    const byRule = /^R-[A-Z]+-\d+$/.test(by) ? by : null;
    if (named.has(at.id)) out.proven.push(at);
    else if (byRule && named.has(byRule)) out.proven.push(at);
    else if (byRule) leftOpen({ ...at, bad: `By names ${byRule}, which no test cites` });
    else if (walked && done.some((id) => same(id, walked))) out.proven.push(at);
    else if (walked) leftOpen({ ...at, bad: `By says walked ${walked}, which is not a done chunk` });
    else if (/^walk$/i.test(by)) out.walk.push(at);
    else if (disputes.has(at.id)) out.disputed.push({ ...at, gap: disputes.get(at.id) });
    else if (byChunk && !same(byChunk, chunk) && open.some((id) => same(id, byChunk))) out.later.push(at);
    else if (byChunk && !same(byChunk, chunk)) leftOpen({ ...at, bad: `By names ${byChunk}, which is not an open chunk` });
    else leftOpen(at);
  };
  const storyFiles = tracked.filter(matcher(config.stories.files));
  for (const area of config.areas.filter((a) => a.docs)) {
    const dir = `${area.docs}/test-data/`;
    const paths = tracked.filter((p) => p.startsWith(dir) && p.endsWith(".md"));
    const ids = specIds(paths, files);
    // An open dispute is a gap row of kind `dispute` that names the line or rule: the next refresh answers it.
    const disputes = new Map();
    for (const gap of ids.filter((each) => each.kind === "gap" && each.gapKind === "dispute")) for (const id of [...(gap.text.match(CHECK_OR_RULE_IN_TEXT) ?? []), ...(gap.text.match(ACCEPTANCE_IN_TEXT) ?? [])]) disputes.set(id, gap.id);
    const proof = new Map(proofRows(paths, files).map((row) => [row.id, row.by]));
    // The stories' acceptance lines. A high-risk one is gated; a low-risk one with no proof is only counted,
    // unless testdata.chunkScope is "all". A proof row is honoured for either: a walk goes to sign-off.
    for (const path of area.prefix ? storyFiles : []) for (const story of readStories(files(path), [area.prefix], path)) {
      if (story.removed || !mine.has(story.id)) continue;
      const high = new Set(riskLines(story).high.map((each) => each.id));
      for (const line of story.acceptance.filter((each) => !each.removed)) {
        const by = proof.get(line.id) ?? "";
        sort({ id: line.id, kind: "line", path, line: story.line, by, text: line.text }, by, disputes, everyLine || high.has(line.id));
      }
    }
    // Accepted rules: a proposed rule is the reviewer's to accept first.
    for (const row of ids.filter((each) => each.kind === "rule" && !/^new$/i.test(each.accepted ?? ""))) {
      const by = row.by ?? "";
      // Ours: it names one of the chunk's stories (By may hand it to a later chunk), or its By names this chunk.
      const ours = (CHUNK_ID.test(by) && same(by, chunk)) || storiesIn(row.stories).some((s) => mine.has(s));
      if (ours) sort({ id: row.id, kind: "rule", path: row.path, line: row.line, by, type: row.type ?? "" }, by, disputes, forOwner(row));
    }
    for (const row of ids.filter((each) => each.kind === "check" && storiesIn(each.stories).some((s) => mine.has(s)))) {
      out.legacy.checks++;
      if (named.has(row.id)) out.legacy.cited++;
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

/** How the chunk trace starts its count of low-risk lines with no test; `wf done chunk` reads the count after it. */
export const LOW_NOTE = "low-risk lines no test cites, not gated: ";

/** A chunk's acceptance lines and rules as lines to print; what nothing proves is what its end waits on. */
export function chunkLines(found, { all = false } = {}) {
  const ids = (list) => list.map((each) => each.id).join(", ");
  const every = [...found.proven, ...found.walk, ...found.later, ...found.disputed, ...found.unproven, ...found.ungated, ...found.low];
  const count = (kind) => every.filter((each) => each.kind === kind).length;
  const lines = [`${found.chunk}: ${count("line")} acceptance lines and ${count("rule")} rules for its stories (${found.stories.join(", ") || "none"}).`];
  lines.push(`  proven by a test or a scenario, or walked in a done chunk: ${found.proven.length}`);
  if (found.walk.length) lines.push(`  for the sign-off page, a walk by hand each: ${ids(found.walk)}`);
  if (found.later.length) lines.push(`  left to a later chunk: ${found.later.map((each) => `${each.id} (${each.by})`).join(", ")}`);
  if (found.disputed.length) lines.push(`  disputed, for the next refresh: ${found.disputed.map((each) => `${each.id} (${each.gap})`).join(", ")}`);
  if (found.ungated.length) lines.push(`  craft rules no test cites yet, the team's, not gated: ${found.ungated.length}`);
  if (found.low.length) {
    lines.push(`  ${LOW_NOTE}${found.low.length}${all ? "" : " (--all lists them)"}`);
    if (all) for (const each of found.low) lines.push(`    ${each.id}  ${each.text.slice(0, 70)}`);
  }
  if (found.legacy.checks) lines.push(`  check rows from before acceptance lines were the checks, not gated: ${found.legacy.checks}, ${found.legacy.cited} cited by a test; npx wf testdata prune <area> takes out those nothing cites`);
  if (found.unproven.length) {
    lines.push(`  held by the chunk end and proven by nothing: ${found.unproven.length}`);
    for (const each of found.unproven) lines.push(`    ${each.id}  ${each.kind === "line" ? each.text.slice(0, 70) : `${each.path}:${each.line}`}${each.bad ? `  (${each.bad})` : ""}`);
    lines.push("  For each: cite it in the test that already shows it, such as // GM-07.3; a new test only where none does, never one just to cite (CS-TEST).");
    lines.push("  Else a row in the area's proof table, | Line | By |, with walk or a later open chunk; a rule's own By cell; or a dispute row in a gaps table.");
  }
  return lines;
}
