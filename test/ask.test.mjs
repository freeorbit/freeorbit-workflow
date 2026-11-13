import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { request } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext, Script } from "node:vm";

import { answered, answersMarkdown, askState, checkAnswers, recordAnswers } from "../lib/ask/answers.mjs";
import { answersFromText, EXAMPLES, projectTemplates, runAsk, runView } from "../lib/ask/index.mjs";
import { buildPage, exportHtml, imageSize, pageScript, pictureFile } from "../lib/ask/page.mjs";
import { answersPath, readSpec, serve, servedFile } from "../lib/view/serve.mjs";
import { asker, ensureHub, hubUp, projects, register } from "../lib/view/hub.mjs";
import { checkTemplate, normalize, TEMPLATES } from "../lib/ask/spec.mjs";
import { merge } from "../lib/config/config.mjs";
import { DEFAULTS } from "../lib/config/defaults.mjs";
import { KIT_KINDS } from "../lib/design/annotate.mjs";
import { projectKey, SERVER, withViewServer } from "../lib/view/view.mjs";
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

test("the server serves each project at its key, swaps in its token, and takes answers only from its own pages", async () => {
  const raw = example("decision");
  const { root, view } = project(raw);
  const { spec } = buildPage(root, view, raw, KIT_KINDS, {}, { asker: { project: "demo", branch: "main", worktree: "", session: "local_abc12345" } });
  mkdirSync(join(view, "answers"), { recursive: true });
  writeFileSync(join(root, "secret.txt"), "no");
  const key = projectKey(root);
  const logs = [];
  const find = (k) => (k === key ? { key, view, name: "demo", kinds: KIT_KINDS } : null);
  writeFileSync(join(view, "ask", spec.id, "p", "evil.svg"), '<svg xmlns="http://www.w3.org/2000/svg"><script>fetch("/")</script></svg>');
  const { port, token, pageToken, close } = await serve({ resolve: find, list: () => [{ key, view, name: "demo" }], check: checkAnswers, stateOf: askState, port: 0, version: "x", log: (line) => logs.push(line) });
  const base = `http://127.0.0.1:${port}`;
  try {
    assert.deepEqual(await (await fetch(`${base}/__hub`)).json(), { hub: "freeorbit-workflow", version: "x", pid: process.pid, port });
    const served = await fetch(`${base}/${key}/ask/${spec.id}/`);
    const page = await served.text();
    const mine = pageToken(key, spec.id);
    assert.notEqual(mine, token, "a page never holds the server's own secret");
    assert.match(page, new RegExp(`<meta name="wf-token" content="${mine}">`));
    assert.match(served.headers.get("content-security-policy"), /connect-src 'self'/);
    // Any other file runs sandboxed, in no origin, so its script reads no page's token.
    const svg = await fetch(`${base}/${key}/ask/${spec.id}/p/evil.svg`);
    assert.match(svg.headers.get("content-security-policy"), /^sandbox allow-scripts;.*connect-src 'none'/);
    assert.match(page, new RegExp(`"key":"${key}"`));
    assert.equal((await fetch(`${base}/${key}/ask/${spec.id}/p/1.png`)).headers.get("content-type"), "image/png");
    assert.equal((await fetch(`${base}/other-123456/ask/${spec.id}/`)).status, 404, "an unknown project");
    assert.deepEqual(await (await fetch(`${base}/__ask/${key}/version/${spec.id}`)).json(), { hash: spec.hash });
    assert.equal((await fetch(`${base}/${key}/..%2f..%2fsecret.txt`)).status, 404);
    const post = (body, headers = {}, k = key) => fetch(`${base}/__ask/${k}/answers/${spec.id}`, { method: "POST", headers: { "Content-Type": "application/json", "X-WF-Token": mine, ...headers }, body: JSON.stringify(body) });
    const answers = { id: spec.id, hash: spec.hash, answers: { layout: { choice: "tabs" } } };
    assert.equal((await post(answers, { "X-WF-Token": "wrong" })).status, 403);
    assert.equal((await post(answers, { "X-WF-Token": pageToken(key, "another-page") })).status, 403, "another page's token answers only that page");
    assert.equal((await post(answers, { Origin: "http://evil.test" })).status, 403);
    assert.equal((await post(answers, {}, "other-123456")).status, 404);
    assert.equal((await post({ ...answers, answers: { layout: { choice: "grid" } } })).status, 422);
    const ok = await post(answers);
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { ok: true, partial: true, open: ["empty"] });
    assert.equal(JSON.parse(readFileSync(answersPath(view, spec.id), "utf8")).answers.layout.choice, "tabs");
    assert.equal((await fetch(`${base}/${key}/answers/${spec.id}.json`)).status, 403);
    assert.equal((await fetch(`${base}/${key}/ANSWERS/${spec.id}.json`)).status, process.platform === "linux" ? 404 : 403, "the answers folder in any case");
    assert.equal(statSync(answersPath(view, spec.id)).mode & 0o777, 0o600, "answers are this user's alone");
    const { items } = await (await fetch(`${base}/__hub/inbox`)).json();
    assert.deepEqual(items.map((i) => `${i.id} ${i.state} ${i.open}/${i.questions} ${i.asker.session} ${i.href}`), [`chunk-12-layout partial 1/2 local_abc12345 /${key}/ask/chunk-12-layout/`]);
    assert.match(await (await fetch(`${base}/`)).text(), /<title>Asks<\/title>/);
    // A broken spec in one project is skipped and leaves the server up for every other.
    writeFileSync(join(view, "ask", spec.id, "spec.json"), "{ not json");
    assert.equal((await fetch(`${base}/__ask/${key}/version/${spec.id}`)).status, 404);
    assert.equal((await fetch(`${base}/__hub/inbox`)).status, 200);
    assert.deepEqual((await (await fetch(`${base}/__hub/inbox`)).json()).items, []);
    writeFileSync(join(view, "ask", spec.id, "spec.json"), JSON.stringify(spec));
    assert.equal((await fetch(`${base}/__hub/stop`, { method: "POST" })).status, 403, "stop needs the token");
    assert.equal((await fetch(`${base}/__hub/stop`, { method: "POST", headers: { "X-WF-Token": mine } })).status, 403, "a page's token cannot stop the server");
    // A page on another name that resolves here cannot reach the server.
    const other = await new Promise((done) => request({ host: "127.0.0.1", port, path: `/${key}/ask/${spec.id}/`, headers: { Host: "evil.test" } }, (res) => { res.resume(); done(res.statusCode); }).end());
    assert.equal(other, 403);
    assert.match(logs.join("\n"), new RegExp(`answers for ${key}/chunk-12-layout: 1 of 2 still open`));
  } finally {
    await close();
  }
});

test("the registry keeps projects by key, and drops a root that is no longer a project", () => {
  const a = mkdtempSync(join(tmpdir(), "wf-ask-reg-"));
  const b = mkdtempSync(join(tmpdir(), "wf-ask-reg-"));
  for (const root of [a, b]) {
    mkdirSync(join(root, ".workflow"));
    writeFileSync(join(root, ".workflow/config.json"), "{}");
  }
  const env = { WF_STATE_DIR: mkdtempSync(join(tmpdir(), "wf-ask-state-")) };
  const ka = register(a, env);
  const kb = register(b, env);
  assert.notEqual(ka, kb);
  assert.deepEqual(Object.keys(projects(env)).sort(), [ka, kb].sort());
  rmSync(join(b, ".workflow"), { recursive: true });
  assert.deepEqual(Object.keys(projects(env)), [ka]);
});

test("who asks names the repository, the branch, the worktree, and the session", () => {
  const root = mkdtempSync(join(tmpdir(), "wf-ask-who-"));
  spawnSync("git", ["init", "-q", "-b", "main"], { cwd: root });
  const who = asker(root, { CLAUDE_CODE_HOST_SESSION_ID: "local_1234abcd" });
  assert.equal(who.branch, "main");
  assert.equal(who.worktree, "");
  assert.equal(who.session, "local_1234abcd");
});

test("a served file stays in the folder", () => {
  const { view } = project();
  mkdirSync(join(view, "a"), { recursive: true });
  writeFileSync(join(view, "a/index.html"), "x");
  assert.equal(servedFile(view, "/a/"), realpathSync(join(view, "a/index.html")), "the real path, as on macOS where /var is /private/var");
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

test("a second start finds the shared server and reuses it, and stop ends it", async () => {
  const port = 20000 + Math.floor(Math.random() * 20000);
  const env = { ...process.env, WF_ASK_NO_SERVER: "" };
  const first = await ensureHub({ port, env });
  assert.equal(first.hub, "freeorbit-workflow");
  const second = await ensureHub({ port, env });
  assert.equal(second.pid, first.pid, "the same server");
  const out = [];
  assert.equal(await runView(["stop", "--port", String(port)], (line) => out.push(line)), 0);
  assert.match(out.join(), /stopped/);
  for (let i = 0; i < 20 && (await hubUp(port)); i++) await new Promise((done) => setTimeout(done, 100));
  assert.equal(await hubUp(port), null);
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

test("a page carries the kit's themes, and the server hands out the Claude Desktop theme", async () => {
  const raw = example("rank");
  const { root, view } = project(raw);
  const { page } = buildPage(root, view, raw, KIT_KINDS);
  const data = JSON.parse(readFileSync(page, "utf8").split('id="ask-data">')[1].split("</script>")[0]);
  assert.equal(data.themes.default, "clay");
  assert.deepEqual(Object.keys(data.themes.themes).sort(), ["clay", "contrast", "indigo", "moss", "slate", "teal"]);
  const key = projectKey(root);
  const theme = { name: "Night", id: "night", light: { "--bg-100": "1 2% 3%" }, dark: { "--bg-100": "4 5% 6%" } };
  const asked = [];
  const { port, close } = await serve({ resolve: () => null, list: () => [{ key, view, name: "x" }], port: 0, log: () => {}, theme: (id) => { asked.push(id); return theme; }, themes: () => ({ active: "night", list: [{ id: "night", name: "Night" }] }) });
  try {
    assert.deepEqual(await (await fetch(`http://127.0.0.1:${port}/__hub/theme`)).json(), { ok: true, ...theme });
    await fetch(`http://127.0.0.1:${port}/__hub/theme?id=nord`);
    assert.deepEqual(await (await fetch(`http://127.0.0.1:${port}/__hub/theme?id=../x`)).json(), { ok: false });
    assert.deepEqual(asked, ["", "nord"], "an id that is not a palette name is never asked for");
    assert.deepEqual(await (await fetch(`http://127.0.0.1:${port}/__hub/themes`)).json(), { ok: true, active: "night", list: [{ id: "night", name: "Night" }] });
    const inbox = await (await fetch(`http://127.0.0.1:${port}/`)).text();
    assert.match(inbox, /<script type="application\/json" id="themes">/);
  } finally {
    await close();
  }
  const none = await serve({ resolve: () => null, list: () => [], port: 0, log: () => {} });
  try {
    assert.deepEqual(await (await fetch(`http://127.0.0.1:${none.port}/__hub/theme`)).json(), { ok: false });
  } finally {
    await none.close();
  }
});

test("the inbox script parses", async () => {
  const { inboxHtml } = await import("../lib/view/inbox.mjs");
  new Script(inboxHtml().split("<script>\n")[1].split("\n</script>")[0]);
});

test("a spec is read only for an id that is one, and only when it is a page's", () => {
  const raw = example("rank");
  const { root, view } = project(raw);
  buildPage(root, view, raw, KIT_KINDS);
  assert.equal(readSpec(view, "next-chunks").id, "next-chunks");
  assert.equal(readSpec(view, "../../../../etc/x"), null);
  assert.equal(readSpec(view, undefined), null);
  writeFileSync(join(view, "ask/next-chunks/spec.json"), JSON.stringify({ id: "other", questions: [] }));
  assert.equal(readSpec(view, "next-chunks"), null, "a spec whose id is not its folder's");
  writeFileSync(join(view, "ask/next-chunks/spec.json"), "null");
  assert.equal(readSpec(view, "next-chunks"), null);
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

test("doctor and view setup read the server entry the same way", async () => {
  const { viewEntry } = await import("../lib/view/view.mjs");
  const kind = (entry) => viewEntry({ configurations: [entry] }).kind;
  assert.equal(kind(SERVER), "kit");
  assert.equal(kind({ ...SERVER, runtimeArgs: ["wf", "view", "serve", "--port", "9000"] }), "kit");
  assert.equal(kind({ name: SERVER.name, runtimeExecutable: "node", runtimeArgs: ["node_modules/freeorbit-workflow/bin/wf.mjs", "view", "serve"] }), "kit");
  assert.equal(kind({ name: SERVER.name, runtimeExecutable: "python3", runtimeArgs: ["-m", "http.server", "8765"] }), "old");
  assert.equal(kind({ name: SERVER.name, runtimeExecutable: "node", runtimeArgs: ["mine.js"] }), "own");
  assert.equal(viewEntry({ configurations: [] }).kind, "none");
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
  assert.match(bad({ blocks: [{ type: "html", html: "<b>" }] }), /type is one of text, stats, table, diff, questions, part/);
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
  assert.match(normalize({ ...base, off: ["everything"] }, {}, {}).problems.join(), /"everything" is not a block kind or a page feature/);
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
