#!/usr/bin/env node
// The kit's command line. Run it from anywhere inside a project:
//   wf doc:find <ID, date, or heading> [file or folder ...]
//   wf doc:facts [status | growth]
//   wf doc:check
//   wf config          the project's settings over the defaults, with reasons
//   wf roles [--write] the Who decides block, or write it into AGENTS.md
//   wf ai:sync         OpenCode agents, commands, and skill paths from the project and the kit
//   wf ai:check        fail if any of those is out of step

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { reconcile } from "../lib/ai.mjs";
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
