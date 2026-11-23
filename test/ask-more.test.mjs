// A note that is the answer, and asking the agent for more: a question
// answered in its note alone, the person's requests for more on a question
// or the page, the agent's rich replies and added options, details written
// when the page is built, and code shown from the project.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { answersMarkdown, askState, checkAnswers, recordAnswers } from "../lib/ask/answers.mjs";
import { fieldsOf } from "../lib/ask/fields.mjs";
import { runAsk } from "../lib/ask/index.mjs";
import { addAsk, addMore, markTold, MORE_LIMITS, moreBlocks, moreOf, PAGE, pendingAsks, readAsks, readMore, untoldAsks, withMore } from "../lib/ask/more.mjs";
import { changesSince, keepRound, rounds } from "../lib/ask/live.mjs";
import { exportHtml } from "../lib/ask/page.mjs";
import { buildPage } from "../lib/ask/page.mjs";
import { RULES } from "../lib/ask/rules.mjs";
import { normalize } from "../lib/ask/spec.mjs";
import { codeFile as fileOf } from "../lib/ask/sources.mjs";
import { answersPath, askDir } from "../lib/ask/store.mjs";
import { KIT_KINDS } from "../lib/design/annotate.mjs";
import { serve } from "../lib/view/serve.mjs";

process.env.WF_ASK_NO_SERVER = "1";
process.env.WF_STATE_DIR = mkdtempSync(join(tmpdir(), "wf-ask-more-state-"));

const opt = (id) => ({ id, label: id.toUpperCase(), why: `${id}, as it says.` });
const choice = (id, extra = {}) => ({ id, text: `Pick ${id}?`, type: "one", options: [opt("a"), opt("b")], recommended: "a", why: "It reads best.", ...extra });
const page = (extra = {}) => ({ id: "more-test", title: "More", questions: [choice("q1"), choice("q2")], ...extra });
function built(raw = page(), files = {}) {
  const root = mkdtempSync(join(tmpdir(), "wf-ask-more-"));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(root, name, ".."), { recursive: true });
    writeFileSync(join(root, name), text);
  }
  const view = join(root, ".cache/view");
  const { spec } = buildPage(root, view, raw, KIT_KINDS);
  const past = new Date(Date.now() - 60_000);
  utimesSync(join(askDir(view, spec.id), "spec.json"), past, past);
  return { root, view, spec };
}
const check = (spec, answers, view) => checkAnswers(view ? withMore(view, spec) : spec, { id: spec.id, hash: spec.hash, answers }, KIT_KINDS);
const send = (view, spec, answers) => {
  const { answers: checked, problems } = check(spec, answers, view);
  assert.equal(problems, undefined);
  mkdirSync(join(view, "answers"), { recursive: true });
  writeFileSync(answersPath(view, spec.id), JSON.stringify(checked));
  return checked;
};
const text = (s) => ({ type: "text", text: s });

// --- a note alone is the answer ------------------------------------------------------

test("a note alone answers a question of any type, but not one half placed", () => {
  const one = normalize(page()).spec.questions[0];
  assert.equal(RULES.answered({ note: "Neither; keep it as it is." }, one), true);
  assert.equal(RULES.inNote({ note: "Neither." }, one), true);
  assert.equal(RULES.answered({ note: "   " }, one), false, "a note of spaces says nothing");
  assert.equal(RULES.inNote({ note: "x", choice: "a" }, one), false, "with a pick the note is a note");
  const grid = normalize({ id: "g", title: "G", questions: [{ id: "g", text: "Each?", type: "grid", rows: ["r1", "r2"], options: [opt("a"), opt("b")], recommended: { r1: "a" }, why: "w" }] }).spec.questions[0];
  assert.equal(RULES.answered({ note: "None of these fit." }, grid), true, "nothing placed: the note is the answer");
  assert.equal(RULES.answered({ note: "And the rest?", rows: { r1: "a" } }, grid), false, "half placed: the note is about the rows");
  const rank = normalize({ id: "r", title: "R", questions: [{ id: "o", text: "Order?", type: "rank", options: [opt("a"), opt("b")], why: "w" }] }).spec.questions[0];
  assert.equal(RULES.answered({ note: "Drop b." }, rank), true);
  assert.equal(RULES.asRecommended(one, { note: "Neither." }), false, "a note alone is never a plain agreement");
});

test("a note alone opens no follow-up, as You decide does not", () => {
  const { spec } = normalize(page({ questions: [choice("q1"), choice("q2", { showIf: { question: "q1" } })] }));
  const byId = new Map(spec.questions.map((q) => [q.id, q]));
  assert.equal(RULES.shown(spec.questions[1], { q1: { choice: "a" } }, byId), true);
  assert.equal(RULES.shown(spec.questions[1], { q1: { note: "Neither." } }, byId), false);
});

test("answers in a note alone are not open, and the agent reads that the note is the answer", () => {
  const { spec } = normalize(page());
  const { answers } = check(spec, { q1: { choice: "a" }, q2: { note: "Neither: keep the old layout." } });
  assert.equal(answers.partial, false);
  assert.deepEqual(answers.open, []);
  assert.deepEqual(answers.inNote, ["q2"]);
  assert.equal(check(spec, { q1: { choice: "a" } }).answers.inNote, undefined, "no list when no answer is in a note alone");
  const md = answersMarkdown(spec, answers, {}, { brief: true });
  assert.match(md, /- \*\*q2\*\* Pick q2\?: the note is the answer; no option was picked\.\n {2}- Note: Neither: keep the old layout\./);
  assert.match(md, /2 of 2 answered: 1 as recommended with nothing added, 1 in a note alone, 0 other, 0 open\./);
  const rank = normalize({ id: "r", title: "R", questions: [{ id: "o", text: "Order?", type: "rank", options: [opt("a"), opt("b")], why: "w" }] }).spec;
  assert.match(answersMarkdown(rank, check(rank, { o: { note: "Drop b." } }).answers), /the note is the answer; no order was given/);
});

test("record writes no decision for a question answered in its note alone, and says so", () => {
  const root = mkdtempSync(join(tmpdir(), "wf-ask-more-record-"));
  const { spec } = normalize(page({ questions: [choice("q1", { record: "general" })] }));
  const { answers } = check(spec, { q1: { note: "Neither." } });
  const lines = recordAnswers(root, { logs: {} }, spec, answers, "2026-11-23");
  assert.deepEqual(lines, ["q1: answered in its note alone, so no decision was written; record it by hand if it is one"]);
});

// --- asking for more ------------------------------------------------------------------

test("the person asks for more on a question or the page, kept to a size and a count", () => {
  const { view, spec } = built();
  assert.deepEqual(addAsk(view, spec, { question: "q1", text: "Show an example" }), { n: 1 });
  assert.deepEqual(addAsk(view, spec, { question: PAGE, text: "What is this page about?" }), { n: 1 });
  assert.deepEqual(addAsk(view, spec, { question: "q1", kind: "option", text: "Both, behind a setting" }), { n: 2 });
  const asks = readAsks(view, spec.id);
  assert.deepEqual(asks.q1.map((a) => [a.n, a.kind, a.text]), [[1, "more", "Show an example"], [2, "option", "Both, behind a setting"]]);
  assert.throws(() => addAsk(view, spec, { question: "nope", text: "x" }), /nope is not a question on the page/);
  assert.throws(() => addAsk(view, spec, { question: "q1", text: "  " }), /says what would help/);
  assert.throws(() => addAsk(view, spec, { question: "q1", text: "x".repeat(MORE_LIMITS.ask + 1) }), /at most 1000/);
  assert.throws(() => addAsk(view, spec, { question: "q1", kind: "shout", text: "x" }), /kind is more or option/);
  assert.throws(() => addAsk(view, spec, { question: PAGE, kind: "option", text: "x" }), /an option is proposed on a one or many question/);
  for (let i = 0; i < MORE_LIMITS.pending; i++) addAsk(view, spec, { question: "q2", text: `More ${i}` });
  assert.throws(() => addAsk(view, spec, { question: "q2", text: "One too many" }), /already waits on 5 asks/);
  const off = built(page({ id: "more-off", off: ["more"] }));
  assert.throws(() => addAsk(off.view, off.spec, { question: "q1", text: "x" }), /turned off/);
});

test("the agent's reply answers the asks before it: blocks, Markdown with code, and added options", () => {
  const { view, spec } = built();
  addAsk(view, spec, { question: "q1", text: "Show the code" });
  addAsk(view, spec, { question: "q2", text: "Why?" });
  assert.deepEqual(pendingAsks(view, spec).map((a) => a.question), ["q1", "q2"]);
  const { blocks, problems } = moreBlocks({ md: "Here:\n\n```js:41\nconst x = 1;\n```" }, {});
  assert.deepEqual(problems, []);
  assert.deepEqual(Object.keys(blocks[0]).sort(), ["id", "note", "source", "title", "type"], "text goes as Markdown; the page parses it");
  const back = addMore(view, spec, "q1", { blocks });
  assert.equal(back.to, 1);
  assert.deepEqual(pendingAsks(view, spec).map((a) => a.question), ["q2"], "q1's ask is answered");
  assert.equal(readMore(view, spec.id).replies.q1[0].blocks[0].type, "text");
  assert.throws(() => addMore(view, spec, "q1", {}), /a reply shows something/);
  assert.throws(() => addMore(view, spec, "nope", { blocks }), /nope is not a question/);
  // An option the agent adds can be picked, and its answer is checked with it.
  addMore(view, spec, "q1", { options: [{ id: "c", label: "Both", why: "Behind a setting." }] });
  const more = withMore(view, spec);
  assert.deepEqual(more.questions[0].options.map((o) => [o.id, o.added === true]), [["a", false], ["b", false], ["c", true]]);
  assert.equal(more.hash, spec.hash, "an added option does not make it another page");
  assert.equal(spec.questions[0].options.length, 2, "the spec read is not changed");
  assert.equal(check(spec, { q1: { choice: "c" } }, view).problems, undefined);
  assert.match(check(spec, { q1: { choice: "c" } }).problems.join(), /"c" is not one of its options/);
  assert.throws(() => addMore(view, spec, "q1", { options: [{ id: "a", label: "Again" }] }), /q1 has an option a already/);
  assert.throws(() => addMore(view, spec, "q1", { options: [{ id: "bad id", label: "x" }] }), /an option has an id/);
  const rank = built({ id: "more-rank", title: "R", questions: [{ id: "o", text: "Order?", type: "rank", options: [opt("a"), opt("b")], why: "w" }] });
  assert.throws(() => addMore(rank.view, rank.spec, "o", { options: [opt("c")] }), /options are added to a one or many question/);
  assert.match(moreBlocks({ md: "x".repeat(4001) }, {}).problems.join(), /at most 4000/);
  assert.match(moreBlocks({ blocks: [{ type: "questions" }] }, {}).problems.join(), /holds no questions/);
});

test("a reply after the page was sent asks again, as a reply under a question does", () => {
  const { view, spec } = built();
  send(view, spec, { q1: { choice: "a" }, q2: { choice: "b" } });
  assert.equal(askState(view, spec.id, spec).state, "answered");
  addAsk(view, spec, { question: "q2", text: "Why b?" });
  assert.equal(askState(view, spec.id, spec).state, "answered", "the person asking is not the agent asking");
  addMore(view, spec, "q2", { blocks: [{ type: "text", title: "", note: "", id: "", source: "Because." }] });
  assert.equal(askState(view, spec.id, spec).state, "waiting");
});

test("a page built again as it was keeps the asks and replies; a changed one drops them", () => {
  const raw = page();
  const { root, view, spec } = built(raw);
  addAsk(view, spec, { question: "q1", text: "More" });
  buildPage(root, view, raw, KIT_KINDS);
  assert.equal(readAsks(view, spec.id).q1.length, 1);
  buildPage(root, view, page({ questions: [choice("q1"), choice("q3")] }), KIT_KINDS);
  assert.deepEqual(readAsks(view, spec.id), {});
  assert.deepEqual(readMore(view, spec.id).replies, {});
});

test("the server takes an ask from the page with its token, and the page reads the replies", async () => {
  const { view, spec } = built();
  const key = "more-test-123456";
  const find = (k) => (k === key ? { key, view, kinds: KIT_KINDS } : null);
  const { port, pageToken, close } = await serve({ resolve: find, list: () => [{ key, view, name: "demo" }], check: checkAnswers, stateOf: askState, moreOf, askMore: addAsk, specOf: withMore, onAnswers: keepRound, port: 0, log: () => {} });
  try {
    const base = `http://127.0.0.1:${port}`;
    const ask = (body, token = pageToken(key, spec.id)) => fetch(`${base}/__ask/${key}/more/${spec.id}`, { method: "POST", headers: { "Content-Type": "application/json", "X-WF-Token": token }, body: JSON.stringify(body) });
    const ok = await ask({ question: "q1", text: "An example" });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { ok: true, n: 1 });
    assert.equal((await ask({ question: "q1", text: "x" }, "wrong")).status, 403);
    const bad = await ask({ question: "q9", text: "x" });
    assert.equal(bad.status, 422);
    assert.match((await bad.json()).error, /q9 is not a question/);
    assert.equal((await fetch(`${base}/__ask/${key}/more/${spec.id}`)).status, 405);
    addMore(view, spec, "q1", { options: [{ id: "c", label: "Both", why: "w" }] });
    const got = await (await fetch(`${base}/__ask/${key}/live/${spec.id}`)).json();
    assert.equal(got.more.asks.q1[0].text, "An example");
    assert.equal(got.more.replies.q1[0].options[0].id, "c");
    // An added option is one the page may send.
    const res = await fetch(`${base}/__ask/${key}/answers/${spec.id}`, { method: "POST", headers: { "Content-Type": "application/json", "X-WF-Token": pageToken(key, spec.id) }, body: JSON.stringify({ id: spec.id, hash: spec.hash, answers: { q1: { choice: "c" } } }) });
    assert.equal(res.status, 200);
    assert.equal(rounds(view, spec.id)[0].spec.questions[0].options.at(-1).label, "Both", "the round names the added option");
  } finally {
    await close();
  }
  // With asking off, the server takes no ask and the poll shows none.
  const shut = built(page({ id: "more-shut", off: ["more"] }));
  const findShut = (k) => (k === key ? { key, view: shut.view, kinds: KIT_KINDS } : null);
  const other = await serve({ resolve: findShut, list: () => [], check: checkAnswers, stateOf: askState, moreOf, askMore: addAsk, port: 0, log: () => {} });
  try {
    const res = await fetch(`http://127.0.0.1:${other.port}/__ask/${key}/more/${shut.spec.id}`, { method: "POST", headers: { "Content-Type": "application/json", "X-WF-Token": other.pageToken(key, shut.spec.id) }, body: JSON.stringify({ question: "q1", text: "x" }) });
    assert.equal(res.status, 403);
    assert.deepEqual((await (await fetch(`http://127.0.0.1:${other.port}/__ask/${key}/live/${shut.spec.id}`)).json()).more, { asks: {}, replies: {}, told: {} });
  } finally {
    await other.close();
  }
});

test("a reply answers the asks wait told; one that came after waits for its own", () => {
  const { view, spec } = built();
  addAsk(view, spec, { question: "q1", text: "First" });
  markTold(view, spec, untoldAsks(view, spec));
  addAsk(view, spec, { question: "q1", text: "Second, while the agent wrote" });
  assert.equal(addMore(view, spec, "q1", { blocks: [{ type: "text", title: "", note: "", id: "", source: "One." }] }).to, 1);
  assert.deepEqual(untoldAsks(view, spec).map((a) => a.text), ["Second, while the agent wrote"]);
  assert.deepEqual(moreOf(view, spec.id).told, { q1: 1 }, "the page reads which asks the agent has");
});

test("added options are counted per question, also on the spec that holds them", () => {
  const { view, spec } = built();
  const opts = (from, n) => Array.from({ length: n }, (_, i) => ({ id: `o${from + i}`, label: `O${from + i}` }));
  addMore(view, spec, "q1", { options: opts(0, MORE_LIMITS.options - 1) });
  assert.throws(() => addMore(view, withMore(view, spec), "q1", { options: opts(20, 2) }), /at most 10 added options/);
  addMore(view, withMore(view, spec), "q1", { options: opts(30, 1) });
  // A reply that adds an option is kept past the replies limit, so the option stays pickable.
  for (let i = 0; i < MORE_LIMITS.replies + 2; i++) addMore(view, spec, "q1", { blocks: [{ type: "text", title: "", note: "", id: "", source: `R${i}` }] });
  assert.equal(withMore(view, spec).questions[0].options.length, 2 + MORE_LIMITS.options);
});

test("changed details are said as such, and an export carries the asks and replies", () => {
  const a = normalize(page({ questions: [choice("q1", { more: [text("One.")] }), choice("q2")] })).spec;
  const b = normalize(page({ questions: [choice("q1", { more: [text("Two.")] }), choice("q2")] })).spec;
  const c = changesSince(a, b, "2026-11-23T00:00:00Z");
  assert.deepEqual(c.changed, [{ id: "q1", what: ["its details"] }]);
  assert.equal(c.pictures, false);
  const { view, spec } = built();
  addAsk(view, spec, { question: "q1", text: "More" });
  addMore(view, spec, "q1", { options: [{ id: "c", label: "Both" }] });
  assert.match(exportHtml(view, spec, KIT_KINDS, null), /"more":\{"asks":\{"q1":\[\{"n":1,"kind":"more","text":"More"/);
});

test("wf ask wait wakes the agent on an ask, once; wf ask more answers it; answers lists any left", async () => {
  const root = mkdtempSync(join(tmpdir(), "wf-ask-more-cli-"));
  mkdirSync(join(root, ".workflow"));
  writeFileSync(join(root, ".workflow/config.json"), "{}");
  writeFileSync(join(root, "package.json"), "{}");
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src/a.js"), Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join("\n"));
  spawnSync("git", ["init", "-q"], { cwd: root });
  const cwd = process.cwd();
  process.chdir(root);
  try {
    const out = [];
    const log = (line) => out.push(line);
    writeFileSync(join(root, "p.json"), JSON.stringify(page()));
    assert.equal(await runAsk(["page", "p.json"], log), 0);
    const view = join(root, ".cache/view");
    const spec = JSON.parse(readFileSync(join(view, "ask/more-test/spec.json"), "utf8"));
    addAsk(view, spec, { question: "q1", text: "Show the code" });
    addAsk(view, spec, { question: PAGE, text: "Why now?" });
    out.length = 0;
    assert.equal(await runAsk(["wait", "more-test", "--timeout", "5"], log), 0);
    const said = out.join("\n");
    assert.match(said, /More asked on the page more-test, while the person answers:/);
    assert.match(said, /- q1 \(Pick q1\?\): “Show the code”/);
    assert.match(said, /- the page: “Why now\?”/);
    assert.match(said, /npx wf ask more more-test <question \| --page>/);
    assert.deepEqual(untoldAsks(view, spec), [], "told once");
    out.length = 0;
    assert.equal(await runAsk(["wait", "more-test", "--timeout", "0.6"], log), 3, "an ask told is not told again");
    assert.equal(await runAsk(["answers", "more-test"], log), 0);
    assert.match(out.at(-1), /Asked for more, not answered yet:\n- the page: “Why now\?”\n- q1 \(Pick q1\?\): “Show the code”/);
    writeFileSync(join(root, "reply.md"), "The code:\n\n```js\nconst a = 1;\n```");
    writeFileSync(join(root, "code.json"), JSON.stringify([{ type: "code", file: "src/a.js", lines: [3, 5], mark: [4] }]));
    assert.equal(await runAsk(["more", "more-test", "q1", "--md", "reply.md", "--blocks", "code.json", "--option", JSON.stringify({ id: "c", label: "Both", why: "Behind a setting." })], log), 0);
    assert.match(out.at(-1), /more-test: more under q1, answering “Show the code”, with 2 blocks and 1 added option\. The page shows it now; run npx wf ask wait more-test again\./);
    const reply = readMore(view, "more-test").replies.q1[0];
    assert.deepEqual(reply.blocks.map((b) => b.type), ["text", "code"]);
    assert.deepEqual(reply.blocks[1].lines, ["line 3", "line 4", "line 5"]);
    assert.equal(await runAsk(["more", "more-test", "--page", "--text", "Because", "the", "release", "is", "close."], log), 0);
    assert.match(out.at(-1), /more on the page, answering “Why now\?”/);
    assert.equal(await runAsk(["more", "more-test", "q1"], log), 2, "a reply shows something");
    // Markdown that came through the shell as one line is refused, with how to pass it.
    out.length = 0;
    assert.equal(await runAsk(["more", "more-test", "q1", "--text", "Like this:\\n\\n```js\\nconst a = 1;\\n```"], log), 1);
    assert.match(out.join("\n"), /holds \\n as two characters.*--md -/s);
    assert.equal(await runAsk(["more", "more-test", "q1", "--md", "reply.md", "--text", "One line:\\n\\n- b"], log), 1, "each source is read on its own");
    writeFileSync(join(root, "open.md"), "```js\nconst a = 1;");
    assert.equal(await runAsk(["more", "more-test", "q1", "--md", "open.md"], log), 0);
    assert.match(out.join("\n"), /Markdown: a code fence is left open/);
    // A live page's update takes a code block of the project's file too.
    writeFileSync(join(root, "live.json"), JSON.stringify(page({ id: "more-live", live: true })));
    assert.equal(await runAsk(["page", "live.json"], log), 0);
    assert.equal(await runAsk(["live", "more-live", "--blocks", "code.json"], log), 0);
    assert.equal(await runAsk(["more", "more-test", "q1", "--blocks", "missing.json"], log).catch(() => 1), 1);
  } finally {
    process.chdir(cwd);
  }
});

// --- details written when the page is built --------------------------------------------

test("a question, a template's item, and the page carry details written when it is built", () => {
  const { spec, problems } = normalize(page({ more: [text("Why the page asks.")], questions: [choice("q1", { more: [text("The long story.")] }), choice("q2")] }));
  assert.deepEqual(problems, []);
  assert.equal(spec.more[0].source, "Why the page asks.");
  assert.equal(spec.questions[0].more[0].source, "The long story.");
  assert.deepEqual(spec.questions[1].more, []);
  const triage = normalize({ id: "t", title: "T", template: "triage", items: [{ id: "F-1", text: "A finding", noPick: "Yours.", more: [{ type: "code", code: "x()", lang: "js" }] }] });
  assert.deepEqual(triage.problems, []);
  assert.equal(triage.spec.questions[0].more[0].type, "code");
  for (const template of ["compare", "frame-review", "storyboard", "naming", "plan", "signoff"]) assert.match(fieldsOf(template).join("\n"), /\bmore\b/, `${template} items take more`);
  assert.match(normalize(page({ questions: [choice("q1", { more: [{ type: "questions" }] })] })).problems.join(), /holds no questions/);
  assert.match(normalize(page({ questions: [choice("q1", { more: "words" })] })).problems.join(), /more is a list of blocks/);
});

// --- code -------------------------------------------------------------------------------

test("a code block shows lines of a project file, its lines marked, read inside the project only", () => {
  const lines = Array.from({ length: 30 }, (_, i) => `row ${i + 1}`).join("\n");
  const { root, spec } = built(page({ blocks: [{ type: "code", file: "lib/x.mjs", lines: [10, 14], mark: [[11, 12]], title: "The loop" }, { type: "questions" }] }), { "lib/x.mjs": lines, ".env": "SECRET=1", "notes.txt": "a\nb" });
  const code = spec.sections[0].blocks[0];
  assert.deepEqual({ lang: code.lang, start: code.start, file: code.file, lines: code.lines, mark: code.mark }, { lang: "js", start: 10, file: "lib/x.mjs", lines: ["row 10", "row 11", "row 12", "row 13", "row 14"], mark: [[11, 12]] });
  const ctx = { file: (path) => fileOf(root, path) };
  const fails = (b) => normalize(page({ blocks: [b] }), {}, ctx).problems.join(" | ");
  assert.match(fails({ type: "code", file: "../x.js" }), /outside the project/);
  assert.match(fails({ type: "code", file: ".env" }), /may hold secrets/);
  assert.match(fails({ type: "code", file: ".git/config" }), /may hold secrets/);
  assert.match(fails({ type: "code", file: "nope.js" }), /does not exist/);
  assert.match(fails({ type: "code", file: "lib/x.mjs", lines: [20, 10] }), /lines are a first and a last line/);
  assert.match(fails({ type: "code", file: "lib/x.mjs", lines: [1, 900] }), /at most 400 lines/);
  assert.match(fails({ type: "code", file: "lib/x.mjs", code: "x" }), /a file or code, not both/);
  assert.match(fails({ type: "code" }), /a code block shows a file's lines, or code/);
  assert.match(fails({ type: "code", code: "x", mark: [[3, 1]] }), /mark is lines, or first and last lines/);
  const outside = join(mkdtempSync(join(tmpdir(), "wf-ask-more-outside-")), "out.txt");
  writeFileSync(outside, "not the project's");
  symlinkSync(outside, join(root, "out.txt"));
  assert.match(fails({ type: "code", file: "out.txt" }), /leads out of the project/);
  // Every name the guard's one list holds, and a link inside the project that leads to one, are refused.
  for (const name of [".git-credentials", "id_rsa.old", "id_ed25519-backup", "server.pem", ".npmrc", "credentials.json", "secrets/prod.yaml", ".GIT/config"]) assert.match(fails({ type: "code", file: name }), /may hold secrets/, name);
  mkdirSync(join(root, ".git"));
  writeFileSync(join(root, ".git/config"), "[remote] url = https://token@example.com");
  mkdirSync(join(root, "secrets"));
  writeFileSync(join(root, "secrets/prod.yaml"), "key: 1");
  symlinkSync(".git", join(root, "gitlink"));
  symlinkSync("secrets", join(root, "cfg"));
  assert.match(fails({ type: "code", file: "gitlink/config" }), /leads to a file that may hold secrets/);
  assert.match(fails({ type: "code", file: "cfg/prod.yaml" }), /leads to a file that may hold secrets/);
  assert.equal(normalize(page({ blocks: [{ type: "code", file: "notes.txt" }] }), {}, ctx).spec.sections[0].blocks[0].lang, "", "a plain file has no language");
  const inline = normalize(page({ blocks: [{ type: "code", code: "a\nb", lang: "py", start: 7, mark: [8] }] })).spec.sections[0].blocks[0];
  assert.deepEqual([inline.lines, inline.start, inline.mark], [["a", "b"], 7, [[8, 8]]]);
  assert.match(fieldsOf("code").join("\n"), /file, lines, mark, code, lang, start/);
});


test("the review-findings example builds, with details and code on each finding", () => {
  const raw = JSON.parse(readFileSync(new URL("../plugins/core/skills/ask-page/blocks/review-findings.json", import.meta.url), "utf8"));
  const { spec, problems } = normalize(raw);
  assert.deepEqual(problems, []);
  assert.deepEqual(spec.questions.map((q) => q.more.map((b) => b.type).join(",")), ["code,text", "diff"]);
  assert.deepEqual(spec.questions[0].more[0].mark, [[42, 42]]);
  assert.equal(spec.more[0].type, "text");
});
