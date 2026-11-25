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
  - The ask-pages server, `wf view serve`, listens on `127.0.0.1` only.
  - A project that names a team server (`teamServer.url`) sends it each ask page it builds, with its pictures, the agent's replies and live status, and its open questions left for a role, over HTTPS with the person's own token. Without one, nothing leaves the machine.
  - An ask page loads nothing from the web: a picture in its Markdown shows as its words. A link in it goes only to an `https:` or `mailto:` address, opens only when the person clicks it, in a new tab that is told nothing of the page, and shows where it goes; a link whose words are an address shows the one it goes to beside them.
- **The project, and a few named places outside it.** Scripts read and write the git work tree they run in, and:
  - the kit's own state folder, `~/.local/state/freeorbit-workflow` (the ask-pages server's registry, token, and log). The one server serves every project registered there.
  - Claude Desktop's theme, read only, so ask pages match it: its install and its config folder.
  - Claude Code's plugin folder, `~/.claude` or `CLAUDE_CONFIG_DIR`, read only, for `wf doctor`.
  - `wf app`'s run folder, `/tmp/<app.name>-agent`, made for this user alone (0700) and refused when another account owns it. `wf disk` removes it. The folder of its starts' locks, `/tmp/<app.name>-agent-locks`, is made and refused the same way before a lock is taken, and stays.
  - `wf try`'s throwaway folders, under `~/.cache/<app.name>-try` or `app.try.home`.
  - A link in the project that leads out of it is not read.
- **Secrets stay out of agents' reads.** `SECRET_GLOBS` in the core plugin's guard names the files that may hold one: `.env`, `.env.*`, keys, certificates, keystores, SSH keys, `.npmrc`, `.netrc`, `.git-credentials`, `.pgpass`, and `credentials.json`.
  - `wf ai:sync` writes them as Read deny rules for every Claude Code session and OpenCode agent.
  - The guard denies them to the kit's blind agents on Read, Grep, and Glob, and refuses a blind agent's Grep over a folder that holds one unless a glob or a type leaves it out.
  - The deny rules do not cover a shell: a main session that runs `cat .env` reads it. A token in `.env`, as `wf board` and the team server allow for local runs, is as safe as the session's shell; the environment, or CI's secrets, keep it from the session's files.
- **Where an agent's limits hold.** The blind agents' limits on what they read, search, and run are enforced by the guard, a Claude Code hook. OpenCode runs no such hook: there an agent's prompt and its tool list, with the secret deny rules, are its only limits.

## The team server

`wf team serve` is the one part of the kit made to be reached from other machines: by a team working apart, and by its client (docs/design/team-server.md). Where it runs, it promises:

- **HTTPS only**, by its host's ingress or a TLS proxy. It answers only its own address, `WF_TEAM_ORIGIN`, as Host, and its own Origin for a browser's writes; only a GET or HEAD of its health probe answers at any Host, and it says only that the server is up.
- **Every request is signed in**, but its health probe, the invite link's page, and the sign-in page.
  - **Joining.** A person joins with a link that works once, lasts a week, and is used only when they choose a password and press Join, so a mail scanner that opens it does not use it up. A new link for the same name sets a new password, and signs every browser of theirs out.
  - **Signing in.** Then they sign in from any browser with their name and password. Each browser gets a session of its own, for 30 days or to the end of a client's access, at most 10 a person, in an `HttpOnly`, `Secure`, `SameSite=Lax` cookie named `__Host-wf_team`, which no other site on a parent domain can set. Signing out ends that browser's session, or, from the account page, every browser's. A wrong name and a wrong password say the same. Tries are limited to 10 a minute from one address, and for one name from one address, and to 60 a minute for one name in all, so one address cannot lock a person out; a try still in its minute is never forgotten. Each failed try is logged, with where it came from, never the password.
  - **The kit's token** is separate from every session: shown once at joining, and made again from the account page with the password, which stops the one before and signs every other browser out. A client has none.
  - **What is kept.** Passwords are kept as scrypt (N=2^14, r=8, p=5, OWASP's guidance) with a salt and the cost of their own; secrets, sessions, and codes only as SHA-256. A sign-in checks the password as it is once scrypt is done, so one in flight when a new password is set does not outlast it. A browser's cookie that names no session, such as one from before v1.22, is cleared. The name `admin-token` is the admin secret's own, and no invite gives it.
- **Each person sees only their projects.** A client sees only the pages for the client, and has no kit token; a page they may not see is not there for them. This is checked on each request, for each page and each of its files. A client answers; only the team archives an ask.
- **A page holds only the kit's script.** The server draws each page itself from the spec a member's kit sends, for the person who opens it, so no member can put script on a page another opens. The spec is checked as the kit makes one: its hash is twelve hex digits, so it names no file; its questions, pictures, and blocks are of the kinds the page draws; and a project's comment kinds are words and colours. What the agent writes is drawn as text.
- **Writes are limited**: a page's pictures to 24 MB, one page published at a time, a person's changes, from their kit or their browser, to 120 a minute, and tries of invite codes to 10 a minute from one address, the last one the host's proxy adds to `X-Forwarded-For`.
- **Working together on a page** is for the people who see it.
  - A browser's save of an answer, a line under a question, an assign, a done, and where it is on the page each need its session, the page's own token, the server's Origin, JSON, and the page's hash, so a tab open from before the page was built again writes nothing into the new one.
  - Each answer is checked with the page's rules; a line is at most 2,000 characters, a page's lines at most 400,000 in all, drawn as text; a question is assigned only by the team, and only to a person who sees the page; where a person is says only which question.
  - A live stream is checked again as it goes, at least every 10 seconds of events: a revoke, a sign-out, or a page built again for others ends it, and a page built again closes every stream on it. A stream that stops reading is closed.
  - A page has at most 50 open streams, a person 5 on a page and 20 in all, opened at most 30 a minute. Saves of answers are limited to 240 a minute a person, where they are to 300, and lines, assigns, and dones count toward the 120.
  - A client's page names only them and whom its questions are assigned to, never the whole team; who is on the page now, they see.
- **A log** of each join, invite, revoke, publish, answer, archive, and the agent's posts, a file a month, `team/log-<yyyy-mm>.jsonl` on its volume.
- **The kit follows no redirect** from the team server, so a page or a token never goes to another host.
- **An admin** invites and revokes, with the first admin's secret, `WF_TEAM_ADMIN_TOKEN`, from the host's secret store.

What it does not do: it sends no email, and loads nothing from the web. Its state is files on a volume; backups are the host's.

## Known risks, accepted

- **One person per machine.** The ask-pages server checks the Host and Origin of each request and a per-page token on every write, so another website cannot read or answer an ask. It does not tell this user from another account on the same machine: any local account can read the inbox and the answer history, and fetch a page with its token. The kit is for a developer's own machine. On a shared one, stop the server (`npx wf view stop`) when not asking. (Review 2026-11-17, SA-1.)
- **Setup by tag.** `wf init` and the README install the kit from a git tag, which the repository's owner could move. The lockfile pins the commit after the first install. (Review 2026-11-17, SB-10.)
