import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { request } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Script } from "node:vm";

import { answered, answersMarkdown, checkAnswers, recordAnswers } from "../lib/ask/answers.mjs";
import { answersFromText, EXAMPLES, projectTemplates, runAsk } from "../lib/ask/index.mjs";
import { buildPage, exportHtml, imageSize, pictureFile } from "../lib/ask/page.mjs";
import { answersPath, serve, servedFile } from "../lib/ask/serve.mjs";
import { checkTemplate, normalize, TEMPLATES } from "../lib/ask/spec.mjs";
import { merge } from "../lib/config/config.mjs";
import { DEFAULTS } from "../lib/config/defaults.mjs";
import { KIT_KINDS } from "../lib/design/annotate.mjs";
import { SERVER, withViewServer } from "../lib/design/view.mjs";
import { emptyFile } from "../lib/logs/decisions.mjs";

const here = dirname(fileURLToPath(import.meta.url));
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
    assert.ok(spec.questions.length > 0, name);
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
  const { spec: rank } = normalize(example("rank"));
  assert.match(checkAnswers(rank, { id: rank.id, hash: rank.hash, answers: { order: { order: ["search"] } } }, KIT_KINDS).problems.join(), /every item once/);
  assert.equal(answered({ decide: "later" }), true);
  assert.equal(answered({ note: "only a note" }), false);
});

test("the answers read as Markdown, and the page's copied text reads back", () => {
  const { spec } = normalize(example("compare"));
  const record = checkAnswers(spec, { id: spec.id, hash: spec.hash, submitted: "2026-11-13T09:30:00Z", answers: { "accounts-wide": { choice: "drift", pins: [{ picture: 1, x: 640, y: 380, kind: "drift", text: "tags clipped", box: 1 }] }, "accounts-narrow": { decide: "agent" } } }, KIT_KINDS).answers;
  const md = answersMarkdown(spec, record);
  assert.match(md, /^# Accounts: frame against the app \(accounts-drift\), answered 2026-11-13 09:30\n/);
  assert.match(md, /- \*\*accounts-wide\*\* Accounts, wide: do these match\?: \*\*drift\*\* Drifts from the frame\.\n  - Pin 1 on App at 640, 380 \(drift\), in box 1: tags clipped/);
  assert.match(md, /- \*\*accounts-narrow\*\* .*: you decide\./);
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

test("the server serves the view folder, swaps in its token, and takes answers only from its own pages", async () => {
  const raw = example("decision");
  const { root, view } = project(raw);
  const { spec } = buildPage(root, view, raw, KIT_KINDS);
  mkdirSync(join(view, "answers"), { recursive: true });
  writeFileSync(join(root, "secret.txt"), "no");
  const logs = [];
  const { port, token, close } = await serve({ dir: view, port: 0, kinds: KIT_KINDS, log: (line) => logs.push(line) });
  const base = `http://127.0.0.1:${port}`;
  try {
    const page = await (await fetch(`${base}/ask/${spec.id}/`)).text();
    assert.match(page, new RegExp(`<meta name="wf-token" content="${token}">`));
    assert.equal((await fetch(`${base}/ask/${spec.id}/p/1.png`)).headers.get("content-type"), "image/png");
    assert.deepEqual(await (await fetch(`${base}/__ask/version/${spec.id}`)).json(), { hash: spec.hash });
    assert.equal((await fetch(`${base}/..%2f..%2fsecret.txt`)).status, 404);
    const post = (body, headers = {}) => fetch(`${base}/__ask/answers/${spec.id}`, { method: "POST", headers: { "Content-Type": "application/json", "X-WF-Token": token, ...headers }, body: JSON.stringify(body) });
    const answers = { id: spec.id, hash: spec.hash, answers: { layout: { choice: "tabs" } } };
    assert.equal((await post(answers, { "X-WF-Token": "wrong" })).status, 403);
    assert.equal((await post(answers, { Origin: "http://evil.test" })).status, 403);
    assert.equal((await post({ ...answers, answers: { layout: { choice: "grid" } } })).status, 422);
    const ok = await post(answers);
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { ok: true, partial: true, open: ["empty"] });
    assert.equal(JSON.parse(readFileSync(answersPath(view, spec.id), "utf8")).answers.layout.choice, "tabs");
    assert.equal((await fetch(`${base}/answers/${spec.id}.json`)).status, 403);
    // A page on another name that resolves here cannot reach the server.
    const other = await new Promise((done) => request({ host: "127.0.0.1", port, path: `/ask/${spec.id}/`, headers: { Host: "evil.test" } }, (res) => { res.resume(); done(res.statusCode); }).end());
    assert.equal(other, 403);
    assert.match(logs.join("\n"), /answers for decision-free|answers for chunk-12-layout: 1 of 2 still open/);
  } finally {
    await close();
  }
});

test("a served file stays in the folder", () => {
  const { view } = project();
  mkdirSync(join(view, "a"), { recursive: true });
  writeFileSync(join(view, "a/index.html"), "x");
  assert.equal(servedFile(view, "/a/"), join(view, "a/index.html"));
  assert.equal(servedFile(view, "/../x"), null);
  assert.equal(servedFile(view, "/%E0%A4%A"), null);
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
    assert.equal(await runAsk(["page", join(EXAMPLES, "rank.json")], log), 0);
    assert.match(out.join("\n"), /Open: http:\/\/127\.0\.0\.1:8765\/ask\/next-chunks\/index\.html/);
    const spec = JSON.parse(readFileSync(join(view, "ask/next-chunks/spec.json"), "utf8"));
    assert.equal(await runAsk(["wait", "next-chunks", "--timeout", "0.6"], log), 3);
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

test("the client script parses", () => {
  new Script(readFileSync(join(here, "../lib/ask/client.js"), "utf8"));
});

test("view setup replaces the old python server and keeps the project's own entries", () => {
  const old = { version: "0.0.1", configurations: [{ name: "web", port: 5173 }, { name: "question-pictures", runtimeExecutable: "python3", runtimeArgs: ["-m", "http.server", "8765"], port: 8765 }] };
  const now = JSON.parse(withViewServer(JSON.stringify(old)));
  assert.deepEqual(now.configurations, [{ name: "web", port: 5173 }, SERVER]);
  const theirs = { version: "0.0.1", configurations: [{ name: "question-pictures", runtimeExecutable: "node", runtimeArgs: ["mine.js"], port: 9000 }] };
  assert.deepEqual(JSON.parse(withViewServer(JSON.stringify(theirs))), theirs, "a project's own server of that name is theirs");
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
