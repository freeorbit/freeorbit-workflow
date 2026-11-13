// `wf doctor`: whether a project's set-up is whole, one line each, OK, FAIL,
// or SKIP: the config, the kit's pin in package.json, the Claude Code
// settings, the Claude Code plugins installed for this project, the installed kit, the docs, the agent settings, the tools, the
// hooks, and GitHub. It changes nothing; each FAIL says what to run.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { reconcile } from "./ai.mjs";
import { DEFAULTS } from "../config/defaults.mjs";
import { unknownKeys } from "../config/config.mjs";
import { problems as docProblems } from "../docs/check.mjs";
import { hooksLine, hooksPathOf } from "./hooks.mjs";
import { KIT_REPO } from "./init.mjs";
import { claudeDir, installedPlugins } from "./plugins.mjs";
import { roleProblems } from "../roles.mjs";
import { viewEntry } from "../view/view.mjs";
import { report, toolRows, onPath } from "./tools.mjs";

const ok = (note = "", lines = []) => ({ status: "OK", note, lines });
const fail = (note, lines = []) => ({ status: "FAIL", note, lines });
const skip = (note) => ({ status: "SKIP", note });
const json = (root, file) => (existsSync(path.join(root, file)) ? JSON.parse(readFileSync(path.join(root, file), "utf8")) : null);

/** The tag package.json pins the kit at, or null. */
export function pinnedTag(pkg) {
  return pkg?.devDependencies?.["freeorbit-workflow"]?.match(/#(v[\w.-]+)$/)?.[1] ?? null;
}

/** Each check as [label, run]; `io` swaps the outside calls for tests. */
export function doctorSteps(root, project, io = {}) {
  const { config } = project;
  const gh = io.gh ?? ((args) => spawnSync("gh", args, { cwd: root, encoding: "utf8" }));
  const kitVersion = io.kitVersion ?? (() => json(root, "node_modules/freeorbit-workflow/package.json")?.version ?? null);
  const pkg = json(root, "package.json");
  const settings = json(root, ".claude/settings.json");
  const tag = pinnedTag(pkg);
  return [
    ["the config names only known keys", () => {
      const raw = json(root, ".workflow/config.json");
      if (!raw) return fail("no .workflow/config.json; run the workflow-init skill");
      const unknown = unknownKeys(raw, DEFAULTS);
      return unknown.length ? fail(`unknown: ${unknown.join(", ")}`) : ok();
    }],
    ["every role is held, and the people are whole", () => {
      const found = roleProblems(config);
      return found.length ? fail(found.join("; ")) : ok();
    }],
    ["package.json pins the kit at a tag", () => (tag ? ok(tag) : fail(`add freeorbit-workflow as git+https://github.com/${KIT_REPO}.git#<tag> to devDependencies`))],
    ["the installed kit is the pinned one", () => {
      const version = kitVersion();
      if (!version) return fail("the kit is not installed; run the package install");
      return tag && `v${version}` !== tag ? fail(`installed v${version}, pinned ${tag}; run the package install with --force`) : ok(`v${version}`);
    }],
    ["Claude Code loads the kit's plugins at the same tag", () => {
      const ref = settings?.extraKnownMarketplaces?.["freeorbit-workflow"]?.source?.ref;
      if (!settings?.enabledPlugins?.["core@freeorbit-workflow"]) return fail(".claude/settings.json does not turn on core@freeorbit-workflow");
      return ref === tag ? ok(ref) : fail(`.claude/settings.json's marketplace is at ${ref ?? "no ref"}, the pin is ${tag}`);
    }],
    ["Claude Code has the kit's plugins installed at the pinned tag", () => {
      if (!config.ai.tools.includes("claude")) return skip("ai.tools has no claude");
      const report = installedPlugins(root, tag, settings, io.claudeDir ?? claudeDir());
      if (report.skip) return skip(report.skip);
      const lines = [...report.problems, ...report.notes];
      if (report.problems.length) return fail(`${report.problems.filter((line) => !line.startsWith("first,")).length} to install or update`, lines);
      return ok(report.notes.length ? `${tag}, but the marketplace is not` : tag, lines);
    }],
    ["docs are in step", async () => {
      const found = await docProblems(project);
      return found.length ? fail(`${found.length} problems; run npx wf doc:check`) : ok();
    }],
    ["agent settings are in step", async () => {
      const bad = config.ai.tools.filter((tool) => !["claude", "opencode"].includes(tool));
      if (bad.length || !config.ai.tools.length) return fail(`ai.tools is ${JSON.stringify(config.ai.tools)}; name claude, opencode, or both`);
      const { problems } = await reconcile(root, { tools: config.ai.tools });
      if (problems.length) return fail(`${problems.length} problems; run npx wf ai:sync`);
      // OpenCode's files left from before it was turned off would still load in OpenCode.
      if (!config.ai.tools.includes("opencode") && (existsSync(path.join(root, ".opencode")) || existsSync(path.join(root, "opencode.json")))) return fail("ai.tools has no opencode, but .opencode/ or opencode.json is still here; delete them");
      return ok();
    }],
    ["the required tools are here", () => {
      const list = path.join(root, config.docs.workflow, "tools.md");
      if (!existsSync(list)) return fail("no tools.md; run npx wf docs sync");
      const rows = toolRows(readFileSync(list, "utf8"));
      const has = io.has ?? ((name) => onPath(name, process.env.PATH ?? ""));
      const { lines, failed } = report(rows, has, process.platform);
      return failed ? fail(lines.filter((line) => line.startsWith("missing required")).join("; ")) : ok(lines.length ? `${lines.length} optional missing; run npx wf tools` : "");
    }],
    ["the question-pictures server takes ask pages' answers", () => {
      if (!config.ai.tools.includes("claude")) return skip("ai.tools has no claude");
      const launch = json(root, ".claude/launch.json");
      const { kind } = viewEntry(launch);
      if (kind === "kit") return ok();
      if (kind === "none") return fail("no question-pictures server in .claude/launch.json; run npx wf view setup");
      if (kind === "old") return fail("it is the old file server, which cannot take answers; run npx wf view setup");
      return fail("the question-pictures entry in .claude/launch.json runs something of the project's own; rename it, or make it run npx wf view serve");
    }],
    ["the branch hooks are on", () => {
      const line = hooksLine(io.hooksPath ?? hooksPathOf(root));
      return line ? fail(line) : ok();
    }],
    ["GitHub is reachable for this repo", () => {
      const remote = gh(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]);
      if (remote.error) return skip("gh is not installed");
      return remote.status === 0 ? ok(remote.stdout.trim()) : fail("gh cannot see this repo: sign in with gh auth login, or add the remote");
    }],
  ];
}

/** Run the checks and print them; returns the exit code. */
export async function runDoctor(root, project, io = {}, log = console.log) {
  let failed = 0;
  for (const [label, check] of doctorSteps(root, project, io)) {
    const { status, note, lines = [] } = await check();
    if (status === "FAIL") failed += 1;
    log(`${status.padEnd(4)} ${label}${note ? `: ${note}` : ""}`);
    for (const line of lines) log(`     - ${line}`);
  }
  log(failed ? `${failed} to fix.` : "The set-up is whole.");
  return failed ? 1 : 0;
}
