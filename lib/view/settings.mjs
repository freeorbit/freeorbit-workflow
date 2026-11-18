// The ask pages' settings, kept by the server for this user, so the look and
// the inbox's filters outlive a browser that forgets its storage, such as a
// new session's browser pane. One file for every project, since one server
// serves them all: ask-settings.json in the server's state folder, readable by
// this user alone.
// A page gets them in its HTML when it is served, and posts them back when
// they change; its own storage is only the fallback, for an exported page.

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { writeWhole } from "../files.mjs";

/** The browser storage keys the server keeps; anything else a page stores stays in that browser. */
export const SETTINGS_KEYS = ["wf-ask:look", "wf-ask:notify", "wf-ask:inbox"];
/** How large the kept settings may be, as JSON: a look is a few hundred bytes. */
export const SETTINGS_MAX = 16 * 1024;
/** What the server swaps for the settings in a page's HTML; an export keeps it, and its page reads none. */
export const SETTINGS_MARK = "__WF_ASK_SETTINGS__";

/** The settings file in the server's state folder (hub.mjs's stateDir). */
export const settingsFile = (dir) => join(dir, "ask-settings.json");

/**
 * The settings a page sent, kept to the known keys, each a plain JSON value.
 * Gives { settings } or { error }.
 */
export function cleanSettings(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { error: "settings are a JSON object" };
  const unknown = Object.keys(raw).filter((key) => !SETTINGS_KEYS.includes(key));
  if (unknown.length) return { error: `not a kept setting: ${unknown.join(", ")}` };
  const settings = Object.fromEntries(SETTINGS_KEYS.filter((key) => raw[key] !== undefined).map((key) => [key, raw[key]]));
  if (JSON.stringify(settings).length > SETTINGS_MAX) return { error: `settings are at most ${SETTINGS_MAX / 1024} KB` };
  return { settings };
}

/** The kept settings, or {} when there are none or the file cannot be read as settings. */
export function readSettings(file) {
  if (!existsSync(file)) return {};
  try {
    return cleanSettings(JSON.parse(readFileSync(file, "utf8"))).settings ?? {};
  } catch {
    return {};
  }
}

/** Keep the settings in place of what was kept, for this user alone: a page sends every kept one it has, so one it dropped goes. */
export function writeSettings(settings, file) {
  mkdirSync(join(file, ".."), { recursive: true, mode: 0o700 });
  writeWhole(file, `${JSON.stringify(settings, null, 2)}\n`);
  return settings;
}

/** The settings as JSON a `<script type="application/json">` can hold: no `<` to end it early. */
export const settingsScript = (settings) => JSON.stringify(settings).replace(/</g, "\\u003c");
