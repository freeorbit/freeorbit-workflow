// Desktop notifications from the question-pictures server. A page in Claude's
// built-in browser pane, or any browser that refuses web notifications,
// still gets told: the page asks the server, which runs on the same machine,
// and the server shows the notification through the operating system.
//
// Linux uses notify-send (libnotify), macOS osascript. Elsewhere, or with no
// such program, there is none, and the page falls back to the browser's own.

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

const onPath = (name, env) => (env.PATH ?? "").split(delimiter).filter(Boolean).map((dir) => join(dir, name)).find((file) => existsSync(file)) ?? null;

// Text from a page goes into a notification only as plain, short text.
const plain = (text, max) => String(text ?? "").replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/**
 * The command that shows a notification on this machine, as `{ file, args:
 * (title, body) => [...] }`, or null when there is none.
 */
export function desktopCommand({ platform = process.platform, env = process.env } = {}) {
  if (platform === "linux") {
    const file = onPath("notify-send", env);
    return file ? { file, args: (title, body) => ["--app-name=Workflow asks", "--", title, body] } : null;
  }
  if (platform === "darwin") {
    const file = existsSync("/usr/bin/osascript") ? "/usr/bin/osascript" : onPath("osascript", env);
    // The text goes in as arguments, never into the script, so no quote in it can change what runs.
    return file ? { file, args: (title, body) => ["-e", "on run argv", "-e", "display notification (item 2 of argv) with title (item 1 of argv)", "-e", "end run", title, body] } : null;
  }
  return null;
}

/**
 * A function that shows `title` and `body` as a desktop notification and
 * says whether it did, or null when this machine has no way. One a second at
 * most, and the same one once a minute, so a page that misbehaves cannot
 * flood the screen.
 */
export function desktopNotifier({ command = desktopCommand(), run = execFile, now = Date.now } = {}) {
  if (!command) return null;
  let last = -Infinity;
  const recent = new Map();
  return (title, body) => {
    const t = plain(title, 120);
    const b = plain(body, 240);
    if (!t) return false;
    const at = now();
    const key = `${t}\u0000${b}`;
    if (at - last < 1000 || at - (recent.get(key) ?? -Infinity) < 60_000) return false;
    last = at;
    recent.set(key, at);
    for (const [k, when] of recent) if (at - when >= 60_000) recent.delete(k);
    run(command.file, command.args(t, b), { timeout: 5000, windowsHide: true }, () => {});
    return true;
  };
}
