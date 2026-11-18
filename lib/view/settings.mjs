// The ask pages' settings, kept by the server for this user, so the look and
// the inbox's filters outlive a browser that forgets its storage, such as a
// new session's browser pane. One file for every project, since one server
// serves them all: ask-settings.json in the server's state folder, readable by
// this user alone.
// A page gets them in its HTML when it is served, and posts them back when
// they change; its own storage is only the fallback, for an exported page.

import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
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
 * Settings a page sent, kept to the known keys: each a JSON value, or null to
 * drop it. Gives { settings } or { error }.
 */
export function cleanSettings(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { error: "settings are a JSON object" };
  const unknown = Object.keys(raw).filter((key) => !SETTINGS_KEYS.includes(key));
  if (unknown.length) return { error: `not a kept setting: ${unknown.join(", ")}` };
  const settings = Object.fromEntries(SETTINGS_KEYS.filter((key) => raw[key] !== undefined).map((key) => [key, raw[key]]));
  if (JSON.stringify(settings).length > SETTINGS_MAX) return { error: `settings are at most ${SETTINGS_MAX / 1024} KB` };
  return { settings };
}

/** The kept settings, or {} when there are none, the file is larger than settings can be, or it cannot be read as settings. */
export function readSettings(file) {
  try {
    if (!existsSync(file) || statSync(file).size > SETTINGS_MAX) return {};
    const { settings = {} } = cleanSettings(JSON.parse(readFileSync(file, "utf8")));
    return Object.fromEntries(Object.entries(settings).filter(([, value]) => value !== null));
  } catch {
    return {};
  }
}

/**
 * Lay the settings a page changed over the kept ones, a null dropping its
 * key, and keep the result for this user alone. A page sends only what it
 * changed, so another tab's newer change to another key stays. Gives the
 * settings now kept.
 */
export function writeSettings(changed, file, kept = readSettings(file)) {
  const next = { ...kept, ...changed };
  for (const [key, value] of Object.entries(next)) if (value === null) delete next[key];
  mkdirSync(join(file, ".."), { recursive: true, mode: 0o700 });
  writeWhole(file, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

/**
 * What a served page reads before its scripts: the keys the server keeps, so
 * the page and the server hold one list, and the settings. As JSON a
 * `<script type="application/json">` can hold: no `<` to end it early.
 */
export const settingsScript = (settings) => JSON.stringify({ keys: SETTINGS_KEYS, settings }).replace(/</g, "\\u003c");
