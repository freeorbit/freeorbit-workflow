// The shared server and hub in lib/view: what it serves, to whom, and how a
// second start, an older server, and the launch.json entry are handled.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { request } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Script } from "node:vm";

import { askState, checkAnswers } from "../lib/ask/answers.mjs";
import { EXAMPLES } from "../lib/ask/index.mjs";
import { runView } from "../lib/view/command.mjs";
import { buildPage } from "../lib/ask/page.mjs";
import { answersPath, readSpec } from "../lib/ask/store.mjs";
import { serve, servedFile } from "../lib/view/serve.mjs";
import { readSettings, settingsFile, writeSettings } from "../lib/view/settings.mjs";
import { asker, ensureHub, hubUp, keptToken, olderVersion, projects, register, stateDir } from "../lib/view/hub.mjs";
import { KIT_KINDS } from "../lib/design/annotate.mjs";
import { projectKey, SERVER, withViewServer } from "../lib/view/view.mjs";

const here = dirname(fileURLToPath(import.meta.url));
// No shared server is started, and the registry is a throwaway one.
process.env.WF_ASK_NO_SERVER = "1";
process.env.WF_STATE_DIR = mkdtempSync(join(tmpdir(), "wf-view-state-"));
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const example = (name) => JSON.parse(readFileSync(join(EXAMPLES, `${name}.json`), "utf8"));

/** A project with every picture an example names, so its page builds. */
function project(...specs) {
  const root = mkdtempSync(join(tmpdir(), "wf-view-"));
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
    assert.deepEqual(await (await fetch(`${base}/__hub`)).json(), { hub: "freeorbit-workflow", version: "x", pid: process.pid, port, notify: false });
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

test("a page asks the server for a desktop notification with its own token; the inbox has one too, and no other origin may", async () => {
  const raw = example("decision");
  const { root, view } = project(raw);
  const { spec } = buildPage(root, view, raw, KIT_KINDS, {}, {});
  const key = projectKey(root);
  const shown = [];
  const find = (k) => (k === key ? { key, view, name: "demo", kinds: KIT_KINDS } : null);
  const { port, pageToken, close } = await serve({ resolve: find, list: () => [], check: checkAnswers, stateOf: askState, port: 0, log: () => {}, desktop: (title, body) => { shown.push([title, body]); return true; } });
  const base = `http://127.0.0.1:${port}`;
  const post = (body, tok, headers = {}) => fetch(`${base}/__hub/notify`, { method: "POST", headers: { "Content-Type": "application/json", "X-WF-Token": tok, ...headers }, body: JSON.stringify(body) });
  try {
    assert.equal((await (await fetch(`${base}/__hub`)).json()).notify, true);
    assert.equal((await post({ key, id: spec.id, title: "T", body: "B" }, pageToken(key, spec.id))).status, 200);
    assert.equal((await post({ key, id: spec.id, title: "T2" }, "wrong")).status, 403);
    assert.equal((await post({ key, id: "no-such-page", title: "T3" }, pageToken(key, "no-such-page"))).status, 403);
    assert.equal((await post({ key: "__hub", id: "inbox", title: "T4", body: "" }, pageToken("__hub", "inbox"))).status, 200);
    assert.equal((await post({ key, id: spec.id, title: "T5" }, pageToken(key, spec.id), { Origin: "http://evil.test" })).status, 403);
    assert.match(await (await fetch(`${base}/`)).text(), new RegExp(`<meta name="wf-token" content="${pageToken("__hub", "inbox")}">`));
    assert.deepEqual(shown, [["T", "B"], ["T4", ""]]);
  } finally {
    await close();
  }
});

test("the server keeps the ask pages' settings in a file, puts them in each page it serves, and takes them only from its own pages", async () => {
  const raw = example("decision");
  const { root, view } = project(raw);
  const { spec } = buildPage(root, view, raw, KIT_KINDS, {}, {});
  const key = projectKey(root);
  const file = settingsFile(mkdtempSync(join(tmpdir(), "wf-settings-")));
  const find = (k) => (k === key ? { key, view, name: "demo", kinds: KIT_KINDS } : null);
  const { port, pageToken, close } = await serve({ resolve: find, list: () => [], check: checkAnswers, stateOf: askState, port: 0, log: () => {}, settings: { read: () => readSettings(file), write: (value) => writeSettings(value, file) } });
  const base = `http://127.0.0.1:${port}`;
  const post = (body, tok, headers = {}) => fetch(`${base}/__hub/settings`, { method: "POST", headers: { "Content-Type": "application/json", "X-WF-Token": tok, ...headers }, body: JSON.stringify(body) });
  const look = { theme: "slate", accent: "teal", mode: "dark" };
  try {
    assert.deepEqual((await (await fetch(`${base}/__hub/settings`)).json()).settings, {});
    assert.equal((await post({ key, id: spec.id, settings: { "wf-ask:look": look, "wf-ask:notify": true } }, pageToken(key, spec.id))).status, 200);
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { "wf-ask:look": look, "wf-ask:notify": true });
    if (process.platform !== "win32") assert.equal(statSync(file).mode & 0o777, 0o600, "for this user alone");
    // Each page served, and the inbox, carry them, ready before any script reads its storage.
    const page = await (await fetch(`${base}/${key}/ask/${spec.id}/`)).text();
    assert.match(page, /<script type="application\/json" id="wf-settings">\{"wf-ask:look":\{"theme":"slate"/);
    assert.match(await (await fetch(`${base}/`)).text(), /id="wf-settings">\{"wf-ask:look"/);
    // From the inbox, with the hub's token; a setting is replaced, so one dropped goes.
    assert.equal((await post({ key: "__hub", id: "inbox", settings: { "wf-ask:inbox": { project: "a" } } }, pageToken("__hub", "inbox"))).status, 200);
    assert.deepEqual(readSettings(file), { "wf-ask:inbox": { project: "a" } });
    // Refused: a wrong token, another origin, a key the server does not keep, too large, and a value that would end the script.
    assert.equal((await post({ key, id: spec.id, settings: {} }, "wrong")).status, 403);
    assert.equal((await post({ key, id: spec.id, settings: {} }, pageToken(key, spec.id), { Origin: "http://evil.test" })).status, 403);
    assert.equal((await post({ key, id: spec.id, settings: { "wf-ask:notified": [] } }, pageToken(key, spec.id))).status, 422);
    assert.equal((await post({ key, id: spec.id, settings: { "wf-ask:look": { theme: "x".repeat(17 * 1024) } } }, pageToken(key, spec.id))).status, 413);
    assert.equal((await post({ key, id: spec.id, settings: { "wf-ask:look": { theme: "</script><script>alert(1)</script>" } } }, pageToken(key, spec.id))).status, 200);
    assert.doesNotMatch(await (await fetch(`${base}/${key}/ask/${spec.id}/`)).text(), /<\/script><script>alert/);
    // An exported page keeps the mark, which its script reads as no settings.
    writeFileSync(file, "not json");
    assert.deepEqual(readSettings(file), {});
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

test("view setup replaces the old python server and keeps the project's own entries", () => {
  const old = { version: "0.0.1", configurations: [{ name: "web", port: 5173 }, { name: "ask-pages", runtimeExecutable: "python3", runtimeArgs: ["-m", "http.server", "8765"], port: 8765 }] };
  const now = JSON.parse(withViewServer(JSON.stringify(old)));
  assert.deepEqual(now.configurations, [{ name: "web", port: 5173 }, SERVER]);
  const theirs = { version: "0.0.1", configurations: [{ name: "ask-pages", runtimeExecutable: "node", runtimeArgs: ["mine.js"], port: 9000 }] };
  assert.deepEqual(JSON.parse(withViewServer(JSON.stringify(theirs))), theirs, "a project's own server of that name is theirs");
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

test("a server older than the kit is started again on the kit, with the token its open pages hold", async () => {
  assert.equal(olderVersion("0.69.1", "0.69.2"), true);
  assert.equal(olderVersion("0.69.2", "0.69.2"), false);
  assert.equal(olderVersion("0.70.0", "0.69.9"), false, "a newer server is left alone");
  assert.equal(olderVersion("0.9.0", "0.10.0"), true, "by number, not by letter");
  assert.equal(olderVersion(undefined, "0.69.2"), false);
  const port = 20000 + Math.floor(Math.random() * 20000);
  const env = { ...process.env, WF_ASK_NO_SERVER: "", WF_STATE_DIR: mkdtempSync(join(tmpdir(), "wf-ask-old-")) };
  // An old server, as an earlier kit left it: its record in the state folder, its own token.
  const old = await serve({ resolve: () => null, list: () => [], check: checkAnswers, stateOf: askState, port, log: () => {}, version: "0.0.1", onStop: () => old.close() });
  writeFileSync(join(stateDir(env), "view-hub.json"), JSON.stringify({ pid: process.pid, port, token: old.token, version: "0.0.1" }));
  assert.equal(keptToken(port, env), old.token);
  assert.equal(keptToken(port + 1, env), undefined, "another port's token is not this one's");
  const kit = JSON.parse(readFileSync(join(here, "../package.json"), "utf8")).version;
  try {
    const now = await ensureHub({ port, env });
    assert.equal(now.version, kit, "the kit's own server answers now");
    assert.notEqual(now.pid, process.pid);
    assert.equal(JSON.parse(readFileSync(join(stateDir(env), "view-hub.json"), "utf8")).token, old.token, "with the token before, so an open page can still send");
    assert.equal((await ensureHub({ port, env })).pid, now.pid, "and it is not started again");
  } finally {
    const hub = JSON.parse(readFileSync(join(stateDir(env), "view-hub.json"), "utf8"));
    await fetch(`http://127.0.0.1:${port}/__hub/stop`, { method: "POST", headers: { "X-WF-Token": hub.token } }).catch(() => null);
    await old.close().catch(() => null);
    for (let i = 0; i < 20 && (await hubUp(port)); i++) await new Promise((done) => setTimeout(done, 100));
  }
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

test("doctor and view setup read the server entry the same way", async () => {
  const { viewEntry } = await import("../lib/view/view.mjs");
  const kind = (entry) => viewEntry({ configurations: [entry] }).kind;
  assert.equal(kind(SERVER), "kit");
  assert.equal(kind({ ...SERVER, runtimeArgs: ["wf", "view", "serve", "--port", "9000"] }), "kit");
  assert.equal(kind({ name: SERVER.name, runtimeExecutable: "node", runtimeArgs: ["node_modules/freeorbit-workflow/bin/wf.mjs", "view", "serve"] }), "kit");
  assert.equal(kind({ name: SERVER.name, runtimeExecutable: "python3", runtimeArgs: ["-m", "http.server", "8765"] }), "old");
  assert.equal(kind({ name: SERVER.name, runtimeExecutable: "node", runtimeArgs: ["mine.js"] }), "own");
  assert.equal(viewEntry({ configurations: [] }).kind, "none");
  // The kit's server under another name, or twice, is one entry to tidy, not none: setup once added a second on the same port.
  const renamed = { ...SERVER, name: "ask-page" };
  assert.equal(kind(renamed), "untidy");
  assert.equal(viewEntry({ configurations: [renamed, SERVER] }).kind, "untidy");
  const web = { name: "web", port: 5173 };
  const tidy = (configurations) => JSON.parse(withViewServer(JSON.stringify({ version: "0.0.1", configurations }))).configurations;
  assert.deepEqual(tidy([renamed, web]), [SERVER, web], "renamed in place");
  assert.deepEqual(tidy([renamed, web, SERVER]), [web, SERVER], "the named one stays, the other goes");
  assert.deepEqual(tidy([{ ...renamed, runtimeArgs: ["wf", "view", "serve", "--port", "9000"], port: 9000 }]), [{ ...SERVER, runtimeArgs: ["wf", "view", "serve", "--port", "9000"], port: 9000 }], "its options are kept");
  assert.equal(viewEntry({ configurations: tidy([renamed, SERVER]) }).kind, "kit");
  // The name before v0.86.0: doctor accepts it for now, and setup renames it.
  const before = { ...SERVER, name: "question-pictures" };
  assert.equal(SERVER.name, "ask-pages");
  assert.deepEqual([viewEntry({ configurations: [before] }).kind, viewEntry({ configurations: [before] }).legacy], ["kit", true]);
  assert.equal(viewEntry({ configurations: [SERVER] }).legacy, undefined);
  assert.deepEqual(tidy([web, before]), [web, SERVER], "the old name is renamed in place");
  assert.deepEqual(tidy([before, renamed]), [SERVER], "the old name is the one kept over another");
  assert.deepEqual(tidy([{ name: "question-pictures", runtimeExecutable: "python3", runtimeArgs: ["-m", "http.server", "8765"], port: 8765 }]), [SERVER], "the python server under the old name is replaced");
  const theirOld = { name: "question-pictures", runtimeExecutable: "node", runtimeArgs: ["mine.js"] };
  assert.deepEqual(tidy([theirOld]), [theirOld, SERVER], "a project's own entry under the old name no longer stands in the way");
  const own = { name: SERVER.name, runtimeExecutable: "node", runtimeArgs: ["mine.js"] };
  assert.deepEqual(tidy([own, renamed]), [own, renamed], "a project's own entry of that name is still left alone");
});
