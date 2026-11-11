// Waiting for a page that has rendered and stays, after an app starts: a
// debug build may rewrite generated code at launch, which makes the dev
// server reload the page once.

import { sleep } from "../process.mjs";

/**
 * Read the page every `every` ms, up to `tries` times, until it has text and
 * reads the same twice running. `alive` throws when the app has exited; a
 * read that fails, such as before the page exists, starts the count again.
 * Resolves with the page, or null when it never settled.
 */
export async function waitForStablePage(read, { alive = () => {}, tries = 60, every = 500 } = {}) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    await sleep(every);
    alive();
    try {
      const page = await read();
      if (page.text.trim() && last && page.text === last.text && page.url === last.url) return page;
      last = page;
    } catch {
      last = null;
    }
  }
  return null;
}
