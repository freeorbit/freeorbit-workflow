---
name: web-app-testing
description: >-
  Runs, tests, and debugs the project's web app without the user, on Linux:
  runs the project's checks, starts its servers and a headless Chromium under a
  memory cap, reads the page text and console, clicks and types, takes
  screenshots to compare with design frames, and queries its database. Use
  after changing app or UI code, before proposing a commit, and when the user
  asks to run, test, try, debug, or screenshot the app, or reports a blank
  page, an error, or a screen that looks wrong.
---

# Web app testing

Test changes yourself before handing back, and say what you checked. Do not ask the user to run the app for something this skill can check.

Read the project's app-testing doc first, `app.doc` in `.workflow/config.json` (`npx wf config` prints it). It has the project's checks, how its servers start, its test data and how to seed it, and stubs for outside services. `app.kind` is `web`, and `app.web` names the address Chromium opens and the servers behind it. Commands run from the repo root, and use systemd user units, or detached processes where there is no user systemd such as on macOS (`app.runner`), and `/tmp`, so they run outside a sandbox.

## 1. Checks

Run `npx wf check` while working, and `npx wf check --all` once before handing back. Fix failures before going further.

## 2. Run and look

Chromium runs headless by default (`app.web.headless`), so the person's desktop is left alone; `start --headed` or `--headless` overrides it for one start, and a screen run sets its own with `screens.headless`, and with its sandbox (`app.web.sandbox`), which only a CI runner that forbids it turns off. The setting covers this driver, not the design tools' renders. A website has no fixed window: a run opens at `app.web.size`, or the project's frame size (`design.size`) when that is unset, and checks other widths with `size`. `<app.instanceEnv>=N` gives a second browser its own profile, unit, and debugging port (`app.web.debugPort` + N), with the servers shared, for a screen review in parallel.

```bash
npx wf app start --fresh            # starts the servers, then Chromium, and prints the first page
npx wf app run 'go /reviews' 'click "New review"' 'expect "Review details"' 'fits' 'shot /tmp/<name>-agent/setup.png' 'size mobile' 'fits' 'page /tmp/<name>-agent/setup-mobile.png'
npx wf app stop                     # always stop when done
```

Check a flow with one `run`, not one command per action. Plan the steps up front, then read the result: one line per step, and on the first failure the step, the reason, and the page text.

| `run` step | What it does |
| --- | --- |
| `go </path>` or `go <#hash>` | Loads a path, or changes the hash, then waits for the page to settle. |
| `back` | Goes one page back, as the browser's Back does, then waits for the page. Fails on the window's first page. |
| `size <name or WxH>` | Sets the viewport, such as `size mobile` or `size 1024x768`, from `app.web.sizes` (desktop, tablet, and mobile by default); a width under 768 renders as a phone. |
| `click <label> [in <group>]` | Clicks the button, link, list option, or field with that text, aria-label, or placeholder. `in <group>` picks the one beside that group's label. |
| `type <label> <value>` | Fills a field so React sees it, found by its aria-label, `<label>`, or placeholder. |
| `expect <text>` / `absent <text>` | Fails unless the text is, or is not, on the page. |
| `until <text>` | Waits up to 10 s for the text, such as a slow reply. |
| `show <text>` / `lines <text>` | Scrolls the element that reads exactly that to the top, or prints the lines that contain the text. |
| `text` / `url` / `eval <js>` | Prints the page text, the URL, or a value. `eval` runs the rest of the step as written, quotes and all. |
| `wait <ms>` | Waits, for a job that takes a while. |
| `shot [file]` / `page <file>` | Saves the viewport, or the whole page down to its foot, drawn at once. Read them with the Read tool. |
| `fits` | Fails if anything is wider than the window. Use it with `start --size <w>x<h>`. |

| Command | What it does |
| --- | --- |
| `start [--fresh] [--size <name or WxH>] [--headed or --headless]` | Starts each server in `app.web.servers` not already answering, waits for its `url`, then Chromium at `app.web.url`. `--fresh` gives Chromium a new profile and tells the project's `prepare` hook to reset its data. `--headed` opens it on the person's screen for this start, `--headless` without a window. |
| `go`, `back`, `click`, `type`, `text`, `eval` | One step as its own command; `go`, `back`, `click`, and `type` then print the page. |
| `console` | What the page logs while it watches, for half a second; reload or repeat a step around it to catch a message. |
| `screenshot`, `mem`, `status` | The window, the browser's memory against `app.memoryMax`, and which units run. |
| `logs [n]` | Each server's output, such as a stack trace from the API. |
| `db [name] ["sql"]` | Runs SQL through `psql` against an address in `app.databases`; without SQL it lists the tables. |
| `reset` | Stops the browser and deletes its profile. |

Each server and the browser run under `app.memoryMax` and stop themselves after `app.runtimeMaxSec`. A server that already answers at its `url`, such as the person's own dev server, is used and left running.

Use the project's test data as its doc says. What real data may be used, if any, is in the project's `AGENTS.md`.

## 3. Compare with the design

Follow the `design-frames` skill: shoot the same state of the app at the frame's size, and read both pictures. With `design.source` `png` the frame is the picture exported from the design tool. Report differences in layout, text, and color.

## 4. When something is wrong

1. `npx wf app status`. If a server stopped, read `npx wf app logs`.
2. `start` says the page did not settle: `npx wf app mem`. Memory near the cap means the page is looping.
3. An error on screen: `npx wf app text`. A blank page: `npx wf app console`, then `npx wf app eval "document.getElementById('root').innerHTML"`.
4. An API error: the server's log shows it; reproduce it with `eval "await (await fetch('/api/...')).text()"`.

Search the project's troubleshooting log when a symptom looks familiar, and add an entry when a new issue takes real debugging.

## 5. For a person: `wf try`

When the person wants to try the app themselves, at a point in a journey, point them at `npx wf try` (or the project's own script for it). It runs in their terminal, not yours: it asks with a live picker. They can pick a scenario, answer the project's questions, and the app opens on a throwaway folder under `app.try.home`, never their real data. It prints the command that opens the same run again with no questions, and `--keep` reopens the folder as they left it. `--dry-run` shows what it would run, and you can run that yourself to check a set-up.

It starts `app.web.servers` with the scenario's settings, their output in the folder's `logs/`, then opens `app.web.url` in a visible browser window on a profile of its own. The scenario's cookies and sign-ins never meet the person's own browser. Quitting that browser, or Ctrl-C, stops it all.

It needs two hooks in `app.hooks` beside `prepare` and `stop`. `wf try` passes ctx with `purpose: "try"`, the `scenario`, its `answers`, `keep`, and `state`. `state` is an object for `prepare` to fill as it starts things, so `stop` can undo them even when `prepare` fails part way:

- `scenarios(ctx)` gives `[{ id, about, set?, setName?, group?, note? }]`. A set is a first choice, such as a plugin. A group is a heading in the picker.
- `prepare(ctx)` builds the scenario into `ctx.dataHome`, as for `wf app start --scenario`, and may return a `message` to print, such as what to type where.
- Optional: `asks(scenario, answers, ctx)` gives the next question (`{ flag, question, choices?, yesNo?, default?, other?, skip? }`) or null. Each answer becomes a `--<flag>` on the repeat command, and a no or a skip becomes `--no-<flag>`.
- Optional: `plan(...)` gives the steps to run by hand, and `files(ctx)` the test files `--files` lists.

## Do not

- Do not run a server or the browser without the memory cap: no plain dev server started by the agent.
- Do not open the app in the person's own browser profile.
- Do not leave units running at the end of a turn. Run `npx wf app stop`.
