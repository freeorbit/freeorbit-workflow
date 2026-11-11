// The Chromium flags every kit browser shares: wf app's driven window, wf
// try's window for a person, and wf design's headless frame checker. Each
// runs on a profile of its own, so it never meets the person's own browser.

/**
 * A profile of its own, no first-run or default-browser prompt, and the
 * sandbox off only where the system forbids it, such as a CI runner.
 */
export function profileFlags(profile, { sandbox = true } = {}) {
  return [...(sandbox ? [] : ["--no-sandbox"]), "--no-first-run", "--no-default-browser-check", `--user-data-dir=${profile}`];
}
