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
//   wf id <ID> [--all]                 where an ID is defined, and every place that cites it
//   wf testdata trace [area] [--all]   spec rows no code names, and tests that name no row or story
//   wf testdata ids <area>             give every check without an ID its own, C-<prefix>-NN
//   wf testdata rename-ids [area] [--write] [--all]   qualify old IDs with their area: R-12 to R-GM-12
//   wf testdata merge <folder> [--write]           a flow area's folder as one file, every row kept
//   wf testdata fold <file> <sibling> [--write]    a small file into a sibling in its folder
//   wf ask <templates | example | page | wait | answers | record | export | import | live | reply | history> ...   ask a person on a page beside the chat
//   wf view <serve | stop | setup | notify>   the question-pictures server, which serves .cache/view and takes an ask page's answers
//   wf design <render | check | storyboard | annotate> ...   design frames, their pictures, and question sheets
//   wf app <start | run | stop | ...>   drive the project's app, Tauri or web, under a memory cap
//   wf try [scenario] [--keep] [--dry-run] [--files]   open the app yourself at a test scenario
//   wf disk [--dry-run] [GB]            check free space, and clean only leftovers when low
//   wf github <sync | check | ruleset>   the .github files from the github config, and the ruleset to apply
//   wf board <setup [--create] | plan | sync | feedback [--json] | reply <id> <Q-ID ...|--noted>>   the client's monday.com board
//   wf signoffs [--bypass "<reason>"]   the questions this branch still waits on, or an admin's bypass of them
//   wf decision add <file> "<decision>" "<why>" | supersede <ID> [<ID> ...] <by ID>   the decisions log
//   wf question add <chunk | none> "<question>" <needs> "<from>" [story IDs ...] [--revisit "<when>"] | resolve <Q-ID> "<decision>"   the open questions log
//   wf release <next | check | set | verify> ...   the project's release commands
//   wf ready <quick | chunk | area> [chunk]   what a track needs before work starts
//   wf done <quick | chunk | area> [chunk]    what a track needs before its pull request
//   wf tools          what this computer has of tools.md, and whether the branch hooks are on
//   wf check [--all]  the project's checks from check.steps, one line each
//   wf hooks <install | pre-commit | pre-push>   the git hooks that hold branches.md
//   wf init <answers.json>   set up a new project from the workflow-init skill's answers
//   wf doctor         whether the project's set-up is whole
//   wf screens <--light | --deep | names | scope | --brief | --accept | ...>   the screen check

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { KIT_ROOT, reconcile } from "../lib/setup/ai.mjs";
import { localToday } from "../lib/docs/check.mjs";
import { runApp } from "../lib/app/driver.mjs";
import { runTry } from "../lib/try/index.mjs";
import { design } from "../lib/design/index.mjs";
import { runAsk, runView } from "../lib/ask/index.mjs";
import { diskCheck } from "../lib/disk.mjs";
import { addDecision, supersedeAll } from "../lib/logs/decisions.mjs";
import { runQuestion } from "../lib/logs/questions.mjs";
import { runBoard } from "../lib/board/index.mjs";
import { ruleset, rulesetBlocked, syncGithub } from "../lib/setup/github.mjs";
import { runRelease, STEPS } from "../lib/release.mjs";
import { runSignoffs } from "../lib/logs/signoffs.mjs";
import { screens } from "../lib/screens/run.mjs";
import { runTrack } from "../lib/tracks.mjs";
import { runChecks } from "../lib/checks.mjs";
import { install, runHook } from "../lib/setup/hooks.mjs";
import { runTools } from "../lib/setup/tools.mjs";
import { answerProblems, writeStarter } from "../lib/setup/init.mjs";
import { runDoctor } from "../lib/setup/doctor.mjs";
import { syncDocs } from "../lib/docs/docsync.mjs";
import { didNotRun, ledger, scan } from "../lib/review.mjs";
import { runTestdata } from "../lib/testdata.mjs";
import { loadConfig, project, projectRoot } from "../lib/config/config.mjs";
import { problems, warnings } from "../lib/docs/check.mjs";
import { growth, status } from "../lib/docs/facts.mjs";
import { findEntries } from "../lib/docs/shape.mjs";
import { roleProblems, rolesBlock, writeRoles } from "../lib/roles.mjs";

const commands = {
  async "doc:find"([query, ...paths]) {
    if (!query) {
      console.log("Usage: wf doc:find <ID, date, or heading> [file or folder ...]   (default: docs)");
      return 2;
    }
    const found = findEntries(projectRoot(), query, paths);
    for (const entry of found) console.log(`${entry.path}:${entry.line}\n${entry.text}\n`);
    console.log(found.length ? `${found.length} found.` : `Nothing starts with "${query}". Try grep for a word inside an entry.`);
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
    const context = project();
    const found = await problems(context);
    for (const problem of found) console.log(problem);
    const noted = warnings(context);
    for (const warning of noted) console.log(`WARN ${warning}`);
    const also = noted.length ? `, and ${noted.length} ${noted.length === 1 ? "warning" : "warnings"} to judge` : "";
    console.log(found.length === 0 ? `Docs are in step${also}.` : `${found.length} to look at${also}.`);
    return found.length === 0 ? 0 : 1;
  },

  async roles([flag]) {
    const root = projectRoot();
    const config = loadConfig(root);
    for (const problem of roleProblems(config)) console.error(`.workflow/config.json: ${problem}`);
    if (flag !== "--write") {
      console.log(rolesBlock(config));
      return 0;
    }
    for (const line of writeRoles(root, config)) (line.error ? console.error : console.log)(line.text);
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
      console.log("Usage: wf testdata <route|stale|covered|index|journeys|e2e-files|refresh-close> <area> [arguments]\n       wf testdata trace [area] [--all]\n       wf testdata ids <area>\n       wf testdata rename-ids [area] [--write] [--all]\n       wf testdata merge <folder> [--write]\n       wf testdata fold <file> <sibling> [--write]");
      return 2;
    }
    const root = projectRoot();
    if (name === "merge" || name === "fold") {
      // The kit's own steps: a dry run unless --write, and never a write that loses a row.
      const { foldFile, mergeFolder, mergeLines } = await import("../lib/testdata-merge.mjs");
      const { existsSync, mkdirSync, readdirSync, rmdirSync, unlinkSync, writeFileSync } = await import("node:fs");
      const { dirname, join } = await import("node:path");
      const [first, second] = args.filter((a) => !a.startsWith("--"));
      if (!first || (name === "fold" && !second)) {
        console.log(name === "merge" ? "Usage: wf testdata merge <flow area folder> [--write]" : "Usage: wf testdata fold <small file> <sibling> [--write]");
        return 2;
      }
      // An ignored file is not listed, so a merge asks the disk whether its file is there.
      const ctx = { ...project(), exists: (path) => existsSync(join(root, path)) };
      const found = name === "merge" ? mergeFolder(ctx, first) : foldFile(ctx, first, second);
      const asked = args.includes("--write");
      const write = asked && found.before === found.after;
      let kept = [];
      if (write) {
        for (const [path, text] of found.writes) {
          mkdirSync(dirname(join(root, path)), { recursive: true });
          writeFileSync(join(root, path), text);
        }
        for (const path of found.removes) unlinkSync(join(root, path));
        if (name === "merge") {
          const folder = join(root, first.replace(/\/+$/, ""));
          kept = readdirSync(folder);
          if (!kept.length) rmdirSync(folder);
        }
      }
      for (const line of mergeLines(found, { from: first, asked, write, limit: ctx.config.testdata.limits.lines, kept })) console.log(line);
      return found.before === found.after ? 0 : 1;
    }
    if (name === "rename-ids") {
      // The kit's own step: a dry run unless --write.
      const { renameIds, renameLines } = await import("../lib/testdata-rename.mjs");
      const { writeFileSync } = await import("node:fs");
      const { join } = await import("node:path");
      const { config, tracked, files, links } = project();
      const write = args.includes("--write");
      // A link can point outside the project, so it is never read or written.
      const found = renameIds({ config, tracked: tracked.filter((path) => !links.has(path)), files }, args.find((a) => !a.startsWith("--")) ?? null);
      found.links = [...links];
      if (write) for (const [path, text] of found.texts) writeFileSync(join(root, path), text);
      for (const line of renameLines(found, { write, all: args.includes("--all") })) console.log(line);
      return 0;
    }
    if (name === "ids") {
      // The kit's own step: number the area's checks that have no ID, in file order, never renumbering one.
      const { fillCheckIds } = await import("../lib/testdata.mjs");
      const { execFileSync } = await import("node:child_process");
      const { readFileSync, writeFileSync } = await import("node:fs");
      const { join } = await import("node:path");
      const config = loadConfig(root);
      const area = config.areas.find((each) => each.id === args[0] && each.docs);
      if (!area) {
        console.log(`Usage: wf testdata ids <area>; areas with a docs folder: ${config.areas.filter((each) => each.docs).map((each) => each.id).join(", ") || "none"}`);
        return 2;
      }
      const dir = `${area.docs}/test-data/`;
      const tracked = execFileSync("git", ["ls-files", "--", dir], { cwd: root, encoding: "utf8" }).trim().split("\n").filter((p) => p.endsWith(".md"));
      const { texts, added } = fillCheckIds(tracked, (path) => readFileSync(join(root, path), "utf8"), area.prefix ?? "");
      for (const [path, text] of texts) writeFileSync(join(root, path), text);
      console.log(added ? `${area.id}: ${added} ${added === 1 ? "check" : "checks"} got an ID, in ${texts.size} ${texts.size === 1 ? "file" : "files"}.` : `${area.id}: every check has an ID.`);
      return 0;
    }
    if (name === "trace") {
      // The kit's own step: it reads the spec and the code, and runs no project command.
      const { trace, traceLines } = await import("../lib/testdata-trace.mjs");
      const area = args.find((a) => !a.startsWith("--")) ?? null;
      for (const line of traceLines(trace(project(), area), { all: args.includes("--all") })) console.log(line);
      return 0;
    }
    return runTestdata(root, loadConfig(root), name, args);
  },

  /** `wf id <ID> [--all]`: where an ID is defined, and every place that cites it. */
  async id(args) {
    const target = args.find((a) => !a.startsWith("--"));
    if (!target) {
      console.log("Usage: wf id <ID> [--all]   such as R-GM-119, C-GM-41, GM-07, D-GM-101, Q-113, or a fixture's name; the patterns are in docs/workflow/ids.md");
      return 2;
    }
    const { findId, idLines } = await import("../lib/idfind.mjs");
    const { config, tracked, files, links } = project();
    const found = findId({ config, tracked: tracked.filter((path) => !links.has(path)), files }, target);
    for (const line of idLines(found, { all: args.includes("--all") })) console.log(line);
    return found.defined.length || found.cited.length ? 0 : 1;
  },

  design,
  async ask(args) {
    return runAsk(args);
  },
  async view(args) {
    return runView(args);
  },

  async app(args) {
    const root = projectRoot();
    return runApp(root, loadConfig(root), args);
  },

  async try(args) {
    const root = projectRoot();
    return runTry(root, loadConfig(root), args);
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
      console.log(addDecision(root, config, args[0], args[1], args[2], localToday()));
      return 0;
    }
    if (sub === "supersede" && args.length >= 2) {
      // Every ID before the last is superseded by the last, so none given is dropped.
      const by = args.at(-1);
      supersedeAll(root, config, args.slice(0, -1), by);
      for (const id of args.slice(0, -1)) console.log(`${id} superseded by ${by}`);
      return 0;
    }
    console.log('Usage: wf decision add <file> "<decision>" "<why>"   or   wf decision supersede <ID> [<ID> ...] <by ID>');
    return 2;
  },

  async question(args) {
    const root = projectRoot();
    return runQuestion(root, loadConfig(root), args, localToday());
  },

  async board(args) {
    return runBoard(project(), args);
  },

  async signoffs(args) {
    const root = projectRoot();
    return runSignoffs(root, loadConfig(root), args, localToday());
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

  async init([file]) {
    if (!file) {
      console.log("Usage: wf init <answers.json>; the workflow-init skill writes the answers.");
      return 2;
    }
    const root = process.cwd();
    const answers = JSON.parse(readFileSync(file, "utf8"));
    const found = answerProblems(answers);
    if (found.length) {
      for (const problem of found) console.error(problem);
      return 1;
    }
    const template = readFileSync(join(KIT_ROOT, "templates", "threat-model.md"), "utf8");
    for (const [path, what] of writeStarter(root, answers, { today: localToday(), template })) console.log(`${path}: ${what}`);
    const config = loadConfig(root);
    for (const path of syncDocs(root, config)) console.log(`${path}: written`);
    const { problems } = await reconcile(root, { write: true, tools: config.ai.tools });
    for (const problem of problems) console.error(problem);
    for (const line of install(root)) console.log(line);
    const github = syncGithub(root, config, { write: true });
    for (const problem of github.problems) console.error(problem);
    if (github.changed) console.log(`.github: ${github.changed} written`);
    console.log("Next: install the packages, then add the kit's marketplace and plugins in Claude Code, restart it, and run npx wf doctor.");
    return problems.length || github.problems.length ? 1 : 0;
  },

  async doctor() {
    return runDoctor(projectRoot(), project());
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
    console.log(`\nWhat each setting does, its default, and why: ${config.docs.workflow}/config.md, and on hover in an editor from .workflow/config.schema.json.`);
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
