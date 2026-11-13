// Advice on how an ask page groups its questions: printed by wf ask page,
// never a reason to refuse the page.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { EXAMPLES, runAsk } from "../lib/ask/index.mjs";
import { GROUPING, normalize } from "../lib/ask/spec.mjs";

process.env.WF_ASK_NO_SERVER = "1";
process.env.WF_STATE_DIR = mkdtempSync(join(tmpdir(), "wf-ask-group-state-"));

const opt = (id) => ({ id, label: id, why: `${id}, as it says.` });
/** A question with options `ids`, recommending the first. */
const q = (id, ids = ["a", "b"], extra = {}) => ({ id, text: `Pick ${id}?`, type: "one", options: ids.map(opt), recommended: ids[0], why: "It reads best.", ...extra });
const advice = (raw) => {
  const { problems, advice: out } = normalize({ id: "g", title: "G", ...raw });
  assert.deepEqual(problems, [], "advice never comes with a problem");
  return out.join(" | ");
};

test("a long page with no groups is advised to group its questions", () => {
  const many = Array.from({ length: GROUPING.ungrouped + 1 }, (_, i) => q(`q${i}`, [`x${i}`, `y${i}`]));
  assert.match(advice({ questions: many }), /9 questions and no groups: give each question a group/);
  assert.equal(advice({ questions: many.map((x, i) => ({ ...x, group: i < 4 ? "Layout" : "Words" })) }), "", "grouped, it is fine");
  assert.equal(advice({ questions: many.slice(0, GROUPING.ungrouped) }), "", "eight is fine");
});

test("questions that share their options are advised to be one grid, but not a template's own verdicts", () => {
  assert.match(advice({ questions: [q("a1"), q("a2"), q("a3"), q("b1", ["c", "d"])] }), /a1, a2, a3 share the same options: one grid question/);
  assert.equal(advice({ questions: [q("a1"), q("a2"), q("b1", ["c", "d"])] }), "", "two is fine");
  assert.equal(advice({ questions: [q("a1"), q("a2"), q("a3", ["a", "b"], { showIf: { question: "a1", is: "a" } })] }), "", "a follow-up is not counted");
  for (const name of ["plan", "signoff"]) assert.equal(normalize(JSON.parse(readFileSync(join(EXAMPLES, `${name}.json`), "utf8"))).advice.length, 0, `${name} gives each item its verdicts on purpose`);
});

test("a page asking more than a few minutes of answers is advised to go step by step", () => {
  const form = { id: "f", text: "The release", type: "form", fields: Array.from({ length: 12 }, (_, i) => ({ id: `f${i}` })) };
  const page = { questions: [form, q("a", ["x", "y"]), q("b", ["z", "w"]), q("c", ["u", "v"]), q("d", ["s", "t"])] };
  assert.match(advice(page), /about 16 answers on one page: split it into steps/);
  const steps = { ...page, steps: true, sections: [{ title: "One", blocks: [{ type: "questions" }] }] };
  assert.doesNotMatch(advice(steps), /answers on one page/, "a step-by-step page is already split");
});

test("paged and table templates ask item by item on purpose, and every kit example builds without advice", () => {
  for (const f of readdirSync(EXAMPLES)) assert.deepEqual(normalize(JSON.parse(readFileSync(join(EXAMPLES, f), "utf8"))).advice, [], f);
  const frames = Array.from({ length: 12 }, (_, i) => ({ image: `f${i}.png`, name: `Frame ${i}` }));
  assert.deepEqual(normalize({ id: "r", title: "R", template: "frame-review", frames }).advice, []);
});

test("wf ask page builds the page and prints the advice", async () => {
  const root = mkdtempSync(join(tmpdir(), "wf-ask-group-"));
  mkdirSync(join(root, ".workflow"));
  writeFileSync(join(root, ".workflow/config.json"), "{}");
  writeFileSync(join(root, "package.json"), "{}");
  spawnSync("git", ["init", "-q"], { cwd: root });
  writeFileSync(join(root, "g.json"), JSON.stringify({ id: "grouping", title: "G", questions: [q("a1"), q("a2"), q("a3")] }));
  const cwd = process.cwd();
  process.chdir(root);
  try {
    const out = [];
    assert.equal(await runAsk(["page", "g.json"], (line) => out.push(line)), 0, "advice is no failure");
    assert.ok(out.includes("Grouping: a1, a2, a3 share the same options: one grid question, with a row for each, asks them together."));
  } finally {
    process.chdir(cwd);
  }
});

test("picture advice: a joined sheet, a box the pictures do not have, and a frame against the app with no compare", async () => {
  const { pictureAdvice } = await import("../lib/ask/spec.mjs");
  const pic = (w, h, boxes = []) => ({ image: "a.png", label: "A", w, h, boxes });
  const page = (q) => ({ questions: [{ id: "q", text: "Fine?", look: "", detail: "", pictures: [], compare: null, ...q }] });
  assert.match(pictureAdvice(page({ pictures: [pic(5136, 1684)] })).join(), /q: picture A is 5136×1684, likely several frames joined in one sheet; give each its own picture with npx wf design annotate --ask/);
  assert.match(pictureAdvice(page({ look: "Sheet A, box 2", pictures: [pic(1280, 800)] })).join(), /q: names a box, but its pictures have none the page can draw/);
  assert.equal(pictureAdvice(page({ look: "Sheet A, box 2", pictures: [pic(1280, 800, [{ n: 2 }])] })).length, 0, "a box the page draws is fine");
  assert.match(pictureAdvice(page({ text: "Does the app match the frame?", pictures: [pic(1280, 800)] })).join(), /compares a frame with the app in one picture; a compare pair, \[frame, app\]/);
  assert.match(pictureAdvice(page({ text: "Box 3: change the frame or the app?" })).join(), /q: names a box, but shows no picture[\s\S]*is about a frame and the app, and shows neither/);
  assert.equal(pictureAdvice(page({ text: "Does the app match the frame?", compare: [pic(1280, 800), pic(1280, 800)] })).length, 0);
  assert.equal(pictureAdvice(page({ pictures: [pic(1280, 800)] })).length, 0, "one screen is fine");
});

test("template advice: a decision page doing another template's job is pointed at that template", async () => {
  const { templateAdvice } = await import("../lib/ask/spec.mjs");
  const tq = (id, extra = {}) => ({ id, text: `Pick ${id}?`, options: [], pictures: [], compare: null, role: "", ...extra });
  const page = (questions, template = "decision") => templateAdvice({ template, questions });
  assert.match(page([tq("a", { role: "designer" }), tq("b", { role: "owner" }), tq("c", { role: "owner" })]).join(), /3 questions for 2 roles \(designer, owner\): a batch page/);
  assert.match(page([tq("a", { text: "Q-012: still open?" }), tq("b", { text: "Q-013: x" }), tq("c", { text: "Q-020: y" })]).join(), /Q-012, Q-013, Q-020 are open questions: a triage page/);
  const finding = (id) => tq(id, { options: [{ id: "accept-now" }, { id: "defer" }, { id: "reject" }] });
  assert.match(page([finding("f1"), finding("f2"), finding("f3")]).join(), /3 questions accept or reject an item each: a triage page with those options as its verdicts/);
  const judged = (id, compare) => tq(id, { pictures: compare ? [] : [{ image: "a.png" }], compare: compare ? [{}, {}] : null, options: [{ id: "ok", kind: "ok" }, { id: "bug", kind: "bug" }] });
  assert.match(page([judged("a"), judged("b"), judged("c")]).join(), /3 pictures each given a verdict: a frame-review page/);
  assert.match(page([judged("a", true), judged("b", true), judged("c", true)]).join(), /a compare page/);
  const rules = tq("cat-time", { text: "Accept the Time rules (R-20, R-21, R-37)?" });
  assert.match(page([rules], "batch").join(), /cat-time judges several rules in one question: a testdata page gives each rule its row/);
  assert.deepEqual(page([tq("a", { role: "designer" }), tq("b", { role: "owner" }), tq("c", { role: "owner" })], "batch"), [], "a batch page is grouped by role already");
  assert.deepEqual(page([tq("a"), tq("b")]), []);
});
