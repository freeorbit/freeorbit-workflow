// The kinds of mark on a picture: what a box or a pin means, and its colour.
// Shared by design's annotated sheets and the ask pages' pins, so one kind
// looks the same everywhere.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { KIT_ROOT } from "../setup/ai.mjs";

/**
 * The kit's kinds of mark, each with its colour and its word in the legend,
 * from plugins/design/annotate-kinds.json. A kind is never changed, so it
 * looks the same in every run and every project.
 */
export const KIT_KINDS = JSON.parse(readFileSync(join(KIT_ROOT, "plugins", "design", "annotate-kinds.json"), "utf8")).kinds;

/**
 * The kit's kinds, then the project's own from design.kinds. A project kind
 * may not reuse a kit kind's name or any kind's colour, so a mark never
 * changes meaning. Throws with what clashes.
 */
export function kindsFor(config) {
  const out = { ...KIT_KINDS };
  const colors = new Map(Object.entries(KIT_KINDS).map(([kind, { color }]) => [color.toLowerCase(), kind]));
  for (const [kind, value] of Object.entries(config.design.kinds)) {
    if (KIT_KINDS[kind]) throw new Error(`design.kinds.${kind}: the kit already has a kind named ${kind}, and a kind never changes.`);
    if (!value || typeof value.color !== "string" || !value.word || !value.use) {
      throw new Error(`design.kinds.${kind}: a kind has a color, a word, and a use.`);
    }
    const clash = colors.get(value.color.toLowerCase());
    if (clash) throw new Error(`design.kinds.${kind}: ${value.color} is already the colour of ${clash}.`);
    colors.set(value.color.toLowerCase(), kind);
    out[kind] = value;
  }
  return out;
}
