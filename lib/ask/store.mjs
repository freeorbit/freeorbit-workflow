// Where an ask page and its answers live on disk, under a project's
// .cache/view: the one place that knows the layout. The ask commands write
// it, and the ask-pages server reads it to serve each page (TA-1).

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** An ask page's id. */
export const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Where an ask page's files and its answers live under the served folder. */
export const askDir = (dir, id) => join(dir, "ask", id);
export const answersPath = (dir, id) => join(dir, "answers", `${id}.json`);
/** What a page said between builds that a page built again with other questions drops: it was about the page before. */
export const DROPPED_ON_CHANGE = ["replies.json", "asks.json", "more.json", "working.json", "collab.json"];
/** The mark a person leaves when they archive an ask in the inbox, beside its spec. */
export const archivePath = (dir, id) => join(askDir(dir, id), "archived.json");

/**
 * When a page was archived, as the time it was asked that the archive covers,
 * or null. Asked again, the page has a newer spec, so the mark no longer
 * covers it and it shows again.
 */
export function archivedAsked(dir, id) {
  const file = archivePath(dir, id);
  if (!existsSync(file)) return null;
  try {
    const mark = JSON.parse(readFileSync(file, "utf8"));
    return typeof mark?.asked === "string" ? mark.asked : null;
  } catch {
    return null;
  }
}

/** A page's spec, or null: for an id that is not one, a file that is not JSON, or a spec that is not a page's. */
export function readSpec(dir, id) {
  if (typeof id !== "string" || !ID.test(id)) return null;
  const file = join(askDir(dir, id), "spec.json");
  if (!existsSync(file)) return null;
  try {
    const spec = JSON.parse(readFileSync(file, "utf8"));
    return spec && spec.id === id && Array.isArray(spec.questions) ? spec : null;
  } catch {
    return null;
  }
}
