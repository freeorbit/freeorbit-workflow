// The built app's Default picture of each screen, kept for the board's Built
// screens column (docs/design/board-sync.md). wf screens --accept copies each
// screen shot in that run to <design.built>/<area>/<screen>.png, so the
// pictures are committed and CI's board sync can upload them, and removes the
// picture of a screen no longer on the screen list, or no longer picked by
// board.screenshots.rows.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

import { builtPath, screenshotRows } from "../board/frames.mjs";
import { parseScreens } from "./list.mjs";

/** Whether wf screens --accept keeps built pictures: the project has a board that shows them. */
export const keepsBuilt = (config) => Boolean(config.board?.boardId && config.board?.show?.screenshots);

/**
 * Copy the run's Default pictures into design.built and remove the stale
 * ones. `latest` is the run's hashes by screen name, `latestDir` where its
 * pictures are. Returns { copied, removed }, each a list of repo paths.
 */
export function keepBuilt(root, config, latest, latestDir) {
  const copied = [];
  const removed = [];
  const picks = screenshotRows(config);
  for (const area of config.areas.filter((each) => each.docs)) {
    const list = join(root, area.docs, config.design.screens);
    const rows = existsSync(list) ? parseScreens(readFileSync(list, "utf8"), list).filter(picks) : [];
    const names = new Set(rows.map((row) => row.name));
    for (const row of rows) {
      const from = join(latestDir, `${row.name}-wide-default.png`);
      if (!latest[row.name]?.["wide-default"] || !existsSync(from)) continue;
      const to = builtPath(config, area.id, row.name);
      mkdirSync(join(root, to, ".."), { recursive: true });
      copyFileSync(from, join(root, to));
      copied.push(to);
    }
    const dir = join(root, config.design.built, area.id);
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir).filter((each) => each.endsWith(".png"))) {
      if (names.has(file.slice(0, -4))) continue;
      rmSync(join(dir, file));
      removed.push(builtPath(config, area.id, file.slice(0, -4)));
    }
  }
  return { copied, removed };
}
