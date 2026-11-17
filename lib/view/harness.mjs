// Which agent harness runs this command, so an ask page opens where the
// person looks: Claude's desktop app has its own browser pane, Orca has a
// browser tab per worktree, and a plain terminal has the system's browser.
//
// Orca is known by the variables it sets in its terminals. Outside them a
// bare `orca` is never run: on Linux it is often GNOME's screen reader.

import { execFile, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

/** Where an ask page opens: auto picks by the harness; the others force one. */
export const OPEN_CHOICES = {
  auto: "Orca's browser tab in Orca, the browser pane in Claude's desktop app, else the system's browser",
  pane: "the agent opens it in Claude's desktop app's browser pane",
  orca: "a tab in Orca's built-in browser, for this worktree",
  system: "the system's default browser",
  print: "nothing opens; the address is printed",
};

/** The harness this runs in: { name: "orca", cli } , { name: "desktop" }, or { name: "terminal" }. */
export function harness(env = process.env) {
  if (env.ORCA_CLI_COMMAND || env.ORCA_WORKTREE_PATH || env.ORCA_ROOT_PATH) return { name: "orca", cli: env.ORCA_CLI_COMMAND || "orca" };
  if (env.CLAUDE_CODE_ENTRYPOINT === "claude-desktop") return { name: "desktop" };
  return { name: "terminal" };
}

const onPath = (name, env) => (env.PATH ?? "").split(delimiter).filter(Boolean).some((dir) => existsSync(join(dir, name)));

/** How a page opens for `choice` in harness `h`: the way's name, and the command to run, or none when the agent or the person opens it. */
export function openWay(choice, h, { platform = process.platform, env = process.env } = {}) {
  let way = choice === "auto" ? { orca: "orca", desktop: "pane", terminal: "system" }[h.name] : choice;
  // Outside Orca, with no ORCA_CLI_COMMAND, "orca" could be GNOME's screen reader, so the address is printed.
  if (way === "orca" && h.name !== "orca" && !env.ORCA_CLI_COMMAND) way = "print";
  if (way === "orca") return { way, run: (url) => [h.cli || env.ORCA_CLI_COMMAND || "orca", ["tab", "create", "--url", url, "--worktree", "active", "--json"]] };
  if (way === "system") {
    const opener = platform === "darwin" ? "open" : platform === "win32" ? null : onPath("xdg-open", env) ? "xdg-open" : null;
    return opener ? { way, run: (url) => [opener, [url]] } : { way: "print" };
  }
  return { way };
}

/**
 * Open `url` as `choice` says; resolves to the lines to print. A command
 * that fails says so and prints the address, so the page is never lost.
 */
export function openPage(url, choice, { h = harness(), run = spawnSync, platform, env } = {}) {
  const { way, run: command } = openWay(choice, h, { platform, env });
  if (way === "pane") return { opened: false, lines: [`Open ${url} in the browser pane (Claude's desktop app), and bring the pane into view.`] };
  if (!command) return { opened: false, lines: [`Open ${url}`] };
  const [file, args] = command(url);
  const ran = run(file, args, { encoding: "utf8", timeout: 15000, stdio: ["ignore", "pipe", "pipe"], detached: way === "system" });
  if (ran.status === 0) return { opened: true, lines: [way === "orca" ? `Opened ${url} in a tab of Orca's browser.` : `Opened ${url} in the system's browser.`] };
  const why = String(ran.stderr || ran.error?.message || `exit ${ran.status}`).trim().split("\n").pop();
  return { opened: false, lines: [`Could not open it with ${file} (${why}). Open ${url}`] };
}

/**
 * In Orca, the unread dot on this worktree's workspace, so the person sees an
 * agent waits on them. It runs beside the wait loop, never blocking it, and
 * resolves to whether it showed; `run` is execFile's shape.
 */
export function markUnread(h = harness(), run = execFile) {
  if (h.name !== "orca") return Promise.resolve(false);
  return new Promise((resolve) => {
    run(h.cli, ["worktree", "set", "--worktree", "active", "--unread", "--json"], { timeout: 10000 }, (error) => resolve(!error));
  });
}
