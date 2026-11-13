// The ask pages' and the inbox's styles: the parts in lib/ask/browser/style,
// joined in file order (10 the tokens, 20 the frame, 30 pictures, 40 the
// footer, popovers, receipt, and inbox, 50 blocks, 60 the richer answers,
// 70 charts and diagrams), as the page's script is joined from its parts.

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const STYLE = join(dirname(fileURLToPath(import.meta.url)), "browser", "style");

/** Every style part, in order, as one stylesheet. */
export function pageStyles() {
  return readdirSync(STYLE).filter((f) => f.endsWith(".css")).sort().map((f) => readFileSync(join(STYLE, f), "utf8")).join("\n");
}
