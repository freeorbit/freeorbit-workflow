// Desktop notifications from the question-pictures server. A page in Claude's
// built-in browser pane, or any browser that refuses web notifications,
// still gets told: the page asks the server, which runs on the same machine,
// and the server shows the notification through the operating system.
//
// Linux uses notify-send (libnotify). macOS uses terminal-notifier when it is
// installed, else osascript, whose notifications macOS shows as Script
// Editor's, so Script Editor must be allowed in System Settings, Notifications.
// Elsewhere, or with no such program, there is none, and the page falls back
// to the browser's own. `wf view notify` sends one to try it.

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
    return file ? { file, name: "notify-send", args: (title, body) => ["--app-name=Workflow asks", "--", title, body] } : null;
  }
  if (platform === "darwin") {
    const notifier = onPath("terminal-notifier", env);
    if (notifier) return { file: notifier, name: "terminal-notifier", args: (title, body) => ["-title", title, "-message", body || " ", "-group", "wf-ask"] };
    const file = existsSync("/usr/bin/osascript") ? "/usr/bin/osascript" : onPath("osascript", env);
    // The text goes in as arguments, never into the script, so no quote in it can change what runs.
    return file ? { file, name: "osascript", args: (title, body) => ["-e", "on run argv", "-e", "display notification (item 2 of argv) with title (item 1 of argv)", "-e", "end run", title, body] } : null;
  }
  return null;
}

/** What to do when a notification does not appear, for this machine. */
export function desktopHelp(command, platform = process.platform) {
  if (!command) {
    if (platform === "linux") return ["No notify-send: install libnotify (such as libnotify-bin, or libnotify), and a notification daemon if the desktop has none.", "Until then, the page uses the browser's own notifications, which Claude's built-in browser pane does not show."];
    return ["This machine has no desktop notifier the kit knows. The page uses the browser's own notifications, which Claude's built-in browser pane does not show."];
  }
  if (command.name === "osascript") {
    return [
      "macOS shows osascript's notifications as Script Editor's. If none appeared: System Settings, Notifications, Script Editor, then Allow notifications.",
      "Script Editor is listed there only after it first asks; opening Script Editor once and running display notification \"hi\" makes it ask.",
      "Or install terminal-notifier (brew install terminal-notifier); the kit uses it when it is there, under its own name.",
      "Focus or Do Not Disturb hides them too.",
    ];
  }
  if (command.name === "terminal-notifier") return ["If none appeared: System Settings, Notifications, terminal-notifier, then Allow notifications. Focus or Do Not Disturb hides them too."];
  return ["If none appeared, check that the desktop's notification daemon runs, and that Do Not Disturb is off."];
}

/**
 * A function that shows `title` and `body` as a desktop notification and
 * says whether it did, or null when this machine has no way. One a second at
 * most, and the same one once a minute, so a page that misbehaves cannot
 * flood the screen.
 */
export function desktopNotifier({ command = desktopCommand(), run = execFile, now = Date.now, log = () => {} } = {}) {
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
    run(command.file, command.args(t, b), { timeout: 5000, windowsHide: true }, (error, stdout, stderr) => {
      if (error) log(`question-pictures: the desktop notification did not show (${command.name}: ${String(stderr || error.message).trim().slice(0, 200)}); npx wf view notify says what to check`);
    });
    return true;
  };
}
