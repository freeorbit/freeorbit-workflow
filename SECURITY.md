# Security

The kit runs inside your project as you: its scripts read your files, and its hooks can allow or block an agent's actions. Treat a change to it like a change to your build tools.

## Reporting a problem

Open a private security advisory on this repository (Security, then "Report a vulnerability"), or contact the maintainer directly. Do not open a public issue for a hook that can be bypassed, a script that reads outside the project, or a prompt that leaks data.

## What the kit promises

- **No dependencies.** The package has none, so installing it adds no third-party code. The scripts use only the Node and Python 3 standard libraries.
- **The network only where a command says so.** Every other script makes no network call.
  - `wf board` talks to monday.com's API (`api.monday.com`), with the token named by `board.tokenEnv`. It sends the stories, their acceptance lines, the frames and built screens, the open questions the board shows, and the bot's replies. With `board.workItems.plans` set, it also sends each listed plan doc's phases (title and lead) and steps (text, who does it, status, and the stories each unblocks), never their Leaves behind, and with `board.workItems.people` it assigns those people's monday user ids in Owner.
  - `wf doctor` and `wf signoffs` run `gh`, which talks to GitHub.
  - `wf scan` runs the commands a project lists in its own config, which may reach the network.
  - The ask-pages server listens on `127.0.0.1` only.
- **The project, and a few named places outside it.** Scripts read and write the git work tree they run in, and:
  - the kit's own state folder, `~/.local/state/freeorbit-workflow` (the ask-pages server's registry, token, and log). The one server serves every project registered there.
  - Claude Desktop's theme, read only, so ask pages match it: its install and its config folder.
  - Claude Code's plugin folder, `~/.claude` or `CLAUDE_CONFIG_DIR`, read only, for `wf doctor`.
  - `wf app`'s run folder, `/tmp/<app.name>-agent`, made for this user alone (0700) and refused when another account owns it. `wf disk` removes it.
  - `wf try`'s throwaway folders, under `~/.cache/<app.name>-try` or `app.try.home`.
  - A link in the project that leads out of it is not read.
- **Secrets stay out of agents' reads.** `SECRET_GLOBS` in the core plugin's guard names the files that may hold one: `.env`, `.env.*`, keys, certificates, keystores, SSH keys, `.npmrc`, `.netrc`, `.git-credentials`, `.pgpass`, and `credentials.json`.
  - `wf ai:sync` writes them as Read deny rules for every Claude Code session and OpenCode agent.
  - The guard denies them to the kit's blind agents on Read, Grep, and Glob, and refuses a blind agent's Grep over a folder that holds one unless a glob or a type leaves it out.
  - The deny rules do not cover a shell: a main session that runs `cat .env` reads it. A token in `.env`, as `wf board` allows for local runs, is as safe as the session's shell; the environment, or CI's secrets, keep it from the session's files.
- **Where an agent's limits hold.** The blind agents' limits on what they read, search, and run are enforced by the guard, a Claude Code hook. OpenCode runs no such hook: there an agent's prompt and its tool list, with the secret deny rules, are its only limits.

## Known risks, accepted

- **One person per machine.** The ask-pages server checks the Host and Origin of each request and a per-page token on every write, so another website cannot read or answer an ask. It does not tell this user from another account on the same machine: any local account can read the inbox and the answer history, and fetch a page with its token. The kit is for a developer's own machine. On a shared one, stop the server (`npx wf view stop`) when not asking. (Review 2026-11-17, SA-1.)
- **Setup by tag.** `wf init` and the README install the kit from a git tag, which the repository's owner could move. The lockfile pins the commit after the first install. (Review 2026-11-17, SB-10.)
