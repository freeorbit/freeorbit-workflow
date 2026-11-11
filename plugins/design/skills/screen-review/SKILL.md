---
name: screen-review
description: >-
  The one screen check. A run is light (screens one change reaches on its
  own), deep (also screens reached through shared code), or deferred, and takes
  the pictures the designer ticks: Default (wide, beside the frame), Narrow (the
  whole page), and the Stress look on top of either. A blind screen-reader
  agent names each difference from the frame and each fault (clipping,
  wrapping, things out of view), and the main session reads every flag. Use
  while building a screen, at chunk end after the code review when UI files or
  frames changed, and when the designer reports a visual issue or asks whether
  a screen looks right.
---

# Screen review

This looks at screens against their frames. It does not test flows; for that, use the `app-testing` skill. It drives the app through `wf app`, and its settings are `screens` in `.workflow/config.json` (`npx wf config` prints them).

A run shoots on one app a core, up to `screens.jobsMax`, each on its own virtual display, off the designer's screen. `--jobs 1` shoots on the user's screen instead, to watch, and so does a machine without a virtual display (`screens.display`).

A web app's browser follows `app.web.headless` unless `screens.headless` says otherwise: `review` for a chunk-end `--light` or `--deep` run, `build` for named screens, `--chunk`, or `--all`. A project that watches each build-time check but not the chunk-end review sets `{ "review": true, "build": false }`; a headed run on more than one app shoots on virtual displays, so `--jobs 1` keeps it on the person's screen.

- Each screen takes one app session a viewport: the Reach is walked once, the default picture taken, then the stress look put on the same page and taken again.
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

Three boxes, two viewports and a look. Each ticked viewport is shot as a new install shows it; with Stress ticked, in the stress look too. So up to four pictures a screen.

- **Default**: the app's own window, beside its frame.
- **Narrow**: `screens.narrow`, the whole page scrolled and joined.
- **Stress look**: `screens.stress`, for each ticked viewport: the choices most likely to break, together.

**Reading a pair.** The scenario is the closest one, not a copy of the frame's data.

- Names, counts, and text lengths differ. Set those aside.
- The state must match: the step, the open panel, the branch. When it does not, fix the Reach.
- Everything around the data must match the frame.
- When the data itself causes a fault, such as a long name wrapping badly, raise it with the designer and ask how to fix it.

A screen is listed to read when its app pictures **or its frame** changed since the last accept, or it is new: *app changed*, *frame changed*, *both*, or *new*. *Frame changed* means the design moved, so the code follows the frame, or the frame change goes to the designer.

## Light and deep

`npx wf screens scope` gives two lists, and about how long each takes, from the project's `screens.scope` module.

- **Light**: screens a changed file reaches in one place only, such as its own page, its route, or its frame. Counted from the last run, light or deep.
- **Deep**: screens a changed file reaches in more than one place, such as a shared component, the shell, the tokens, or the shared frame styles. Counted from the last deep run, with that span's light screens too.
- A screen on both is on the deep list only. A backend change can still change words on a screen; if one did, name those screens.
- The state lives on this computer in `.cache/screens/state.json`, as the code review keeps its ledger header.

## While building

As soon as a screen renders, check it on its own, and fix what differs before building the next one. A named run does not move the state:

```bash
npx wf screens <screen>
```

## At chunk end

After the code review and the fixes for its findings, when UI files or frames changed. Never start it while the code review runs, because a fix can change a screen, and rebuild the app first so the pictures are of the fixed code:

1. **Scope.** Run `npx wf screens scope`. Both lists empty: stop here.
2. **Ask the designer, first question:** light, deep, or defer.
   - Show both lists' counts and times, the light runs waiting, and any deferral.
   - Recommend light. Recommend deep when the light list is empty and the deep one is not, or when two or more light runs are waiting.
   - Defer runs `npx wf screens --defer` and shoots nothing. Both lists keep growing until a run.
3. **Ask the designer, second question:** which pictures, as checkboxes: Default, Narrow, Stress look.
   - Light starts from Default. Deep starts from all three.
   - Say which are the defaults in the option labels, and that Stress adds to the ticked viewports. Stress with no viewport ticked needs asking again.
4. **Run** `npx wf screens --light` or `--deep`, with the ticked boxes: `--wide` for Default, `--narrow`, and `--stress`.
   - `--chunk N`, `--all`, and names still check just those screens, without moving the state.
   - `--light` and `--deep` refuse until the code review ledger has reviewed or deferred at HEAD. `--force` is for a run the designer asks for outside chunk end.
5. **Triage.** Run `npx wf screens --brief`. It writes one brief per eight listed screens and prints the reader's model. Start one `screen-reader` agent a brief, all at once, on that model, each with the prompt `Brief: <path>` and nothing else. Each returns one line a screen: `same`, `differs`, `fault`, or `could not read`.
6. **Look.** Read in full every pair a reader flagged, every *frame changed* pair, and every picture a reader could not read. Enlarge a doubtful spot: crop and scale into `.cache/view/`, since the image reader caches by path.

   ```bash
   magick <picture> -crop 700x300+500+400 +repage -scale 300% .cache/view/crop-1.png
   ```

   A reader's flag that is not there in full is dropped. Name any you dropped in the report.
7. **Fix or record.**
   - Fix a difference or fault now, and run those screens again.
   - A difference the designer accepts goes in the frame or in the decisions log, never only in the code.
   - To ask the designer about a difference, send its pair first, made with `npx wf design annotate` with an amber `drift` or red `bug` box on it, and name where to look.
   - A fault you do not fix goes in the open questions log.
8. **Report.** Tell the designer each screen read, with a line on what you saw, which lines came from a reader only, and what you did not read at full size. Give the reached count from the run's last line, and name any frame still waiting on this chunk.
9. **Accept** only once every flagged screen was read and its faults fixed: `npx wf screens --accept`.
   - It accepts only the last run's screens, and only the pictures taken in it.
   - A light run moves the last run and adds its range. A deep run moves both and clears the light runs and any deferral. A run with a screen that did not shoot moves neither.
   - Accepted hashes stay on this computer, so on a new one every screen is new.
   - While the board shows built screens, it also copies each screen's Default picture to `design.built`. Commit those with the chunk, so the board shows them once the story is Built.

The designer can also ask for a review at any time. Ask the same two questions, without defer. `npx wf screens --sheets` puts the listed pictures six to a sheet, for a quick look by hand.

## Do not

- Do not accept a run whose flags you have not read.
- Do not run every screen for a change that cannot reach them.
- Do not defer without the designer's answer to the first question.
- Do not change a frame to match the code without the designer's yes.
