// What `wf app` knows about the app before it starts anything: its settings
// from the config and the instance number, Chromium's arguments, the page
// among Chromium's targets, the psql and database paths, and where a picture
// may be saved. Pure, apart from the checks shotPath makes on the disk.

import { existsSync, lstatSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import { browserFor } from "../platform.mjs";

/** Everything a run needs to know about the app, from the config and the instance number. */
export function appSettings(root, config, env = process.env) {
  const app = config.app;
  const web = app.kind === "web";
  const needs = web ? ["name"] : ["name", "binary", "bundleId"];
  for (const key of needs) {
    if (!app[key]) throw new Error(`app.${key} is not set in .workflow/config.json; wf app needs ${needs.join(", ")}`);
  }
  if (web && !app.web.url) throw new Error("app.web.url is not set in .workflow/config.json; wf app needs the address the app opens at");
  const raw = env[app.instanceEnv] ?? "0";
  const instance = Number(raw);
  if (!Number.isInteger(instance) || instance < 0 || instance > 32) throw new Error(`${app.instanceEnv} is a number from 0 to 32`);
  const base = `/tmp/${app.name}-agent`;
  const state = instance ? `${base}-${instance}` : base;
  const data = join(state, "data");
  // A second instance keeps its data in its own folder, but the app and the
  // project's tools see it at the first instance's path, through a private
  // mount, so a screen shows the same path whichever app shot it.
  const seenData = join(base, "data");
  return {
    root,
    app,
    instance,
    state,
    data,
    seenData,
    mount: instance ? ["-p", "PrivateUsers=yes", "-p", `BindPaths=${data}:${seenData}`] : [],
    appData: (home) => join(home, app.bundleId),
    binary: join(root, app.binary),
    inspector: `127.0.0.1:${app.inspectorPort + instance}`,
    viteUrl: app.vite.url,
    web,
    // Looked up when Chromium starts, so stop, status, and logs work without one installed.
    get browser() {
      return web ? browserFor(config) : null;
    },
    // A website has no fixed window: it opens at the project's frame size unless app.web.size says otherwise.
    size: app.web.size ?? config.design.size,
    debugPort: app.web.debugPort + instance,
    profile: join(state, "chromium"),
    // Shared by every instance: one lock a shared server, held while it starts.
    locks: `${base}-locks`,
    units: {
      ...(web ? {} : { vite: `${app.name}-agent-vite` }),
      app: instance ? `${app.name}-agent-app-${instance}` : `${app.name}-agent-app`,
      ...Object.fromEntries((web ? app.web.servers : []).map((server) => [`server:${server.name}`, `${app.name}-agent-${server.name}`])),
    },
  };
}

/** Whether this start's Chromium runs without a window: --headed or --headless for one start, else app.web.headless. */
export function headlessFor(app, args = []) {
  if (args.includes("--headed") && args.includes("--headless")) throw new Error("say --headed or --headless, not both");
  if (args.includes("--headed")) return false;
  if (args.includes("--headless")) return true;
  return app.web.headless;
}

/** Chromium's arguments for the web kind: a throwaway profile, the debugging port, and the window size. */
export function chromiumArgs(s, size, headless = s.app.web.headless) {
  const [width, height] = size;
  return [
    s.browser,
    ...(headless ? ["--headless"] : []),
    // Only where the system forbids Chromium's sandbox, such as a CI runner.
    ...(s.app.web.sandbox ? [] : ["--no-sandbox"]),
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    `--user-data-dir=${s.profile}`,
    "--remote-debugging-address=127.0.0.1",
    `--remote-debugging-port=${s.debugPort}`,
    `--window-size=${width},${height}`,
    s.app.web.url,
  ];
}

/** The app's page among Chromium's targets: the one on exactly the app's origin, or null. */
export function appPage(targets, url) {
  const origin = new URL(url).origin;
  const on = (target) => {
    try {
      return new URL(target.url).origin === origin;
    } catch {
      return false;
    }
  };
  return targets.find((target) => target.type === "page" && on(target)) ?? null;
}

/** psql's arguments and environment for one query: read-only, no backslash commands, and the address kept out of the process list. */
export function psqlCall(url, sql) {
  const query = sql ?? "SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog', 'information_schema') ORDER BY 1, 2";
  // A backslash command such as \! runs a shell, so only SQL is passed.
  if (/^\s*\\/.test(query) || /(^|\n)\s*\\/.test(query)) throw new Error("db takes SQL only, not psql's backslash commands");
  return {
    args: ["-X", "--no-psqlrc", "-v", "ON_ERROR_STOP=1", "-c", query],
    env: { PGDATABASE: url, PGOPTIONS: "-c default_transaction_read_only=on" },
  };
}

/** A web viewport: a name from app.web.sizes, such as mobile, or WxH. */
export function viewport(app, value) {
  if (app.web.sizes[value]) return app.web.sizes[value];
  const size = String(value ?? "").split("x").map(Number);
  if (size.length !== 2 || size.some((n) => !Number.isInteger(n) || n < 1)) throw new Error(`a size is WxH or one of ${Object.keys(app.web.sizes).join(", ")}, not ${JSON.stringify(value)}`);
  return size;
}

/** The database file `db <name>` reads, from `app.databases`; `*` in a pattern stands for the name. */
export function databasePath(databases, appData, name) {
  const names = Object.keys(databases);
  if (names.length === 0) throw new Error("app.databases names no database");
  const which = name ?? names[0];
  const pattern = databases[which] ?? databases["*"]?.replaceAll("*", which);
  if (!pattern) throw new Error(`no database named ${which} in app.databases (${names.join(", ")})`);
  return join(appData, pattern);
}

/**
 * Where a shot, page, or screenshot may be saved, as an absolute path (SEC-079):
 * a .png under the run's state folder, the project's .cache/e2e, or the
 * .cache/screens that wf screens shoots into, reached through no link. A relative path is from the project root. Throws otherwise.
 */
export function shotPath(s, out) {
  if (typeof out !== "string" || !out.endsWith(".png")) throw new Error(`a shot is saved as a .png file, not ${out || "nothing"}`);
  const file = resolve(s.root, out);
  const under = (path, dir) => {
    const rel = relative(dir, path);
    return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
  };
  const dir = [s.state, join(s.root, ".cache", "e2e"), join(s.root, ".cache", "screens")].find((each) => under(file, each));
  if (!dir) throw new Error(`a shot is saved under the run's state folder (${s.state}) .cache/e2e/, or .cache/screens/, not ${out}`);
  let link = false;
  try {
    link = lstatSync(file).isSymbolicLink();
  } catch {}
  if (link) throw new Error(`${out} is a link; a shot never writes through one`);
  let head = dirname(file);
  while (!existsSync(head) && head !== dir) head = dirname(head);
  if (existsSync(head)) {
    const real = realpathSync(head);
    const realDir = existsSync(dir) ? realpathSync(dir) : dir;
    if (real !== realDir && !under(real, realDir)) throw new Error(`${out} leads through a link out of ${dir}; a shot never writes through one`);
  }
  return file;
}
