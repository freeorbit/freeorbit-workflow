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

import { existsSync, readFileSync, realpathSync } from "node:fs";
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

const realRoot = (root) => {
  try {
    return realpathSync(root);
  } catch {
    return root;
  }
};

/**
 * A project path as the path it really leads to, through any link on the way
 * (SEC-082), or null when that is outside the project. The part that does not
 * exist yet is kept as written, after the deepest part that does.
 */
export function where(root, path) {
  const rel = inside(root, path);
  if (rel === null) return null;
  const parts = rel ? rel.split("/") : [];
  for (let n = parts.length; n >= 0; n -= 1) {
    const head = join(root, ...parts.slice(0, n));
    if (!existsSync(head)) continue;
    let real;
    try {
      real = realpathSync(head);
    } catch {
      return null;
    }
    return inside(realRoot(root), join(real, ...parts.slice(n)));
  }
  return rel;
}

/** A path inside the project, through its links, that is in one of `dirs` and names no secret; else null. */
function allowedIn(root, path, dirs) {
  const rel = where(root, path);
  if (rel === null || isSecret(rel) || isSecret(inside(root, path))) return null;
  return dirs.some((dir) => dir === "**" || rel === dir || rel.startsWith(`${dir}/`)) ? rel : null;
}

// A tool's own glob, as a search pattern: ** any depth, * and ? within a name, [...] a class.
const searchGlob = (pattern) => {
  let out = "";
  for (let i = 0; i < pattern.length; i += 1) {
    const c = pattern[i];
    if (c === "*" && pattern[i + 1] === "*") {
      out += ".*";
      i += pattern[i + 2] === "/" ? 2 : 1;
    } else if (c === "*") out += "[^/]*";
    else if (c === "?") out += "[^/]";
    else if (c === "[") {
      const end = pattern.indexOf("]", i + 2);
      if (end < 0) out += "\\[";
      else {
        out += `[${pattern.slice(i + 1, end).replace(/^!/, "^").replace(/\\/g, "\\\\")}]`;
        i = end;
      }
    } else out += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${out}$`);
};

// One level of {a,b} at a time, so *.{rs,pem} is checked as *.rs and *.pem.
const braces = (pattern) => {
  const m = pattern.match(/^(.*?)\{([^{}]*)\}(.*)$/);
  return m ? m[2].split(",").flatMap((alt) => braces(`${m[1]}${alt}${m[3]}`)) : [pattern];
};

const SECRET_NAMES = [".env", ".env.local", "server.pem", "server.key", "cert.p12", "cert.pfx", "id_rsa", "id_rsa.pub", "id_ed25519", "id_ecdsa"];
const PLAIN_NAMES = ["a.rs", "main.mjs", "README.md", "notes.txt", "Cargo.toml", "data.csv", "shot.png"];

/**
 * Why a Glob pattern or a Grep glob is refused, or null (SEC-082): it may not
 * leave its folder, and it may not pick out the files SECRET_GLOBS names. A
 * pattern that matches ordinary files as well, such as *, is left to the folder check.
 */
export function patternProblem(pattern) {
  if (pattern === undefined || pattern === null || pattern === "") return null;
  const text = String(pattern);
  if (isAbsolute(text) || text.startsWith("~")) return `the pattern ${text} starts outside the folder`;
  for (const alt of braces(text)) {
    if (alt.split("/").includes("..")) return `the pattern ${text} climbs out of the folder`;
    const name = searchGlob(alt.split("/").pop());
    if (SECRET_NAMES.some((file) => name.test(file)) && !PLAIN_NAMES.some((file) => name.test(file))) return `the pattern ${text} picks out files that may hold a secret`;
  }
  return null;
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
      read: [".workflow/config.json", `${config.docs?.workflow ?? "docs/workflow"}/test-data-formats.md`, ...docs(["overview.md", "user-stories.md", "user-flows.md", "test-data/**"]), ...testdataReads],
      search: docs(["test-data"]),
      bash: false,
      web: "any",
    },
    "screen-reader": { read: [".cache/screens/**"], search: [], bash: false, web: false },
    "code-reviewer": { read: ["**"], search: ["**"], bash: false, web: config.review?.webDomains?.length ? config.review.webDomains : WEB_DOMAINS },
  };
}


// Outside quotes the shell expands these, or reads them as syntax, so the
// guard would check text other than what runs (SEC-077).
const EXPANDS = new Set(["$", "~", "{", "}", "*", "?", "[", "]", "(", ")", "#", "!", "`"]);

/**
 * A command split into words as the shell reads them: quoted parts joined to
 * their neighbours, quotes removed, and backslashes undone (SEC-078). Returns
 * the words, or a string saying why the command cannot be read safely: an
 * unbalanced quote, or anything the shell would expand.
 */
export function shellWords(text) {
  const out = [];
  let word = null;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (c === " " || c === "\t") {
      if (word !== null) out.push(word);
      word = null;
      continue;
    }
    word ??= "";
    if (c === "'") {
      const end = text.indexOf("'", i + 1);
      if (end < 0) return "it has an unbalanced quote";
      word += text.slice(i + 1, end);
      i = end;
    } else if (c === '"') {
      let j = i + 1;
      for (; j < text.length && text[j] !== '"'; j += 1) {
        if (text[j] === "$" || text[j] === "`") return "it expands a variable or a command inside double quotes; use single quotes";
        if (text[j] === "\\" && j + 1 < text.length && '$`"\\'.includes(text[j + 1])) j += 1;
        word += text[j];
      }
      if (j >= text.length) return "it has an unbalanced quote";
      i = j;
    } else if (c === "\\") {
      if (i + 1 >= text.length) return "it ends in a backslash";
      i += 1;
      word += text[i];
    } else if (EXPANDS.has(c)) return `the shell would expand its ${c}; quote it, or name the path in full`;
    else word += c;
  }
  if (word !== null) out.push(word);
  return out;
}

// The flags each looking command may take, none of which reads a file or a
// name list (SEC-077); any other flag, long ones included, is refused.
const FLAGS = {
  grep: /^-[rnilcwvxHhsEFoLq]+$/,
  ls: /^-[laRh1tSrd]+$/,
  head: /^-\d+$/,
  wc: /^-[lwcm]+$/,
  file: /^-[bi]+$/,
};

/** Whether a Bash command is one the e2e tester may run, or why not. `search` is the folders it may search. */
export function e2eCommand(command, root, search = [".cache/e2e"]) {
  const text = String(command ?? "").trim();
  if (SHELL_META.test(text)) return "it chains, pipes, redirects, or substitutes; run one command at a time";
  const words = shellWords(text);
  if (typeof words === "string") return words;
  const [first, ...rest] = words;
  if (words.join(" ") === "npx wf config") return null;
  const lead = first === "npx" && rest[0] === "wf" && rest[1] === "app" ? 3 : first === "pnpm" && rest[0] === "app" ? 2 : first === "pnpm" && rest[0] === "-s" && rest[1] === "app" ? 3 : 0;
  if (lead && words[lead] !== undefined) {
    const sub = words[lead];
    if (["db", "logs", "reset"].includes(sub)) return `wf app ${sub} is not something a user has`;
    if (words.some((word) => word === "--real" || word.startsWith("--real="))) return "--real would open the user's real data";
    return null;
  }
  const flags = FLAGS[first];
  if (!flags) return "the tester runs only npx wf app, npx wf config, grep in its own folders, and ls, head, wc, or file on the files the app wrote";
  const bad = rest.find((word) => word.startsWith("-") && word !== "-" && !flags.test(word));
  if (bad) return `${first} may not take ${bad}: the flags it may use read no other file`;
  const plain = rest.filter((word) => !(word.startsWith("-") && word !== "-"));
  // Some Claude Code builds have no Grep tool, so the tester searches with grep, in its own folders only.
  if (first === "grep") {
    const paths = plain.slice(1);
    if (!plain[0] || paths.length === 0) return "grep needs a pattern and a path inside the folders it may search";
    return paths.every((path) => allowedIn(root, path, search) !== null) ? null : `grep may search only ${search.join(", ")}, and no file that may hold a secret`;
  }
  if (plain.length === 0) return `${first} needs a path under .cache/e2e/`;
  return plain.every((path) => allowedIn(root, path, [".cache/e2e"]) !== null) ? null : `${first} may look only at the files the app wrote, under .cache/e2e/`;
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
    if (inside(root, args.file_path) === null) return deny(`${args.file_path} is outside the project`);
    // Where the path leads, through any link, is what is read (SEC-082).
    const path = where(root, args.file_path);
    if (path === null) return deny(`${args.file_path} leads outside the project`);
    if (isSecret(path) || isSecret(inside(root, args.file_path))) return deny(`${path} may hold a secret`);
    return policy.read.some((pattern) => glob(pattern).test(path)) ? null : deny(`${path} is not among what it may read`);
  }
  if (tool === "Grep" || tool === "Glob") {
    if (inside(root, args.path ?? root) === null) return deny(`${args.path} is outside the project`);
    const path = where(root, args.path ?? root);
    if (path === null) return deny(`${args.path} leads outside the project`);
    if (isSecret(path) || isSecret(inside(root, args.path ?? root))) return deny(`${path} may hold a secret`);
    const pattern = patternProblem(tool === "Glob" ? args.pattern : args.glob);
    if (pattern) return deny(pattern);
    const ok = policy.search.some((dir) => dir === "**" || path === dir || path.startsWith(`${dir}/`));
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
