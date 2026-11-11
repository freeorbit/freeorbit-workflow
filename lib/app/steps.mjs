// `wf app run`: several steps in one call, on one connection. Each step is
// one argument:
//
//   run 'go #/catalog' 'click "Install"' 'expect Installed' 'shot /tmp/a.png'
//
// It prints one line per step and stops at the first failure, with the page
// text for context. Nothing else is printed unless a step asks for it. Each
// verb is an entry in VERBS; one that prints its own line returns SAID.

import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { clickTarget } from "./clickTarget.mjs";
import { shotPath, viewport } from "./appsettings.mjs";
import { goBack } from "./inspector.mjs";
import { evalSource, FIND, FITS, PAGE_TEXT, SET, words } from "./page.mjs";
import { stitchPage } from "./stitch.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** What a verb returns when it printed its own line, so no "ok" line follows. */
const SAID = "said";

export const USAGE = `usage: run 'go #/catalog' 'click Install' 'expect Installed'
  steps: go <#hash | /path> · back · size <name | WxH> · click <label> [in <group>] · type <label> <value> · expect <text> · until <text> · show <text> · absent <text>
         lines <text> · text · url · eval <js> · wait <ms> · shot [file] · page <file> · fits`;

const windowSize = async (p) => JSON.parse(await p.evaluate("JSON.stringify([innerWidth, innerHeight])"));

/** Scroll the first element whose own text is `want` to the top of its scrolling box. */
const SHOW = (want) => `(() => {
                  const want = ${JSON.stringify(want)}.toLowerCase();
                  const reads = (e) => e.textContent.trim().toLowerCase() === want;
                  // The innermost element that reads it, in the page before the sidebar and the panel.
                  const scope = document.querySelector("main") ?? document.body;
                  const hit = [...scope.querySelectorAll("*")].find((e) => reads(e) && ![...e.children].some(reads));
                  if (!hit) return false;
                  hit.scrollIntoView({ block: "start" });
                  return true;
                })()`;

/**
 * The verbs. Each gets c: the page p, the step's words after the verb in
 * rest, the whole step, its tag and index, the driver's wiring in d, the
 * current page text in c.page (null when stale), and current() to read it.
 */
const VERBS = {
  async go(c) {
    await c.d.navigate(c.p, c.rest[0] ?? "");
    c.page = await c.d.settle(c.p);
  },
  async back(c) {
    c.page = await goBack(c.p, c.d.settle);
  },
  async click(c) {
    const { label, within } = clickTarget(c.rest);
    const found = await c.p.evaluate(`(() => { const n = ${FIND(label, within)}; if (!n) return false; n.click(); return true; })()`);
    if (!found) throw new Error(`nothing clickable with text "${label}"${within ? ` in ${within}` : ""}`);
    c.page = await c.d.settle(c.p);
  },
  async type(c) {
    if (!(await c.p.evaluate(SET(c.rest[0] ?? "", c.rest[1] ?? "")))) throw new Error(`no field labelled "${c.rest[0]}"`);
    c.page = await c.d.settle(c.p);
  },
  async expect(c) {
    const want = c.rest.join(" ");
    if (!(await c.current()).text.includes(want)) throw new Error(`"${want}" is not on the page`);
  },
  async until(c) {
    // Waits up to 10 s for text that comes later, such as a model's answer.
    const want = c.rest.join(" ");
    const end = Date.now() + 10_000;
    while (!(c.page = JSON.parse(await c.p.evaluate(PAGE_TEXT))).text.includes(want)) {
      if (Date.now() > end) throw new Error(`"${want}" did not show in 10 s`);
      await sleep(100);
    }
    c.page = await c.d.settle(c.p);
  },
  async show(c) {
    const want = c.rest.join(" ");
    if (!(await c.p.evaluate(SHOW(want)))) throw new Error(`nothing reads "${want}"`);
    c.page = await c.d.settle(c.p);
  },
  async absent(c) {
    const want = c.rest.join(" ");
    if ((await c.current()).text.includes(want)) throw new Error(`"${want}" is on the page`);
  },
  async lines(c) {
    const want = c.rest.join(" ").toLowerCase();
    const hits = (await c.current()).text.split("\n").filter((l) => l.toLowerCase().includes(want));
    console.log(`${c.tag}\n${hits.map((l) => `   ${l}`).join("\n") || "   (no lines)"}`);
    return SAID;
  },
  async text(c) {
    console.log(`${c.tag}\n${(await c.current()).text}`);
    return SAID;
  },
  async url(c) {
    console.log(`${c.tag}: ${(await c.current()).url}`);
    return SAID;
  },
  async eval(c) {
    const value = await c.p.evaluate(evalSource(c.step));
    console.log(`${c.tag}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
    c.page = null;
    return SAID;
  },
  async wait(c) {
    await sleep(Number(c.rest[0] ?? 500));
    c.page = null;
  },
  async shot(c) {
    const out = shotPath(c.d.s, c.rest[0] ?? join(c.d.s.state, `step-${c.n + 1}.png`));
    const size = await windowSize(c.p);
    writeFileSync(out, await c.d.capture(c.p, size[0], size[1]));
    console.log(`${c.tag}: saved ${out} (${size[0]}x${size[1]})`);
    return SAID;
  },
  async size(c) {
    // A website is checked at several widths in one run, such as desktop then mobile.
    if (!c.d.s.web) throw new Error("size is for the web kind; start a Tauri app with --size");
    const [width, height] = viewport(c.d.s.app, c.rest[0]);
    await c.p.call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 768 });
    c.d.saveState({ ...c.d.loadState(), size: [width, height] });
    c.page = await c.d.settle(c.p);
  },
  async page(c) {
    if (!c.rest[0]) throw new Error("usage: page <file.png>");
    const out = shotPath(c.d.s, c.rest[0]);
    if (c.d.s.web) {
      // Chromium draws the whole document at once, beyond the window, so nothing is stitched.
      const { data } = await c.p.call("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
      writeFileSync(out, Buffer.from(data, "base64"));
      console.log(`${c.tag}: saved ${out} (the whole page)`);
    } else {
      const windows = await stitchPage(c.p, out, c.d.capture, c.d.sh);
      console.log(`${c.tag}: saved ${out} (${windows} windows)`);
    }
    c.page = null;
    return SAID;
  },
  async fits(c) {
    const wide = JSON.parse(await c.p.evaluate(FITS));
    if (wide.length) throw new Error(`wider than the window: ${wide.join("; ")}`);
  },
};
VERBS.set = VERBS.type;

/** Run the steps on page p, with the driver's wiring d. Sets process.exitCode on the first failure. */
export async function runSteps(p, steps, d) {
  const c = { p, d, page: null };
  c.current = async () => (c.page ??= JSON.parse(await p.evaluate(PAGE_TEXT)));
  for (const [n, step] of steps.entries()) {
    const [verb, ...rest] = words(step);
    const tag = `${n + 1}. ${step}`;
    Object.assign(c, { n, step, rest, tag });
    try {
      const run = Object.hasOwn(VERBS, verb) ? VERBS[verb] : null;
      if (!run) throw new Error(`no step "${verb}"`);
      if ((await run(c)) !== SAID) console.log(`ok ${tag}`);
    } catch (err) {
      console.log(`FAIL ${tag}: ${err.message}`);
      const now = await c.current().catch(() => null);
      if (now) console.log(`url: ${now.url}\n---\n${now.text.split("\n").slice(0, 40).join("\n")}`);
      process.exitCode = 1;
      return;
    }
  }
  console.log(`url: ${(await c.current()).url}`);
}
