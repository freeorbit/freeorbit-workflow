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
