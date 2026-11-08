// Headless Chromium over its debugging protocol, with no dependency. The frame
// checker and the annotator open frames through it.
//
//   const browser = await openChromium(root);
//   try { await browser.open(url, 1280, 800); await browser.evaluate("1 + 1"); }
//   finally { await browser.close(); }

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

/** Start Chromium with a throwaway profile under the project's .cache, and one page to drive. */
export async function openChromium(root) {
  mkdirSync(join(root, ".cache"), { recursive: true });
  const profile = mkdtempSync(join(root, ".cache", "chromium-check-"));
  const chrome = spawn(
    "chromium",
    ["--headless", "--disable-gpu", "--no-sandbox", "--hide-scrollbars", `--user-data-dir=${profile}`, "--remote-debugging-port=0", "about:blank"],
    { stdio: "ignore" },
  );
  let ws;
  const close = async () => {
    ws?.close();
    // Chromium can still be writing to its profile as it exits. Wait for it,
    // and retry the removal.
    const exited = new Promise((r) => chrome.once("exit", r));
    chrome.kill();
    await Promise.race([exited, new Promise((r) => setTimeout(r, 3000))]);
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  };
  try {
    // Chromium writes the port on the first line once it listens. Wait for a
    // whole line: a file read too early can be empty.
    const portFile = join(profile, "DevToolsActivePort");
    let port = "";
    for (let i = 0; i < 300 && !/^\d+\n/.test(port); i++) {
      await new Promise((r) => setTimeout(r, 100));
      if (existsSync(portFile)) port = readFileSync(portFile, "utf8");
    }
    port = port.split("\n")[0];
    if (!port) throw new Error("Chromium did not start its debugging port within 30 seconds.");
    const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
    ws = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((r) => ws.addEventListener("open", r, { once: true }));
    let id = 0;
    const waiting = new Map();
    const events = [];
    ws.addEventListener("message", (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id && waiting.has(msg.id)) {
        waiting.get(msg.id)(msg);
        waiting.delete(msg.id);
      } else if (msg.method) events.push(msg);
    });
    const call = (method, params = {}, sessionId) =>
      new Promise((res, rej) => {
        const n = ++id;
        waiting.set(n, (msg) => (msg.error ? rej(new Error(msg.error.message)) : res(msg.result)));
        ws.send(JSON.stringify({ id: n, method, params, sessionId }));
      });
    const { targetId } = await call("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await call("Target.attachToTarget", { targetId, flatten: true });
    await call("Page.enable", {}, sessionId);
    return {
      /** Load `url` in a window of this size, and wait for it to load. */
      async open(url, width, height) {
        await call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false }, sessionId);
        events.length = 0;
        await call("Page.navigate", { url }, sessionId);
        for (let i = 0; i < 100 && !events.some((e) => e.method === "Page.loadEventFired"); i++) {
          await new Promise((r) => setTimeout(r, 30));
        }
      },
      /** The value of an expression in the page. */
      async evaluate(expression) {
        const { result } = await call("Runtime.evaluate", { expression, returnByValue: true }, sessionId);
        return result.value;
      },
      close,
    };
  } catch (err) {
    await close();
    throw err;
  }
}
