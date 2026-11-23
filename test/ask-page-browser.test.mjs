// The ask page's behaviour, in a real browser: each test builds a page,
// serves it from the kit's own server, opens it in headless Chromium through
// lib/browser, and does what a person does (keys, buttons, Send), then reads
// what the page shows and what the server received.
//
// Chromium is found as the design tools find it (lib/config/platform.mjs).
// Without one the tests fail, as the kit's design checks would: a skipped
// test proves nothing.

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { after, before, test } from "node:test";

import { askState, checkAnswers } from "../lib/ask/answers.mjs";
import { EXAMPLES } from "../lib/ask/index.mjs";
import { buildPage } from "../lib/ask/page.mjs";
import { placeholderPng } from "../lib/ask/placeholder.mjs";
import { openChromium } from "../lib/browser/headless.mjs";
import { DEFAULTS } from "../lib/config/defaults.mjs";
import { merge } from "../lib/config/config.mjs";
import { browserFor } from "../lib/config/platform.mjs";
import { KIT_KINDS } from "../lib/design/annotate.mjs";
import { answersPath } from "../lib/ask/store.mjs";
import { serve } from "../lib/view/serve.mjs";
import { projectKey } from "../lib/view/view.mjs";
import { markWaiting } from "../lib/view/waiting.mjs";
import { addAsk, moreOf, withMore } from "../lib/ask/more.mjs";

process.env.WF_ASK_NO_SERVER = "1";
process.env.WF_STATE_DIR ??= mkdtempSync(join(tmpdir(), "wf-page-state-"));
const example = (name, dir = "examples") => JSON.parse(readFileSync(join(EXAMPLES, "..", dir, `${name}.json`), "utf8"));

let browser;
const scratch = mkdtempSync(join(tmpdir(), "wf-page-browser-"));
const servers = [];
before(async () => {
  browser = await openChromium(scratch, browserFor(DEFAULTS));
});
after(async () => {
  await browser?.close();
  for (const s of servers) await s.close();
  // Chromium's helpers can still be writing as they exit; rmSync's retries leave the folder behind, rm's wait it out.
  await rm(scratch, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
});

/** Build `raw` in a project of its own, with a stand-in for each picture it names, serve it, and open it in a window of this size. */
async function openPage(raw, { before: prepare, width = 1280, height = 900, config = null, settings } = {}) {
  const root = mkdtempSync(join(scratch, "project-"));
  const walk = (v) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      if (typeof v.image === "string" && !existsSync(join(root, v.image))) {
        mkdirSync(dirname(join(root, v.image)), { recursive: true });
        writeFileSync(join(root, v.image), placeholderPng(basename(v.image)));
      }
      Object.values(v).forEach(walk);
    }
  };
  walk(raw);
  const view = join(root, ".cache/view");
  const built = buildPage(root, view, raw, KIT_KINDS, {}, config ? { ctx: { config } } : {});
  assert.deepEqual(built.problems ?? [], []);
  const { spec } = built;
  const key = projectKey(root);
  prepare?.({ view, spec });
  const project = { key, view, name: "demo", kinds: KIT_KINDS };
  const server = await serve({ resolve: (k) => (k === key ? project : null), list: () => [project], check: checkAnswers, stateOf: askState, moreOf, askMore: addAsk, specOf: withMore, port: 0, log: () => {}, ...(settings ? { settings } : {}) });
  servers.push(server);
  await browser.open(`http://127.0.0.1:${server.port}/${key}/ask/${spec.id}/`, width, height);
  await until("document.querySelector('footer.commit') !== null", "the page to build");
  return { spec, view, sent: () => JSON.parse(readFileSync(answersPath(view, spec.id), "utf8")) };
}

/** The value of `expression` in the page. */
const js = (expression) => browser.evaluate(expression);

/** Wait until `expression` is true in the page. */
async function until(expression, what, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await js(`Boolean(${expression})`)) return;
    await new Promise((r) => setTimeout(r, 40));
  }
  assert.fail(`timed out waiting for ${what}: ${expression}`);
}

/** Press a key where the focus is, as the keyboard would. */
const press = (key, { shift = false, ctrl = false } = {}) =>
  js(`(document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(key)}, shiftKey: ${shift}, ctrlKey: ${ctrl}, bubbles: true, cancelable: true })), null`);

/** Click the first element matching `selector`, or the one whose text includes `text`. */
const click = (selector, text = "") =>
  js(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => e.textContent.includes(${JSON.stringify(text)})); if (!el) throw new Error(${JSON.stringify(`nothing to click: ${selector} ${text}`)}); el.click(); return null; })()`);

/** The ids of a question's options the page shows as chosen. */
const chosen = (id) => js(`[...document.querySelectorAll('#q-${id} [aria-checked="true"]')].map((e) => e.dataset.id)`);
/** The question the page has as the current one. */
const current = () => js(`document.querySelector(".q.cur, tr.cur")?.dataset.id ?? null`);
/** Whether a question is on the page for the person to see. */
const shown = (id) => js(`(() => { const el = document.getElementById("q-${id}"); return Boolean(el) && !el.hidden && el.closest("[hidden]") === null && el.getClientRects().length > 0; })()`);

/** A list page of plain choices, each with a recommendation. */
const choices = (n = 3) => ({
  id: "keys",
  title: "Keys",
  questions: Array.from({ length: n }, (_, i) => ({
    id: `q${i + 1}`,
    text: `Question ${i + 1}?`,
    options: [{ id: "a", label: "A", why: "the first" }, { id: "b", label: "B", why: "the second" }, { id: "c", label: "C", why: "the third" }],
    recommended: "b",
    why: "b is the middle way",
  })),
});

test("R takes the current question's recommendation, and only its", async () => {
  await openPage(choices());
  assert.equal(await current(), "q1");
  await press("r");
  assert.deepEqual(await chosen("q1"), ["b"]);
  assert.deepEqual(await chosen("q2"), [], "the next question is left as it was");
});

test("R takes a table row's recommendation", async () => {
  const raw = example("testdata");
  raw.tables[0].rows[0].recommended = "wrong";
  const { spec } = await openPage(raw);
  const row = spec.questions[0].id;
  assert.equal(await current(), row);
  await press("r");
  await until(`document.querySelector('tr[data-id="${row}"] [aria-checked="true"]')`, "the row's verdict");
  assert.deepEqual(await js(`[...document.querySelectorAll('tr[data-id="${row}"] [aria-checked="true"]')].map((b) => b.dataset.id)`), ["wrong"]);
});

test("1 to 9 pick that option of the current question", async () => {
  await openPage(choices());
  await press("3");
  assert.deepEqual(await chosen("q1"), ["c"]);
  await press("1");
  assert.deepEqual(await chosen("q1"), ["a"], "a one-choice question holds one");
  assert.deepEqual(await chosen("q2"), []);
  await press("9");
  assert.deepEqual(await chosen("q1"), ["a"], "a number past the options picks nothing");
});

test("Enter moves to the next open question, past the answered ones, and to Send when none is open", async () => {
  await openPage(choices(4));
  await click("#q-q2 .opt", "B");
  await click("#q-q3 .opt", "A");
  await js(`document.querySelector("#q-q1").focus()`);
  assert.equal(await current(), "q1");
  await press("Enter");
  assert.equal(await current(), "q4", "q2 and q3 are answered");
  await press("2");
  await press("Enter");
  assert.equal(await current(), "q1", "it goes round to the first open one");
  await press("2");
  await press("Enter");
  await until(`document.activeElement?.matches("footer.commit .btn.primary")`, "Send to take the focus");
  assert.match(await js(`document.querySelector("footer.commit .btn.primary").textContent`), /^Send 4 answers/);
});

test("Take all recommendations answers every open question with its recommendation, and leaves the answered ones", async () => {
  await openPage(choices());
  await click("#q-q2 .opt", "C");
  assert.equal(await js(`document.querySelector("header .pill").textContent`), "1 of 3");
  await click("footer.commit .btn", "Take all recommendations");
  assert.deepEqual([await chosen("q1"), await chosen("q2"), await chosen("q3")], [["b"], ["c"], ["b"]]);
  assert.equal(await js(`document.querySelector("header .pill").textContent`), "3 of 3");
  assert.equal(await js(`[...document.querySelectorAll("footer.commit .btn")].find((b) => b.textContent.includes("Take all")).hidden`), true, "with nothing open, the button goes");
});

test("Shift+R takes every recommendation, as the button does", async () => {
  await openPage(choices());
  await press("R", { shift: true });
  assert.deepEqual([await chosen("q1"), await chosen("q2"), await chosen("q3")], [["b"], ["b"], ["b"]]);
});

test("Take all answers the follow-ups its answers bring into view, and leaves away one whose answer does not fit", async () => {
  const { sent } = await openPage(example("release", "answers"));
  assert.equal(await shown("confidence"), false, "a follow-up of Ship it waits for that answer");
  assert.equal(await shown("hold-why"), false);
  await click("footer.commit .btn", "Take all recommendations");
  assert.deepEqual(await chosen("ship"), ["yes"]);
  await until(`document.getElementById("q-confidence").getClientRects().length`, "the follow-up to show");
  assert.equal(await shown("hold-why"), false, "Hold a week was not the answer");
  await click("footer.commit .btn.primary");
  await until(`document.querySelector(".sendpanel")`, "the panel for what is still open");
  await click(".sendpanel label", "Leave it open");
  await click(".sendpanel .btn.primary");
  await until(`!document.querySelector(".receipt").hidden`, "the receipt");
  const { answers } = sent();
  assert.deepEqual(answers.confidence, { number: 4 }, "the follow-up took its own recommendation");
  assert.equal(answers["hold-why"], undefined);
});

test("a launch page's command row shows the picked run with its options' flags, and follows each answer", async () => {
  await openPage(example("launch"));
  const row = () => js(`document.querySelector("footer.commit .launchcmd").textContent`);
  assert.match(await row(), /^Pick a run/);
  assert.equal(await shown("show"), false, "the options wait for a run");
  await press("1");
  assert.match(await row(), /^Runs ?npx wf screens --light ?Copy$/, "an option left open counts as its recommendation");
  assert.equal(await shown("show"), true);
  await click("#q-show .opt", "On my screen");
  await click("#q-stress .opt", "Yes");
  await js(`(() => { const t = document.querySelector("#q-area textarea"); t.value = "uplink downlink"; t.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  assert.equal(await js(`document.querySelector(".launchcmd code").textContent`), "npx wf screens --light --show screen --wide --stress --area uplink downlink");
  await click("#q-run .opt", "Defer");
  assert.equal(await js(`document.querySelector(".launchcmd code").textContent`), "npx wf screens --defer", "the options for other runs drop out");
  await until(`!document.getElementById("q-show").getClientRects().length`, "the options to go");
});

test("Take all on a launch page takes the recommended run and each option it brings into view", async () => {
  const { sent } = await openPage(example("launch"));
  await press("R", { shift: true });
  assert.deepEqual([await chosen("run"), await chosen("show"), await chosen("stress")], [["deep"], ["set"], ["off"]]);
  assert.equal(await js(`document.querySelector(".launchcmd code").textContent`), "npx wf screens --deep");
  await press("Enter", { ctrl: true });
  await until(`document.querySelector(".sendpanel")`, "the panel for the open text option");
  await click(".sendpanel label", "Leave it open");
  await click(".sendpanel .btn.primary");
  await until(`!document.querySelector(".receipt").hidden`, "the receipt");
  assert.deepEqual(sent().answers, { run: { choice: "deep" }, show: { choice: "set" }, stress: { choice: "off" } });
});

test("Send posts the answers to the server, and the receipt says they arrived", async () => {
  const { spec, sent } = await openPage(choices());
  await press("R", { shift: true });
  await click("footer.commit .btn.primary");
  await until(`!document.querySelector(".receipt").hidden`, "the receipt");
  assert.equal(await js(`document.querySelector(".receipt h2").textContent`), "Sent to the agent");
  const record = sent();
  assert.equal(record.hash, spec.hash);
  assert.deepEqual(record.answers, { q1: { choice: "b" }, q2: { choice: "b" }, q3: { choice: "b" } });
  assert.match(await js(`document.querySelector("header .saved.on")?.textContent ?? ""`), /^Sent · /);
});

test("Send with questions open asks what they go as, and sends them as that", async () => {
  const { sent } = await openPage(choices());
  await press("2");
  await press("Enter", { ctrl: true });
  await until(`document.querySelector(".sendpanel")`, "the panel for open questions");
  assert.equal(await js(`document.querySelector(".sendpanel h3").textContent`), "2 questions are still open");
  await click(".sendpanel label", "Later");
  await click(".sendpanel .btn.primary");
  await until(`!document.querySelector(".receipt").hidden`, "the receipt");
  assert.deepEqual(sent().answers, { q1: { choice: "b" }, q2: { decide: "later" }, q3: { decide: "later" } });
});

test("the header says when an agent is waiting on the page, and for how long", async () => {
  const since = new Date(Date.now() - 3 * 60_000 - 5000).toISOString();
  await openPage(choices(), { before: ({ view, spec }) => markWaiting(view, spec.id, { since }) });
  await until(`!document.querySelector(".waitpill").hidden`, "the waiting pill");
  assert.equal(await js(`document.querySelector(".waitpill").textContent`), "Agent waiting · 3 min");
  assert.match(await js("document.title"), /^● /, "the tab's title carries a dot");
});

test("no pill when no agent waits on the page", async () => {
  await openPage(choices());
  // The inbox is read once the page is up; once it has been, the asks box shows.
  await until(`document.querySelector(".asks button")`, "the inbox to be read");
  assert.equal(await js(`document.querySelector(".waitpill").hidden`), true);
  assert.doesNotMatch(await js("document.title"), /^● /);
});

// --- layout: what the person sees where -------------------------------------------

/** A box's place on the screen. */
const rect = (selector) => js(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height }; })()`);
/** One computed style property of the first element matching `selector`. */
const style = (selector, prop, pseudo = null) => js(`getComputedStyle(document.querySelector(${JSON.stringify(selector)}), ${JSON.stringify(pseudo)}).getPropertyValue(${JSON.stringify(prop)})`);
/** Whether the page itself scrolls sideways. */
const pageScrollsSideways = () => js("document.documentElement.scrollWidth > document.documentElement.clientWidth");

/** A test-data page with many rows, one with a long rule, each recommending Fine. */
const manyRows = (n) => {
  const raw = example("testdata");
  raw.tables[0].rows = Array.from({ length: n }, (_, i) => ({ id: `R-${i + 1}`, cells: [i === 0 ? "A rule long enough to need more than one line in its column, ".repeat(4) : `Rule ${i + 1}`, "limit", "none"], recommended: "ok" }));
  return raw;
};

test("a long table scrolls in its own box with its header in view, its text wraps, and the page never scrolls sideways", async () => {
  await openPage(manyRows(60));
  assert.equal(await pageScrollsSideways(), false);
  const wrap = await rect(".table-wrap");
  assert.ok(wrap.height <= 0.7 * 900 + 1, `the box is at most 70% of the window: ${wrap.height}`);
  assert.equal(await js(`(() => { const w = document.querySelector(".table-wrap"); return w.scrollHeight > w.clientHeight; })()`), true);
  await js(`document.querySelector(".table-wrap").scrollTop = 600`);
  const head = await rect(".table-wrap thead th");
  assert.ok(Math.abs(head.top - wrap.top) <= 1, "the header stays at the top of the box");
  const cell = await rect(".table-wrap tbody tr td:nth-child(2)");
  const next = await rect(".table-wrap tbody tr:nth-child(2) td:nth-child(2)");
  assert.ok(cell.height > next.height * 1.5, "a long rule wraps onto more lines");
  assert.equal(await style(".table-wrap", "overscroll-behavior-y"), "auto", "at its end, the wheel goes on to scroll the page");
});

test("a table page takes the window's width, with no rail of row ids", async () => {
  await openPage(manyRows(3), { width: 1700 });
  assert.equal(await style("main.content", "max-width"), "1600px");
  assert.equal(await style("nav.rail", "display"), "none");
});

test("a table's filter shows the rows left, and its count says how many are answered", async () => {
  const { spec } = await openPage(manyRows(12));
  const [a, b, c] = spec.questions;
  const verdict = (q, id) => click(`tr[data-id="${q.id}"] [data-id="${id}"]`);
  await verdict(a, "ok");
  await verdict(b, "wrong");
  await verdict(c, "ok");
  assert.equal(await js(`document.querySelector(".t-count").textContent`), "3 of 12");
  assert.deepEqual(await js(`[...document.querySelectorAll("[data-filter]")].map((x) => x.textContent)`), ["All", "Open", "Not as recommended"]);
  const visible = () => js(`[...document.querySelectorAll("tbody tr[data-id]")].filter((tr) => tr.getClientRects().length).map((tr) => tr.dataset.id)`);
  await click(`[data-filter="open"]`);
  assert.deepEqual(await visible(), spec.questions.slice(3).map((q) => q.id));
  await click(`[data-filter="other"]`);
  assert.deepEqual(await visible(), [b, ...spec.questions.slice(3)].map((q) => q.id), "the plain agreements go");
  await click(`[data-filter="all"]`);
  assert.equal((await visible()).length, 12);
});

test("the receipt leads with the answers that differ and folds the plain agreements away", async () => {
  const { spec } = await openPage(manyRows(12));
  await press("R", { shift: true });
  await click(`tr[data-id="${spec.questions[2].id}"] [data-id="wrong"]`);
  await click("footer.commit .btn.primary");
  await until(`!document.querySelector(".receipt").hidden`, "the receipt");
  assert.equal(await js(`document.querySelectorAll(".receipt > ol > li").length`), 1, "only the one that differs is listed first");
  assert.match(await js(`document.querySelector(".receipt > ol > li").textContent`), /^3\. /);
  assert.equal(await js(`document.querySelector(".receipt details.agreed summary").textContent`), "11 as recommended");
  assert.equal(await js(`document.querySelector(".receipt details.agreed").open`), false);
});

test("the receipt lists every answer when few are plain agreements", async () => {
  await openPage(choices());
  await press("R", { shift: true });
  await click("footer.commit .btn.primary");
  await until(`!document.querySelector(".receipt").hidden`, "the receipt");
  assert.equal(await js(`document.querySelectorAll(".receipt > ol > li").length`), 3);
  assert.equal(await js(`document.querySelector(".receipt details.agreed")`), null);
});

test("options with nothing to describe sit in one row; described ones stack", async () => {
  await openPage(example("plan"));
  const tops = (id) => js(`[...document.querySelectorAll("#q-${id} .opt")].map((o) => Math.round(o.getBoundingClientRect().top))`);
  const [one, two] = await tops("step-1");
  assert.equal(one, two, "a plan's verdicts share a row");
  await openPage(example("decision"));
  const [first, second] = await tops("layout");
  assert.ok(second > first, "a decision's options each say what they mean, so they stack");
});

test("options three questions share are described once above them, and each question's sit in a row", async () => {
  const raw = example("triage");
  raw.items.push({ ...raw.items[1], id: "Q-040" });
  await openPage(raw);
  assert.deepEqual(await js(`[...document.querySelectorAll("dl.legend dt")].map((d) => d.textContent)`), ["Answer it now", "Keep it open", "Drop it"]);
  const tops = await js(`[...document.querySelectorAll("#q-Q-031 .opt")].map((o) => Math.round(o.getBoundingClientRect().top))`);
  assert.equal(new Set(tops).size, 1);
});

test("Select all and the fold buttons show from four questions up", async () => {
  await openPage(choices(3));
  assert.equal(await js(`document.querySelector(".toolbar").getClientRects().length`), 0);
  await openPage(choices(4));
  assert.ok(await js(`document.querySelector(".toolbar").getClientRects().length`));
  assert.deepEqual(await js(`[...document.querySelectorAll(".toolbar [data-fold]")].map((b) => b.textContent)`), ["Expand all", "Fold answered", "Collapse all"]);
});

test("the first Tab goes to the current question's answer, not through the header", async () => {
  await openPage(choices());
  await js(`document.activeElement.blur()`);
  assert.equal(await js("document.activeElement === document.body"), true);
  await press("Tab");
  assert.equal(await js(`document.activeElement.closest(".q")?.dataset.id ?? document.activeElement.tagName`), "q1");
  assert.equal(await js(`document.activeElement.classList.contains("opt")`), true);
});

test("a select box takes a click a few pixels around it", async () => {
  await openPage(manyRows(3));
  const box = await rect("thead .sel");
  const hit = await js(`document.elementFromPoint(${box.left - 5}, ${box.top + box.height / 2})?.matches("thead .sel")`);
  assert.equal(hit, true);
  assert.ok(box.width + 14 >= 28, "with the edge, the target is near 30 px");
});

test("the asks box's buttons are big enough to hit", async () => {
  await openPage(choices());
  await until(`document.querySelector(".asks button")`, "the asks box");
  const b = await rect(".asks button");
  assert.equal(b.height, 26);
  assert.ok(b.width >= 28);
});

test("form fields and added words take the theme's colours", async () => {
  await openPage(example("release", "answers"));
  await click("footer.commit .btn", "Take all recommendations");
  // A probe styled with the theme's own tokens says what each resolves to.
  const token = (prop, value) => js(`(() => { const p = document.createElement("div"); p.style.setProperty(${JSON.stringify(prop)}, ${JSON.stringify(value)}); p.style.borderStyle = "solid"; document.body.append(p); const v = getComputedStyle(p).getPropertyValue(${JSON.stringify(prop)}); p.remove(); return v; })()`);
  for (const field of ['.form input[type="number"]', '.form input[type="date"]', ".form select"]) {
    assert.equal(await style(field, "border-top-color"), await token("border-top-color", "var(--line-2)"), field);
    assert.equal(await style(field, "background-color"), await token("background-color", "var(--panel)"), field);
    assert.equal(await style(field, "color"), await token("color", "var(--text)"), field);
  }
  assert.ok(await js(`document.querySelector("ins.d-add")`), "the edits show their added words");
  assert.equal(await style("ins.d-add", "color"), await token("color", "var(--text)"), "added words read as text");
});

// --- pictures ------------------------------------------------------------------------

test("a compare's bar is one row of controls, and its sizes sit with the view's note", async () => {
  await openPage(example("compare"));
  const bar = "#q-accounts-wide .vbar";
  assert.deepEqual(await js(`[...document.querySelectorAll("${bar} > :not(.grow):not([hidden])")].map((e) => e.getAttribute("aria-label") ?? e.textContent.replace(/[A-Z]$/, ""))`), ["How to compare", "How much of Frame shows", "Zoom", "Comment", "Expand"]);
  const tops = await js(`[...document.querySelectorAll("${bar} > :not([hidden])")].map((e) => Math.round(e.getBoundingClientRect().top + e.getBoundingClientRect().height / 2))`);
  assert.ok(Math.max(...tops) - Math.min(...tops) <= 2, "one row");
  assert.equal(await js(`document.querySelector("${bar} .size")`), null, "no sizes in the bar");
  assert.match(await js(`document.querySelector("#q-accounts-wide .view-line .size").textContent`), /^960×600/);
  assert.doesNotMatch(await js("document.body.innerText"), /Comment \(side by side\)/);
});

test("past Fit, a swipe is as wide as its picture and scrolls in its box, so the line and the cut agree; the page never scrolls sideways", async () => {
  await openPage(example("compare"));
  const over = "#q-accounts-wide .over.swipe";
  const fit = await rect(over);
  assert.ok(fit.width <= (await rect("#q-accounts-wide .stage-wrap")).width + 1, "at Fit, it fits its box");
  await js(`(() => { const s = document.querySelector("#q-accounts-wide select.zoom"); s.value = "2"; s.dispatchEvent(new Event("change")); })()`);
  const wide = await rect(over);
  const picture = await rect(`${over} .stage:not(.top)`);
  assert.equal(Math.round(wide.width), 1920, "200% of a 960 px picture");
  assert.equal(Math.round(wide.width), Math.round(picture.width), "the overlay is exactly as wide as its picture");
  assert.equal(await js(`(() => { const b = document.querySelector("#q-accounts-wide .stage-wrap"); return b.scrollWidth > b.clientWidth; })()`), true, "the box scrolls");
  assert.equal(await pageScrollsSideways(), false, "a question's column never takes its content's width");
});

test("one picture's label and size are its bar, with no caption under it", async () => {
  await openPage(example("decision"));
  assert.equal(await js(`document.querySelector("#q-layout figcaption")`), null);
  assert.match(await js(`document.querySelector("#q-layout .vbar").textContent`), /^Aaccounts frame960×600/);
});

test("F expands the pictures over the header and footer, the keys still answer there, and Expand goes with the frame", async () => {
  const { spec } = await openPage(example("frame-review"));
  const [first, second] = spec.questions;
  const before = await rect(`#q-${first.id} .stage`);
  await press("f");
  await until(`document.querySelector("dialog.viewer-room")?.open`, "the expanded viewer");
  assert.equal(await js(`document.querySelector("dialog.viewer-room").matches(":modal")`), true, "a modal, above the page's header and footer");
  const room = await rect("dialog.viewer-room");
  const big = await rect(`dialog.viewer-room .stage`);
  assert.ok(big.height > before.height && big.bottom <= room.bottom + 1, "Fit uses the expanded viewer's height");
  await press("1");
  assert.deepEqual(await js(`[...document.querySelectorAll('dialog.viewer-room [aria-checked="true"]')].map((b) => b.dataset.id)`), ["ok"], "a verdict key answers while expanded");
  await until(`document.querySelector("dialog.viewer-room #q-${second.id}, dialog.viewer-room .viewer") && document.querySelector(".q.cur")?.dataset.id === "${second.id}"`, "the next frame");
  assert.equal(await js(`document.getElementById("q-${second.id}").querySelector(".viewer")?.closest("dialog.viewer-room") !== null`), true, "the next frame opens expanded too");
  await press("f");
  await until(`!document.querySelector("dialog.viewer-room")`, "Expand to close");
});

test("a review's verdicts stay in view above the footer, and under the picture on a narrow window", async () => {
  await openPage(example("frame-review"), { height: 520 });
  const verdicts = (id) => rect(`#q-${id} .verdicts`);
  const footer = await rect("footer.commit");
  const v = await verdicts("accounts-wide");
  assert.ok(v.bottom <= footer.top + 1 && v.bottom > 0, `the verdicts sit above the footer: ${v.bottom} <= ${footer.top}`);
  assert.ok(v.top < (await rect("#q-accounts-wide .stage")).bottom, "over the picture's lower edge, while the picture scrolls");
  await openPage(example("frame-review"), { width: 680, height: 520 });
  const narrow = await verdicts("accounts-wide");
  assert.ok(narrow.top >= (await rect("#q-accounts-wide .stage")).bottom - 1, "under the picture, never over it");
});

test("a page with a picture takes the window's width; on a wide window the picture sits beside the answer, and text keeps its reading width", async () => {
  await openPage(example("decision"), { width: 1280, height: 900 });
  const pic = await rect("#q-layout .stage");
  assert.ok(pic.height <= Math.max(0.36 * 900, 260) + 1, `a picture beside an answer leaves the answer on screen: ${pic.height}`);
  await openPage(example("decision"), { width: 1700, height: 900 });
  const viewer = await rect("#q-layout .viewer");
  const opts = await rect("#q-layout .opts");
  assert.ok(opts.left >= viewer.right - 1 || viewer.left >= opts.right - 1, "side by side");
  assert.ok(Math.abs(viewer.top - opts.top) < viewer.height, "on the same rows");
  assert.ok(opts.width <= 780, `the answer keeps the reading width: ${opts.width}`);
  assert.ok((await rect(".shell")).width > 1280, "the page is wider than a page of plain questions");
  const head = await rect("#q-layout .q-head");
  assert.ok(head.width > 780, "a long question stays on one line above its picture");
  await openPage(choices(), { width: 1700, height: 900 });
  assert.ok((await rect(".shell")).width <= 1280, "a page of plain questions keeps its column");
});

test("a review's page takes the window's width", async () => {
  await openPage(example("frame-review"), { width: 2400, height: 900 });
  assert.equal(await style("main.content", "max-width"), "2080px");
});

/** A team of two, so Later lists who each role is. */
const TEAM = merge(DEFAULTS, { team: "small", people: [{ name: "Ken", roles: ["owner", "developer", "reviewer"] }, { name: "Sam", roles: ["designer"] }] });
const laterPage = () => ({
  id: "later-demo",
  title: "Empty states",
  template: "decision",
  questions: [
    { id: "copy", text: "What does the list say with no accounts?", role: "designer", options: [{ id: "short", label: "No accounts yet", why: "Plain" }, { id: "cta", label: "Add your first", why: "Leads on" }], recommended: "cta", why: "It says what to do." },
    { id: "icon", text: "Show an icon?", role: "developer:frontend", options: [{ id: "yes", label: "Yes", why: "Friendlier" }, { id: "no", label: "No", why: "Calmer" }], recommended: "no", why: "The text is enough." },
    { id: "name", text: "What do we call the empty state?", type: "text" },
  ],
});
const forPick = (id) => `document.querySelector("#q-${id} .later-for")`;

test("Later shows who it is for, from the team, starting on the question's role, and an answer after takes it back", async () => {
  const { sent } = await openPage(laterPage(), { config: TEAM });
  assert.equal(await js(`${forPick("copy")}.hidden`), true, "no For until Later");
  await click("#q-copy .meta button", "Later");
  assert.equal(await js(`${forPick("copy")}.hidden`), false);
  assert.equal(await js(`${forPick("copy")}.querySelector("select").value`), "designer");
  assert.deepEqual(await js(`[...${forPick("copy")}.querySelectorAll("option")].map((o) => o.textContent)`), ["owner (Ken)", "designer (Sam)", "developer (Ken)", "reviewer (Ken)", "client"]);
  // A specialty the team list does not name on its own is still there to pick, and picked.
  await click("#q-icon .meta button", "Later");
  assert.equal(await js(`${forPick("icon")}.querySelector("select").value`), "developer:frontend");
  await js(`(() => { const s = ${forPick("copy")}.querySelector("select"); s.value = "client"; s.dispatchEvent(new Event("change", { bubbles: true })); return null; })()`);
  // Picking an option after Later takes back Later and who it was for, so Send is not refused.
  await click("#q-icon [data-id='yes']");
  assert.equal(await js(`${forPick("icon")}.hidden`), true);
  // Typing an answer after Later takes it back the same way.
  await click("#q-name .meta button", "Later");
  await js(`(() => { const a = document.querySelector("#q-name textarea"); a.value = "Nothing here"; a.dispatchEvent(new Event("input", { bubbles: true })); return null; })()`);
  await click("footer.commit .btn.primary");
  await until(`!document.querySelector(".receipt").hidden`, "the receipt");
  assert.deepEqual(sent().answers, { copy: { decide: "later", for: "client" }, icon: { choice: "yes" }, name: { text: "Nothing here" } });
});

test("a page sends the server only the settings that changed, and nothing when it opens with what the server has", async () => {
  const writes = [];
  let kept = { "wf-ask:look": { theme: "", mode: "auto", density: "comfortable", size: "m", accent: "teal", advance: true, sep: "sections", motion: "system", fold: "none", zoom: "fit", compare: "swipe" }, "wf-ask:inbox": { project: "a" } };
  const settings = { read: () => kept, write: (changed) => { writes.push(changed); kept = { ...kept, ...changed }; return kept; } };
  await openPage(choices(), { settings });
  assert.equal(await js(`window.wfLook.look.accent`), "teal", "the server's look wins");
  await new Promise((r) => setTimeout(r, 700));
  assert.deepEqual(writes, [], "opening the page changes nothing");
  await js(`window.wfLook.remember({ density: "compact" }), null`);
  await until(`true`, "");
  await new Promise((r) => setTimeout(r, 700));
  assert.equal(writes.length, 1);
  assert.deepEqual(Object.keys(writes[0]), ["wf-ask:look"], "only the look, so another tab's inbox filters stay");
  assert.equal(writes[0]["wf-ask:look"].density, "compact");
  assert.deepEqual(kept["wf-ask:inbox"], { project: "a" });
});

// --- a note that is the answer, and asking the agent for more -------------------------

const agentWaits = ({ view, spec }) => markWaiting(view, spec.id);
/** Type `text` into the field matching `selector`, as a person does. */
const type = (selector, text) => js(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error("no field ${selector.replace(/"/g, "'")}"); el.value = ${JSON.stringify(text)}; el.dispatchEvent(new Event("input", { bubbles: true })); return null; })()`);

test("a note alone answers its question: it is counted, sent with no panel, and the receipt says the note is the answer", async () => {
  const { sent } = await openPage(choices(2));
  await press("2");
  await click("#q-q2 .meta button", "Note");
  await type("#q-q2 .note textarea", "Neither: keep the old layout.");
  await until(`document.querySelector("header .pill").textContent === "2 of 2"`, "the note to count");
  await press("Enter", { ctrl: true });
  await until(`!document.querySelector(".receipt").hidden`, "the receipt, with no panel first");
  assert.equal(await js(`document.querySelector(".sendpanel")`), null);
  assert.equal(await js(`document.querySelector(".receipt h2").textContent`), "Sent to the agent");
  assert.match(await js(`document.querySelector(".receipt").textContent`), /In the note: “Neither: keep the old layout\.”/);
  const record = sent();
  assert.deepEqual(record.answers.q2, { note: "Neither: keep the old layout." });
  assert.deepEqual(record.inNote, ["q2"]);
});

test("Ask for more asks the agent in place; its reply shows under the question, code and all, with the draft kept", async () => {
  // An agent waits on the page, so the page reads the reply soon after it is written.
  const { view, spec } = await openPage(choices(2), { before: agentWaits });
  await press("2");
  await until(`!document.querySelector(".waitpill").hidden`, "the page to know an agent waits");
  await click("#q-q2 .more-btn", "Ask for more");
  await click("#q-q2 .more-box .chip-btn", "Show an example");
  await click("#q-q2 .more-box .btn.primary", "Ask");
  await until(`document.querySelector("#q-q2 .more-thread .ask")`, "the ask under the question");
  assert.match(await js(`document.querySelector("#q-q2 .more-thread").textContent`), /Show an example.*Waiting for the agent/s);
  const { readAsks, addMore, moreBlocks } = await import("../lib/ask/more.mjs");
  assert.equal(readAsks(view, spec.id).q2[0].text, "Show an example");
  addMore(view, spec, "q2", moreBlocks({ md: "Like this:\n\n```js:41\nconst a = 1;\nconst b = 2;\n```" }, {}));
  await until(`document.querySelector("#q-q2 .more-reply .code-view")`, "the agent's reply", 8000);
  assert.equal(await js(`document.querySelector("#q-q2 .code-view .code-lang").textContent`), "js");
  assert.deepEqual(await js(`[...document.querySelectorAll("#q-q2 .code-view .ln")].map((e) => e.textContent)`), ["41", "42"]);
  assert.equal(await js(`/Waiting for the agent/.test(document.querySelector("#q-q2 .more-thread").textContent)`), false, "answered");
  assert.deepEqual(await chosen("q1"), ["b"], "the answers given stay");
});

test("a proposed option comes back as one to pick, and is sent", async () => {
  const { view, spec, sent } = await openPage(choices(1), { before: agentWaits });
  await until(`!document.querySelector(".waitpill").hidden`, "the page to know an agent waits");
  await click("#q-q1 .more-btn", "Ask for more");
  await click("#q-q1 .more-box .more-kind button", "Propose an option");
  await type("#q-q1 .more-box textarea", "Both, behind a setting");
  await click("#q-q1 .more-box .btn.primary", "Ask");
  const { readAsks, addMore } = await import("../lib/ask/more.mjs");
  await until(`document.querySelector("#q-q1 .more-thread .ask")`, "the ask");
  assert.equal(readAsks(view, spec.id).q1[0].kind, "option");
  addMore(view, spec, "q1", { options: [{ id: "both", label: "Both", why: "Behind a setting." }] });
  await until(`document.querySelector('#q-q1 [data-id="both"]')`, "the added option", 8000);
  assert.match(await js(`document.querySelector('#q-q1 [data-id="both"]').textContent`), /Added/);
  await click(`#q-q1 [data-id="both"]`);
  await press("Enter", { ctrl: true });
  await until(`!document.querySelector(".receipt").hidden`, "the receipt");
  assert.deepEqual(sent().answers, { q1: { choice: "both" } });
});

test("details written at build fold under the question, a code block shows its lines, and Explain this page asks about the page", async () => {
  const raw = { ...choices(1), more: [{ type: "text", text: "Why this page." }], blocks: [{ type: "code", title: "The loop", code: "for (;;) {\n  tick();\n}", lang: "js", start: 7, mark: [8] }, { type: "questions" }] };
  raw.questions[0].more = [{ type: "text", text: "The long story." }];
  const { view, spec } = await openPage(raw, { before: agentWaits });
  await until(`!document.querySelector(".waitpill").hidden`, "the page to know an agent waits");
  assert.equal(await js(`document.querySelector("#q-q1 details.more-pre > summary").textContent`), "Details");
  assert.equal(await js(`document.querySelector("#q-q1 details.more-pre").open`), false);
  await click("#q-q1 details.more-pre > summary");
  assert.match(await js(`document.querySelector("#q-q1 details.more-pre").textContent`), /The long story\./);
  assert.deepEqual(await js(`[...document.querySelectorAll(".block-code .ln")].map((e) => e.textContent)`), ["7", "8", "9"]);
  assert.deepEqual(await js(`[...document.querySelectorAll(".block-code .code-line")].map((e) => e.classList.contains("mark"))`), [false, true, false]);
  assert.ok(await js(`[...document.querySelectorAll(".block-code .code-head button")].some((b) => b.textContent === "Copy")`));
  await click("header .page-more-btn", "Explain this page");
  assert.match(await js(`document.querySelector(".page-more").textContent`), /Why this page\./, "the page's own details show first");
  await type(".page-more .more-box textarea", "Why now?");
  await click(".page-more .more-box .btn.primary", "Ask");
  const { readAsks, addMore, PAGE } = await import("../lib/ask/more.mjs");
  await until(`document.querySelector(".page-more .more-thread .ask")`, "the ask about the page");
  assert.equal(readAsks(view, spec.id)[PAGE][0].text, "Why now?");
  addMore(view, spec, PAGE, { blocks: [{ type: "text", title: "", note: "", id: "", source: "The release is close.", nodes: [{ k: "p", spans: [{ t: "text", s: "The release is close." }] }] }] });
  await until(`/The release is close/.test(document.querySelector(".page-more .more-reply")?.textContent ?? "")`, "the reply about the page", 8000);
});
