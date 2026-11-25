# A shared ask-page server for a team

Ask pages, shared by a team working apart and by its client: one server everyone reaches over HTTPS, which keeps every page and answer on its own disk. Optional: a project without it works alone, as before. Designed 2026-11-23; built in v1.20.0.

## Why

- **A teammate's questions wait for their merge.** An open question is a row in the questions log on its asker's branch. The person it waits on sees it only once that PR merges, and answers in another PR, so each round trip is two merges.
- **The client is asked by email.** The exported page goes out by email, and the answers come back by hand.
- **The ask pages work only on one machine.** The server listens on `127.0.0.1`, by design (SECURITY.md).

## The shape

```
 a teammate's kit ──┐                         ┌── a teammate's browser
 your kit ──────────┼─ HTTPS, a member token ─┤   (invite link → session)
 your agent's wait ─┘                         └── the client's browser
                         asks server               (client link → session)
                    one container, 1 replica
                    state on a mounted volume
```

- **One server, the kit's own.** `wf team serve` is the hub that runs today (`lib/view/serve.mjs`) behind a sign-in layer, serving one folder per project laid out as `.cache/view` is. The page, the answers rules, asks for more, live pages, and history are the same code.
- **Turned on per project.** `.workflow/config.json` takes `teamServer: { "url": "https://…", "project": "acme", "tokenEnv": "WF_TEAM_TOKEN" }`. With no `url`, nothing changes. With it, the kit sends what it writes to the server as well:

  | Command | Today, alone | With `teamServer` |
  | --- | --- | --- |
  | `wf ask page` | Writes the page under `.cache/view`, served by the local server | Publishes the page and its pictures to the team server, which alone takes its answers |
  | `wf ask wait` | Watches the answers file | Polls the server, and keeps a copy under `.cache/view/answers`, so everything after it is unchanged |
  | `wf ask more`, `reply`, `live` | Write files the page polls | Post to the server |
  | `wf ask record` (Later, for a role) | Adds an open questions row | Also publishes it as a question for that role, with its Q-ID (see Open questions) |
- **One page can stay here.** `wf ask page <spec> --local`, or the spec's `"local": true`, keeps that page on this machine as if no team server were named, and the page remembers it for the commands after. Where a page lives is not part of it, so the same page built either way keeps its answers and replies; a copy published before stays on the team server, which the build says. Turning `teamServer` off is never needed for one page.
- **The agent's side does not change.** `answers`, `record`, `history`, and `export` read the local copy.

## Who signs in

- **Members, by invite link, then a password.** An admin's `wf team invite <name> --role designer` prints a link that works once, within a week. On it the person chooses a password, and the page shows, once, their kit's token for `tokenEnv`. From then on they sign in from any browser with their name and password, each browser a session of its own; `/__team/account` signs a browser out or makes a new kit token. A forgotten password is a new invite link. `wf team revoke <name>` ends every session and the token. No outside service.
- **The client, by a client link.** `wf team invite <name> --client` gives a link on which the client chooses a password too, and that opens only the pages for the client, and only to answer them. Their access ends after 30 days, or the days the invite gives, and `wf team invite` again renews it. It replaces the emailed page.
- **What each sees.** A page names who it is for with `for` (roles, `client`, or names), and a question its `role`. Members see every page of their projects; the client sees only the pages for the client. A person's inbox marks the asks that wait on their role, or on them by name, "for you", and `wf question inbox` lists them.
- **Who answered.** An answer keeps who sent it. On a page several people answer (a `batch` by role), the server keeps each person's latest answer to each question, not the last whole send.

## Working together

Several people answer one page at once (decided 2026-11-25): one shared answer per question, and any member's Send wakes the agent.

- **Saved as it is made.** Each pick or note is saved for everyone, a moment after the last change, as `POST /__ask/<key>/answer/<id>` with one question's answer, and checked with the rest as a whole page's answers are. The last save wins, and says who. The shared answers are `ask/<id>/working.json`, `{ answers, by, at }`; a save never wakes the agent's wait.
- **Send** turns the shared answers into the answers file, which wakes the wait, and says who sent it (`sent.by`, and "sent by" in `wf ask answers`). Each answer carries who gave it, as `by`. A send from an older page, or `wf ask import`, carries a whole page's answers: each that differs is saved as the sender's first.
- **Live.** Each open page holds one event stream, `GET /__ask/<key>/events/<id>` (Server-Sent Events), which says the page's state at once, then each change; a save names its connection, which is not told it back. The server is one process, so the streams are kept in memory.
- **Who is on the page**: a round per person in the header, with where they are and whether they type, and their initials on that question. Clicking one follows them; a second click stops.
- **Changed under you.** An answer someone else changes while you are writing that question's words, or before your own change is saved, is not laid over yours: the question says so, with Use theirs and Keep mine.
- **Under each question**: who answered it and when, Assign to (the team's, to a person who sees the page; the inbox marks it for them, and the person who assigned it is told when someone else answers), Discuss (lines anyone on the page adds; `@name` tells that person), and Link (a link to the question).
- **The ready check**: Mark my part done, with who is done and who is still to go.
- **What happened**, in the ⋯ menu: the page's last 200 answers, lines, assigns, dones, and sends, with who and when.
- **Kept with the page**, in `ask/<id>/collab.json`: threads, assigns, dones, who sent it, and what happened. Both files go when the page is published again with other questions, and the open pages are told to reload.
- **Anyone on the page may change or clear any answer**, a client too: one shared answer means the last change wins, whoever makes it. What happened says who did it, and each answer says who gave it.
- **Kept to size.** An event says only what changed. The files are written a second after a change, a second's changes at once, and at a stop. A page no one has open leaves memory once more than 100 are kept. The limits are SECURITY.md's.
- **Not in this version**: votes, and email when a person is assigned or named.

## Open questions, before the merge

The round trip this was asked for (from the start of the design):

1. A teammate's `wf ask record` turns "Later, for designer" into a row in the log on their branch, as now, and publishes the question to the server with its Q-ID.
2. The designer's inbox lists it at once, whatever is merged. They answer it on its page.
3. The teammate's `wf question pull` notes the answer under the row on their own branch, with who gave it. The agent makes it a decision and resolves the row, so the answer merges in the same PR as the question.

`wf question inbox` lists, in the terminal, the asks waiting on you, open questions first. The page is `oq-<q-id>`, and `.cache/view/team-questions.json` keeps which this branch published, so `pull` brings each answer in once.

## State that survives a restart

- **Files, written whole**, as the kit writes them today (`writeWhole`: a temporary file, then a rename), one folder per project, on a volume mounted into the container. A restart or a new revision loses nothing.
- **One replica.** One writer, so no two processes write one file. `minReplicas` and `maxReplicas` are 1, kept warm so a poll gets an answer at once.
- **The server's own records**: members, invite links, and a log of who did what, in a `team/` folder beside the projects' `projects/<key>/` folders.
- **Backups.** A nightly snapshot of the volume, by the host, kept 14 days.
- **Read once, kept in memory.** The server is the only writer of its folder, so it reads the members, the projects, and each page's spec and inbox line once, and makes a page's line again only when it writes that page. A poll of the inbox or a page reads no file, which matters on a network share; an agent's wait sends the version it last saw, and an unchanged page answers in a word.
- **Not chosen:** a project's own database. Postgres or another needs a driver, and the kit has no dependencies. Node's built-in SQLite works on Node 24, but not reliably on a network share. Files are enough for a team's pages; revisit past a few thousand.

## Hosting

Any host that runs a container with HTTPS ingress and a persistent volume, such as Azure Container Apps with an Azure Files share, or a small VPS behind a TLS proxy.

- **One container, kept warm**, at about 0.25 vCPU and 0.5 GiB, with external ingress. The host's own address and certificate are enough to start; a custom name can come later.
- **Its image is the kit's.** The kit ships a `Dockerfile` for `wf team serve`. A project builds it from the kit version it pins, `node_modules/freeorbit-workflow`, in its own deploy workflow, and pushes it to its own registry. The server's version then follows the pin, with no registry or secret of the kit's.
- **In the project's infrastructure code**, where it has some, so the server is created, checked, and removed with the rest. A project keeps its own hosting notes; this doc names none.
- **Cost:** a few dollars a month for the container and the volume, on most hosts.

## Deploying

1. **The image.** Build `templates/team-server/Dockerfile` from the kit the project pins, and push it to the project's registry:
   ```bash
   docker build -t <registry>/wf-team:<kit version> -f node_modules/freeorbit-workflow/templates/team-server/Dockerfile node_modules/freeorbit-workflow
   ```
2. **The container**: one replica, kept warm, listening on 8080, with external HTTPS ingress, and these settings:

   | Setting | Value |
   | --- | --- |
   | `WF_TEAM_ORIGIN` | The address people open, such as `https://asks.example.com` |
   | `WF_TEAM_ADMIN_TOKEN` | A random secret of 32 characters or more, from the host's secret store (`openssl rand -base64 36`) |
   | `WF_TEAM_DATA` | `/data`, where the volume is mounted |
   | Probes | `GET /__team/health`, which answers at any Host, so a probe that reaches the replica by its own address needs no header |
   | `X-Forwarded-For` | Set by the host's proxy, as Azure Container Apps' ingress does; the server takes its last address as the caller's, to limit invite tries |
3. **The volume** at `/data`, which outlasts a restart and a new revision, with the host's snapshots.
4. **The first people.** The admin puts the admin secret in their own `tokenEnv` for a moment, and invites themself and the team:
   ```bash
   WF_TEAM_TOKEN=<admin secret> npx wf team invite ken --role owner --admin
   npx wf team invite ana --role designer
   npx wf team invite glen --client --days 30
   ```
   Each opens their link; members keep the token it shows in their gitignored `.env`.
5. **The project** names the server in `.workflow/config.json`: `"teamServer": { "url": "https://asks.example.com", "project": "<key>" }`.

## What the kit promises, again (SECURITY.md)

Today's promise, "the ask-pages server listens on `127.0.0.1` only", stays for `wf view serve`. The team server makes its own:

- **HTTPS only**, by the host's ingress or a TLS proxy; plain HTTP is refused.
- **Every request is signed in**: a session cookie (`Secure`, `HttpOnly`, `SameSite=Lax`) for a browser, a bearer token for the kit. A page's token still binds its writes to that page, and writes need the server's own origin.
- **Each person sees only their projects**, and the client only their pages, checked on every request, not only in the inbox.
- **Limits**: bodies and pictures by size, asks and sends by rate per person, and links by age.
- **A log** of each sign-in, invite, publish, answer, and revoke, kept on the share.
- **What the agent writes** is already drawn safely: no HTML from a string, links only to `https:` or `mailto:` (v1.19.0). Pictures are copied in and served from the server, never fetched.

## Phases

The first version carries everything (decided 2026-11-23), built in this order on one branch, each step tested before the next:

1. `wf team serve`: sign-in, invites, projects, and the hub's routes behind them; state on disk; `SECURITY.md`.
2. The kit's side: `teamServer` in the config, then `page`, `wait`, `more`, `reply`, and `live` over HTTPS; one shared answer per question (Working together, v1.23).
3. Client links, and the inbox by role.
4. Open questions published by `record`, `wf question inbox`, and `wf question pull`.
5. The `Dockerfile`, and a deploy guide: the container, the volume, the secret, and the build step a project adds to its own infrastructure code.

## Not in this version

- **Email.** The server sends none. A person sees new asks in their inbox and its tab's count; the admin sends a client their link. A mail service could tell the client of a new ask later.
- **Settings across browsers.** On a team server, the look and the inbox's filters stay in each browser.
- **A desktop notification when an agent waits.** That comes from the local hub, on the agent's own machine; a teammate sees "Agent waiting" on the page and in the inbox.
