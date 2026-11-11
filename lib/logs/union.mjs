// The append-only logs merge by union, so rows two branches add both land
// (audit W-13). GitHub's own merge ignores .gitattributes merge drivers, as
// the 2026-11-09 test showed, so a pull request behind main still shows a
// conflict there; a local rebase onto main honours the driver and resolves
// it, which is what the pull-request skill does. The block in .gitattributes
// between its two marker lines is the kit's; the rest is the project's.

const START = "# wf:union: the append-only logs merge by union (wf docs sync writes this block)";
const END = "# /wf:union";

/** The .gitattributes block for the logs `docs.union` names. */
export function unionBlock(config) {
  return [START, ...config.docs.union.map((pattern) => `${pattern} merge=union`), END].join("\n");
}

/** .gitattributes with the kit's block in step, or null when the text already is. */
export function withUnion(text, config) {
  const block = unionBlock(config);
  const current = text ?? "";
  const start = current.indexOf(START);
  const end = current.indexOf(END);
  let next;
  if (start !== -1 && end > start) next = `${current.slice(0, start)}${block}${current.slice(end + END.length)}`;
  else next = `${current}${current && !current.endsWith("\n") ? "\n" : ""}${current ? "\n" : ""}${block}\n`;
  if (config.docs.union.length === 0 && start === -1) return null;
  return next === current ? null : next;
}
