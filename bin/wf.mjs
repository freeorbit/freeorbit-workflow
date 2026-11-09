#!/usr/bin/env node
// The kit's command line. Run it from anywhere inside a project:
//   wf doc:find <ID, date, or heading> [file or folder ...]
//   wf doc:facts [status | growth]
//   wf doc:check
//   wf config          the project's settings over the defaults, with reasons
//   wf roles [--write] the Who decides block, or write it into AGENTS.md
//   wf ai:sync         OpenCode agents, commands, and skill paths from the project and the kit
//   wf ai:check        fail if any of those is out of step
//   wf scan full | diff <since> [--light]   the review's scans into .cache/review-scan
//   wf ledger <ledger.py arguments>         change the review ledger
//   wf docs sync       write the kit's workflow docs into the project, with its local parts
//   wf testdata <route|stale|covered|index|journeys|e2e-files|refresh-close> <area> ...   the project's test-data steps
//   wf design <render | check | storyboard | annotate> ...   design frames, their pictures, and question sheets
//   wf app <start | run | stop | ...>   drive the project's Tauri app under a memory cap
//   wf disk [--dry-run] [GB]            check free space, and clean only leftovers when low
//   wf github <sync | check | ruleset>   the .github files from the github config, and the ruleset to apply
//   wf signoffs        the needs lines this branch still waits on
//   wf decision add <file> "<decision>" "<why>" | supersede <ID> <by ID>   the decisions log
//   wf release <next | check | set | verify> ...   the project's release commands
//   wf ready <quick | chunk | area> [chunk]   what a track needs before work starts
//   wf done <quick | chunk | area> [chunk]    what a track needs before its pull request
//   wf tools          what this computer has of tools.md, and whether the branch hooks are on
//   wf check [--all]  the project's checks from check.steps, one line each
//   wf hooks <install | pre-commit | pre-push>   the git hooks that hold branches.md
//   wf screens <--light | --deep | names | scope | --brief | --accept | ...>   the screen check

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { reconcile } from "../lib/ai.mjs";
import { runApp } from "../lib/app/driver.mjs";
import { design } from "../lib/design/index.mjs";
import { diskCheck } from "../lib/disk.mjs";
import { addDecision, supersede } from "../lib/decisions.mjs";
import { ruleset, rulesetBlocked, syncGithub } from "../lib/github.mjs";
import { runRelease, STEPS } from "../lib/release.mjs";
import { signoffs } from "../lib/signoffs.mjs";
import { screens } from "../lib/screens/run.mjs";
import { runTrack } from "../lib/tracks.mjs";
import { runChecks } from "../lib/checks.mjs";
import { install, runHook } from "../lib/hooks.mjs";
import { runTools } from "../lib/tools.mjs";
import { syncDocs } from "../lib/docsync.mjs";
import { didNotRun, ledger, scan } from "../lib/review.mjs";
import { runTestdata } from "../lib/testdata.mjs";
import { loadConfig, project, projectRoot } from "../lib/config.mjs";
import { DEFAULTS, REASONS } from "../lib/defaults.mjs";
import { problems } from "../lib/docs/check.mjs";
import { growth, status } from "../lib/docs/facts.mjs";
import { entries } from "../lib/docs/shape.mjs";
import { BLOCK_END, BLOCK_START, roleProblems, rolesBlock, withBlock } from "../lib/roles.mjs";

const commands = {
  async "doc:find"([query, ...paths]) {
    if (!query) {
      console.log("Usage: wf doc:find <ID, date, or heading> [file or folder ...]   (default: docs)");
      return 2;
    }
    const root = projectRoot();
    const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", ...(paths.length ? paths : ["docs"])], {
      cwd: root,
      encoding: "utf8",
    })
      .split("\n")
      .filter((path) => path.endsWith(".md"));
    let count = 0;
    for (const path of files) {
      for (const entry of entries(readFileSync(join(root, path), "utf8"), query)) {
        console.log(`${path}:${entry.line}\n${entry.text}\n`);
        count += 1;
      }
    }
    console.log(count ? `${count} found.` : `Nothing starts with "${query}". Try grep for a word inside an entry.`);
    return 0;
  },

  async "doc:facts"([which]) {
    const context = project();
    const parts = which === "status" ? [status] : which === "growth" ? [growth] : [status, growth];
    const lines = [];
    for (const part of parts) lines.push(...(await part(context)));
    console.log(lines.join("\n"));
    return 0;
  },

  async "doc:check"() {
    const found = await problems(project());
    for (const problem of found) console.log(problem);
    console.log(found.length === 0 ? "Docs are in step." : `${found.length} to look at.`);
    return found.length === 0 ? 0 : 1;
  },

  async roles([flag]) {
    const root = projectRoot();
    const config = loadConfig(root);
    for (const problem of roleProblems(config)) console.error(`.workflow/config.json: ${problem}`);
    const block = rolesBlock(config);
    if (flag !== "--write") {
      console.log(block);
      return 0;
    }
    for (const path of config.growth.always) {
      const file = join(root, path);
      let text;
      try {
        text = readFileSync(file, "utf8");
      } catch {
        continue;
      }
      const fresh = withBlock(text, block);
      if (fresh === null) console.error(`${path}: no ${BLOCK_START} and ${BLOCK_END} markers, so nothing was written`);
      else if (fresh !== text) {
        writeFileSync(file, fresh);
        console.log(`${path}: Who decides updated`);
      } else console.log(`${path}: Who decides already up to date`);
    }
    return 0;
  },

  async "ai:sync"() {
    const { problems, changed, counts } = await reconcile(projectRoot(), { write: true });
    for (const problem of problems) console.error(problem);
    console.log(`OpenCode is in step (${counts.agents} agents, ${counts.commands} commands, ${changed} updated).`);
    return problems.length ? 1 : 0;
  },

  async "ai:check"() {
    const { problems, counts } = await reconcile(projectRoot());
    for (const problem of problems) console.error(problem);
    if (problems.length) {
      console.error("Run wf ai:sync.");
      return 1;
    }
    console.log(`OpenCode is in step (${counts.agents} agents, ${counts.commands} commands).`);
    return 0;
  },

  async scan([mode, since, flag]) {
    if (!["full", "diff"].includes(mode) || (mode === "diff" && !since)) {
      console.log("Usage: wf scan full | wf scan diff <since> [--light]");
      return 2;
    }
    const root = projectRoot();
    const result = await scan(root, loadConfig(root), { mode, since, light: flag === "--light" || since === "--light" });
    if (mode === "diff") console.log(`Scope: ${result.scope.length} files, in .cache/review-scan/scope.txt.${result.deps ? " A dependency file changed, so the deps scans ran." : ""}`);
    for (const [name, code] of result.ran) {
      const note = didNotRun(code) ? " DID NOT RUN: install or fix it before reviewing" : code ? " (read its output: non-zero often means found something)" : "";
      console.log(`  ${name}: exit ${code}${note}`);
    }
    return result.ran.some(([, code]) => didNotRun(code)) ? 1 : 0;
  },

  async ledger(args) {
    const root = projectRoot();
    return ledger(root, loadConfig(root), args);
  },

  async docs([sub]) {
    if (sub !== "sync") {
      console.log("Usage: wf docs sync");
      return 2;
    }
    const root = projectRoot();
    const changed = syncDocs(root, loadConfig(root));
    console.log(changed.length ? changed.map((file) => `${file}: written`).join("\n") : "Workflow docs already match the kit.");
    return 0;
  },

  async testdata([name, ...args]) {
    if (!name) {
      console.log("Usage: wf testdata <route|stale|covered|index|journeys|e2e-files|refresh-close> <area> [arguments]");
      return 2;
    }
    const root = projectRoot();
    return runTestdata(root, loadConfig(root), name, args);
  },

  design,

  async app(args) {
    const root = projectRoot();
    return runApp(root, loadConfig(root), args);
  },

  async github([sub]) {
    const root = projectRoot();
    const config = loadConfig(root);
    if (sub === "ruleset") {
      const blocked = rulesetBlocked(config);
      if (blocked) {
        console.log(`No ruleset: ${blocked}.`);
        return 0;
      }
      console.log(JSON.stringify(ruleset(config), null, 2));
      console.error("Apply it with: gh api repos/{owner}/{repo}/rulesets -X POST --input <file>");
      return 0;
    }
    if (sub !== "sync" && sub !== "check") {
      console.log("Usage: wf github <sync | check | ruleset>");
      return 2;
    }
    const { problems, changed } = syncGithub(root, config, { write: sub === "sync" });
    for (const problem of problems) console.error(problem);
    if (!problems.length) console.log(sub === "sync" ? `GitHub files are in step (${changed} updated).` : "GitHub files are in step.");
    return problems.length ? 1 : 0;
  },

  async decision([sub, ...args]) {
    const root = projectRoot();
    const config = loadConfig(root);
    if (sub === "add" && args.length === 3) {
      const today = new Date().toLocaleDateString("sv-SE");
      console.log(addDecision(root, config, args[0], args[1], args[2], today));
      return 0;
    }
    if (sub === "supersede" && args.length === 2) {
      supersede(root, config, args[0], args[1]);
      console.log(`${args[0]} superseded by ${args[1]}`);
      return 0;
    }
    console.log('Usage: wf decision add <file> "<decision>" "<why>"   or   wf decision supersede <ID> <by ID>');
    return 2;
  },

  async signoffs() {
    const root = projectRoot();
    const config = loadConfig(root);
    const texts = [];
    try {
      texts.push([config.logs.openQuestions, readFileSync(join(root, config.logs.openQuestions), "utf8")]);
    } catch {
      // No open questions log yet.
    }
    // The branch's pull request body, when there is one and gh can read it.
    try {
      const body = execFileSync("gh", ["pr", "view", "--json", "body", "-q", ".body"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      texts.push(["the pull request", body]);
    } catch {
      // No pull request for this branch, or no gh.
    }
    const { lines, code } = signoffs(config, texts);
    for (const line of lines) console.log(line);
    return code;
  },

  async release([name, ...args]) {
    if (!name) {
      console.log(`Usage: wf release <${Object.keys(STEPS).join("|")}> [arguments]`);
      return 2;
    }
    const root = projectRoot();
    return runRelease(root, loadConfig(root), name, args);
  },

  async ready(args) {
    const root = projectRoot();
    return runTrack(root, loadConfig(root), "ready", args);
  },

  async done(args) {
    const root = projectRoot();
    return runTrack(root, loadConfig(root), "done", args);
  },

  async tools() {
    const root = projectRoot();
    return runTools(root, loadConfig(root));
  },

  async check(args) {
    const root = projectRoot();
    return runChecks(root, loadConfig(root), args);
  },

  async hooks([hook]) {
    const root = projectRoot();
    if (hook === "install") {
      for (const line of install(root)) console.log(line);
      return 0;
    }
    if (hook !== "pre-commit" && hook !== "pre-push") {
      console.log("Usage: wf hooks <install | pre-commit | pre-push>");
      return 2;
    }
    const { code, lines } = runHook(root, loadConfig(root), hook);
    for (const line of lines) console.error(line);
    return code;
  },

  async screens(args) {
    const root = projectRoot();
    return screens(root, loadConfig(root), args);
  },

  async disk(args) {
    const root = projectRoot();
    const dryRun = args.includes("--dry-run");
    const number = args.find((arg) => /^\d+$/.test(arg));
    const config = loadConfig(root);
    return diskCheck(root, config, { dryRun, minimum: number ? Number(number) : config.disk.minimumGb });
  },

  async config() {
    const config = loadConfig(projectRoot());
    console.log(JSON.stringify(config, null, 2));
    console.log("\nWhy the defaults are what they are:");
    for (const [key, reason] of Object.entries(REASONS)) {
      const value = key.split(".").reduce((node, part) => node?.[part], DEFAULTS);
      console.log(`  ${key} = ${JSON.stringify(value)}: ${reason}`);
    }
    return 0;
  },
};

const [name, ...args] = process.argv.slice(2);
const command = commands[name];
if (!command) {
  console.log(`Usage: wf <${Object.keys(commands).join(" | ")}> ...`);
  process.exit(2);
}
try {
  process.exit(await command(args));
} catch (error) {
  console.error(`wf ${name}: ${error.message}`);
  process.exit(1);
}
