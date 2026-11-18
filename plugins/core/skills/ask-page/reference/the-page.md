# The page

What the person sees and uses. Nothing here is set in a spec; read it when they ask how the page works.

Every template shares one layout: a header with the title, who asked, the draft state, the other asks, and the progress; a column of questions; and a footer whose one primary button is Send.

- **Keys.** J and K move between questions, 1–9 pick, R takes the recommendation, D and L are You decide and Later, N is a note, Enter goes to the next open question, X selects, Ctrl+K opens the command list, Ctrl+Z undoes, and ? lists them all.
- **Reviews.** A compare opens on Swipe. A paged template shows one frame with a filmstrip; 1–4 give a verdict and move on. C is comment mode for pins, M the compare view, Z zoom, and F (Expand) shows the pictures in the whole window, where Fit is as big as the screen; Esc closes it. Past Fit, drag a picture to move around it. A wide picture, table, or diff scrolls in its own box, never the page.
- **Many at once.** Take all recommendations, or select questions or rows and give them one answer. Every change can be undone, from the toast or Ctrl+Z.
- **Waiting.** While an agent waits on the page (`wf ask wait` runs), the header shows "Agent waiting" with how long, the tab title starts with ●, and the tab's icon carries a dot. The inbox marks the row, and its own title starts with ● too. `wait` also shows a desktop notification when it starts and one reminder after `ask.remind` minutes, through the server; `ask.notify: false` turns both off, and `off: ["waiting"]` takes the marks off one page.
- **Later, for someone.** Picking Later shows a For list of the project's roles, each with the names of the people who hold it, and the client. It starts on the question's own role; `wf ask record` logs the open question for whoever is picked.
- **Sending.** Questions left open get one panel: send them as You decide, as Later, or open. A receipt then shows exactly what was sent, with Change answers and the next waiting ask.
- **Look.** Themes use Claude Desktop's own colour tokens: its theme and palettes when it is installed, and the kit's six, each light and dark. Any theme takes an accent, a text size, and a density.
- **Motion.** Things glide, open and close, and charts draw in. Motion in the ⋯ menu is System (the computer's setting for less motion), Full, Subtle, or Off; `off: ["motion"]` turns it off.
- **Separation.** Each section is one panel by default, its questions split by hairlines; Cards, Lines, and Bands are in the settings.
- **Folding.** Questions start expanded; Fold answered or Collapse all (⇧E) changes that, and Select all (⇧X) selects every question. Settings are kept until Reset settings, by the ask-pages server for this user, so a new browser or a new session's pane opens with them.
