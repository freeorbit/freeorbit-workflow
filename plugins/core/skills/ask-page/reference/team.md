# A team server

Ask pages shared by a team working apart, and its client, for the `ask-page` skill. The design, and the steps to deploy one, are the kit's `docs/design/team-server.md`.

- **Turned on by the config.** With `teamServer.url` and `teamServer.project` in `.workflow/config.json`, and your token in the variable `teamServer.tokenEnv` names (`WF_TEAM_TOKEN`, in a gitignored `.env`), every step of the skill works as it does alone, and:
  - `wf ask page` publishes the page there, instead of to the local server, and prints `Team: <address>`; `wf ask open` opens it.
  - `wf ask wait` waits on the server, marks the page as waited on there, and keeps a copy of the answers here, so `answers`, `record`, and `history` read them as ever.
  - `wf ask more`, `reply`, and `live` post to the server.
  - Without the token set, each says so before it does anything.
- **Who a page is for.** The spec's `for` lists roles, `client`, or people by name. A client sees only a page whose `for` names `client` or them; the team sees every page of the project. A question's `role` names who answers it. A person's inbox marks the asks for them.
- **Several people on one page.** Each person's latest answer to each question is kept, with who gave it, as `by` in the answers JSON.
- **Questions left for later.** `wf ask record` also publishes each one to the server, for its role, as the page `oq-<q-id>`. The role answers it there, before your branch merges; `npx wf question pull` notes the answer under its row in the log. Make it a decision, then resolve the row. One that `record` could not send is said, and `npx wf question publish <Q-ID>` sends it.
- **Your own asks.** `npx wf question inbox` lists what on the server waits on you, open questions first.
- **People.** An admin runs `npx wf team invite <name> --role <role>`, or `--client` for a client's link that ends after 30 days (`--days`), and `npx wf team revoke <name>`. Each link works once, for a week; send it to that person alone.
