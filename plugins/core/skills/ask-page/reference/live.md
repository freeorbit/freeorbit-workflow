# Live ask pages

Live pages, replies, history, changes, steps, and saying a page is waiting, for the `ask-page` skill.

- **A live page.** A `status` page, or any page with `"live": true`, shows where a step stands while it runs, and redraws in place as you update it. The example is the skill's `examples/status.json`.
  ```bash
  npx wf ask live <id> --step "Flow 3: sync" --progress 3/12 --log "flow 2 … ok"
  npx wf ask live <id> --blocks blocks.json        # blocks in place of the ones before: tiles, a table, a chart
  npx wf ask live <id> --state done                # or failed, or waiting (on the person)
  ```
  `--log` adds lines (the last 200 are kept), `--clear` starts again. A status page has no questions, so it needs no `wait`; it shows as Status in the inbox.
- **A reply under a question.** When an answer needs a word back, `npx wf ask reply <id> <question> <text>` puts your reply under that question. The page asks again: it waits for a send, the question stays open, and `wf ask wait` prints the person's reply with your own.
- **History.** Every send keeps a round. `npx wf ask history` lists every ask with rounds; `npx wf ask history <id>` prints its rounds as Markdown, newest first. The page's ⋯ menu shows Earlier answers, and `wf ask export` adds `<id>.history.md`.
- **What changed.** Building a page again with other questions marks them New or Changed, and lists what was removed, so the person sees what changed since they were last asked.
- **Step by step.** `"steps": true` with `sections` shows one section at a time, each a step, with Back and Next and a stepper that ticks a step when its questions are answered. Place each step's questions with a `questions` block and its `group`. The example is the skill's `blocks/steps.json`.
- **Saying a page is waiting.** A served page's tab says how many asks wait, such as `(3) Chunk 12`. In the ⋯ menu, or on the inbox, the person can turn on a notification when an agent asks, replies, or a live page finishes. The server shows it on the desktop where it can, so it works in Claude's built-in browser pane, which shows no web notification; elsewhere the browser's own is used. A page tells only while the person is away from it: another tab, or the chat beside the pane.
  - **Linux** uses `notify-send`. **macOS** uses `terminal-notifier` when it is installed, and `osascript` when it is not or macOS has not allowed it, whose notifications macOS lists as Script Editor's: allow Script Editor in System Settings, Notifications.
  - `npx wf view notify` sends one now and says what to check when none appears. When the person says notifications do not show, run it.
