// Two people on one team server ask page, each in a browser of their own:
// what one answers shows on the other's page as it is made, with who gave
// it; who is on the page; a warning when someone changes what you are
// writing; assigning, threads, the ready check, and who sent it
// (docs/design/team-server.md, "Working together").

import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

import { buildPage } from "../lib/ask/page.mjs";
import { openChromium } from "../lib/browser/headless.mjs";
import { DEFAULTS } from "../lib/config/defaults.mjs";
import { browserFor } from "../lib/config/platform.mjs";
import { KIT_KINDS } from "../lib/design/annotate.mjs";
import { teamServe } from "../lib/team/server.mjs";

const scratch = mkdtempSync(join(tmpdir(), "wf-collab-browser-"));
const ADMIN = "d".repeat(40);
const opt = (id) => ({ id, label: id.toUpperCase(), why: `${id}, as it says.` });
const raw = { id: "pick", title: "Pick", questions: [{ id: "q1", text: "First?", options: [opt("a"), opt("b")], recommended: "a", why: "w" }, { id: "q2", text: "Second?", options: [opt("a"), opt("b")], recommended: "a", why: "w" }] };

let server, origin, kenB, anaB;
before(async () => {
  const port = await new Promise((done) => { const t = createServer(); t.listen(0, "127.0.0.1", () => { const p = t.address().port; t.close(() => done(p)); }); });
  origin = `http://127.0.0.1:${port}`;
  server = await teamServe({ dir: mkdtempSync(join(scratch, "team-")), origin, port, host: "127.0.0.1", adminToken: ADMIN, secureCookie: false, log: () => {} });
  [kenB, anaB] = await Promise.all([openChromium(mkdtempSync(join(scratch, "ken-")), browserFor(DEFAULTS)), openChromium(mkdtempSync(join(scratch, "ana-")), browserFor(DEFAULTS))]);
});
after(async () => {
  await Promise.all([kenB?.close(), anaB?.close()]);
  await server?.close();
  await rm(scratch, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

const api = (path, { method = "GET", token = ADMIN, body } = {}) => fetch(`${origin}${path}`, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });

/** Invite a person, set their password, and give their browser the session. */
async function enroll(browser, name, role) {
  const { link } = await (await api("/__team/invite", { method: "POST", body: { name, role, projects: ["atlas"] } })).json();
  const res = await fetch(`${origin}/__team/join`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ code: link.split("#")[1], password: "correct horse battery" }) });
  const [cookieName, value] = res.headers.get("set-cookie").split(";")[0].split("=");
  await browser.command("Network.enable");
  await browser.command("Network.setCookie", { name: cookieName, value, url: origin });
  return (await res.json()).token;
}

const js = (b, expression) => b.evaluate(expression);
async function until(b, expression, what, ms = 6000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await js(b, `Boolean(${expression})`)) return;
    await new Promise((r) => setTimeout(r, 40));
  }
  assert.fail(`timed out waiting for ${what}: ${expression}`);
}
const click = (b, selector, text = "") =>
  js(b, `(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => e.textContent.includes(${JSON.stringify(text)})); if (!el) throw new Error(${JSON.stringify(`nothing to click: ${selector} ${text}`)}); el.click(); return null; })()`);
const chosen = (b, id) => js(b, `[...document.querySelectorAll('#q-${id} [aria-checked="true"]')].map((e) => e.dataset.id)`);

test("two people on one page see each other's answers, places, threads, and sends as they happen", async () => {
  const kenToken = await enroll(kenB, "ken", "developer");
  await enroll(anaB, "ana", "designer");
  const root = mkdtempSync(join(scratch, "proj-"));
  const { spec } = buildPage(root, join(root, ".cache/view"), raw, KIT_KINDS);
  await api("/__team/api/atlas", { method: "PUT", token: kenToken, body: { name: "Atlas", kinds: KIT_KINDS } });
  await api("/__team/api/atlas/pick", { method: "PUT", token: kenToken, body: { spec, pictures: {} } });
  const url = `${origin}/atlas/ask/pick/`;
  await Promise.all([kenB.open(url, 1280, 900), anaB.open(url, 1280, 900)]);
  for (const b of [kenB, anaB]) await until(b, `document.querySelectorAll(".avatars .avatar").length === 2`, "both people on the page");
  assert.deepEqual(await js(kenB, `[...document.querySelectorAll(".avatars .avatar")].map((a) => a.textContent)`), ["AN", "KE"]);

  // Ana's pick shows on Ken's page, with who gave it.
  await click(anaB, "#q-q1 .opt", "B");
  await until(kenB, `document.querySelector('#q-q1 [aria-checked="true"]')?.dataset.id === "b"`, "ana's pick on ken's page");
  assert.match(await js(kenB, `document.querySelector("#q-q1 .who-chip").textContent`), /^ana/);
  assert.match(await js(anaB, `document.querySelector("#q-q1 .who-chip").textContent`), /^You/);
  // The answers are the same after a reload: they are the server's, not the browser's.
  await kenB.open(url, 1280, 900);
  await until(kenB, `document.querySelector('#q-q1 [aria-checked="true"]')`, "the shared answer after a reload");
  assert.deepEqual(await chosen(kenB, "q1"), ["b"]);

  // Where Ana is shows on her question for Ken.
  await js(anaB, `document.getElementById("q-q2").focus(), document.getElementById("q-q2").click(), null`);
  await until(kenB, `document.querySelector("#q-q2 .here-chips .here")?.textContent.startsWith("AN")`, "ana shown on q2");
  // Ken follows Ana: where she goes, his page goes.
  await click(kenB, ".avatars .avatar", "AN");
  await until(kenB, `document.querySelector(".q.cur")?.dataset.id === "q2"`, "ken taken to ana's question");
  await js(anaB, `document.getElementById("q-q1").focus(), document.getElementById("q-q1").click(), null`);
  await until(kenB, `document.querySelector(".q.cur")?.dataset.id === "q1"`, "ken following ana to q1");
  await click(kenB, ".avatars .avatar", "AN");

  // Ken writes a note on q2 while Ana picks q2: Ken's note is kept, and he is told.
  await click(kenB, "#q-q2 .opt", "A");
  await until(anaB, `document.querySelector('#q-q2 [aria-checked="true"]')?.dataset.id === "a"`, "ken's pick on ana's page");
  await js(kenB, `(() => { const add = [...document.querySelectorAll("#q-q2 .meta button")].find((b) => /Note/.test(b.textContent)); add?.click(); return null; })()`);
  await until(kenB, `document.querySelector("#q-q2 textarea")`, "ken's note box");
  await js(kenB, `(() => { const t = document.querySelector("#q-q2 textarea"); t.focus(); t.value = "mine"; t.dispatchEvent(new Event("input", { bubbles: true })); return null; })()`);
  // Ken's note is saved as he types; once it reaches Ana, she picks B while he is still in it.
  await until(anaB, `document.querySelector("#q-q2 textarea")?.value === "mine"`, "ken's note on ana's page");
  await click(anaB, "#q-q2 .opt", "B");
  await until(kenB, `!document.querySelector("#q-q2 .collab-conflict").hidden`, "the changed-under-you warning");
  // It waits for Ken to choose: his note is not saved over Ana's pick by itself.
  await new Promise((r) => setTimeout(r, 900));
  assert.equal(await js(kenB, `document.querySelector("#q-q2 .collab-conflict").hidden`), false);
  assert.deepEqual(await chosen(anaB, "q2"), ["b"]);
  // Send waits on the choice too.
  await click(kenB, "footer button", "Send");
  await until(kenB, `/Choose Use theirs or Keep mine/.test(document.querySelector(".status")?.textContent ?? "") || /Choose Use theirs/.test(document.body.textContent)`, "the send held for the choice");
  assert.match(await js(kenB, `document.querySelector("#q-q2 .collab-conflict").textContent`), /ana changed this answer/);
  await click(kenB, "#q-q2 .collab-conflict button", "Keep mine");
  await until(anaB, `document.querySelector('#q-q2 [aria-checked="true"]')?.dataset.id === "a"`, "ken's kept answer on ana's page");

  // Undo is shared too, as any change is: Ken takes back his note, and Ana's page loses it.
  await js(kenB, `document.activeElement?.blur(), null`);
  await js(kenB, `document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true })), null`);
  await until(anaB, `(document.querySelector("#q-q2 textarea")?.value ?? "") === ""`, "ken's undo on ana's page");
  assert.deepEqual(await chosen(anaB, "q2"), ["a"]);

  // Assigning: Ken gives q1 to Ana; her page says it is for her.
  await js(kenB, `(() => { const s = document.querySelector("#q-q1 .assign-pick"); s.value = "ana"; s.dispatchEvent(new Event("change", { bubbles: true })); return null; })()`);
  await until(anaB, `document.querySelector("#q-q1 .for-chip")?.textContent === "For you"`, "q1 for ana");

  // A thread line naming Ken reaches him.
  await click(anaB, "#q-q1 .talk-btn");
  await js(anaB, `(() => { const t = document.querySelector("#q-q1 .talk textarea"); t.value = "@ken is B right?"; return null; })()`);
  await click(anaB, "#q-q1 .talk button", "Post");
  await until(kenB, `document.querySelector("#q-q1 .talk-btn").textContent === "Discuss (1)"`, "the line on ken's page");
  assert.equal(await js(kenB, `document.querySelector("#q-q1 .talk-list .mention").textContent`), "@ken");

  // The ready check, and who sent it.
  await click(anaB, ".ready-btn");
  await until(kenB, `/Done: ana/.test(document.querySelector(".ready-line").textContent)`, "ana's part done on ken's page");
  await click(kenB, "footer .send, footer button", "Send");
  await until(anaB, `!document.querySelector(".sent-by").hidden`, "who sent it, on ana's page", 8000);
  assert.match(await js(anaB, `document.querySelector(".sent-by").textContent`), /Sent to the agent by ken/);
  const sent = await (await api("/__team/api/atlas/pick", { token: kenToken })).json();
  assert.equal(sent.state, "answered");
  assert.deepEqual(sent.answers.answers.q1, { choice: "b" });
  assert.equal(sent.answers.sent.by, "ken");
});

test("each page and the inbox say who asked it and the work it came from, and tell the asker when someone else sends it", async () => {
  const gimToken = await enroll(kenB, "gimyong", "developer");
  const andoxToken = await enroll(anaB, "andox", "designer");
  const root = mkdtempSync(join(scratch, "proj-"));
  const asker = { project: "atlas-nx", branch: "feat/login", worktree: "", session: "s1", commit: "1a2b3c4", repo: "https://github.com/acme/atlas-nx" };
  const publish = async (token, page, origin, from = asker) => {
    const { spec } = buildPage(root, join(root, ".cache/view"), page, KIT_KINDS, {}, { asker: from });
    assert.equal((await api(`/__team/api/atlas/${spec.id}`, { method: "PUT", token, body: { spec, pictures: {}, ...(origin ? { origin } : {}) } })).status, 200);
    return spec;
  };
  await publish(gimToken, { ...raw, id: "login", title: "Login layout" }, { pr: "41", prState: "open" });
  await publish(gimToken, { ...raw, id: "login-copy", title: "Login copy" });
  await publish(andoxToken, { ...raw, id: "icons", title: "Icons" }, undefined, { ...asker, branch: "feat/icons" });
  await api("/__team/api/atlas/login/waiting", { method: "POST", token: gimToken, body: { on: true, since: new Date(Date.now() - 25 * 60_000).toISOString() } });
  const url = `${origin}/atlas/ask/login/`;
  await Promise.all([kenB.open(url, 1280, 900), anaB.open(url, 1280, 900)]);

  // Andox sees who asked it, linked to the work: the branch, the pull request, and the commit.
  await until(anaB, `document.querySelector(".who .asker-btn")?.textContent === "gimyong"`, "who asked it");
  const links = await js(anaB, `[...document.querySelectorAll(".who a")].map((a) => [a.textContent, a.getAttribute("href")])`);
  assert.deepEqual(links.slice(0, 3), [["feat/login", "https://github.com/acme/atlas-nx/tree/feat/login"], ["PR #41 open", "https://github.com/acme/atlas-nx/pull/41"], ["1a2b3c4", "https://github.com/acme/atlas-nx/commit/1a2b3c4"]]);
  assert.equal(await js(kenB, `document.querySelector(".who .asker-btn").textContent`), "you");
  assert.match(await js(anaB, `document.querySelector(".who").textContent`), /^Asked by gimyong · atlas-nx · feat\/login · PR #41 open · 1a2b3c4 · All asks$/);
  // Whose agent waits, and the other open ask from the same branch.
  await until(anaB, `/gimyong's agent waiting · 25 min/.test(document.querySelector(".waitpill")?.textContent ?? "")`, "whose agent waits");
  await until(anaB, `/^1 more open ask from feat\\/login: Login copy$/.test(document.querySelector(".branch-asks:not([hidden])")?.textContent ?? "")`, "the other ask from this branch");
  // The asker's card: their other open asks, and a line to them.
  await click(anaB, ".who .asker-btn");
  await until(anaB, `[...document.querySelectorAll(".pop")].some((p) => /gimyong · developer/.test(p.textContent))`, "the asker's card");
  assert.match(await js(anaB, `[...document.querySelectorAll(".pop")].find((p) => /gimyong · developer/.test(p.textContent)).textContent`), /gimyong's other open asks[\s\S]*Login copy/);
  await click(anaB, ".pop button", "Message gimyong");
  await until(anaB, `document.activeElement?.value === "@gimyong "`, "a line to gimyong started");

  // The work merged: the page says so.
  await api("/__team/api/atlas/login/origin", { method: "POST", token: gimToken, body: { pr: "41", prState: "merged" } });
  await anaB.open(url, 1280, 900);
  await until(anaB, `!document.querySelector(".notice.stale")?.hidden`, "the merged work said");
  assert.match(await js(anaB, `document.querySelector(".notice.stale").textContent`), /The work this came from is merged: PR #41, as gimyong's kit saw it/);

  // Andox sends it; Gimyong, who asked, is told.
  await click(anaB, "#q-q1 .opt", "B");
  await click(anaB, "#q-q2 .opt", "A");
  await click(anaB, "footer button", "Send");
  await until(kenB, `/andox sent your ask/.test(document.querySelector(".toast")?.textContent ?? "")`, "gimyong told", 8000);

  // The inbox: who asked each, grouped by who asked, and only mine.
  await anaB.open(`${origin}/`, 1280, 900);
  await until(anaB, `document.querySelectorAll(".item-row").length >= 3`, "the inbox");
  const heads = await js(anaB, `[...document.querySelectorAll(".sess")].map((e) => e.textContent)`);
  assert.ok(heads.includes("Asked by gimyong") && heads.includes("Asked by andox"), JSON.stringify(heads));
  // Open asks come before answered ones, whoever asked them.
  const order = await js(anaB, `[...document.querySelectorAll(".item-row .title")].map((e) => e.textContent).filter((t) => ["Login layout", "Login copy", "Icons"].includes(t))`);
  assert.equal(order.at(-1), "Login layout", JSON.stringify(order));
  assert.match(await js(anaB, `[...document.querySelectorAll(".item-row")].find((a) => /Login layout/.test(a.textContent)).textContent`), /Asked by gimyong · feat\/login · PR #41 merged/);
  assert.ok(await js(anaB, `[...document.querySelectorAll(".item-row")].find((a) => /Login layout/.test(a.textContent)).classList.contains("stale")`));
  await js(anaB, `(() => { const s = document.querySelector('select[aria-label="Asked by"]'); s.value = "__me"; s.dispatchEvent(new Event("change")); return null; })()`);
  await until(anaB, `[...document.querySelectorAll(".item-row")].every((a) => /Asked by you/.test(a.textContent))`, "only andox's own asks");
});
