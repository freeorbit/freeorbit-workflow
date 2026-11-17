import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext, Script } from "node:vm";

import { answered, answersMarkdown, askState, checkAnswers, localTime, recordAnswers } from "../lib/ask/answers.mjs";
import { answersFromText, EXAMPLE_PICTURES, EXAMPLES, projectTemplates, runAsk } from "../lib/ask/index.mjs";
import { BLOCK_FIELDS, fieldsOf, TYPE_FIELDS } from "../lib/ask/fields.mjs";
import { placeholderPng } from "../lib/ask/placeholder.mjs";
import { BLOCK_KINDS } from "../lib/ask/blocks.mjs";
import { buildPage, checkPage, exportHtml, imageSize, pageScript, pictureFile } from "../lib/ask/page.mjs";
import { answersPath } from "../lib/ask/store.mjs";
import { QUESTION_FIELDS } from "../lib/ask/fieldnames.mjs";
import { TYPES } from "../lib/ask/questions.mjs";
import { normalize } from "../lib/ask/spec.mjs";
import { checkTemplate, TEMPLATES } from "../lib/ask/templates.mjs";
import { merge } from "../lib/config/config.mjs";
import { DEFAULTS } from "../lib/config/defaults.mjs";
import { KIT_KINDS } from "../lib/design/annotate.mjs";
import { projectKey } from "../lib/view/view.mjs";
import { emptyFile } from "../lib/logs/decisions.mjs";

const here = dirname(fileURLToPath(import.meta.url));
// No shared server is started, and the registry is a throwaway one.
process.env.WF_ASK_NO_SERVER = "1";
process.env.WF_STATE_DIR = mkdtempSync(join(tmpdir(), "wf-ask-state-"));
// A one-pixel PNG, and another, so a page has real pictures to copy.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const PNG2 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const example = (name) => JSON.parse(readFileSync(join(EXAMPLES, `${name}.json`), "utf8"));

/** A project with every picture an example names, so its page builds. */
function project(...specs) {
  const root = mkdtempSync(join(tmpdir(), "wf-ask-"));
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      if (typeof v.image === "string" && !existsSync(join(root, v.image))) {
        mkdirSync(dirname(join(root, v.image)), { recursive: true });
        writeFileSync(join(root, v.image), PNG);
      }
      Object.values(v).forEach(walk);
    }
  };
  specs.forEach(walk);
  return { root, view: join(root, ".cache/view") };
}

test("every template has an example, and every example is a whole spec", () => {
  assert.deepEqual(readdirSync(EXAMPLES).map((f) => f.replace(/\.json$/, "")).sort(), Object.keys(TEMPLATES).sort());
  for (const name of Object.keys(TEMPLATES)) {
    const raw = example(name);
    assert.equal(raw.template, name);
    const { spec, problems } = normalize(raw);
    assert.deepEqual(problems, [], name);
    assert.ok(spec.questions.length > 0 || TEMPLATES[name].optional, name);
    assert.equal(spec.layout, TEMPLATES[name].layout);
  }
});

test("a spec names what is wrong with it", () => {
  const bad = (raw) => normalize(raw).problems.join("\n");
  assert.match(bad({ id: "Bad Id", title: "t", questions: [{ id: "a", text: "x" }] }), /lowercase letters/);
  assert.match(bad({ id: "a", title: "t", template: "nope" }), /template is one of/);
  assert.match(bad({ id: "a", title: "t", questions: [{ id: "q", text: "x", options: ["a", "b"], recommended: "c" }] }), /recommended names its options/);
  assert.match(bad({ id: "a", title: "t", questions: [{ id: "q", text: "x", type: "one", options: ["a"] }] }), /at least two options/);
  assert.match(bad({ id: "a", title: "t", questions: [{ id: "q", text: "x" }, { id: "q", text: "y" }] }), /question ids repeat: q/);
  assert.match(bad({ id: "a", title: "t", template: "batch", questions: [{ id: "q", text: "x" }] }), /names the role/);
  assert.match(bad({ id: "a", title: "t", template: "compare", pairs: [{ left: { image: "a.png" } }] }), /compare is two pictures/);
  assert.match(bad({ id: "a", title: "t", questions: [{ id: "q", text: "x", record: "app" }] }), /only a one or many question records/);
});

test("a choice recommends one and says why, or says why it cannot", () => {
  const problems = (raw) => normalize({ id: "a", title: "t", ...raw }).problems;
  const q = (more) => ({ questions: [{ id: "q", text: "x", options: [{ id: "a", why: "what a means" }, { id: "b", why: "what b means" }], ...more }] });
  assert.match(problems({ questions: [{ id: "q", text: "x", options: ["a", { id: "b", why: "w" }], recommended: "b", why: "w" }] }).join(), /q: every option says what it means, in why; a does not/);
  assert.match(problems(q({})).join(), /q: a recommendation: name the option in recommended, or say in noPick/);
  assert.match(problems(q({ recommended: "a" })).join(), /q: a recommendation says why/);
  assert.deepEqual(problems(q({ recommended: "a", why: "because" })), []);
  assert.deepEqual(problems(q({ noPick: "a product call with no data yet" })), []);
  assert.match(problems(q({ noPick: "none", recommended: "a" })).join(), /noPick says there is no recommendation/);
  assert.deepEqual(problems({ questions: [{ id: "q", text: "x" }] }), [], "a text question asks for a fact");
  assert.match(problems({ template: "rank", items: ["a", "b"] }).join(), /a suggested order says why/);
  assert.match(problems({ template: "triage", items: [{ id: "Q-001", text: "x" }] }).join(), /Q-001: a recommendation/);
  assert.deepEqual(problems({ template: "frame-review", frames: [{ image: "a.png" }] }), [], "a review's verdicts are the person's own");
});

test("templates expand into plain questions", () => {
  const { spec: plan } = normalize(example("plan"));
  assert.deepEqual(plan.questions.map((q) => q.id), ["step-1", "step-2", "step-3", "plan"]);
  const { spec: rows } = normalize(example("testdata"));
  assert.deepEqual(rows.questions.map((q) => `${q.id} ${q.table} ${q.cells.length}`), ["R-ACC.R-ACC-01 Account names 3", "R-ACC.R-ACC-02 Account names 3"]);
  const { spec: rank } = normalize(example("rank"));
  assert.equal(rank.questions[0].type, "rank");
  const { spec: pairs } = normalize(example("compare"));
  assert.equal(pairs.questions[0].compare.length, 2);
  assert.equal(pairs.questions[0].pins, true);
});

test("the steps say which options sit in one row, and which three or more questions share", () => {
  const S = answerSteps();
  // A plan's verdicts describe nothing, so each question's options are one row.
  const { spec: plan } = normalize(example("plan"));
  assert.equal(S.sharedOptions(plan.questions), null, "the plan's last question has its own options");
  assert.ok(plan.questions.every((q) => S.optionsInRow(q, null)));
  // A decision's options each say what they mean, so they stay stacked.
  const { spec: decision } = normalize(example("decision"));
  assert.equal(S.optionsInRow(decision.questions[0], null), false);
  // Three or more questions with the same described options: described once, then one row each.
  const raw = example("triage");
  assert.equal(S.sharedOptions(normalize(raw).spec.questions), null, "two questions describe their own");
  raw.items.push({ ...raw.items[1], id: "Q-040" });
  const { spec: triage } = normalize(raw);
  const shared = S.sharedOptions(triage.questions);
  assert.deepEqual(shared.map((o) => o.id), ["answer", "defer", "drop"]);
  assert.equal(S.optionsInRow(triage.questions[0], shared), true);
  // "Something else" brings its own description, so the options stay stacked.
  assert.equal(S.optionsInRow({ ...plan.questions[0], other: true }, null), false);
});

test("a field the kit does not know stops the build, with the nearest name", () => {
  const raw = example("decision");
  raw.intro2 = "x";
  raw.questions[0].typ = "one";
  raw.questions[0].options[0].preveiw = "x";
  raw.questions[0].pictures[0].caption = "x";
  const { problems } = normalize(raw);
  assert.deepEqual(problems.filter((p) => p.includes("no field")), [
    "the spec: no field intro2; did you mean intro?",
    "questions 1 (layout): no field typ; did you mean type?",
    "questions 1 (layout) option 1: no field preveiw; did you mean preview?",
    "questions 1 (layout) picture 1: no field caption",
  ]);
  const triage = example("triage");
  triage.items[0].contxt = "x";
  assert.match(normalize(triage).problems.join("\n"), /items 1 \(Q-031\): no field contxt; did you mean context\?/);
  const rows = example("testdata");
  rows.tables[0].rows[0].recomended = "ok";
  assert.match(normalize(rows).problems.join("\n"), /tables 1 \(R-ACC\) row 1: no field recomended; did you mean recommended\?/);
  // Every example, block example, and answer example carries only fields the kit knows.
  for (const dir of ["examples", "blocks", "answers"]) {
    for (const file of readdirSync(join(EXAMPLES, "..", dir)).filter((f) => f.endsWith(".json"))) {
      const each = JSON.parse(readFileSync(join(EXAMPLES, "..", dir, file), "utf8"));
      if (!each.title) continue;
      assert.deepEqual((normalize(each, {}, { parts: { "release-checks": [] } }).problems ?? []).filter((p) => p.includes("no field")), [], file);
    }
  }
});

test("the agent's answers are brief: a count, then only the answers that are not plain agreements", () => {
  const raw = example("testdata");
  raw.tables[0].rows = Array.from({ length: 12 }, (_, i) => ({ id: `R-${i + 1}`, cells: [`Rule ${i + 1}`, "limit", "none"], recommended: "ok" }));
  const { spec } = normalize(raw);
  const answers = Object.fromEntries(spec.questions.map((q) => [q.id, { choice: "ok" }]));
  answers["R-ACC.R-3"] = { choice: "wrong" };
  answers["R-ACC.R-5"] = { choice: "ok", note: "but see the fixture" };
  delete answers["R-ACC.R-7"];
  const record = { id: spec.id, hash: spec.hash, submitted: "2026-11-15T10:03:00.000Z", answers };
  const brief = answersMarkdown(spec, record, {}, { brief: true });
  assert.match(brief, /11 of 12 answered: 9 as recommended with nothing added, 2 other, 1 open\./);
  assert.match(brief, /Only the 3 that are not as recommended are listed; npx wf ask answers accounts-rules --all lists every one\./);
  assert.deepEqual(brief.split("\n").filter((l) => l.startsWith("- ")).map((l) => l.match(/R-\d+/)[0]), ["R-3", "R-5", "R-7"]);
  assert.match(brief, /but see the fixture/);
  // In full, and for a page with few agreements, every answer is listed.
  assert.equal(answersMarkdown(spec, record).split("\n").filter((l) => l.startsWith("- ")).length, 12);
  const { spec: small } = normalize(example("batch"));
  const few = answersMarkdown(small, { id: small.id, hash: small.hash, submitted: "2026-11-15T10:03:00.000Z", answers: Object.fromEntries(small.questions.map((q) => [q.id, { choice: q.type === "many" ? [].concat(q.recommended) : q.recommended }])) }, {}, { brief: true });
  assert.equal(few.split("\n").filter((l) => l.startsWith("- ")).length, small.questions.length);
  assert.match(few, /3 of 3 answered: 3 as recommended with nothing added, 0 other, 0 open\./);
});

test("the agent reads the time the person's clock showed", () => {
  const raw = example("testdata");
  const { root, view } = project(raw);
  const { spec } = buildPage(root, view, raw, KIT_KINDS);
  const sent = "2026-11-14T23:02:41.017Z";
  const d = new Date(sent);
  const two = (n) => String(n).padStart(2, "0");
  assert.equal(localTime(sent), `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}:${two(d.getMinutes())}`);
  assert.match(answersMarkdown(spec, { id: spec.id, hash: spec.hash, submitted: sent, answers: {} }), new RegExp(`answered ${localTime(sent)}`));
  assert.equal(localTime("not a time"), "not a time");
});

test("the steps say what a plain agreement is, and which rows each filter shows", () => {
  const S = answerSteps();
  const raw = example("testdata");
  raw.tables[0].rows = Array.from({ length: 12 }, (_, i) => ({ id: `R-${i + 1}`, cells: [`Rule ${i + 1}`, "limit", "none"], recommended: "ok" }));
  const { spec } = normalize(raw);
  const [a, b, c, d] = spec.questions;
  const answers = { [a.id]: { choice: "ok" }, [b.id]: { choice: "wrong" }, [c.id]: { choice: "ok", note: "see the fixture" } };
  // A plain agreement is the recommendation with nothing added; the agent's Markdown and the receipt read this one rule.
  assert.deepEqual([a, b, c, d].map((q) => S.asRecommended(q, answers[q.id])), [true, false, false, false]);
  assert.deepEqual([a, b, c, d].map((q) => S.rowShows("open", q, answers[q.id])), [false, false, false, true]);
  assert.deepEqual([a, b, c, d].map((q) => S.rowShows("other", q, answers[q.id])), [false, true, true, true]);
  assert.deepEqual([a, b, c, d].map((q) => S.rowShows("all", q, answers[q.id])), [true, true, true, true]);
});

test("the agent's side: every example builds as printed, fields lists a part, and --check builds nothing", async () => {
  // A stand-in picture is a real PNG of the size its name asks for.
  assert.deepEqual(imageSize(placeholderPng("accounts-wide.png")), [960, 600]);
  assert.deepEqual(imageSize(placeholderPng("accounts-narrow.png", 1)), [390, 700]);
  const root = mkdtempSync(join(tmpdir(), "wf-ask-agent-"));
  spawnSync("git", ["init", "-q", root]);
  mkdirSync(join(root, ".workflow"), { recursive: true });
  writeFileSync(join(root, ".workflow/config.json"), "{}");
  const cwd = process.cwd();
  const before = { no: process.env.WF_ASK_NO_SERVER, state: process.env.WF_STATE_DIR };
  process.chdir(root);
  process.env.WF_ASK_NO_SERVER = "1";
  process.env.WF_STATE_DIR = join(root, ".state");
  try {
    for (const name of Object.keys(TEMPLATES)) {
      const out = [];
      assert.equal(await runAsk(["example", name], (line) => out.push(line)), 0);
      const raw = JSON.parse(out.join("\n"));
      // Printed in a project, the example names pictures the kit wrote, so it checks and builds as it is.
      const { spec } = checkPage(root, raw);
      assert.equal(spec.template, name);
      for (const image of out.join("\n").matchAll(/"image":\s*"([^"]+)"/g)) assert.ok(image[1].startsWith(`${EXAMPLE_PICTURES}/`) && existsSync(join(root, image[1])), image[1]);
    }
    // --check says the spec is right and writes no page; with a field it does not know, it fails like a build.
    const spec = join(root, "plan.json");
    writeFileSync(spec, JSON.stringify(example("plan")));
    const said = [];
    assert.equal(await runAsk(["page", spec, "--check"], (line) => said.push(line)), 0);
    assert.match(said.join("\n"), /chunk-14-plan: the spec is right, 4 questions \(plan\)\. Nothing was built\./);
    assert.equal(existsSync(join(root, ".cache/view/ask/chunk-14-plan")), false);
    writeFileSync(spec, JSON.stringify({ ...example("plan"), stepz: [] }));
    await assert.rejects(() => runAsk(["page", spec, "--check"], () => {}), /no field stepz; did you mean steps\?/);
  } finally {
    process.chdir(cwd);
    for (const [key, value] of [["WF_ASK_NO_SERVER", before.no], ["WF_STATE_DIR", before.state]]) { if (value == null) delete process.env[key]; else process.env[key] = value; }
    rmSync(root, { recursive: true, force: true });
  }
  // fields knows every template, question type, and block, and names only fields the check takes.
  for (const part of [...Object.keys(TEMPLATES), ...TYPES, ...BLOCK_KINDS]) assert.ok(fieldsOf(part)?.length, part);
  assert.equal(fieldsOf("nope"), null);
  assert.deepEqual(Object.keys(TYPE_FIELDS).sort(), [...TYPES].sort());
  assert.deepEqual(Object.keys(BLOCK_FIELDS).sort(), [...BLOCK_KINDS].sort());
  for (const t of Object.values(TYPE_FIELDS)) for (const f of t.fields) assert.ok(QUESTION_FIELDS.includes(f), f);
  assert.match(fieldsOf("triage").join("\n"), /Each of items: id, text, context, needs, role, chunk, recommended, why, noPick/);
  // Every block in the kit's examples carries only the fields its line lists.
  for (const dir of ["examples", "blocks", "answers"]) {
    for (const file of readdirSync(join(EXAMPLES, "..", dir)).filter((f) => f.endsWith(".json"))) {
      const data = JSON.parse(readFileSync(join(EXAMPLES, "..", dir, file), "utf8"));
      const blocks = Array.isArray(data) ? data : [...(data.blocks ?? []), ...(data.sections ?? []).flatMap((sec) => sec.blocks ?? [])];
      for (const block of blocks) for (const key of Object.keys(block)) assert.ok(["type", "title", "note", ...(BLOCK_FIELDS[block.type] ?? [])].includes(key), `${file}: ${block.type}.${key}`);
    }
  }
});

test("a page copies its pictures, hashes them, and keeps answers to the same page", () => {
  const raw = example("frame-review");
  const { root, view } = project(raw);
  const { page, spec } = buildPage(root, view, raw, KIT_KINDS);
  const html = readFileSync(page, "utf8");
  assert.match(html, /<meta name="wf-token" content="__WF_ASK_TOKEN__">/);
  assert.doesNotMatch(html.split('id="ask-data">')[1].split("</script>")[0], /</, "the data has no raw <");
  assert.ok(existsSync(join(dirname(page), "p/1.png")));
  assert.equal(spec.questions[0].pictures[0].src, "p/1.png");
  // The same spec with a new picture is a new page.
  writeFileSync(join(root, raw.frames[0].image), PNG2);
  const again = buildPage(root, view, raw, KIT_KINDS);
  assert.notEqual(again.spec.hash, spec.hash);
  mkdirSync(dirname(answersPath(view, raw.id)), { recursive: true });
  writeFileSync(answersPath(view, raw.id), JSON.stringify({ id: raw.id, hash: again.spec.hash, answers: { "accounts-wide": { choice: "ok" } } }));
  assert.equal(buildPage(root, view, raw, KIT_KINDS).kept, true);
});

test("a picture is a file in the project, reached through no link", () => {
  const { root } = project();
  writeFileSync(join(root, "a.png"), PNG);
  symlinkSync(join(root, "a.png"), join(root, "b.png"));
  assert.ok(pictureFile(root, "a.png"));
  assert.throws(() => pictureFile(root, "../x.png"), /outside the project/);
  assert.throws(() => pictureFile(root, "b.png"), /is a link/);
  assert.throws(() => pictureFile(root, "a.txt"), /not a picture/);
  assert.throws(() => pictureFile(root, "c.png"), /does not exist/);
});

test("answers keep to what the page asks", () => {
  const { spec } = normalize(example("decision"));
  const good = checkAnswers(spec, { id: spec.id, hash: spec.hash, answers: { layout: { choice: "list", note: "longer is fine", junk: 1 } } }, KIT_KINDS);
  assert.deepEqual(good.answers.answers, { layout: { choice: "list", note: "longer is fine" } });
  assert.equal(good.answers.partial, true);
  assert.deepEqual(good.answers.open, ["empty"]);
  const fail = (answers, hash = spec.hash) => checkAnswers(spec, { id: spec.id, hash, answers }, KIT_KINDS).problems?.join("\n") ?? "";
  assert.match(fail({ layout: { choice: "grid" } }), /not one of its options/);
  assert.match(fail({ nope: { choice: "a" } }), /not a question on this page/);
  assert.match(fail({ layout: { choice: "tabs" } }, "000000000000"), /an older page/);
  assert.match(fail({ layout: { pins: [] } }), /takes no pins/);
  assert.match(fail({ layout: { note: "x".repeat(5001) } }), /at most 5000/);
  const { spec: pairs } = normalize(example("compare"));
  const pin = (p) => checkAnswers(pairs, { id: pairs.id, hash: pairs.hash, answers: { "accounts-wide": { pins: [p] } } }, KIT_KINDS);
  assert.deepEqual(pin({ picture: 1, x: 10.4, y: 20, kind: "bug", text: "clipped", box: 1 }).answers.answers["accounts-wide"].pins, [{ picture: 1, x: 10, y: 20, kind: "bug", text: "clipped", box: 1 }]);
  assert.match(pin({ picture: 2, x: 1, y: 1, kind: "bug" }).problems.join(), /a pin has/);
  assert.match(pin({ picture: 0, x: 1, y: 1, kind: "shiny" }).problems.join(), /a pin has/);
  for (const kind of ["constructor", "toString", "__proto__"]) assert.match(pin({ picture: 0, x: 1, y: 1, kind }).problems.join(), /a pin has/, `${kind} is no pin kind`);
  const { spec: rank } = normalize(example("rank"));
  assert.match(checkAnswers(rank, { id: rank.id, hash: rank.hash, answers: { order: { order: ["search"] } } }, KIT_KINDS).problems.join(), /every item once/);
  assert.equal(answered({ decide: "later" }), true);
  assert.equal(answered({ note: "only a note" }), false);
});

test("the answers read as Markdown, and the page's copied text reads back", () => {
  const { spec } = normalize(example("compare"));
  const record = checkAnswers(spec, { id: spec.id, hash: spec.hash, submitted: "2026-11-13T09:30:00Z", answers: { "accounts-wide": { choice: "drift", pins: [{ picture: 1, x: 640, y: 380, kind: "drift", text: "tags clipped", box: 1 }] }, "accounts-narrow": { decide: "agent" } } }, KIT_KINDS).answers;
  const md = answersMarkdown(spec, record);
  assert.ok(md.startsWith(`# Accounts: frame against the app (accounts-drift), answered ${localTime("2026-11-13T09:30:00Z")}\n`));
  assert.match(md, /- \*\*accounts-wide\*\* Accounts, wide: do these match\?: \*\*drift\*\* Drifts from the frame\.\n  - Pin 1 on App at 640, 380 \(drift\), in box 1: tags clipped/);
  assert.match(md, /- \*\*accounts-narrow\*\* .*: you decide\./);
  const { spec: grouped } = normalize(example("batch"));
  const notes = answersMarkdown(grouped, { answers: { retention: { choice: "30", note: "fine" }, icon: { choice: "dot" } } });
  assert.match(notes, /  - Note: fine\n\n## designer\n/, "a heading after a note still has its blank line");
  const copied = `Answers to the ask page x.\n\n\`\`\`json\n${JSON.stringify({ id: "x", answers: {} })}\n\`\`\`\n`;
  assert.deepEqual(answersFromText(copied), { id: "x", answers: {} });
  assert.deepEqual(answersFromText('{"id":"y"}'), { id: "y" });
});

test("record writes later answers as open questions and recorded choices as decisions", () => {
  const root = mkdtempSync(join(tmpdir(), "wf-ask-record-"));
  const config = merge(DEFAULTS, { areas: [{ id: "app", prefix: "APP", docs: "docs/app" }] });
  mkdirSync(join(root, "docs/log/decisions"), { recursive: true });
  writeFileSync(join(root, config.logs.openQuestions), readFileSync(join(here, "fixtures/questions/open.md"), "utf8"));
  writeFileSync(join(root, config.logs.questionsResolved), readFileSync(join(here, "fixtures/questions/resolved.md"), "utf8"));
  writeFileSync(join(root, "docs/log/decisions/app.md"), emptyFile({ id: "app", prefix: "APP", title: "app" }));
  const { spec } = normalize(example("decision"));
  const lines = recordAnswers(root, config, spec, { answers: { layout: { choice: "tabs" }, empty: { decide: "later" } } }, "2026-11-13");
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^layout: /);
  assert.match(readFileSync(join(root, "docs/log/decisions/app.md"), "utf8"), /How should the accounts list be laid out\? Tabs per provider/);
  assert.match(lines[1], /^empty: open question Q-\d{3}$/);
  assert.match(readFileSync(join(root, config.logs.openQuestions), "utf8"), /What does the screen say with no accounts\?/);
});

test("wait returns once answers to the page as it is now are sent, and export makes one offline file", async () => {
  const raw = example("rank");
  const { root, view } = project(raw);
  writeFileSync(join(root, "package.json"), "{}");
  mkdirSync(join(root, ".workflow"));
  writeFileSync(join(root, ".workflow/config.json"), "{}");
  spawnSync("git", ["init", "-q"], { cwd: root });
  const cwd = process.cwd();
  process.chdir(root);
  try {
    const out = [];
    const log = (line) => out.push(line);
    process.env.CLAUDE_CODE_HOST_SESSION_ID = "local_first123";
    assert.equal(await runAsk(["page", join(EXAMPLES, "rank.json")], log), 0);
    assert.match(out.join("\n"), new RegExp(`Open: http://127\\.0\\.0\\.1:8765/${projectKey(root)}/ask/next-chunks/index\\.html`));
    // Another session's page that still waits is not replaced without --replace.
    const mine = process.env.CLAUDE_CODE_HOST_SESSION_ID;
    process.env.CLAUDE_CODE_HOST_SESSION_ID = "local_other123";
    await assert.rejects(runAsk(["page", join(EXAMPLES, "rank.json")], log), /another session \(local_\w+\) is still waiting on the ask page next-chunks/);
    assert.equal(await runAsk(["page", join(EXAMPLES, "rank.json"), "--replace"], log), 0);
    if (mine === undefined) delete process.env.CLAUDE_CODE_HOST_SESSION_ID;
    else process.env.CLAUDE_CODE_HOST_SESSION_ID = mine;
    const spec = JSON.parse(readFileSync(join(view, "ask/next-chunks/spec.json"), "utf8"));
    // While wait runs, the page is marked as waited on, and the mark goes when it ends.
    const waiting = runAsk(["wait", "next-chunks", "--timeout", "0.6"], log);
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(existsSync(join(view, "ask/next-chunks/waiting.json")), true);
    assert.equal(await waiting, 3);
    assert.equal(existsSync(join(view, "ask/next-chunks/waiting.json")), false);
    const file = answersPath(view, "next-chunks");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ id: "next-chunks", hash: spec.hash, submitted: "2026-11-13T10:00:00Z", answers: { order: { order: ["labels", "search", "offline"] } } }));
    const later = (Date.now() + 2000) / 1000;
    utimesSync(file, later, later);
    out.length = 0;
    assert.equal(await runAsk(["wait", "next-chunks", "--timeout", "5"], log), 0);
    assert.match(out.join("\n"), /order: Labels → Search → Offline mode/);
    assert.equal(await runAsk(["export", "next-chunks"], log), 0);
    const html = readFileSync(join(view, "ask/next-chunks/export/next-chunks.html"), "utf8");
    assert.match(html, /"offline":true/);
    assert.match(html, /<meta name="wf-token" content="">/);
    assert.ok(existsSync(join(view, "ask/next-chunks/export/next-chunks.md")));
    writeFileSync(join(root, "back.json"), `Answers\n\`\`\`json\n${JSON.stringify({ id: "next-chunks", hash: spec.hash, answers: { order: { decide: "agent" } } })}\n\`\`\``);
    assert.equal(await runAsk(["import", join(root, "back.json")], log), 1, "a rank question has no decide");
  } finally {
    process.chdir(cwd);
  }
});

test("an exported page carries its pictures inside it", () => {
  const raw = example("frame-review");
  const { root, view } = project(raw);
  const { spec } = buildPage(root, view, raw, KIT_KINDS);
  const html = exportHtml(view, spec, KIT_KINDS, null);
  assert.match(html, /data:image\/png;base64,/);
  assert.doesNotMatch(html, /"src":"p\//);
});

test("an exported launch page carries the pictures in its runs' details", () => {
  const raw = example("launch");
  const { root, view } = project(raw);
  const { spec } = buildPage(root, view, raw, KIT_KINDS);
  const html = exportHtml(view, spec, KIT_KINDS, null);
  assert.match(html, /data:image\/png;base64,/);
  assert.doesNotMatch(html, /"src":"p\//, "no picture is left pointing at the view folder");
});

test("a run's details problems name the run", () => {
  const raw = example("launch");
  raw.runs[1].details = [{ type: "questions" }];
  assert.match(normalize(raw).problems.join("\n"), /runs 2 details block 1: a run's details holds no questions/);
});

test("the details panel shows the run pointed at, else the one picked, else the recommended one", () => {
  const S = answerSteps();
  const rows = [
    // in view, picked, recommended → id, state, picked
    [null, null, "light", { id: "light", state: "recommended", picked: null }],
    [null, "deep", "light", { id: "deep", state: "picked", picked: "deep" }],
    ["full", "deep", "light", { id: "full", state: "looking", picked: "deep" }],
    ["full", null, "light", { id: "full", state: "looking", picked: null }],
    ["deep", "deep", "light", { id: "deep", state: "picked", picked: "deep" }],
    [null, null, undefined, { id: null, state: "recommended", picked: null }],
  ];
  for (const [inView, picked, rec, want] of rows) assert.deepEqual({ ...S.detailsRun(inView, picked, rec) }, want, `${inView}/${picked}/${rec}`);
});

test("the page's script, joined from its parts, parses", () => {
  new Script(pageScript());
});

/** The answer steps, loaded as the page loads them. */
function answerSteps() {
  const sandbox = { window: {} };
  runInNewContext(readFileSync(join(here, "../lib/ask/browser/state.js"), "utf8"), sandbox);
  return sandbox.window.wfAskState;
}

test("a question's own controls, the bulk actions, and the send panel make the same change", () => {
  const S = answerSteps();
  const { spec } = normalize(example("naming"));
  const q = spec.questions[0];
  const v = { choice: "other", other: "Link an account", note: "keep" };
  S.setDecide(v, "agent");
  assert.deepEqual({ ...v }, { note: "keep", decide: "agent" }, "You decide drops the other text, keeps the note");
  S.toggleDecide(v, "agent");
  assert.deepEqual({ ...v }, { note: "keep" });
  assert.equal(S.takeRecommendation(q, v), true);
  assert.deepEqual({ ...v }, { note: "keep", choice: "connect" });
  const { spec: rank } = normalize(example("rank"));
  const r = { decide: "later" };
  assert.equal(S.takeRecommendation(rank.questions[0], r), true);
  assert.deepEqual({ ...r }, { order: ["search", "labels", "offline"] }, "taking a ranking's order clears Later");
  const { spec: text } = normalize({ id: "a", title: "t", questions: [{ id: "q", text: "x" }] });
  assert.equal(S.takeRecommendation(text.questions[0], {}), false);
  assert.equal(S.answered({ note: "only" }), false);
  assert.equal(S.answered({ decide: "later" }), true);
  const A = { a: { choice: "", pins: [] }, b: { note: "n", text: "" } };
  assert.deepEqual(JSON.parse(JSON.stringify(S.prune(A))), { b: { note: "n" } });
});

test("undo keeps twenty steps back, and redo walks forward again", () => {
  const S = answerSteps();
  const h = new S.History(20);
  for (let i = 0; i < 25; i++) h.push({ n: i });
  let now = { n: 25 };
  let steps = 0;
  for (let back; (back = h.undo(now)); steps++) now = back;
  assert.equal(steps, 20);
  assert.deepEqual({ ...now }, { n: 5 });
  assert.deepEqual({ ...h.redo(now) }, { n: 6 });
  h.push(now);
  assert.equal(h.redo(now), null, "a new change drops what redo had");
});

test("a project template is data that expands into questions, checked like the kit's", () => {
  const dir = join(EXAMPLES, "../project-template");
  const raw = JSON.parse(readFileSync(join(dir, "dependency-review.json"), "utf8"));
  const { template, problems } = checkTemplate(raw);
  assert.equal(problems, undefined);
  const spec = JSON.parse(readFileSync(join(dir, "dependency-review.spec.json"), "utf8"));
  const out = normalize(spec, { [template.name]: template });
  assert.deepEqual(out.problems, []);
  assert.deepEqual(out.spec.questions.map((q) => `${q.id} ${q.group} ${q.text} ${q.recommended}`), ["vite Build vite: 5.4 → 6.0 update", "date-fns App date-fns: 3.6 → 4.1 keep", "left-pad App left-pad: 1.3 → 1.3.1 replace"]);
  assert.match(normalize({ ...spec, packages: [{ id: "x", label: "x" }] }, { [template.name]: template }).problems.join(), /x: a recommendation/, "advised holds it to the asking rules");
  assert.match(checkTemplate({ ...raw, name: "decision" }).problems.join(), /a kit template/);
  assert.match(checkTemplate({ ...raw, script: "alert(1)" }).problems.join(), /unknown fields script; a template is data only/);
  assert.match(checkTemplate({ ...raw, layout: "table" }).problems.join(), /lists its columns/);
  assert.match(normalize({ id: "a", title: "t", template: "nope" }).problems.join(), /template is one of decision/);
});

test("a project's templates are read from .workflow/ask-templates, and a bad one is named", () => {
  const root = mkdtempSync(join(tmpdir(), "wf-ask-tpl-"));
  mkdirSync(join(root, ".workflow/ask-templates"), { recursive: true });
  writeFileSync(join(root, ".workflow/ask-templates/deps.json"), readFileSync(join(EXAMPLES, "../project-template/dependency-review.json")));
  writeFileSync(join(root, ".workflow/ask-templates/bad.json"), "{ nope");
  const { templates, problems } = projectTemplates(root);
  assert.deepEqual(Object.keys(templates), ["dependency-review"]);
  assert.match(problems.join(), /bad\.json: not JSON/);
});

test("a picture's size is read from its header, so the page keeps its space", () => {
  assert.deepEqual(imageSize(PNG), [1, 1]);
  const gif = Buffer.from("R0lGODlhAwACAIAAAP///wAAACH5BAEAAAAALAAAAAADAAIAAAICjAsAOw==", "base64");
  assert.deepEqual(imageSize(gif), [3, 2]);
  assert.equal(imageSize(Buffer.from("not a picture")), null);
});

// WCAG contrast of two "H S% L%" triples.
const hslRgb = (t) => { const [h, s, l] = t.replace(/%/g, "").split(/\s+/).map(Number); const a = (s / 100) * Math.min(l / 100, 1 - l / 100); const f = (n) => { const k = (n + h / 30) % 12; return l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); }; return [f(0), f(8), f(4)]; };
const lumOf = (rgb) => { const c = rgb.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const contrast = (a, b) => { const [x, y] = [lumOf(hslRgb(a)), lumOf(hslRgb(b))].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test("every kit theme, light and dark, passes WCAG contrast for text, controls, and states", () => {
  const { themes, default: first } = JSON.parse(readFileSync(join(here, "../lib/ask/browser/themes.json"), "utf8"));
  assert.ok(themes[first], "the default is a theme");
  const failures = [];
  for (const [name, theme] of Object.entries(themes)) for (const mode of ["light", "dark"]) {
    const v = theme[mode];
    const need = [["--text-000", "--bg-100", 7], ["--text-400", "--bg-000", 4.5], ["--text-400", "--bg-100", 4.5], ["--oncolor-100", "--accent-brand", 4.5], ["--accent-brand", "--bg-100", 3], ["--danger-100", "--bg-000", 4.5], ["--warning-100", "--bg-000", 4.5], ["--success-100", "--bg-000", 4.5], ["--accent-000", "--bg-000", 4.5]];
    for (const [fg, bg, min] of need) {
      const r = contrast(v[fg], v[bg]);
      if (r < min) failures.push(`${name} ${mode} ${fg} on ${bg}: ${r.toFixed(2)} < ${min}`);
    }
  }
  assert.deepEqual(failures, []);
});

/** A small asar archive, laid out as Electron's: a pickled JSON header, then the files. */
function asar(files) {
  const tree = { files: {} };
  const bodies = [];
  let offset = 0;
  for (const [path, text] of Object.entries(files)) {
    const buf = Buffer.from(text);
    let node = tree;
    const parts = path.split("/");
    for (const part of parts.slice(0, -1)) node = node.files[part] ??= { files: {} };
    node.files[parts.at(-1)] = { size: buf.length, offset: String(offset) };
    bodies.push(buf);
    offset += buf.length;
  }
  const json = Buffer.from(JSON.stringify(tree));
  const padded = Math.ceil(json.length / 4) * 4;
  const head = Buffer.alloc(16);
  head.writeUInt32LE(4, 0);
  head.writeUInt32LE(8 + padded, 4);
  head.writeUInt32LE(4 + padded, 8);
  head.writeUInt32LE(json.length, 12);
  return Buffer.concat([head, json, Buffer.alloc(padded - json.length), ...bodies]);
}

test("the Claude Desktop theme is read from the install: the stock tokens, under the active palette", async () => {
  const { claudeTheme, cleanTokens, objectAt } = await import("../lib/ask/claudetheme.mjs");
  const dir = mkdtempSync(join(tmpdir(), "wf-claude-"));
  const resources = join(dir, "resources");
  const config = join(dir, "config");
  mkdirSync(resources);
  mkdirSync(config);
  const css = "x{}[data-theme=claude],[data-theme=claude][data-mode=light]{--bg-100:48 33.3% 97.1%;--text-000:60 2.6% 7.6%;--accent-brand:15 63.1% 59.6%;--x:red}[data-theme=claude][data-mode=dark]{--bg-100:60 2.7% 14.5%;--text-000:48 33.3% 97.1%;--accent-brand:15 63.1% 59.6%}";
  writeFileSync(join(resources, "ion-dist.asar"), asar({ "assets/v1/a.css": "body{}", "assets/v1/b.css": css }));
  const js = 'var a={"other":1};var t={"night":{"name":"Night","light":{"--bg-100":"220 20% 95%"},"dark":{"--bg-100":"240 20% 10%","--accent-brand":"199 75% 69%","--evil":"url(x)","--text-000":"red"}}};';
  writeFileSync(join(resources, "app.asar"), asar({ ".vite/build/index.js": js }));
  const env = { WF_CLAUDE_RESOURCES: resources, WF_CLAUDE_CONFIG: config };
  assert.deepEqual(claudeTheme(env), { name: "Claude", id: "claude", light: { "--bg-100": "48 33.3% 97.1%", "--text-000": "60 2.6% 7.6%", "--accent-brand": "15 63.1% 59.6%" }, dark: { "--bg-100": "60 2.7% 14.5%", "--text-000": "48 33.3% 97.1%", "--accent-brand": "15 63.1% 59.6%" } });
  writeFileSync(join(config, "claude-desktop-extra.jsonc"), '// a comment\n{\n  // "activeTheme": "mario",\n  "activeTheme": "night", // mine\n}\n');
  const t = claudeTheme(env);
  assert.equal(t.name, "Night");
  assert.equal(t.dark["--bg-100"], "240 20% 10%");
  assert.equal(t.dark["--accent-brand"], "199 75% 69%");
  assert.equal(t.dark["--text-000"], "48 33.3% 97.1%", "a value that is not a triple falls back to the stock token");
  assert.equal(t.dark["--evil"], undefined);
  assert.deepEqual(cleanTokens({ "--bg-100": "1 2% 3%", "--bg-200": "1 2% 3%; background: url(x)" }), { "--bg-100": "1 2% 3%" });
  assert.deepEqual(objectAt('x {"a":"}{","b":{"c":1}} y', 2), { a: "}{", b: { c: 1 } });
  assert.equal(claudeTheme({ WF_CLAUDE_RESOURCES: join(dir, "none"), WF_CLAUDE_CONFIG: config }), null);
  const { claudePalettes } = await import("../lib/ask/claudetheme.mjs");
  writeFileSync(join(resources, "app.asar"), asar({ ".vite/build/index.js": `${js}var u={"rose-dawn":{"light":{"--bg-100":"30 40% 96%"},"dark":{"--bg-100":"250 20% 12%"}},"no-bg":{"light":{"--text-000":"1 2% 3%"}}};` }));
  assert.deepEqual(claudePalettes(env), { active: "night", list: [{ id: "claude", name: "Claude" }, { id: "night", name: "Night" }, { id: "rose-dawn", name: "Rose Dawn" }] });
  assert.equal(claudeTheme(env, "rose-dawn").dark["--bg-100"], "250 20% 12%");
  assert.equal(claudeTheme(env, "claude").name, "Claude");
  assert.equal(claudeTheme(env, "missing"), null);
});

test("wording is held short, unless the question asks for more detail", () => {
  const long = "word ".repeat(60).trim();
  const problems = (more) => normalize({ id: "a", title: "t", questions: [{ id: "q", text: "x", options: [{ id: "a", label: "A", why: long }, { id: "b", label: "B", why: "short" }], recommended: "a", why: "short", ...more }] }).problems.join("\n");
  assert.match(problems({}), /q: option a's why is 299 characters, over 160; say it shorter, or set explain: true/);
  assert.equal(problems({ explain: true }), "");
  assert.match(normalize({ id: "a", title: "t", questions: [{ id: "q", text: long, type: "text" }] }).problems.join(), /q: the question is 299 characters, over 160/);
  assert.match(normalize({ id: "a", title: "t", questions: [{ id: "q", text: "x", options: [{ id: "a", label: long, why: "w" }, { id: "b", label: "B", why: "w" }], recommended: "a", why: "w", explain: true }] }).problems.join(), /label is 299 characters, over 60/, "explain never lengthens a label");
});

test("answered means one thing: sent after the page was built, for the page as it is", () => {
  const raw = example("decision");
  const { root, view } = project(raw);
  const { spec } = buildPage(root, view, raw, KIT_KINDS);
  assert.equal(askState(view, spec.id, spec).state, "waiting");
  mkdirSync(join(view, "answers"), { recursive: true });
  const file = answersPath(view, spec.id);
  const later = (Date.now() + 2000) / 1000;
  writeFileSync(file, JSON.stringify({ id: spec.id, hash: "000000000000", answers: { layout: { choice: "tabs" } } }));
  utimesSync(file, later, later);
  assert.equal(askState(view, spec.id, spec).state, "waiting", "answers to an older page");
  writeFileSync(file, JSON.stringify({ id: spec.id, hash: spec.hash, answers: { layout: { choice: "tabs" } } }));
  utimesSync(file, later, later);
  assert.deepEqual([askState(view, spec.id, spec).state, askState(view, spec.id, spec).open], ["partial", 1]);
});

test("a submitted time is the browser's only when it is a time, and never breaks the Markdown", () => {
  const { spec } = normalize(example("rank"));
  const at = (submitted) => checkAnswers(spec, { id: spec.id, hash: spec.hash, submitted, answers: {} }, KIT_KINDS).answers.submitted;
  assert.equal(at("2026-11-13T09:30:00Z"), "2026-11-13T09:30:00Z");
  assert.notEqual(at("2026\n# Forged"), "2026\n# Forged");
  assert.match(at("2026\n# Forged"), /^\d{4}-\d{2}-\d{2}T/);
  assert.doesNotMatch(answersMarkdown(spec, { submitted: "2026-11\n# x", answers: {} }).split("\n")[0], /\n/);
});

test("blocks: text is parsed into nodes, never HTML", async () => {
  const { parseText } = await import("../lib/ask/blocks.mjs");
  const nodes = parseText("## What changed\nSome **bold**, *slant*, and `code` <script>x</script>.\n\n- one\n- two\n\n1. first\n\n```\nraw <b>\n```");
  assert.deepEqual(nodes.map((n) => n.k), ["h", "p", "ul", "ol", "pre"]);
  assert.deepEqual(nodes[1].spans.map((s) => s.t), ["text", "b", "text", "i", "text", "code", "text"]);
  assert.equal(nodes[1].spans.at(-1).s, " <script>x</script>.", "markup stays text, which the page draws as text");
  assert.equal(nodes[4].text, "raw <b>");
});

test("blocks: a diff works out what was removed and added, by line or word", async () => {
  const { diffOps } = await import("../lib/ask/blocks.mjs");
  assert.deepEqual(diffOps("a\nb\nc", "a\nB\nc"), [{ op: "same", s: "a" }, { op: "del", s: "b" }, { op: "add", s: "B" }, { op: "same", s: "c" }]);
  const words = diffOps("Add account now", "Connect an account now", "word");
  assert.deepEqual(words.filter((o) => o.op === "del").map((o) => o.s.trim()), ["Add"]);
  assert.equal(words.filter((o) => o.op !== "del").map((o) => o.s).join(""), "Connect an account now", "the after side reads back whole");
  assert.equal(words.filter((o) => o.op !== "add").map((o) => o.s).join(""), "Add account now", "the before side reads back whole");
});

test("blocks: sections are checked, the questions go in one place, and a part is filled in", async () => {
  const sources = (name) => (name === "open-questions" ? { columns: [{ key: "id", label: "ID" }], rows: [{ id: "Q-001" }], empty: "" } : null);
  const parts = { checks: [{ type: "table", title: "Release {version}", columns: ["Check"], rows: [["ok"]] }] };
  const base = { id: "a", title: "t", questions: [{ id: "q", text: "x" }] };
  const run = (more, config = merge(DEFAULTS, {})) => normalize({ ...base, ...more }, {}, { config, parts, source: sources });
  const good = run({ sections: [{ title: "S", blocks: [{ type: "stats", items: [{ label: "L", value: "1", tone: "ok" }] }, { type: "table", source: "open-questions" }, { type: "part", name: "checks", with: { version: "0.3" } }, { type: "questions" }] }] });
  assert.deepEqual(good.problems, []);
  assert.deepEqual(good.spec.sections[0].blocks.map((b) => b.type), ["stats", "table", "table", "questions"]);
  assert.equal(good.spec.sections[0].blocks[2].title, "Release 0.3");
  assert.deepEqual(good.spec.sections[0].blocks[1].rows, [["Q-001"]]);
  const placed = run({ blocks: [{ type: "text", text: "hi" }] });
  assert.equal(placed.spec.sections.at(-1).blocks[0].type, "questions", "with no questions block, they come after");
  const bad = (more) => run(more).problems.join("\n");
  assert.match(bad({ blocks: [{ type: "html", html: "<b>" }] }), /type is one of text, stats, table, diff, chart, diagram, timeline, board, pictures, questions, part/);
  assert.match(bad({ blocks: [{ type: "questions" }, { type: "questions" }] }), /one questions block at most/);
  assert.match(bad({ blocks: [{ type: "table", source: "/etc/passwd" }] }), /no source \/etc\/passwd/);
  assert.match(bad({ blocks: [{ type: "part", name: "missing" }] }), /no part missing/);
  assert.match(bad({ blocks: [{ type: "stats", items: [{ label: "L", value: "1", tone: "shiny" }] }] }), /tone is ok, warn, bad, or info/);
  assert.match(bad({ blocks: [{ type: "text", text: "x".repeat(4001) }] }), /at most 4000 characters/);
  assert.match(bad({ blocks: [{ type: "table", columns: ["a"], rows: Array.from({ length: 501 }, () => ["x"]) }] }), /at most 500 rows/);
  assert.match(bad({ blocks: [{ type: "text", text: "x" }], sections: [] }), /blocks or sections, not both/);
  const nested = normalize({ ...base, blocks: [{ type: "part", name: "outer" }] }, {}, { parts: { outer: [{ type: "part", name: "checks" }], checks: parts.checks } }).problems.join();
  assert.match(nested, /a part does not use a part/);
});

test("blocks: a page or a project turns block kinds and features off", () => {
  const base = { id: "a", title: "t", questions: [{ id: "q", text: "x" }], blocks: [{ type: "text", text: "hi" }, { type: "stats", items: [{ label: "L", value: "1" }] }] };
  const project = merge(DEFAULTS, { ask: { off: ["stats", "palette"] } });
  const { spec, problems } = normalize({ ...base, off: ["bulk"], on: ["palette"] }, {}, { config: project });
  assert.deepEqual(problems, []);
  assert.deepEqual(spec.sections[0].blocks.map((b) => b.type), ["text"], "stats is off for the project");
  assert.deepEqual(spec.off, ["bulk"], "palette came back on for this page");
  assert.match(normalize({ ...base, off: ["everything"] }, {}, {}).problems.join(), /"everything" is not a block kind, a question type, or a page feature/);
});

test("blocks: the named sources read the project's logs, and an absent one is an empty table", async () => {
  const { sourcesFor } = await import("../lib/ask/sources.mjs");
  const root = mkdtempSync(join(tmpdir(), "wf-ask-src-"));
  const config = merge(DEFAULTS, { areas: [{ id: "app", prefix: "APP", docs: "docs/app" }] });
  const source = sourcesFor(root, config);
  assert.match(source("open-questions").empty, /No docs\/log\/open-questions\.md/);
  mkdirSync(join(root, "docs/log/decisions"), { recursive: true });
  writeFileSync(join(root, config.logs.openQuestions), readFileSync(join(here, "fixtures/questions/open.md"), "utf8"));
  assert.ok(source("open-questions").rows.length > 0);
  writeFileSync(join(root, config.logs.ledger), "# Findings\n\n| ID | Severity | Status | Title | Where |\n| --- | --- | --- | --- | --- |\n| [SEC-001](#sec-001) | Medium | proposed | A | `a.mjs:1` |\n| [SEC-002](#sec-002) | Low | verified | B | `b.mjs:2` |\n\n## Open\n\n| ID | x |\n| --- | --- |\n| SEC-009 | not summary |\n");
  assert.deepEqual(source("ledger").rows, [{ id: "SEC-001", severity: "Medium", status: "proposed", title: "A", where: "a.mjs:1" }]);
  // Open is proposed, accepted, or deferred, as ledger.py counts it; a fixed finding waits for review.
  writeFileSync(join(root, config.logs.ledger), "| ID | Severity | Status | Title | Where |\n| --- | --- | --- | --- | --- |\n| A-1 | Low | accepted | a | x |\n| A-2 | Low | deferred | b | x |\n| A-3 | Low | fixed | c | x |\n| A-4 | Low | accepted-risk | d | x |\n| A-5 | Low | superseded | e | x |\n");
  assert.deepEqual(source("ledger").rows.map((r) => r.id), ["A-1", "A-2"]);
  // A log path from the config is read only inside the project.
  const outside = mkdtempSync(join(tmpdir(), "wf-ask-out-"));
  writeFileSync(join(outside, "q.md"), "secret");
  for (const path of [join(outside, "q.md"), `../${outside.split("/").pop()}/q.md`]) {
    assert.equal(sourcesFor(root, { ...config, logs: { ...config.logs, openQuestions: path } })("open-questions").rows.length, 0);
  }
  symlinkSync(join(outside, "q.md"), join(root, "docs/log/link.md"));
  assert.match(sourcesFor(root, { ...config, logs: { ...config.logs, openQuestions: "docs/log/link.md" } })("open-questions").empty, /No docs\/log\/link\.md/, "a link that leads out is not followed");
  assert.equal(source("decisions").empty, "No decisions yet.");
  assert.equal(source("../secrets"), null);
});

test("the block example and its part build", async () => {
  const { projectParts } = await import("../lib/ask/index.mjs");
  const dir = join(EXAMPLES, "../blocks");
  const root = mkdtempSync(join(tmpdir(), "wf-ask-parts-"));
  mkdirSync(join(root, ".workflow/ask-parts"), { recursive: true });
  writeFileSync(join(root, ".workflow/ask-parts/release-checks.json"), readFileSync(join(dir, "release-checks.json")));
  writeFileSync(join(root, ".workflow/ask-parts/bad.json"), "{}");
  const { parts, problems } = projectParts(root);
  assert.deepEqual(Object.keys(parts), ["release-checks"]);
  assert.match(problems.join(), /bad\.json: a part is a list of blocks/);
  const spec = JSON.parse(readFileSync(join(dir, "status.json"), "utf8"));
  const out = normalize(spec, {}, { parts, source: () => ({ columns: [{ key: "id", label: "ID" }], rows: [], empty: "None." }) });
  assert.deepEqual(out.problems, []);
  assert.deepEqual(out.spec.sections.map((s) => s.blocks.map((b) => b.type).join(",")), ["stats,text,table", "table,table", "diff,diff,questions"]);
});

// --- richer answers -----------------------------------------------------------
const releaseExample = () => JSON.parse(readFileSync(join(EXAMPLES, "../answers/release.json"), "utf8"));
const why = (id, label = id) => ({ id, label, why: `${label}, as it says.` });
// The asking rules' own problems, left out where a test checks something else.
const ADVICE = /a recommendation|a suggested order|in why/;
const unadvised = (out) => ({ ...out, problems: out.problems.filter((p) => !ADVICE.test(p)) });
/** One question on a page, checked, less the asking rules' problems. */
const one = (q, extra = {}) => unadvised(normalize({ id: "rich", title: "Rich", questions: [q], ...extra }));

test("richer answers: the example checks clean and builds", async () => {
  const raw = releaseExample();
  const { spec, problems } = normalize(raw);
  assert.deepEqual(problems, []);
  assert.deepEqual(spec.questions.map((q) => q.type), ["one", "scale", "text", "grid", "buckets", "edits", "form"]);
  assert.deepEqual(spec.questions[1].scale, { min: 1, max: 5, step: 1, style: "stars", low: "Not sure", high: "Very sure", unit: "" });
  assert.deepEqual(spec.questions[5].recommended, { title: "accept", known: "accept" }, "one word recommends every edit");
  assert.equal(spec.questions[5].edits[0].by, "word");
  assert.ok(spec.questions[5].edits[0].ops.some((o) => o.op === "add"));
  const { root, view } = project(raw);
  const built = buildPage(root, view, raw, KIT_KINDS);
  assert.deepEqual(built.problems ?? [], []);
});

test("richer answers: each type is checked", () => {
  const scale = (s, extra = {}) => one({ id: "s", text: "Rate", type: "scale", scale: s, ...extra }).problems.join(" | ");
  assert.equal(scale({ min: 0, max: 100, step: 5 }), "");
  assert.equal(one({ id: "s", text: "Rate", type: "scale", scale: { min: 0, max: 100, step: 5 } }).spec.questions[0].scale.style, "slider", "a wide range is a slider");
  assert.match(scale({ min: 5, max: 1 }), /runs from min to a larger max/);
  assert.match(scale({ max: 20, style: "stars" }), /stars count whole steps/);
  assert.match(scale({}, { recommended: 2.5 }), /a number on the scale/);
  assert.match(scale({ min: 0, max: 1e6, step: 1 }), /at most 1000 steps/);
  const grid = (extra) => one({ id: "g", text: "Grid", type: "grid", rows: ["a", "b"], options: ["x", "y"], ...extra }).problems.join(" | ");
  assert.equal(grid({ recommended: { a: "x" } }), "");
  assert.match(grid({ recommended: { a: "z", c: "x" } }), /recommended places a, c on something it does not have/);
  assert.match(grid({ rows: [] }), /lists its rows/);
  assert.match(grid({ options: ["x"] }), /at least two options, the columns/);
  assert.match(one({ id: "b", text: "Sort", type: "buckets", options: ["now", "later"] }).problems.join(), /lists its items/);
  const edits = (list, extra) => one({ id: "e", text: "Edits", type: "edits", edits: list, ...extra }).problems.join(" | ");
  assert.match(edits([{ id: "a", before: "x", after: "x" }]), /before and after are the same/);
  assert.match(edits([{ id: "a", before: "x", after: "y" }], { recommended: "maybe" }), /recommended places a on something/);
  const form = (fields, extra) => one({ id: "f", text: "Form", type: "form", fields, ...extra }).problems.join(" | ");
  assert.equal(form([{ id: "n", kind: "number", min: 0 }]), "");
  assert.match(form([{ id: "n", kind: "colour" }]), /kind is one of text, long, number, check, select, date/);
  assert.match(form([{ id: "s", kind: "select", options: ["a"] }]), /a select field has at least two options/);
  assert.match(form([{ id: "n" }], { recommended: "x" }), /a form recommends nothing/);
  assert.match(form([{ id: "n" }, { id: "n" }]), /field ids repeat/);
  assert.match(one({ id: "o", text: "Who?", owners: [] }).problems.join(), /owners lists one to 12 names/);
  assert.match(one({ id: "o", text: "Who?", owners: ["Ken", "Ken"] }).problems.join(), /owners repeat/);
});

test("richer answers: the asking rules hold, with a recommendation and why on each", () => {
  const advice = (q) => normalize({ id: "rich", title: "Rich", template: "decision", questions: [q] }).problems.join(" | ");
  assert.match(advice({ id: "s", text: "Rate", type: "scale" }), /give the number in recommended, or say in noPick why/);
  assert.equal(advice({ id: "s", text: "Rate", type: "scale", noPick: "It is yours to say." }), "");
  assert.match(advice({ id: "g", text: "Grid", type: "grid", rows: ["a"], options: ["x", "y"], recommended: { a: "x" }, why: "w" }), /every option says what it means, in why; x, y do not/);
  assert.match(advice({ id: "e", text: "Edits", type: "edits", edits: [{ id: "a", before: "x", after: "y" }], recommended: "accept", why: "w" }), /every edit says why it is suggested/);
  assert.equal(advice({ id: "f", text: "Form", type: "form", fields: [{ id: "a" }] }), "", "a form, like text, asks for no recommendation");
});

test("richer answers: a follow-up names an earlier question, and what it names fits", () => {
  const page = (follow) => unadvised(normalize({ id: "rich", title: "Rich", questions: [
    { id: "a", text: "Pick", options: ["x", "y"] },
    { id: "s", text: "Rate", type: "scale" },
    { id: "f", text: "Then", ...follow },
  ] })).problems.join(" | ");
  assert.equal(page({ showIf: { question: "a", is: "x" } }), "");
  assert.equal(page({ showIf: { question: "s", atLeast: 3 } }), "");
  assert.equal(page({ showIf: { question: "a" } }), "", "with nothing named, it shows once a is answered");
  assert.match(page({ showIf: { question: "z" } }), /showIf names z, which is not an earlier question/);
  assert.match(page({ showIf: { question: "a", is: "q" } }), /showIf's is names options a does not have/);
  assert.match(page({ showIf: { question: "s", is: "x" } }), /showIf's is needs a one or many question; s is scale/);
  assert.match(page({ showIf: { question: "a", atLeast: 2 } }), /atLeast and atMost need a scale/);
  const later = normalize({ id: "rich", title: "Rich", questions: [{ id: "f", text: "Then", showIf: { question: "a" } }, { id: "a", text: "Pick", options: ["x", "y"] }] });
  assert.match(later.problems.join(), /not an earlier question/, "a follow-up never comes before what it follows");
});

test("richer answers: a page or a project turns the types, follow-ups, owners, and boxes off", () => {
  const raw = releaseExample();
  assert.match(normalize({ ...raw, off: ["edits"] }).problems.join(), /notes: edits questions are turned off here/);
  const config = merge(DEFAULTS, { ask: { off: ["followups", "owners", "regions"] } });
  const { spec, problems } = normalize(raw, {}, { config });
  assert.deepEqual(problems, []);
  assert.ok(spec.questions.every((q) => !q.showIf && !q.owners.length));
  assert.deepEqual([...spec.off].sort(), ["followups", "owners", "regions"]);
  assert.deepEqual(normalize({ ...raw, on: ["owners"] }, {}, { config }).spec.questions[3].owners, ["Ken", "Release lead", "The agent"]);
});

test("richer answers: the answers are checked, and a follow-up not asked holds none", () => {
  const { spec } = normalize(releaseExample());
  const send = (answers) => checkAnswers(spec, { id: spec.id, hash: spec.hash, answers }, KIT_KINDS);
  const full = {
    ship: { choice: "yes" }, confidence: { number: 4 }, "hold-why": { text: "never asked" },
    platforms: { rows: { linux: "stable", mac: "stable", windows: "beta" }, owner: "Ken" },
    issues: { rows: { sync: "next", font: "now", export: "now", dark: "later" } },
    notes: { edits: { title: "accept", known: "reject" } },
    cut: { fields: { date: "2026-11-20", builds: 3, checked: true } },
  };
  const ok = send(full);
  assert.equal(ok.problems, undefined);
  assert.equal(ok.answers.partial, false);
  assert.equal(ok.answers.answers["hold-why"], undefined, "hold-why follows a Hold, so its text goes");
  const held = send({ ...full, ship: { choice: "hold" } }).answers;
  assert.equal(held.answers.confidence, undefined, "with Hold, confidence is not asked and its number goes");
  assert.deepEqual(held.answers["hold-why"], { text: "never asked" }, "and hold-why is asked instead");
  assert.deepEqual(send({ ...full, ship: { choice: "hold" }, "hold-why": {} }).answers.open, ["hold-why"]);
  const part = send({ ship: { choice: "yes" }, platforms: { rows: { linux: "stable" } }, cut: { fields: { builds: 3 } } }).answers;
  assert.deepEqual(part.open, ["confidence", "platforms", "issues", "notes", "cut"], "a part-placed grid and a form missing a needed field are open");
  const wrong = (answers, pattern) => assert.match((send(answers).problems ?? []).join(" | "), pattern);
  wrong({ confidence: { number: 9 } }, /confidence: the number is from 1 to 5, by 1/);
  wrong({ confidence: { number: 2.5 } }, /from 1 to 5, by 1/);
  wrong({ ship: { number: 2 } }, /ship: takes no number/);
  wrong({ platforms: { rows: { linux: "nightly" } } }, /rows place each of its rows on one of its options/);
  wrong({ notes: { edits: { title: "maybe" } } }, /edits accept or reject each of its edits/);
  wrong({ cut: { fields: { builds: 40 } } }, /field builds: At most 12/);
  wrong({ cut: { fields: { colour: "red" } } }, /field colour is not one of its fields/);
  wrong({ cut: { fields: { channel: "radio" } } }, /field channel: One of the choices/);
  wrong({ platforms: { owner: "Someone" } }, /owner is one of Ken, Release lead, The agent/);
  wrong({ ship: { owner: "Ken" } }, /owner is not offered here/);
});

test("richer answers: a box drawn on a picture is a pin with a size, unless boxes are off", () => {
  const raw = { id: "boxes", title: "Boxes", questions: [{ id: "q", text: "What is wrong?", pins: true, pictures: [{ image: "a.png" }] }] };
  const { spec } = normalize(raw);
  const pin = { picture: 0, x: 10.4, y: 20, w: 30.6, h: 40, kind: "bug", text: "cut off" };
  const got = checkAnswers(spec, { id: spec.id, hash: spec.hash, answers: { q: { pins: [pin] } } }, KIT_KINDS);
  assert.deepEqual(got.answers.answers.q.pins, [{ picture: 0, x: 10, y: 20, w: 31, h: 40, kind: "bug", text: "cut off" }]);
  assert.match(answersMarkdown(spec, got.answers), /Box 1 on picture 1 at a box at 10, 20, 31×40 \(bug\): cut off/);
  assert.match(checkAnswers(spec, { id: spec.id, hash: spec.hash, answers: { q: { pins: [{ ...pin, w: 0 }] } } }, KIT_KINDS).problems.join(), /a box a width and a height above 0/);
  const { spec: offSpec } = normalize({ ...raw, off: ["regions"] });
  assert.match(checkAnswers(offSpec, { id: offSpec.id, hash: offSpec.hash, answers: { q: { pins: [pin] } } }, KIT_KINDS).problems.join(), /boxes are turned off here/);
});

test("richer answers: the Markdown says each one, and what was not asked", () => {
  const { spec } = normalize(releaseExample());
  const { answers } = checkAnswers(spec, { id: spec.id, hash: spec.hash, answers: {
    ship: { choice: "yes" }, confidence: { number: 4 }, platforms: { rows: { linux: "stable", mac: "beta", windows: "beta" }, owner: "Ken" },
    issues: { rows: { sync: "next", font: "now" } }, notes: { edits: { title: "accept", known: "reject" } }, cut: { fields: { date: "2026-11-20", checked: true, channel: "blog" } },
  } }, KIT_KINDS);
  const md = answersMarkdown(spec, answers);
  assert.match(md, /\*\*confidence\*\* .*: \*\*4\*\* \(recommended\)\./);
  assert.match(md, /\*\*hold-why\*\* .*: not asked, as it follows ship\./);
  assert.match(md, /- Owner: Ken\n {2}- Linux: Stable\n {2}- macOS: Beta/);
  assert.match(md, /\*\*issues\*\* .*: 2 of 4 done, so still open\./);
  assert.match(md, /Edit \*\*known\*\* Known issues: rejected/);
  assert.match(md, /- Cut on: 2026-11-20\n {2}- Builds to make: empty\n {2}- Announce in: The blog\n {2}- The checklist is done: yes/);
  assert.match(md, /, 1 of 6 open/);
});

test("richer answers: the page's steps and the record read one rule", () => {
  const S = answerSteps();
  const { spec } = normalize(releaseExample());
  const q = Object.fromEntries(spec.questions.map((x) => [x.id, x]));
  const byId = new Map(spec.questions.map((x) => [x.id, x]));
  // Follow-ups, and a follow-up of a hidden one.
  const chain = normalize({ id: "c", title: "C", questions: [{ id: "a", text: "A", options: ["x", "y"] }, { id: "b", text: "B", type: "scale", showIf: { question: "a", is: "x" } }, { id: "c", text: "C", showIf: { question: "b", atLeast: 3 } }] }).spec;
  const cById = new Map(chain.questions.map((x) => [x.id, x]));
  const shows = (A) => chain.questions.filter((x) => S.shown(x, A, cById)).map((x) => x.id).join();
  assert.equal(shows({}), "a");
  assert.equal(shows({ a: { choice: "x" } }), "a,b");
  assert.equal(shows({ a: { choice: "x" }, b: { number: 4 } }), "a,b,c");
  assert.equal(shows({ a: { choice: "y" }, b: { number: 4 } }), "a", "c follows b, which is hidden");
  assert.equal(shows({ a: { decide: "agent" } }), "a", "a question left to the agent shows no follow-ups");
  assert.equal(S.shown(q.confidence, { ship: { choice: "yes" } }, byId), true);
  // Taking a recommendation: a number, a place for each row, the edits; a form has none.
  const v = { decide: "later" };
  assert.equal(S.takeRecommendation(q.confidence, v), true);
  assert.deepEqual({ ...v }, { number: 4 });
  const g = { rows: { windows: "skip" } };
  S.takeRecommendation(q.platforms, g);
  assert.deepEqual({ ...g.rows }, { linux: "stable", mac: "stable", windows: "skip" }, "a row already placed stays");
  assert.equal(S.takeRecommendation(q.cut, {}), false);
  // Answered, by the page and by the record alike.
  const cases = [[q.platforms, { rows: { linux: "stable" } }], [q.platforms, { rows: { linux: "stable", mac: "beta", windows: "beta" } }], [q.cut, { fields: { date: "2026-11-20" } }], [q.cut, { fields: { date: "2026-11-20", checked: true } }], [q.cut, { fields: { date: "2026-11-20", checked: true, builds: 99 } }], [q.notes, { edits: { title: "accept" } }]];
  assert.deepEqual(cases.map(([x, a]) => S.answered(a, x)), [false, true, false, true, false, false]);
  assert.deepEqual(cases.map(([x, a]) => answered(a, x)), cases.map(([x, a]) => S.answered(a, x)));
  assert.deepEqual({ ...S.progressOf(q.platforms, { rows: { linux: "stable" } }) }, { done: 1, total: 3 });
  assert.deepEqual({ ...S.progressOf(q.notes, { edits: { title: "accept" } }) }, { done: 1, total: 2 });
  assert.equal(S.progressOf(q.ship, { choice: "yes" }), null, "a choice places nothing");
  const w = { number: 3, rows: { a: "b" }, edits: { e: "accept" }, fields: { f: 1 }, note: "keep", owner: "Ken" };
  S.clearAnswer(w);
  assert.deepEqual({ ...w }, { note: "keep", owner: "Ken" });
  const A = { a: { rows: {}, note: "n" } };
  assert.deepEqual(JSON.parse(JSON.stringify(S.prune(A))), { a: { note: "n" } });
  assert.equal(S.fieldProblem({ kind: "date", required: false }, "2026-02-30x"), "A date, such as 2026-11-13.");
  assert.equal(S.fieldProblem({ kind: "check", required: true }, false), "Tick this to go on.");
});

// --- charts, diagrams, timelines, boards --------------------------------------
/** One block on a page, checked: the block made ready, and the problems. */
const oneBlock = (b, extra = {}) => {
  const { spec, problems } = normalize({ id: "viz", title: "Viz", questions: [{ id: "q", text: "Fine?" }], blocks: [b], ...extra });
  return { block: spec?.sections?.[0]?.blocks?.[0], problems: problems.join(" | ") };
};

test("charts: a bar or line chart is labels and series on one axis, and a tile's trend is a sparkline", () => {
  const chart = (extra) => oneBlock({ type: "chart", labels: ["a", "b"], series: [{ name: "One", values: [1, null] }], ...extra });
  const ok = chart({ kind: "line", unit: "ms" });
  assert.equal(ok.problems, "");
  assert.deepEqual({ kind: ok.block.kind, unit: ok.block.unit, values: ok.block.series[0].values }, { kind: "line", unit: "ms", values: [1, null] });
  assert.equal(chart({}).block.kind, "bar");
  assert.match(chart({ kind: "pie" }).problems, /a chart's kind is bar or line; a sparkline is a stats tile's trend/);
  assert.match(chart({ series: [{ values: [1] }] }).problems, /series 1 has one number, or null, for each label/);
  assert.match(chart({ series: [{ values: [1, "2"] }] }).problems, /one number, or null/);
  assert.match(chart({ series: Array.from({ length: 9 }, () => ({ values: [1, 2] })) }).problems, /at most 8 series; fold the rest into "Other"/);
  assert.match(chart({ kind: "line", stacked: true }).problems, /only a bar chart stacks/);
  assert.match(chart({ stacked: true, series: [{ values: [1, -2] }] }).problems, /a stacked chart has no values below 0/);
  assert.match(chart({ labels: [] , series: [] }).problems, /a chart has labels/);
  const tile = oneBlock({ type: "stats", items: [{ label: "Bugs", value: "23", trend: [41, 30, 23] }, { label: "Odd", value: "1", trend: ["x"] }] });
  assert.deepEqual(tile.block.items[0].trend, [41, 30, 23]);
  assert.match(tile.problems, /tile 2's trend is one to 60 numbers/);
});

test("diagrams: boxes are ranked by what points to them, and a loop's arrow is marked back", async () => {
  const { layout } = await import("../lib/ask/blocks.mjs");
  const { nodes, links } = layout([{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }], [{ from: "a", to: "b" }, { from: "b", to: "c" }, { from: "c", to: "a" }, { from: "a", to: "d" }, { from: "d", to: "c" }]);
  assert.deepEqual(nodes.map((n) => `${n.id}${n.rank}.${n.order}`), ["a0.0", "b1.0", "c2.0", "d1.1"]);
  assert.deepEqual(links.map((l) => l.back), [false, false, true, false, false]);
  const self = layout([{ id: "a" }], [{ from: "a", to: "a" }]);
  assert.equal(self.links[0].back, true, "an arrow to itself is a loop");
  const d = oneBlock({ type: "diagram", direction: "down", nodes: ["x", { id: "y", label: "Why", tone: "ok" }], links: [{ from: "x", to: "y", label: "then" }] });
  assert.equal(d.problems, "");
  assert.deepEqual({ dir: d.block.direction, label: d.block.nodes[1].label, rank: d.block.nodes[1].rank }, { dir: "down", label: "Why", rank: 1 });
  assert.match(oneBlock({ type: "diagram", nodes: ["x", "x"], links: [{ from: "x", to: "z" }] }).problems, /node ids repeat.*link 1 goes from a node to a node/);
  assert.match(oneBlock({ type: "diagram", nodes: Array.from({ length: 41 }, (_, i) => `n${i}`) }).problems, /at most 40 nodes/);
  assert.match(oneBlock({ type: "diagram", nodes: [{ id: "x", tone: "pink" }] }).problems, /node 1's tone is ok, warn, bad, or info/);
});

test("timelines and boards are checked", () => {
  const t = oneBlock({ type: "timeline", events: [{ date: "2026-11-02", title: "Cut", state: "done" }, { title: "Ship", state: "soon" }, { state: "next" }] });
  assert.equal(t.block.events[0].state, "done");
  assert.match(t.problems, /event 2's state is done, now, or next.*event 3 has a title/);
  assert.match(oneBlock({ type: "timeline", events: [] }).problems, /a timeline lists its events/);
  const b = oneBlock({ type: "board", columns: ["todo", { id: "done", title: "Done" }], cards: [{ title: "A", column: "todo", tags: ["x"], owner: "Ken" }, { title: "B", column: "later" }] });
  assert.deepEqual(b.block.lanes, [{ id: "todo", title: "todo" }, { id: "done", title: "Done" }]);
  assert.deepEqual(b.block.cards[0], { title: "A", column: "todo", note: "", tone: "", owner: "Ken", tags: ["x"] });
  assert.match(b.problems, /card 2's column is one of todo, done/);
  assert.match(oneBlock({ type: "board", columns: [] }).problems, /a board lists its columns/);
});

test("the chart example builds, and the new blocks turn off like the rest", () => {
  const raw = JSON.parse(readFileSync(join(EXAMPLES, "../blocks/charts.json"), "utf8"));
  const { spec, problems } = normalize(raw);
  assert.deepEqual(problems, []);
  assert.deepEqual(spec.sections.map((s) => s.blocks.map((b) => b.type).join(",")), ["stats,chart,chart,chart", "diagram,timeline,board,questions"]);
  const off = normalize({ ...raw, off: ["chart", "diagram", "board"] }).spec;
  assert.deepEqual(off.sections.map((s) => s.blocks.map((b) => b.type).join(",")), ["stats", "timeline,questions"]);
  const { root, view } = project(raw);
  assert.deepEqual(buildPage(root, view, raw, KIT_KINDS).problems ?? [], []);
});

test("a page never writes the word null: append and replaceChildren are not handed a null", () => {
  // append and replaceChildren turn null into the text "null"; h() skips it, these do not.
  const dir = join(here, "..", "lib", "ask", "browser", "page");
  const found = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".js"))) {
    const src = readFileSync(join(dir, file), "utf8");
    for (const m of src.matchAll(/\.(append|prepend|replaceChildren|before|after)\(/g)) {
      // Read the call's own arguments, at its own depth only.
      let depth = 0, i = m.index + m[0].length, top = "";
      for (; i < src.length; i++) {
        const c = src[i];
        if ("([{".includes(c)) depth++;
        else if (")]}".includes(c)) { if (depth === 0) break; depth--; }
        else if (depth === 0) top += c;
      }
      if (/:\s*null\b/.test(top)) found.push(`${file}: ${src.slice(m.index, m.index + 60)}`);
    }
  }
  assert.deepEqual(found, []);
});
