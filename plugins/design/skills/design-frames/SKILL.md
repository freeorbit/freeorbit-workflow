---
name: design-frames
description: >-
  Draw, change, render, and read design frames. A frame is one HTML file under
  <frames>/<area>/<section>/, rendered by headless Chromium to a PNG at the same
  path under <review>/, or, with design.source png, a picture exported from a
  design tool such as Figma, filed at that path. Use when drawing or redrawing a
  screen (Step 2), bringing in frames exported from a design tool, implementing
  or comparing a screen that has a frame, refreshing review PNGs, adding an
  area's frames, or sending a picture with a visual question.
---

# Design frames

The design is plain files in the repo. The HTML is the source. The PNG is what the designer reviews and what the app is compared against. Run `npx wf config` for the folders and sizes this project uses; the defaults are `docs/design/frames` and `docs/design/review`, at 1280 by 800.

Read the project's frames doc first, `design.doc` in the config (default `docs/design/frames.md`). It has the areas, the shared styles and tokens, the shell and its body attributes, the frame skeleton, and the look the frames are drawn in. Frame names and their stories are in each area's screen list, `<area docs>/design/screens.md` by default.

## Files

A frame is `<frames>/<area>/<section>/<frame>.html`, in the folder of its `##` section in the screen list, as a slug: "Ask and send" is `ask-and-send`. Its PNG is the same path under `<review>/` with `.png`. A new frame goes under its section's folder, and moving a row to another section moves its files too. Tools find a frame by name, so nothing else needs its folder. The `shared` folder (`design.shared`) holds styles and the shell, not frames.

Use the project's tokens and shared classes, as its frames doc says. Do not hard-code a color. A piece used by more than one frame goes in the shared styles, and a change to a shared piece is checked on every frame that uses it. A one-off may use a small `<style>` in the frame's head.

## Frames from a design tool

With `design.source` `png`, the designer draws in a design tool such as Figma, and the frames are the pictures it exports. Nothing is drawn or rendered here.

1. **Export.** The person exports each frame as PNG at 1x, so a picture's pixels are the frame's size. Ask for every state the stories need, such as empty, loading, and an error, not only the full screen.
2. **Size.** On the first import, read the pictures' size (`magick identify -format "%w %h"`). If it is not `design.size`, propose setting `design.size` to it: a config change, so ask first. A website opens at that size too, unless `app.web.size` says otherwise.
3. **File.** Name each frame in lowercase words joined by hyphens, after the state it shows, and save it as `<review>/<area>/<section>/<frame>.png`. The section is its screen-list heading as a slug.
4. **List.** Add the frame's row to the area's screen list, with its stories, its Reach, and what it shows, as for a drawn frame.
5. **Check.** `npx wf design check` fails each picture not at `design.size`. Then `npx wf design storyboard` lists them for the designer's review.
6. **Change.** A redrawn frame replaces its picture at the same path. A frame dropped in the design tool is deleted here, with its row.

Step 2 is done when every story's screens have a frame and the designer has accepted the storyboard.

## Draw or change a frame

1. Read the stories and the frame's row in the screen list. Design follows the stories. It does not invent a journey.
2. Start from the closest existing frame. Copy it and change only what the new state changes.
3. Follow the skeleton and shell attributes in the project's frames doc.
4. A frame that adds an optional panel or state to a screen draws a screen that already works without it.
5. Give a new frame its row in the area's screen list in the same change, with a **Reach**: the scenario and run steps that open the app on the frame's state, or `none, <chunk>: <reason>` naming the chunk that will build that state. The `screen-review` skill says who fills it in and when, and `npx wf screens --check` fails a row without one.

## Render and check

```bash
npx wf design render                   # every frame
npx wf design render <area>            # one area, or <area>/<section>
npx wf design render <frame> <frame>   # named frames
npx wf design check <frame>            # what runs past the window or is cut off
```

Render only the frames you changed, unless a shared file changed. `check` opens each frame at every size in `design.check.sizes` and lists what runs past the window or is cut off; it exits 1 when it finds any. Only the drawing size is kept as a PNG. When a change affects a smaller window, take a screenshot of the app at that size with the project's app-testing skill and read it.

Then read the PNG. The image reader caches by path, so copy the PNG to a new name first, such as `.cache/view/<frame>-2.png`, and read the copy. Look for clipped or overflowing text, missing pieces, and a layout that does not match the story. Fix and render again. Two or three passes should be enough.

Then run `npx wf design storyboard`, which rewrites each area's `<review>/<area>/storyboard.md` from its screen list and prints the frames changed since `design.base`, in story order. The designer reviews the PNGs in that order. `npx wf design storyboard --check` lists stale storyboards and writes nothing.

Render again after changing a frame or a shared style, and commit the HTML and PNG together. A PNG older than its HTML is out of date: render it rather than trusting it.

## Pictures for a question

A question about a frame, a screen, or an image comes with its picture, sent just before the question. Make every such picture with `npx wf design annotate <spec.json>` (or `-` for a spec on stdin). It gives each picture a bar with its letter and name, and numbered boxes around what to look at:

```json
{
  "out": ".cache/view/sheet.png",
  "pictures": [
    { "label": "A", "frame": "home", "boxes": [{ "n": 1, "kind": "look", "selector": ".toolbar" }, { "n": 2, "kind": "bug", "selector": ".row", "text": "Delete" }] },
    { "label": "B", "name": "the app", "image": ".cache/screens/home.png", "boxes": [{ "n": 1, "kind": "drift", "rect": [633, 373, 598, 35] }] }
  ]
}
```

- A frame's boxes come from its elements (`selector`, optional `text` and `nth`), found in Chromium at the render size. A screenshot's boxes are rects: x, y, width, height.
- Kinds: `look` blue, `bug` red, `drift` amber, `ok` green, `new` purple for what is new or changed in a picture sent for review. When nothing fits, add a kind under `design.kinds` in `.workflow/config.json` with a `color`, `word`, and `use`. A kit kind is never changed and no two kinds share a colour; the command fails on either.
- In the chat, a comparison is one labelled sheet, such as the frame on the left and the app on the right. Several questions share one sheet, and each question says where to look, such as "sheet A, box 2".
- The command also writes the sheet's `.html` page and an `index.html` beside it, and prints the page's address.
- **For an ask page, add `--ask`.** `npx wf design annotate <spec> --ask` draws no sheet: it writes each picture on its own and `<out>.ask.json`, the pictures with their boxes as data, and a frame followed by its app picture as one compare pair (or the pairs `pairs` names, such as `[["A", "B"]]`). Put a pair in a question's `compare`, or the `compare` template's `pairs`, so the page draws the boxes, zooms, and takes pins. Never put the joined sheet on an ask page; the core `ask-page` skill says which part fits each question.
- Without a pane, send the sheet, or open the sheet's address that `wf design annotate` prints; it starts the shared `question-pictures` server when none runs.

## Compare the app with a frame

Render the frame, then screenshot the same state of the app with the project's app-testing skill. Read both images and report differences in layout, text, and color. Frames and the app share the same tokens and font, so a difference is real. Do it as soon as a screen renders, not only at chunk end: a screen built from a frame's words alone drifts from its picture.

## Do not

- Do not edit a PNG under the review folder by hand. Render it.
- Do not use JavaScript in a frame beyond the project's shell script. A frame is a still picture of one state.
- Do not give anything a fixed width that can push past the smallest checked window, and do not add a breakpoint in a frame unless the frames doc says where they live.
- Do not add a font, an image library, or a build step to frames without asking the designer.
