# freeorbit-workflow

The Freeorbit agent workflow as installable Claude Code plugins, the scripts they run, and the same skills for OpenCode. The plan and the audit behind it are `docs/research/workflow-kit.md` and `docs/research/workflow-audit.md` in Freeorbit.

## Install in a project

1. Add the package, pinned to a tag:

   ```sh
   pnpm add -D "freeorbit-workflow@git+https://github.com/freeorbit/freeorbit-workflow.git#v0.1.0"
   ```

2. Add the plugin for Claude Code, at project scope so everyone gets it:

   ```sh
   claude plugin marketplace add freeorbit/freeorbit-workflow --scope project
   claude plugin install core@freeorbit-workflow --scope project
   ```

3. Point OpenCode at the same skills in a committed `opencode.json`:

   ```json
   { "$schema": "https://opencode.ai/config.json", "skills": ["node_modules/freeorbit-workflow/plugins/core/skills"] }
   ```

4. Write `.workflow/config.json`. Run `npx wf config` to see every setting, its default, and why the default is what it is.

## Commands

| Command | What it does |
| --- | --- |
| `wf doc:find <ID, date, or heading> [path]` | Prints each entry that starts with the query |
| `wf doc:facts [status \| growth]` | Where the work stands, and what the docs cost to load |
| `wf doc:check` | Links, the index, story IDs, chunk tables, block length, dates after today, and the project's extensions |
| `wf config` | The project's settings over the defaults, with reasons |

A project adds its own checks and status lines with `extensions` in its config: modules that export `checks(context)` and `status(context)`.

## Develop

```sh
npm test                                   # unit tests
claude plugin validate .                   # marketplace and plugins
```

Skill evals in `plugins/*/evals/` are off for now: no step or CI runs them. They run only by hand, `claude plugin eval plugins/core --runs 1`, at a few cents a case.

A release bumps `version` in `package.json` and in each changed plugin's `plugin.json`, then tags `v<version>`. Projects move to it by changing the tag they pin.
