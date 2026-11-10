---
name: app-testing
description: >-
  Runs, tests, and debugs the project's Tauri desktop app without the user, on
  Linux: runs the project's checks, launches the app on the user's screen under
  a memory cap, reads the window text and console, clicks and types, takes
  screenshots to compare with design frames, and reads the app's SQLite data.
  Use after changing app or UI code, before proposing a commit, and when the
  user asks to run, test, try, debug, or screenshot the app, or reports a blank
  window, a crash, or a screen that looks wrong.
---

# App testing

Test changes yourself before handing back, and say what you checked. Do not ask the user to run the app for something this skill can check.

Read the project's app-testing doc first, `app.doc` in `.workflow/config.json` (`npx wf config` prints it). It has the project's checks and when to run each, how to build the app, its test data and scenarios, any test services, and stubs for what the driver cannot drive. Commands run from the repo root. Commands that start, read, or stop the app use systemd user units, `/tmp`, and the build folder, so they run outside a sandbox.

## 1. Checks

Run the project's checks while working, and the full set once before handing back, as its doc says. Fix failures before going further.

## 2. Run and look

The window opens on the user's screen, so they can watch every run. `<app.instanceEnv>=N` gives a second app its own state, data, unit, and inspector port (`app.inspectorPort` + N), with Vite shared, for a screen review in parallel.

```bash
npx wf app start --fresh            # prints the first screen; the doc may add options, such as a scenario
npx wf app run 'go #/settings' 'click "Save"' 'expect Saved' 'fits' 'shot /tmp/<name>-agent/save.png'
npx wf app stop                     # always stop when done
```

Check a flow with one `run`, not one command per action. Plan the steps up front, then read the result: one line per step, and on the first failure the step, the reason, and the page text. A run of ten steps takes one to two seconds. Use the single commands below to look around when you do not know the page yet.

| `run` step | What it does |
| --- | --- |
| `go <#hash>` | Navigates, then waits for the page to settle. |
| `click <label> [in <group>]` | Clicks the button, link, list option, or field with that text, aria-label, or placeholder. `in <group>` picks the one beside that group's label, such as `click Sage in Scheme`, when two share a name. |
| `type <label> <value>` | Fills a field so React sees it. A field is found by its aria-label, its `<label>`, or its placeholder, not by what is typed in it. |
| `expect <text>` / `absent <text>` | Fails unless the text is, or is not, on the page. |
| `until <text>` | Waits up to 10 s for the text, such as a slow reply, then for the page to settle. |
| `show <text>` | Scrolls the element that reads exactly that, such as a group's heading, to the top. |
| `lines <text>` | Prints the page lines that contain the text. Cheaper than `text`. |
| `text` / `url` / `eval <js>` | Prints the whole page text, the URL, or a value. |
| `wait <ms>` | Waits, for a job that takes a while. |
| `shot [file]` | Saves a screenshot. Read it with the Read tool. |
| `page <file>` | Saves the whole page, a window of its scrolling box at a time, joined. Needs `magick`. |
| `fits` | Fails if anything is wider than the window. Use it with `start --size <w>x<h>`. |

Put a label or script with spaces in quotes: `'click "I added it"'`. A step waits until the page has not changed for 150 ms, at most 3 s.

| Command | What it does |
| --- | --- |
| `start [--fresh] [--size WxH] [--real]` | Starts Vite and the app as user units. `--fresh` wipes the throwaway data first. `--size` sets the window size through `app.sizeEnv`. `--real` uses the user's real data folder: only when asked. The project's hooks may take more options. |
| `run <step> ...` | Several steps in one call. |
| `go`, `click`, `type`, `text`, `eval` | One step as its own command; `go`, `click`, and `type` then print the page. |
| `console` | Console messages so far, with level and source line. |
| `screenshot [file.png]` | The window. |
| `mem` | Memory used by the page process. |
| `logs [n]` | The app's stdout and stderr (Rust panics, WebKit warnings). |
| `db [name] ["sql"]` | Queries a database in `app.databases` in the throwaway data folder. Without SQL it lists the tables. |
| `reset` | Stops the app and deletes the throwaway data folder. |
| `status` | Which units run, page memory, and the saved state. |

The app runs under `app.memoryMax` and stops itself after `app.runtimeMaxSec`. Vite stays up between runs until `stop`. If the user's own dev server already serves the Vite URL, the driver uses it and leaves it running.

The window uses the desktop GPU. Leave `WEBKIT_DISABLE_DMABUF_RENDERER` unset, because it forces software painting. Set it only when the window fails to open on a machine with no GPU.

Never test with real personal data: use the project's synthetic test data.

## 3. Compare with the design

Follow the `design-frames` skill: render the frame, screenshot the same state of the app, and read both images. Report differences in layout, text, and color.

## 4. When something is wrong

Work through this before guessing:

1. `npx wf app status`. If the app unit stopped, read `npx wf app logs`. A Rust panic shows there.
2. `start` says the page did not settle, or a command says the inspector did not answer: run `npx wf app mem`. Memory near the cap means JavaScript is looping. Look for navigation or state updates during render.
3. An error screen in the app: its text is on screen. Use `npx wf app text`.
4. A blank page with no error: `npx wf app console`, then `npx wf app eval "document.getElementById('root').innerHTML"`.
5. A command returned an error: the UI shows the backend's message. Find the Tauri command behind it.

Search the project's troubleshooting log when a symptom looks familiar, and add an entry when a new issue takes real debugging.

## 5. For a person: `wf try`

When the person wants to try the app themselves, at a point in a journey, point them at `npx wf try` (or the project's own script for it). It runs in their terminal, not yours: it asks with a live picker. They can pick a scenario, answer the project's questions, and the app opens on a throwaway folder under `app.try.home`, never their real data. It prints the command that opens the same run again with no questions, and `--keep` reopens the folder as they left it. `--dry-run` shows what it would run, and you can run that yourself to check a set-up.

It runs `app.try.command`, the project's dev command with hot reload, with the folder as `XDG_DATA_HOME`, until they close the window. That works on Linux only, so elsewhere `wf try` refuses rather than open their real data.

It needs two hooks in `app.hooks` beside `prepare` and `stop`. `wf try` passes ctx with `purpose: "try"`, the `scenario`, its `answers`, `keep`, and `state`. `state` is an object for `prepare` to fill as it starts things, so `stop` can undo them even when `prepare` fails part way:

- `scenarios(ctx)` gives `[{ id, about, set?, setName?, group?, note? }]`. A set is a first choice, such as a plugin. A group is a heading in the picker.
- `prepare(ctx)` builds the scenario into `ctx.dataHome`, as for `wf app start --scenario`, and may return a `message` to print, such as what to type where.
- Optional: `asks(scenario, answers, ctx)` gives the next question (`{ flag, question, choices?, yesNo?, default?, other?, skip? }`) or null. Each answer becomes a `--<flag>` on the repeat command, and a no or a skip becomes `--no-<flag>`.
- Optional: `plan(...)` gives the steps to run by hand, and `files(ctx)` the test files `--files` lists.

## Do not

- Do not run the app without the memory cap: no plain dev server or debug binary from the agent.
- Do not drive the app through a browser. A normal browser has no Tauri backend.
- Do not use the user's real data folder (`--real`) unless the user asks.
- Do not leave units running at the end of a turn. Run `npx wf app stop`.
