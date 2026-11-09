#!/usr/bin/env node
// The blind agents' guard (audit W-08), a PreToolUse hook. A blind agent's
// value is what it does not know, so its prompt's limits are enforced here,
// not only asked for: each may read, search, run, and fetch only what its
// policy allows. Any other agent, and the main session, pass untouched.
//
// It runs from the installed plugin, which holds only this folder, so it uses
// nothing but Node's standard library and reads the project's
// .workflow/config.json itself. The hook sets onFailure: block, so a crash
// blocks the call rather than letting it through; for an agent this does not
// guard, it decides before reading anything that could fail.
//
// Input: the hook's JSON on stdin. Output: a deny decision on stdout, or
// nothing to let the call go on.

import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, normalize, relative } from "node:path";
import { pathToFileURL } from "node:url";

/** The agents this guards, by name without the plugin prefix. */
export const GUARDED = ["e2e-tester", "test-data-designer", "screen-reader", "code-reviewer"];

/** Hosts the code reviewer may fetch when the config names none: advisory and official sources only. */
export const WEB_DOMAINS = [
  "osv.dev",
  "github.com",
  "nvd.nist.gov",
  "rustsec.org",
  "crates.io",
  "docs.rs",
  "npmjs.com",
  "www.npmjs.com",
  "registry.npmjs.org",
  "pypi.org",
];

/**
 * File names that may hold a secret, in every folder: the one list. The guard
 * denies them to blind agents on every file tool, and `wf ai:sync` writes them
 * as deny rules for Claude Code's settings and OpenCode's agents (W-11).
 */
export const SECRET_GLOBS = [".env", ".env.*", "*.pem", "*.key", "*.p12", "*.pfx", "id_rsa*", "id_ed25519*", "id_ecdsa*"];
// A command that chains, pipes, redirects, or substitutes could run anything.
const SHELL_META = /[;&|`<>\n\r]|\$\(/;

const glob = (pattern) => {
  let out = "";
  for (let i = 0; i < pattern.length; i += 1) {
    const c = pattern[i];
    if (c === "*" && pattern[i + 1] === "*") {
      out += ".*";
      i += pattern[i + 2] === "/" ? 2 : 1;
    } else if (c === "*") out += "[^/]*";
    else out += c.replace(/[.+^${}()|[\]\\?]/g, "\\$&");
  }
  return new RegExp(`^${out}$`);
};

/** Whether a path's file name is one SECRET_GLOBS names. */
export function isSecret(path) {
  const name = String(path ?? "").split("/").pop();
  return SECRET_GLOBS.some((pattern) => glob(pattern).test(name));
}

/** The agent's name from the hook input, without a plugin prefix such as "e2e:". */
export function agentName(input) {
  const type = input?.agent_type;
  return typeof type === "string" && type ? type.split(":").pop() : null;
}

/** A tool path as a path inside the project, or null when it is outside. */
export function inside(root, path) {
  if (typeof path !== "string" || !path) return null;
  const rel = normalize(relative(root, isAbsolute(path) ? path : join(root, path)));
  return rel.startsWith("..") || isAbsolute(rel) ? null : rel === "." ? "" : rel;
}

/** What each agent may read, as globs from the project root, and whether it may search a folder. */
export function policies(config) {
  const areas = (config.areas ?? []).filter((area) => area.docs);
  const docs = (names) => areas.flatMap((area) => names.map((name) => `${area.docs}/${name}`));
  const e2eReads = config.e2e?.reads ?? [];
  const testdataReads = config.testdata?.reads ?? [];
  return {
    "e2e-tester": {
      read: [...docs(["overview.md", "user-stories.md", "user-flows.md", "design/screens.md", "test-data/**"]), ...e2eReads, ".cache/e2e/**"],
      search: [...docs(["test-data"]), ".cache/e2e"],
      bash: "e2e",
      web: false,
    },
    "test-data-designer": {
      read: [".workflow/config.json", ...docs(["overview.md", "user-stories.md", "user-flows.md", "test-data/**"]), ...testdataReads],
      search: docs(["test-data"]),
      bash: false,
      web: "any",
    },
    "screen-reader": { read: [".cache/screens/**"], search: [], bash: false, web: false },
    "code-reviewer": { read: ["**"], search: ["**"], bash: false, web: config.review?.webDomains?.length ? config.review.webDomains : WEB_DOMAINS },
  };
}

/** A command split into words, keeping "quoted words" together. */
export function shellWords(text) {
  const out = [];
  for (const m of text.matchAll(/"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g)) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

/** Whether a Bash command is one the e2e tester may run, or why not. `search` is the folders it may search. */
export function e2eCommand(command, root, search = [".cache/e2e"]) {
  const text = String(command ?? "").trim();
  if (SHELL_META.test(text)) return "it chains, pipes, redirects, or substitutes; run one command at a time";
  if (/^npx wf config$/.test(text)) return null;
  const app = text.match(/^(?:npx wf app|pnpm -s app|pnpm app) (\S+)/);
  if (app) {
    if (["db", "logs", "reset"].includes(app[1])) return `wf app ${app[1]} is not something a user has`;
    if (/(^|\s)--real(\s|$)/.test(text)) return "--real would open the user's real data";
    return null;
  }
  // Some Claude Code builds have no Grep tool, so the tester searches with grep, in its own folders only.
  if (/^grep\s/.test(text)) {
    const words = shellWords(text).slice(1);
    const rest = words.filter((word) => !/^-[A-Za-z]+$/.test(word));
    const paths = rest.slice(1);
    if (!rest[0] || paths.length === 0) return "grep needs a pattern and a path inside the folders it may search";
    const outside = paths.find((path) => {
      const rel = inside(root, path);
      return rel === null || !search.some((dir) => rel === dir || rel.startsWith(`${dir}/`));
    });
    return outside ? `grep may search only ${search.join(", ")}` : null;
  }
  const look = text.match(/^(ls|head|wc|file)((?:\s+-\w+)*)\s+(.+)$/);
  if (look) {
    const paths = look[3].split(/\s+/).filter((part) => !part.startsWith("-"));
    const outside = paths.find((path) => {
      const rel = inside(root, path.replace(/^['"]|['"]$/g, "")) ?? "";
      return !(rel === ".cache/e2e" || rel.startsWith(".cache/e2e/"));
    });
    return outside ? `${look[1]} may look only at the files the app wrote, under .cache/e2e/` : null;
  }
  return "the tester runs only npx wf app, npx wf config, grep in its own folders, and ls, head, wc, or file on the files the app wrote";
}

/** The decision for one tool call: null to let it go on, or the reason it is denied. */
export function decide(input, root, config) {
  const name = agentName(input);
  if (!name || !GUARDED.includes(name)) return null;
  if (config.hooks?.blindness === false) return null;
  const policy = policies(config)[name];
  const tool = input.tool_name;
  const args = input.tool_input ?? {};
  const deny = (why) => `${name} is blind (W-08): ${why}.`;

  if (["Edit", "Write", "NotebookEdit", "MultiEdit"].includes(tool)) return deny("it never edits a file");
  if (tool === "Read") {
    const path = inside(root, args.file_path);
    if (path === null) return deny(`${args.file_path} is outside the project`);
    if (isSecret(path)) return deny(`${path} may hold a secret`);
    return policy.read.some((pattern) => glob(pattern).test(path)) ? null : deny(`${path} is not among what it may read`);
  }
  if (tool === "Grep" || tool === "Glob") {
    const path = inside(root, args.path ?? root);
    if (path === null) return deny(`${args.path} is outside the project`);
    if (isSecret(path)) return deny(`${path} may hold a secret`);
    const ok = policy.search.some((pattern) => pattern === "**" || path === pattern || path.startsWith(`${pattern}/`));
    return ok ? null : deny(`search only in ${policy.search.join(", ") || "nothing"}, with that as the path`);
  }
  if (tool === "Bash") {
    if (policy.bash !== "e2e") return deny("it runs no commands");
    const why = e2eCommand(args.command, root, policy.search);
    return why ? deny(why) : null;
  }
  if (tool === "WebFetch") {
    if (policy.web === "any") return null;
    if (!policy.web) return deny("it fetches nothing from the web");
    let host = "";
    try {
      host = new URL(args.url).hostname.toLowerCase();
    } catch {
      return deny(`${args.url} is not a web address`);
    }
    const ok = policy.web.some((domain) => host === domain || host.endsWith(`.${domain}`));
    return ok ? null : deny(`${host} is not an advisory or official source it may fetch`);
  }
  if (tool === "WebSearch") return policy.web ? null : deny("it searches nothing on the web");
  return null;
}

async function main() {
  let raw = "";
  for await (const chunk of process.stdin) raw += chunk;
  const input = JSON.parse(raw);
  const name = agentName(input);
  // Most calls are the main session's or an unguarded agent's: decide them before anything can fail.
  if (!name || !GUARDED.includes(name)) return;
  const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  const file = join(root, ".workflow", "config.json");
  const config = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  const why = decide(input, root, config);
  if (why) {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: why } }));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Exit 2 blocks the call on any Claude Code build, with or without onFailure: block.
  await main().catch((error) => {
    process.stderr.write(`The blind agents' guard failed, so the call is blocked: ${error.message}\n`);
    process.exit(2);
  });
}
