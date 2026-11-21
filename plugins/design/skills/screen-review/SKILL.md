---
name: screen-review
description: >-
  The one screen check. A run is light (screens one change reaches on its
  own), deep (also screens reached through shared code), or deferred, and
  takes Default: the app's window beside its frame, as a new install shows it.
  It takes Narrow (the whole page) and the Stress look only when asked, in a
  project that sets them. A blind screen-reader
  agent names each difference from the frame and each fault (clipping,
  wrapping, things out of view), and the main session reads every flag. Use
  while building a screen, at chunk end after the code review when UI files or
  frames changed, and when the designer reports a visual issue or asks whether
  a screen looks right.
---

# Screen review

This looks at screens against their frames. It does not test flows; for that, use the project's app-testing skill, `app-testing` or `web-app-testing`. It drives the app through `wf app`, and its settings are `screens` in `.workflow/config.json` (`npx wf config` prints them).

Each kind of run says where its apps show and how many at once, in `screens.runs`: `review` for a chunk-end `--light` or `--deep` run, `build` for named screens, `--chunk`, or `--all`.

- `show` is `screen` (one app on the person's screen, to watch), `virtual` (each app on its own KWin virtual display, off it), `headless` (a web app's browser with no window), or `auto` (headless for a web app, virtual for any other). `--show` overrides it for one run.
- `jobs` is the most apps at once with `virtual` or `headless`, held to the number of cores; `--jobs` overrides it for one run. `screen` is always one app.
- Each run says on its first line where it shows and how many apps. Without `kwin_wayland`, a `virtual` run shows on the person's screen, one app at a time, and says so.

- Each screen takes one app session a viewport: the Reach is walked once and the picture taken. With `--stress`, the stress look is then put on the same page and taken again.
- Each app builds a scenario once for the run, and copies it for every start.

## The screen list

Every row in every area's screen list (`<area docs>/design/screens.md`) is a screen, and each has a **Reach**: the test-data scenario, then `app-testing` run steps, joined by ` › `.

```text
`downlink-wait-mixed › go #/plugins/downlink/requests › click Brightcart`
```

- **Frame tables** hold design frames. A Reach opens the closest scenario on the frame's state.
- **Unreached frames.** `none, <chunk>: <reason>` means no scenario reaches that state yet, names the open chunk that will, and says what it needs. `cannot: <reason>` is a state run steps cannot hold at all, such as a hover.
- **The gate.** `npx wf screens --gate <chunk>` lists each frame showing the chunk's stories that is not reached and does not wait on a later chunk. It runs at chunk start, to ask the designer, and at chunk end, before the code review.
- **"Screens with no frame"** holds test states no frame draws. They are checked for faults and against their last accepted pictures.
- `npx wf screens --check` belongs in the project's checks. It fails on a frame row with no Reach, a Reach naming no scenario, a scenario on no row, and a `none` with no chunk or a done one. A new frame or scenario gets its row in the same change.

## Who writes the Reach, and when

| When | Who | What |
| --- | --- | --- |
| A frame is drawn (Step 2) | Whoever draws it, in the same change | Its row gets a Reach, usually `none, <chunk>: <reason>`, since no scenario holds the state yet. The `design-frames` skill says so. |
| Chunk start | The agent runs the gate; the designer decides | `--gate <chunk>` lists this chunk's frames nothing reaches. Each is reached in this chunk, or waits on a later chunk with the designer's yes. |
| A scenario is built | The developer, in the same change | It becomes the Reach of each frame whose state it holds, or a row under "Screens with no frame". The `design-test-data` skill says so. |
| A screen renders | The developer | Write the Reach's run steps and check them with `npx wf screens <screen>` before building the next screen. |
| Every check | `npx wf screens --check` | Fails a row with no Reach, a Reach naming no scenario, a scenario on no row, a `none` with no chunk, or one waiting on a done chunk. |
| Chunk end | The agent, then the designer | The gate passes before the code review; then the review below. A pair in the wrong state means the Reach is fixed, not the frame. |

The project's four-steps doc runs the gate at chunk start and chunk end. A Reach never moves to a later chunk without the designer's yes.

## The pictures

Each run takes Default, as a new install shows it. Narrow and the stress look are a project's own: each is off until `screens.narrow` or `screens.stress` is set, and then taken only when the designer asks. In a project that sets neither, never offer them.

- **Default**: the app's own window, beside its frame.
- **Narrow**: `screens.narrow`, the whole page scrolled and joined. Only when asked for. The flags name every viewport to take: `--wide --narrow` for both, `--narrow` alone for Narrow only.
- **Stress look**: `screens.stress`, the choices most likely to break, together. Only when the designer asks for it: add `--stress` with the viewports, such as `--wide --stress`.

**Reading a pair.** The scenario is the closest one, not a copy of the frame's data.

- Names, counts, and text lengths differ. Set those aside.
- The state must match: the step, the open panel, the branch. When it does not, fix the Reach.
- Everything around the data must match the frame.
- When the data itself causes a fault, such as a long name wrapping badly, raise it with the designer and ask how to fix it.

A screen is listed to read when its app pictures **or its frame** changed since the last accept, or it is new: *app changed*, *frame changed*, *both*, or *new*. *Frame changed* means the design moved, so the code follows the frame, or the frame change goes to the designer.

## Light and deep

`npx wf screens scope` gives two lists, and about how long each takes, from the project's `screens.scope` module.

- **Each screen has its own mark**: the commit each of its pictures was last accepted at. A screen is due when a change that reaches it landed after its own mark, so an accepted run moves the screens it took and leaves the rest as they were. Pictures nothing has reached since their marks move with it, when the run was shot with no uncommitted changes, so the marks stay a few commits.
- **Uncommitted changes need no commit first.** A run shot with them is shot at a snapshot of the working tree, taken before its first picture, and the accept marks it. Committed as they were shot, the changes leave those screens accepted; a change made after the snapshot makes them due, as it should.
  - The snapshot is a local commit under `refs/wf/screens/`. A plain push sends branches only, so it stays on this computer; a mirror push, or a refspec of `refs/*`, would send it. An untracked file whose name may hold a secret, or one over 5 MB, is left out and named.
  - An accept drops a snapshot no mark names once it is 14 days old. To drop them all, `git for-each-ref --format='%(refname)' refs/wf/screens/ | xargs -n1 git update-ref -d`; the screens marked there show due again.
  - The project's `screens.scope` module must count the working tree and untracked files in what changed since a mark, as `git diff --name-only <mark>` plus `git ls-files --others --exclude-standard` does.
- **Light**: screens a changed file reaches in one place only, such as its own page, its route, or its frame.
- **Deep**: every screen due, with those a changed file reaches in more than one place, such as a shared component, the shell, the tokens, or the shared frame styles. A light run takes its screens off this list too.
- The state lives on this computer in the main checkout's `.cache/screens/state.json`, with the accepted pictures. Every worktree reads and writes that one record, so a run accepted in a worktree counts everywhere and outlives it.

## While building

As soon as a screen renders, check it on its own, and fix what differs before building the next one. Accepting it moves that screen's mark, so it leaves both lists:

```bash
npx wf screens <screen>
```

## At chunk end

After the code review and the fixes for its findings, when UI files or frames changed. Never start it while the code review runs, because a fix can change a screen. The gate, `npx wf screens --gate <chunk>`, has passed before the code review, as the project's four-steps doc orders it.

1. **Rebuild the app**, so the pictures are of the fixed code. With `app.build` set, `wf screens` builds it itself before it shoots; with `app.sources`, it refuses a binary older than what it is built from.
2. **Scope.** Run `npx wf screens scope`. Both lists empty: stop here, unless a backend change altered words on a screen; then run those screens by name.
3. **Ask the designer** on the choice page: `npx wf choose screens | npx wf ask page -`, then the `ask-page` skill's steps.
   - The page shows both lists' counts and times, how many only shared code reaches, and whether the code review covers HEAD. Each run, light, deep, or defer, shows its command; where the apps show, the areas, and the pictures the project sets are options.
   - It recommends light; deep when the light list is empty and the deep one is not, or when shared code alone reaches as many screens as the light list.
   - Before a deep run, check how much of the usage limit is left; the times are estimates.
   - Defer runs `npx wf screens --defer` and shoots nothing. Both lists keep growing until a run.
   - With no browser pane, ask in the chat with the same runs and options.
4. **Run** the command the page returns, `Command:` at the head of its answers, such as `npx wf screens --light`. Do not ask which pictures: both take Default. Only when the designer asks for other pictures, name every viewport to take, such as `--wide --narrow`, and add `--stress` for the stress look.
   - `--chunk N`, `--all`, and names check just those screens; accepting them moves their marks. These, and `--area` alone, refuse while a light or deep run is not yet accepted, since they would replace it as the run to accept: accept what was read first, then shoot. `--replace` drops the run.
   - `--area <id>` narrows any run to that area's screens, such as `--deep --area uplink`; several are joined by commas, and `scope --area <id>` shows that part of each list. Use it when the designer asks for one area. Its accept marks that area's screens; elsewhere, only pictures nothing has reached since their marks move with it.
   - `--light` and `--deep` refuse until the code review ledger has reviewed or deferred at HEAD. `--force` is for a run the designer asks for outside chunk end.
5. **Triage.** Run `npx wf screens --brief`. It writes the listed screens into briefs of up to 24 pictures each, so 24 screens at one picture a screen, and prints the reader's model. Start one `screen-reader` agent a brief, all at once, on that model, each with the prompt `Brief: <path>` and nothing else. Each returns one line a screen: `same`, `differs`, `fault`, or `could not read`.
6. **Look.** Read in full every pair a reader flagged, every *frame changed* pair, and every picture a reader could not read. Enlarge a doubtful spot: crop and scale into `.cache/view/`, since the image reader caches by path.

   ```bash
   magick <picture> -crop 700x300+500+400 +repage -scale 300% .cache/view/crop-1.png
   ```

   A reader's flag that is not there in full is dropped. Name any you dropped in the report.
7. **Fix or record.**
   - Fix a difference or fault now, and run those screens again: first accept the rest of the run with `npx wf screens --accept --except <screen> ...`, so the run is kept, then shoot those screens by name.
   - A difference the designer accepts goes in the frame or in the decisions log, never only in the code.
   - To ask the designer about differences, use a `compare` ask page, one pair a difference, from `npx wf design annotate --ask` with an amber `drift` or red `bug` box, and the choice each needs as its question. Without a browser pane, send the annotate sheet first, and name where to look.
   - A fault you do not fix goes in the open questions log.
8. **Report.** Tell the designer each screen read, with a line on what you saw, which lines came from a reader only, and what you did not read at full size. Give the reached count from the run's last line, and name any frame still waiting on this chunk.
9. **Accept** only once every flagged screen was read and its faults fixed: `npx wf screens --accept`.
   - It accepts only the last run's screens, and only the pictures taken in it.
   - **A partial accept**, when some screens wait on a fix, such as a fix chunk: `npx wf screens --accept --except <screen> ...` leaves those out, and `npx wf screens --accept <screen> ...` takes only those. A long list goes in a file, one name a line, as `@<file>`.
     - Accept a screen only when it was read as step 6 says and has no fault left. Leave out every screen with a reader's flag you have not read, a fault, a wrong state, or a frame difference the designer has not settled; a *frame changed* pair is read in full even when its reader said `same`.
     - Each screen left out goes in the fix chunk or the open questions log, as step 7 says.
     - The screens taken are marked; the changed screens left out keep their marks, so they stay listed to read and due until an accept takes them, from this run or a named run.
   - Each picture taken is marked at the commit the run was shot at. A screen that did not shoot keeps its mark and stays due until accepted; one the run could not reach is marked, since it was looked at. A light or deep run also clears any deferral.
   - Accepted hashes stay on this computer, in the main checkout, so on a new computer every screen is new.
10. **Stage the built pictures.** While the board shows built screens, the accept copies each screen's Default picture to `design.built`. Commit those with the chunk, so the board shows them once the story is Built.

The designer can also ask for a review at any time. Ask the same question, light or deep, without defer. `npx wf screens --sheets` puts the listed pictures six to a sheet, for a quick look by hand.

## Do not

- Do not accept a run whose flags you have not read.
- Do not run every screen for a change that cannot reach them.
- Do not defer without the designer's answer.
- Do not change a frame to match the code without the designer's yes.
