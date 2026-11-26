#!/usr/bin/env node
// The kit's command line. Run it from anywhere inside a project:
//   wf doc:find <ID, date, or heading> [file or folder ...]
//   wf doc:facts [status | growth]
//   wf doc:check
//   wf config          the project's settings over the defaults, with reasons
//   wf roles [--write] the Who decides block, or write it into AGENTS.md
//   wf ai:sync         OpenCode agents, commands, and skill paths from the project and the kit
//   wf ai:check        fail if any of those is out of step
//   wf scan full | diff <since> [--light] [--performance on|off] [--verify | --no-verify]   the review's scans into .cache/review-scan
//   wf choose <review | screens | chunk | release | e2e>   a launch page's spec for a choice point, from the project's state, for wf ask page -
//   wf ledger <ledger.py arguments>         change the review ledger; migrate moves an older one
//   wf docs sync       write the kit's workflow docs into the project, with its local parts
//   wf testdata <route|stale|covered|index|journeys|e2e-files|refresh-close> <area> ...   the project's test-data steps
//   wf id <ID> [--all]                 where an ID is defined, and every place that cites it
//   wf id --clashes [--no-fetch]       the IDs this branch adds that main or an open branch adds too
//   wf testdata trace [area] [--all]   spec rows no code names, and tests that name no row or story
//   wf testdata trace --chunk <id> [--all]   a chunk's lines and rules: proven, walk, later, disputed, or proven by nothing
//   wf testdata rename-ids [area] [--write] [--all]   qualify old IDs with their area: R-12 to R-GM-12
//   wf testdata review <area> [--chunk <id> | --stories <ids>] [--team]
//   wf testdata drop <area> <ID>... --why "<why>" | --from <ask id> [--write]   rows the owner dropped   an ask page of the owner's rows, or the team's
//   wf testdata budget <area> [story ids] [--check]     each story's fixtures against its cap, for the designer's prompt
//   wf testdata delta <area> <file>                 the designer's return, held to its caps before it is applied
//   wf testdata prune <area> [--all] [--write]   check rows no code cites, out of the spec
//   wf testdata merge <folder> [--write]           a flow area's folder as one file, every row kept
//   wf testdata fold <file> <sibling> [--write]    a small file into a sibling in its folder
//   wf ask <templates | example | fields | page | wait | answers | record | export | import | live | reply | history> ...   ask a person on a page beside the chat
//   wf view <serve | stop | setup | notify>   the ask-pages server, which serves .cache/view and takes an ask page's answers
//   wf design <render | check | storyboard | annotate> ...   design frames, their pictures, and question sheets
//   wf app <start | run | stop | ...>   drive the project's app, Tauri or web, under a memory cap
//   wf try [scenario] [--keep] [--dry-run] [--files]   open the app yourself at a test scenario
//   wf disk [--dry-run] [GB]            check free space, and clean only leftovers when low
//   wf github <sync | check | ruleset>   the .github files from the github config, and the ruleset to apply
//   wf board <setup [--create] | plan | sync | feedback [--json | --brief] | drafts <file> | reply <id> <Q-ID ...|--noted|--answered <Q-ID>>>   the client's monday.com board
//   wf signoffs [--bypass "<reason>"]   the questions this branch still waits on, or an admin's bypass of them
//   wf decision add <file> "<decision>" "<why>" | supersede <ID> [<ID> ...] <by ID>   the decisions log
//   wf question add <chunk | none> "<question>" <needs> "<from>" [story IDs ...] [--revisit "<when>"] | resolve <Q-ID> "<decision>"   the open questions log; with a team server, inbox | pull | publish <Q-ID>
//   wf release <next | check | set | verify> ...   the project's release commands
//   wf ready <quick | chunk | area> [chunk]   what a track needs before work starts
//   wf done <quick | chunk | area> [chunk]    what a track needs before its pull request
//   wf tools          what this computer has of tools.md, and whether the branch hooks are on
//   wf check [--all]  the project's checks from check.steps, one line each
//   wf hooks <install | pre-commit | pre-push>   the git hooks that hold branches.md
//   wf init <answers.json>   set up a new project from the workflow-init skill's answers
//   wf doctor         whether the project's set-up is whole
//   wf team <serve | invite | revoke | members>   the team server, and an admin's invites on it
//   wf screens <--light | --deep | names | scope | --brief | --accept | ...>   the screen check

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { loadConfig, project, projectRoot } from "../lib/config/config.mjs";

const commands = {
  async "doc:find"([query, ...paths]) {
    const { findEntries } = await import("../lib/docs/shape.mjs");
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
    const { growth, status } = await import("../lib/docs/facts.mjs");
    const context = project();
    const parts = which === "status" ? [status] : which === "growth" ? [growth] : [status, growth];
    const lines = [];
    for (const part of parts) lines.push(...(await part(context)));
    console.log(lines.join("\n"));
    return 0;
  },

  async "doc:check"() {
    const { problems, warnings } = await import("../lib/docs/check.mjs");
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
    const { roleProblems, rolesBlock, writeRoles } = await import("../lib/roles.mjs");
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
    const { reconcile } = await import("../lib/setup/ai.mjs");
    const { problems, changed, counts } = await reconcile(projectRoot(), { write: true });
    for (const problem of problems) console.error(problem);
    console.log(`OpenCode is in step (${counts.agents} agents, ${counts.commands} commands, ${changed} updated).`);
    return problems.length ? 1 : 0;
  },

  async "ai:check"() {
    const { reconcile } = await import("../lib/setup/ai.mjs");
    const { problems, counts } = await reconcile(projectRoot());
    for (const problem of problems) console.error(problem);
    if (problems.length) {
      console.error("Run wf ai:sync.");
      return 1;
    }
    console.log(`OpenCode is in step (${counts.agents} agents, ${counts.commands} commands).`);
    return 0;
  },

  async scan(args) {
    const { install } = await import("../lib/setup/hooks.mjs");
    const { didNotRun, performanceLine, scan } = await import("../lib/review.mjs");
    const [mode, since] = args;
    const value = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
    const performance = value("--performance");
    if (!["full", "diff"].includes(mode) || (mode === "diff" && (!since || since.startsWith("--"))) || (performance && !["on", "off"].includes(performance))) {
      console.log("Usage: wf scan full | wf scan diff <since> [--light] [--performance on|off] [--verify | --no-verify]");
      return 2;
    }
    const root = projectRoot();
    const config = loadConfig(root);
    const result = await scan(root, config, { mode, since: mode === "diff" ? since : undefined, light: args.includes("--light"), performance });
    if (mode === "diff") console.log(`Scope: ${result.scope.length} files, in .cache/review-scan/scope.txt.${result.deps ? " A dependency file changed, so the deps scans ran." : ""}`);
    console.log(performanceLine(performance ? { ...config.review, performance: performance === "on" ? "always" : "off" } : config.review, result.performance));
    // The verify pass runs in the skill; the scan says whether this run asked for it, so the skill reads one line.
    const verify = args.includes("--verify") ? true : args.includes("--no-verify") ? false : config.review.verify;
    console.log(`Verify pass: ${verify ? "on" : "off"}${args.includes("--verify") || args.includes("--no-verify") ? ", asked for this run" : ", from review.verify"}.`);
    for (const [name, code] of result.ran) {
      const note = didNotRun(code) ? " DID NOT RUN: install or fix it before reviewing" : code ? " (read its output: non-zero often means found something)" : "";
      console.log(`  ${name}: exit ${code}${note}`);
    }
    return result.ran.some(([, code]) => didNotRun(code)) ? 1 : 0;
  },

  async choose(args) {
    const { choose } = await import("../lib/choose/index.mjs");
    const root = projectRoot();
    return choose(root, loadConfig(root), args);
  },

  async ledger(args) {
    const { ledger } = await import("../lib/review.mjs");
    const root = projectRoot();
    return ledger(root, loadConfig(root), args);
  },

  async docs([sub]) {
    const { syncDocs } = await import("../lib/docs/docsync.mjs");
    if (sub !== "sync") {
      console.log("Usage: wf docs sync");
      return 2;
    }
    const root = projectRoot();
    const changed = syncDocs(root, loadConfig(root));
    console.log(changed.length ? changed.map((file) => `${file}: written`).join("\n") : "Workflow docs already match the kit.");
    return 0;
  },

  async testdata(args) {
    const { runTestdataCommand } = await import("../lib/testdata/cli.mjs");
    return runTestdataCommand(projectRoot(), args);
  },

  /** `wf id <ID> [--all]`: where an ID is defined, and every place that cites it. */
  async id(args) {
    if (args.includes("--clashes")) {
      const { idClashes, clashLines } = await import("../lib/idclash.mjs");
      const root = projectRoot();
      const found = idClashes(root, loadConfig(root), { fetch: !args.includes("--no-fetch") });
      for (const line of clashLines(found)) console.log(line);
      return found.clashes.length ? 1 : 0;
    }
    const target = args.find((a) => !a.startsWith("--"));
    if (!target) {
      console.log("Usage: wf id <ID> [--all]   such as R-GM-119, C-GM-41, GM-07, D-GM-101, Q-113, or a fixture's name; the patterns are in docs/workflow/ids.md\n       wf id --clashes [--no-fetch]   the IDs this branch adds that main or an open branch adds too");
      return 2;
    }
    const { findId, idLines } = await import("../lib/idfind.mjs");
    const { config, tracked, files, links } = project();
    const found = findId({ config, tracked: tracked.filter((path) => !links.has(path)), files }, target);
    for (const line of idLines(found, { all: args.includes("--all") })) console.log(line);
    return found.defined.length || found.cited.length ? 0 : 1;
  },

  async design(args) {
    const { design } = await import("../lib/design/index.mjs");
    return design(args);
  },
  async ask(args) {
    const { runAsk } = await import("../lib/ask/index.mjs");
    return runAsk(args);
  },
  async view(args) {
    const { runView } = await import("../lib/view/command.mjs");
    return runView(args);
  },
  async team(args) {
    const { runTeam } = await import("../lib/team/command.mjs");
    return runTeam(args);
  },

  async app(args) {
    const { runApp } = await import("../lib/app/driver.mjs");
    const root = projectRoot();
    return runApp(root, loadConfig(root), args);
  },

  async try(args) {
    const { runTry } = await import("../lib/try/index.mjs");
    const root = projectRoot();
    return runTry(root, loadConfig(root), args);
  },

  async github([sub]) {
    const { ruleset, rulesetBlocked, syncGithub } = await import("../lib/setup/github.mjs");
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
    const { localToday } = await import("../lib/docs/check.mjs");
    const { addDecision, supersedeAll } = await import("../lib/logs/decisions.mjs");
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
    if (args[0] === "inbox" || args[0] === "pull" || args[0] === "publish") {
      const { runTeamQuestion } = await import("../lib/team/questions.mjs");
      return runTeamQuestion(args);
    }
    const { localToday } = await import("../lib/docs/check.mjs");
    const { runQuestion } = await import("../lib/logs/questions.mjs");
    const root = projectRoot();
    return runQuestion(root, loadConfig(root), args, localToday());
  },

  async board(args) {
    const { runBoard } = await import("../lib/board/index.mjs");
    return runBoard(project(), args);
  },

  async signoffs(args) {
    const { localToday } = await import("../lib/docs/check.mjs");
    const { runSignoffs } = await import("../lib/logs/signoffs.mjs");
    const root = projectRoot();
    return runSignoffs(root, loadConfig(root), args, localToday());
  },

  async release([name, ...args]) {
    const { runRelease, STEPS } = await import("../lib/release.mjs");
    if (!name) {
      console.log(`Usage: wf release <${Object.keys(STEPS).join("|")}> [arguments]`);
      return 2;
    }
    const root = projectRoot();
    return runRelease(root, loadConfig(root), name, args);
  },

  async ready(args) {
    const { runTrack } = await import("../lib/tracks.mjs");
    const root = projectRoot();
    return runTrack(root, loadConfig(root), "ready", args);
  },

  async done(args) {
    const { runTrack } = await import("../lib/tracks.mjs");
    const root = projectRoot();
    return runTrack(root, loadConfig(root), "done", args);
  },

  async init([file]) {
    const { KIT_ROOT, reconcile } = await import("../lib/setup/ai.mjs");
    const { localToday } = await import("../lib/docs/check.mjs");
    const { syncGithub } = await import("../lib/setup/github.mjs");
    const { install } = await import("../lib/setup/hooks.mjs");
    const { answerProblems, writeStarter } = await import("../lib/setup/init.mjs");
    const { syncDocs } = await import("../lib/docs/docsync.mjs");
    if (!file) {
      console.log("Usage: wf init <answers.json>; the workflow-init skill writes the answers.");
      return 2;
    }
    const root = process.cwd();
    const { readJsonFile } = await import("../lib/process.mjs");
    const answers = readJsonFile(file);
    const found = answerProblems(answers);
    if (found.length) {
      for (const problem of found) console.error(problem);
      return 1;
    }
    const templates = Object.fromEntries(["threat-model", "hot-paths"].map((name) => [name, readFileSync(join(KIT_ROOT, "templates", `${name}.md`), "utf8")]));
    for (const [path, what] of writeStarter(root, answers, { templates })) console.log(`${path}: ${what}`);
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
    const { runDoctor } = await import("../lib/setup/doctor.mjs");
    return runDoctor(projectRoot(), project());
  },

  async tools() {
    const { runTools } = await import("../lib/setup/tools.mjs");
    const root = projectRoot();
    return runTools(root, loadConfig(root));
  },

  async check(args) {
    const { runChecks } = await import("../lib/checks.mjs");
    const root = projectRoot();
    return runChecks(root, loadConfig(root), args);
  },

  async hooks([hook]) {
    const { install, runHook } = await import("../lib/setup/hooks.mjs");
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
    const { screens } = await import("../lib/screens/run.mjs");
    const root = projectRoot();
    return screens(root, loadConfig(root), args);
  },

  async disk(args) {
    const { diskCheck } = await import("../lib/disk.mjs");
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
