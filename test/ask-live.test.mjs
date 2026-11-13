// Phase 4 of ask pages: a live page, replies, history, what changed since
// the last ask, step-by-step pages, and saying a page is waiting.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

import { answersMarkdown, askState, checkAnswers } from "../lib/ask/answers.mjs";
import { EXAMPLES, runAsk } from "../lib/ask/index.mjs";
import { addReply, changesSince, everyAsk, historyMarkdown, keepRound, LIVE_LIMITS, readLive, readReplies, rounds, updateLive } from "../lib/ask/live.mjs";
import { buildPage } from "../lib/ask/page.mjs";
import { normalize } from "../lib/ask/spec.mjs";
import { KIT_KINDS } from "../lib/design/annotate.mjs";
import { answersPath, askDir, inbox, serve } from "../lib/view/serve.mjs";

const here = dirname(fileURLToPath(import.meta.url));
process.env.WF_ASK_NO_SERVER = "1";
process.env.WF_STATE_DIR = mkdtempSync(join(tmpdir(), "wf-ask-live-state-"));

const opt = (id) => ({ id, label: id, why: `${id}, as it says.` });
const choice = (id, extra = {}) => ({ id, text: `Pick ${id}?`, type: "one", options: [opt("a"), opt("b")], recommended: "a", why: "It reads best.", ...extra });
const page = (extra = {}) => ({ id: "live-test", title: "Live", questions: [choice("q1"), choice("q2")], ...extra });
/** A project with the page built; `mtime` back-dates its build so a later write is later. */
function built(raw = page()) {
  const root = mkdtempSync(join(tmpdir(), "wf-ask-live-"));
  const view = join(root, ".cache/view");
  const { spec } = buildPage(root, view, raw, KIT_KINDS);
  const past = new Date(Date.now() - 60_000);
  utimesSync(join(askDir(view, spec.id), "spec.json"), past, past);
  return { root, view, spec };
}
const send = (view, spec, answers) => {
  const { answers: checked, problems } = checkAnswers(spec, { id: spec.id, hash: spec.hash, answers }, KIT_KINDS);
  assert.equal(problems, undefined);
  mkdirSync(join(view, "answers"), { recursive: true });
  writeFileSync(answersPath(view, spec.id), JSON.stringify(checked));
  return checked;
};

test("a live update lays over the status before it, checked like a page's blocks", () => {
  let { live, problems } = updateLive(null, { step: "Flow 1", progress: ["1", "8"], log: ["one", "two"] });
  assert.deepEqual(problems, []);
  assert.deepEqual({ state: live.state, step: live.step, progress: live.progress, log: live.log }, { state: "running", step: "Flow 1", progress: [1, 8], log: ["one", "two"] });
  ({ live } = updateLive(live, { state: "done", log: ["three"], blocks: [{ type: "stats", items: [{ label: "Flows", value: "8 of 8" }] }] }));
  assert.deepEqual(live.log, ["one", "two", "three"], "lines are added");
  assert.equal(live.blocks[0].items[0].value, "8 of 8");
  assert.equal(updateLive(live, { clear: true }).live.log.length, 0, "clear starts again");
  const long = updateLive(null, { log: Array.from({ length: LIVE_LIMITS.log + 5 }, (_, i) => `l${i}`) }).live.log;
  assert.equal(long.length, LIVE_LIMITS.log, "the log keeps its last lines");
  assert.equal(long.at(-1), `l${LIVE_LIMITS.log + 4}`);
  const bad = (change) => updateLive(null, change).problems.join(" | ");
  assert.match(bad({ state: "paused" }), /state is running, waiting, done, failed/);
  assert.match(bad({ progress: ["9", "8"] }), /progress is done of a total/);
  assert.match(bad({ step: "x".repeat(201) }), /a step is at most 200/);
  assert.match(bad({ blocks: [{ type: "questions" }] }), /a live update holds no questions/);
  assert.match(bad({ blocks: [{ type: "html" }] }), /type is one of/);
  assert.match(bad({ blocks: Array.from({ length: 21 }, () => ({ type: "text", text: "x" })) }), /at most 20 blocks/);
  assert.deepEqual(updateLive(null, { blocks: [{ type: "chart", labels: ["a"], series: [{ values: [1] }] }] }, { off: new Set(["chart"]) }).live.blocks, [], "a block kind turned off is left out");
});

test("a status page has nothing to answer, and a page is live only when it says so", () => {
  const raw = JSON.parse(readFileSync(join(EXAMPLES, "status.json"), "utf8"));
  const { spec, problems } = normalize(raw);
  assert.deepEqual(problems, []);
  assert.equal(spec.questions.length, 0);
  assert.equal(spec.live, true);
  assert.equal(normalize({ ...raw, off: ["live"] }).spec.live, undefined, "live turns off");
  assert.equal(normalize(page()).spec.live, undefined);
  assert.equal(normalize(page({ live: true })).spec.live, true, "any page can be live");
  assert.match(normalize({ id: "x", title: "x", questions: [] }).problems.join(), /a decision spec lists its questions/, "only a status page may ask nothing");
  const { view, spec: status } = built(raw);
  assert.equal(askState(view, status.id, status).state, "status");
  const items = inbox([{ key: "k", name: "p", view }], askState, readLive);
  assert.equal(items[0].state, "status");
});

test("a reply under a question asks again: the page waits for a send after it", () => {
  const { view, spec } = built();
  send(view, spec, { q1: { choice: "a" }, q2: { choice: "b" } });
  assert.equal(askState(view, spec.id, spec).state, "answered");
  assert.equal(addReply(view, spec, "q1", "  Why a?  "), 1);
  assert.equal(readReplies(view, spec.id).q1[0].text, "Why a?");
  assert.equal(askState(view, spec.id, spec).state, "waiting", "the reply is newer than the answers");
  assert.throws(() => addReply(view, spec, "nope", "x"), /nope is not a question/);
  assert.throws(() => addReply(view, spec, "q1", " "), /a reply says something/);
  assert.throws(() => addReply(view, spec, "q1", "x".repeat(LIVE_LIMITS.reply + 1)), /at most 2000/);
  // The person's reply comes back with the answers, and the agent reads both.
  const back = send(view, spec, { q1: { choice: "a", reply: "Because it is shorter" }, q2: { choice: "b" } });
  const md = answersMarkdown(spec, back, readReplies(view, spec.id));
  assert.match(md, /- You replied: Why a\?\n {2}- Their reply: Because it is shorter/);
  assert.match(checkAnswers(spec, { id: spec.id, hash: spec.hash, answers: { q1: { reply: 3 } } }, KIT_KINDS).problems.join(), /reply is text/);
});

test("the page asked again keeps its replies; a changed page drops them and says what changed", () => {
  const { root, view, spec } = built();
  addReply(view, spec, "q1", "Sure?");
  buildPage(root, view, page(), KIT_KINDS);
  assert.ok(readReplies(view, spec.id).q1, "the same page keeps them");
  const next = page({ questions: [choice("q1", { text: "Pick q1, now?" }), choice("q3")] });
  const { spec: now } = buildPage(root, view, next, KIT_KINDS);
  assert.deepEqual(readReplies(view, spec.id), {}, "a changed page starts without them");
  assert.deepEqual(now.changes.added, ["q3"]);
  assert.deepEqual(now.changes.removed, [{ id: "q2", text: "Pick q2?" }]);
  assert.deepEqual(now.changes.changed, [{ id: "q1", what: ["the question"] }]);
  assert.equal(now.changes.blocks, false);
  assert.ok(Date.parse(now.changes.since) <= Date.now());
  assert.deepEqual(buildPage(root, view, next, KIT_KINDS).spec.changes, now.changes, "asked again as it was, it says the same");
  assert.equal(buildPage(root, view, { ...page({ questions: [choice("q9")] }), off: ["changes"] }, KIT_KINDS).spec.changes, undefined, "changes turn off");
  // What each change is about.
  const a = normalize(page()).spec;
  const what = (q2) => changesSince(a, normalize(page({ questions: [choice("q1"), q2] })).spec, "")?.changed[0]?.what;
  assert.deepEqual(what(choice("q2", { options: [opt("a"), opt("c")] })), ["what it offers"]);
  assert.deepEqual(what(choice("q2", { recommended: "b" })), ["the recommendation"]);
  assert.equal(changesSince(a, a, ""), null);
  assert.equal(changesSince(null, a, ""), null);
});

test("every send keeps a round, with the page it answered, and the history reads them back", () => {
  const { view, spec } = built();
  keepRound(view, spec, send(view, spec, { q1: { choice: "a" } }));
  keepRound(view, spec, send(view, spec, { q1: { choice: "b" }, q2: { choice: "a" } }));
  const all = rounds(view, spec.id);
  assert.equal(all.length, 2);
  assert.equal(all[0].answers.answers.q1.choice, "b", "newest first");
  assert.equal(all[0].spec.title, "Live");
  const md = historyMarkdown(view, spec.id);
  assert.match(md, /round 2 of 2/);
  assert.match(md, /round 1 of 2[\s\S]*\*\*a\*\* a \(recommended\)/);
  assert.deepEqual(everyAsk(view).map((a) => [a.id, a.rounds]), [["live-test", 2]]);
  for (let i = 0; i < LIVE_LIMITS.rounds + 3; i++) keepRound(view, spec, { id: spec.id, hash: spec.hash, answers: {} });
  assert.equal(rounds(view, spec.id).length, LIVE_LIMITS.rounds, "the oldest go");
  const { view: offView, spec: offSpec } = built(page({ off: ["history"] }));
  keepRound(offView, offSpec, { id: offSpec.id, hash: offSpec.hash, answers: {} });
  assert.equal(rounds(offView, offSpec.id).length, 0, "history turns off");
  assert.equal(rounds(view, "../x").length, 0);
});

test("questions blocks place a group's questions, or the ones named, and the rest go to one", () => {
  const q = [choice("a", { group: "One" }), choice("b", { group: "Two" }), choice("c")];
  const place = (sections, extra = {}) => normalize({ id: "p", title: "P", questions: q, sections, ...extra });
  const { spec, problems } = place([{ title: "1", blocks: [{ type: "questions", group: "One" }] }, { title: "2", blocks: [{ type: "questions", ids: ["c"] }] }, { title: "3", blocks: [{ type: "questions" }] }]);
  assert.deepEqual(problems, []);
  assert.deepEqual(spec.sections.map((s) => s.blocks[0].ids), [["a"], ["c"], ["b"]]);
  const left = place([{ title: "1", blocks: [{ type: "questions", group: "One" }] }]).spec;
  assert.deepEqual(left.sections.at(-1).blocks[0].ids, ["b", "c"], "the rest get a section of their own");
  const bad = (sections) => place(sections).problems.join(" | ");
  assert.match(bad([{ blocks: [{ type: "questions", ids: ["a"] }, { type: "questions", group: "One" }] }]), /a is placed by two questions blocks/);
  assert.match(bad([{ blocks: [{ type: "questions", ids: ["zz"] }] }]), /names zz, which is not a question/);
  assert.match(bad([{ blocks: [{ type: "questions", group: "None" }] }]), /the group None, which no question is in/);
  assert.match(bad([{ blocks: [{ type: "questions" }, { type: "questions" }] }]), /one questions block at most places every question left/);
  // A step-by-step page is sections, in a list layout.
  assert.equal(place([{ title: "1", blocks: [{ type: "questions" }] }], { steps: true }).spec.steps, true);
  assert.match(normalize({ ...page(), steps: true }).problems.join(), /gives its steps as sections/);
  const review = JSON.parse(readFileSync(join(EXAMPLES, "frame-review.json"), "utf8"));
  assert.match(normalize({ ...review, steps: true, blocks: [{ type: "questions" }] }).problems.join(), /one frame at a time already; steps need a list layout/);
  const steps = normalize(JSON.parse(readFileSync(join(EXAMPLES, "../blocks/steps.json"), "utf8")));
  assert.deepEqual(steps.problems, []);
  assert.deepEqual(steps.spec.sections.map((s) => s.blocks.find((b) => b.type === "questions").ids), [["layout"], ["sync-words"], ["order"]]);
});

test("the server serves a page's status, replies, and rounds, and keeps each send", async () => {
  const { view, spec } = built(page({ live: true }));
  const key = "live-test-123456";
  const kept = [];
  const find = (k) => (k === key ? { key, view, kinds: KIT_KINDS } : null);
  const { port, pageToken, close } = await serve({ resolve: find, list: () => [{ key, view, name: "demo" }], check: checkAnswers, stateOf: askState, liveOf: readLive, repliesOf: readReplies, historyOf: (v, s) => rounds(v, s.id).map((r) => ({ at: r.at })), onAnswers: (v, s, a) => { kept.push(a); keepRound(v, s, a); }, port: 0, log: () => {} });
  try {
    const base = `http://127.0.0.1:${port}`;
    const live = () => fetch(`${base}/__ask/${key}/live/${spec.id}`).then((r) => r.json());
    assert.deepEqual(await live(), { live: null, replies: {} });
    const { live: status } = updateLive(null, { step: "Going" });
    writeFileSync(join(askDir(view, spec.id), "live.json"), JSON.stringify(status));
    addReply(view, spec, "q1", "Hm?");
    const got = await live();
    assert.equal(got.live.step, "Going");
    assert.equal(got.replies.q1[0].text, "Hm?");
    assert.equal((await fetch(`${base}/__ask/${key}/live/nope`)).status, 404);
    const items = (await (await fetch(`${base}/__hub/inbox`)).json()).items;
    assert.equal(items[0].live.step, "Going", "the inbox says where a live page stands");
    const res = await fetch(`${base}/__ask/${key}/answers/${spec.id}`, { method: "POST", headers: { "Content-Type": "application/json", "X-WF-Token": pageToken(key, spec.id) }, body: JSON.stringify({ id: spec.id, hash: spec.hash, answers: { q1: { choice: "a" } } }) });
    assert.equal(res.status, 200);
    assert.equal(kept.length, 1);
    assert.equal((await (await fetch(`${base}/__ask/${key}/history/${spec.id}`)).json()).rounds.length, 1);
  } finally {
    await close();
  }
});

test("wf ask live, reply, and history, in a project", async () => {
  const root = mkdtempSync(join(tmpdir(), "wf-ask-live-cli-"));
  mkdirSync(join(root, ".workflow"));
  writeFileSync(join(root, ".workflow/config.json"), "{}");
  writeFileSync(join(root, "package.json"), "{}");
  spawnSync("git", ["init", "-q"], { cwd: root });
  const cwd = process.cwd();
  process.chdir(root);
  try {
    const out = [];
    const log = (line) => out.push(line);
    writeFileSync(join(root, "plain.json"), JSON.stringify(page()));
    assert.equal(await runAsk(["page", "plain.json"], log), 0);
    await assert.rejects(runAsk(["live", "live-test", "--step", "x"], log), /is not live/);
    assert.equal(await runAsk(["page", join(EXAMPLES, "status.json")], log), 0);
    writeFileSync(join(root, "blocks.json"), JSON.stringify([{ type: "text", text: "Half way." }]));
    assert.equal(await runAsk(["live", "e2e-run-status", "--step", "Flow 3", "--progress", "3/12", "--log", "one", "--log", "two", "--blocks", "blocks.json"], log), 0);
    assert.match(out.at(-1), /e2e-run-status: running, Flow 3 \(3 of 12\)/);
    const live = readLive(join(root, ".cache/view"), "e2e-run-status");
    assert.deepEqual([live.log, live.blocks[0].type], [["one", "two"], "text"]);
    assert.equal(await runAsk(["live", "e2e-run-status", "--state", "nope"], log), 1);
    assert.equal(await runAsk(["wait", "e2e-run-status"], log), 0, "a status page has nothing to wait for");
    assert.match(out.at(-1), /is a status page/);
    assert.equal(await runAsk(["reply", "live-test", "q1", "Why", "a?"], log), 0);
    assert.match(out.at(-1), /replied under q1 \(1 reply\)/);
    assert.equal(await runAsk(["history"], log), 0);
    assert.match(out.at(-1), /No answers kept yet/);
    const spec = JSON.parse(readFileSync(join(root, ".cache/view/ask/live-test/spec.json"), "utf8"));
    writeFileSync(join(root, "back.json"), JSON.stringify({ id: spec.id, hash: spec.hash, answers: { q1: { choice: "a", reply: "Shorter" } } }));
    assert.equal(await runAsk(["import", "back.json"], log), 0);
    assert.match(out.at(-1), /Their reply: Shorter/);
    assert.equal(await runAsk(["history"], log), 0);
    assert.match(out.at(-1), /live-test\s+1 round/);
    assert.equal(await runAsk(["export", "live-test"], log), 0);
    assert.ok(existsSync(join(root, ".cache/view/ask/live-test/export/live-test.history.md")));
  } finally {
    process.chdir(cwd);
  }
});

test("a new waiting ask is told once, across tabs, and the ones waiting when it was turned on are not news", async () => {
  const told = [];
  const stored = new Map();
  const sandbox = {
    window: {},
    document: { hidden: true },
    localStorage: { getItem: (k) => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, v), removeItem: (k) => stored.delete(k) },
    location: { assign() {} },
  };
  sandbox.Notification = class { constructor(title, opts) { told.push([title, opts.tag]); } static permission = "granted"; static async requestPermission() { return "granted"; } };
  runInNewContext(readFileSync(join(here, "../lib/ask/browser/shared.js"), "utf8"), sandbox);
  const { notifier } = sandbox.window.wfAskShared;
  assert.equal(notifier.on(), false, "off until the person turns it on");
  assert.equal(await notifier.enable(), "granted");
  const ask = (id, state = "waiting") => ({ href: `/k/ask/${id}/`, asked: "2026-11-14T00:00:00Z", state, title: id, project: "p" });
  notifier.check([ask("old")]);
  assert.deepEqual(told, [], "what waits already is not news");
  notifier.check([ask("old"), ask("new"), ask("done", "answered"), ask("mine")], "/k/ask/mine/");
  assert.deepEqual(told, [["p: new", "/k/ask/new/|2026-11-14T00:00:00Z"]], "only the new one, never the page's own");
  notifier.check([ask("old"), ask("new")]);
  assert.equal(told.length, 1, "told once");
  notifier.tell("Done", "", "t");
  assert.equal(told.length, 2);
  sandbox.document.hidden = false;
  notifier.tell("Done", "", "t2");
  assert.equal(told.length, 2, "a page the person is looking at tells nothing");
  notifier.disable();
  notifier.check([ask("newer")]);
  assert.equal(told.length, 2);
});
