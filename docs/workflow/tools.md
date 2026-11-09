# Tools

Every program the workflow and this project need outside their own lockfiles, why each is here, and what happens without it. To add a tool, add its row in the same change as the code that calls it.

<!-- wf:local intro -->

## The list

Need is `required` for building and checking, `review` for the code review, or `optional`. Runs on is `all`, or `linux` for a tool that exists only there.

### The kit's

What the workflow kit's own commands call. A plugin the project does not use needs none of its tools.

| Tool | What it is for | Need | Runs on | Without it |
| --- | --- | --- | --- | --- |
| `node` | Node 24 or later: every `wf` command. | required | all | Nothing in the kit runs. |
| `git` | The repo. `wf doc:check` reads its file list, and the hooks and reviews read its history. | required | all | The docs check stops. |
| `python3` | The review ledger and its tests, and the design plugin's frame renderer. | required | all | `wf ledger` and `wf design render` stop. |
| `gh` | Pull requests, squash merges, `wf github`, and `wf signoffs` reading a pull request. | optional | all | Open and merge pull requests on the website. |
| `chromium` | The design plugin: draws frames to PNG, and checks them for overflow. | required | all | No frame renders. |
| `magick` | ImageMagick: the design plugin's question sheets, and the screen review's contact sheets and crops. | optional | all | No sheet is made; read the pictures one at a time. |
| `systemd-run` | The Tauri adapter's `wf app`: starts the app for agent testing, under a memory cap. | optional | linux | `wf app` cannot start the app. See [Linux only](#linux-only). |
| `kwin_wayland` | The screen review's parallel apps, each on a virtual display (`screens.display`). | optional | linux | One app at a time, on the user's screen. |
| `opencode` | The second agent tool, in [ai-tools.md](ai-tools.md). | optional | all | Use Claude Code. |

### This project's

<!-- wf:local list -->

## Missing packages

What an agent does when a program is missing. The person at this computer installs system packages themself. Do not install them.

- **Not allowed:** sudo, a system package manager, npm -g, pip outside a project, cargo install, or a download-and-unpack into a system folder or the home directory. A temporary install under `/tmp` is not a substitute for asking.
- **Allowed:** checking whether a tool exists (`which`, `--version`, the project's tools check).
- **Where:** what the project uses, and how to install it on each system, is in [The list](#the-list) and [Installing](#installing).

- **Required.** The task cannot be done without a missing program (a CLI, a library, a browser, a font, a language runtime). Stop.
  - Name what is missing and why, and give the exact install command for this computer's system.
  - If it is not in the system's own packages, say so and give the command for where it comes from.
  - Wait until they say it is installed, then continue.
- **Easier, not required.** The job can be done without it, but a missing dependency would make it clearly easier. Ask if it can be installed, even though the job can proceed without it.
  - Name the package, why it helps, and the install command. Recommend it when the gain is real.
  - If no, continue without it. If yes, wait until it is installed. Do not install it either way.
  - A tool the project keeps gets a row in [The list](#the-list).

<!-- wf:local system -->

## Installing

<!-- wf:local installing -->

## Linux only

The kit's commands below work on Linux and have not been tried elsewhere.

- **Agent app testing.** `npx wf app` uses `systemd-run` for its memory cap, and `/tmp`. Without systemd, an agent can run every check but cannot drive the app.
- **The screen review.** `npx wf screens` drives the app through `wf app`, so it needs the same, plus `magick` and Chromium to render frames.
- **`chromium` by name.** `npx wf design render` and `npx wf design check` call `chromium`, so it has to be on the path under that name.
- **The disk check.** `npx wf disk` uses `pgrep` and `systemctl` to see a running build and test app.

<!-- wf:local linux -->

<!-- wf:local more -->
