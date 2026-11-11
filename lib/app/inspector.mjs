// How `wf app` reaches the app's page: WebKit's remote inspector for the
// tauri kind, Chromium's debugging protocol for web, both through the one
// DevTools client in lib/browser/cdp.mjs. A page is { call, evaluate, on,
// close }; pages(s, loadState) gives the connection and what every command
// does with it: capture, settle, navigate.

import { channel, evaluate, openSocket, within } from "../browser/cdp.mjs";
import { sleep } from "../process.mjs";
import { appPage } from "./appsettings.mjs";
import { PAGE_TEXT, QUIET } from "./page.mjs";

/** The script that sends the page to an address: a hash change in place, or a path that loads. */
export function goScript(where) {
  if (where.startsWith("#")) return `location.hash = ${JSON.stringify(where)}`;
  if (where.startsWith("/")) return `location.assign(${JSON.stringify(where)})`;
  throw new Error(`go takes "#/route" or "/path", not ${JSON.stringify(where)}`);
}

/** The script that goes one page back in the window's history, as the browser's Back does. */
export const BACK_SCRIPT = "history.back()";

/**
 * Go one page back, as the browser's Back does, and return the settled page.
 * Fails when the address stays, as on the window's first page.
 */
export async function goBack(p, settle, pause = sleep) {
  const from = await p.evaluate("location.href");
  // A back to another document replaces the page, so the evaluation may not return; a thrown error still counts.
  await p.evaluate(BACK_SCRIPT).catch((error) => {
    if (/page threw/.test(error.message)) throw error;
  });
  await pause(300);
  const page = await settle(p);
  if (page.url === from) throw new Error("the page did not go back: nothing earlier in this window's history");
  return page;
}

/** The page tools for one app and instance; loadState gives the size a web page was last set to. */
export function pages(s, loadState) {
  async function socketPath() {
    const html = await (await fetch(`http://${s.inspector}/`)).text();
    const match = html.match(/\/socket\/\d+\/\d+\/WebPage/);
    if (!match) throw new Error("the app has no inspectable page yet");
    return match[0];
  }

  /** One connection to Chromium's page, for the web kind: the protocol directly, no target wrapper. */
  async function connectChromium() {
    const targets = await (await fetch(`http://127.0.0.1:${s.debugPort}/json/list`)).json();
    // Chromium can open pages of its own, such as a component's, so the app's page is the one on its exact origin.
    const target = appPage(targets, s.app.web.url);
    if (!target) throw new Error(`Chromium has no page open at ${new URL(s.app.web.url).origin}`);
    const ws = await openSocket(target.webSocketDebuggerUrl, { failed: "debugging connection failed", silent: "Chromium did not answer; the page may be hung (check mem)" });
    const page = channel((msg) => ws.send(JSON.stringify(msg)));
    ws.addEventListener("message", (event) => page.receive(JSON.parse(event.data)));
    // The window's frame takes part of Chromium's window size, so the page is set to the exact size each time.
    const [width, height] = loadState().size ?? s.size;
    await page.call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 768 });
    return { call: page.call, evaluate: (expression) => evaluate(page.call, expression, { awaitPromise: true }), on: page.on, close: () => ws.close() };
  }

  /** A picture of the window as PNG bytes, from whichever engine drives the page. */
  async function capture(p, width, height) {
    if (s.web) return Buffer.from((await p.call("Page.captureScreenshot", { format: "png" })).data, "base64");
    const { dataURL } = await p.call("Page.snapshotRect", { x: 0, y: 0, width, height, coordinateSystem: "Viewport" });
    return Buffer.from(dataURL.split(",")[1], "base64");
  }

  /** One connection to the page. Messages go through Target.sendMessageToTarget. */
  async function connect() {
    if (s.web) return connectChromium();
    const hung = "inspector did not answer; the page may be hung (check mem)";
    const ws = await openSocket(`ws://${s.inspector}${await socketPath()}`, { failed: "inspector connection failed", silent: hung });
    let target = null;
    let outer = 0;
    // Each call is wrapped for the page's target; the wrapper's own replies carry nothing.
    const page = channel((msg) => ws.send(JSON.stringify({ id: ++outer, method: "Target.sendMessageToTarget", params: { targetId: target, message: JSON.stringify(msg) } })));
    const ready = new Promise((resolveReady) => {
      ws.addEventListener("message", (event) => {
        const msg = JSON.parse(event.data);
        if (msg.method === "Target.targetCreated" && !target) {
          target = msg.params.targetInfo.targetId;
          resolveReady();
        } else if (msg.method === "Target.dispatchMessageFromTarget") page.receive(JSON.parse(msg.params.message));
      });
    });
    await within(ready, 5000, hung).catch((error) => {
      ws.close();
      throw error;
    });

    // WebKit says a throw with wasThrown, not exceptionDetails.
    async function evaluateWebKit(expression) {
      const result = await page.call("Runtime.evaluate", { expression, returnByValue: true });
      if (result.wasThrown) throw new Error(`page threw: ${result.result?.description ?? JSON.stringify(result.result)}`);
      return result.result?.value;
    }

    return { call: page.call, evaluate: evaluateWebKit, on: page.on, close: () => ws.close() };
  }

  async function withPage(fn) {
    const page = await connect();
    try {
      return await fn(page);
    } finally {
      page.close();
    }
  }

  // Wait until the page has not changed for 150 ms, after at least 250 ms so a
  // backend reply has time to land. At most 3 s.
  async function settle(page, max = 3000) {
    const began = Date.now();
    await page.evaluate(QUIET);
    await sleep(250);
    while (Date.now() - began < max) {
      if ((await page.evaluate(QUIET)) >= 150) break;
      await sleep(50);
    }
    return JSON.parse(await page.evaluate(PAGE_TEXT));
  }

  /** Send the page to a route: the Tauri kind changes the hash; the web kind also loads a path. */
  async function navigate(p, where) {
    if (!s.web) return p.evaluate(`location.hash = ${JSON.stringify(where.replace(/^#?/, "#"))}`);
    if (where.startsWith("#")) return p.evaluate(goScript(where));
    // A path load replaces the page, so the evaluation that started it may not return; a thrown error still counts.
    await p.evaluate(goScript(where)).catch((error) => {
      if (/page threw/.test(error.message)) throw error;
    });
    await sleep(300);
  }

  return { connect, withPage, capture, settle, navigate };
}
