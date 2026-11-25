# Many sessions at once

How one ask-pages server serves every project and session, for the `ask-page` skill.

One server serves every project, worktree, and session on the machine, so asks never clash.

- **Addresses.** Each project is at `http://127.0.0.1:8765/<key>/`, where the key is its folder's name and a short hash; its pages and answers stay in its own `.cache/view`.
- **The inbox.** `http://127.0.0.1:8765/` lists every ask, waiting first, with who asked: the repository, the branch or worktree, and the session. The tab title counts what waits.
- **Ids.** A page another session is still waiting on is not replaced; pick another id, or pass `--replace` when it is truly yours.
- **The server.** It runs on its own, detached, and stops after 12 idle hours; `wait` starts it again if it stopped. One older than the kit, or whose own kit folder was removed (a deleted worktree's `node_modules`), is started again on the kit by `wf ask page`, with the same token, so open pages still send. `npx wf view stop` stops it. Its log and registry are in `~/.local/state/freeorbit-workflow`.
