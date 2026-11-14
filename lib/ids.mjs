// Every ID the workflow makes, in one table: its kind, its pattern, an
// example, what it names, and where it is defined. doc:check, the trace,
// `wf testdata ids`, `wf testdata rename-ids`, and `wf id` all read it, and
// docs/workflow/ids.md describes it, so they cannot drift apart.
//
// An ID is unique across the whole app. A kind with an area in it carries
// the area's prefix, such as GM: R-GM-119 is the Gmail area's rule 119.

/** The area prefixes a project has, such as ["APP", "GM", "DR"]. */
export const prefixesOf = (config) => config.areas.map((area) => area.prefix).filter(Boolean);

const any = (prefixes) => (prefixes.length ? prefixes.join("|") : "[A-Z]+");

/**
 * Each kind of ID: `kind`, `re` (the whole ID), `example`, `means`, and
 * `where` it is defined. Area kinds take the project's prefixes; the order
 * matters, since a finding's shape is the loosest.
 */
export function idKinds(config) {
  const p = any(prefixesOf(config));
  return [
    { kind: "rule", re: new RegExp(`^R-(?:${p})-\\d+$`), example: "R-GM-119", means: "A rule the test data and the app follow", where: "A test-data rules table" },
    { kind: "check", re: new RegExp(`^C-(?:${p})-\\d+$`), example: "C-GM-41", means: "What a passing run shows in one flow", where: "A test-data checks table" },
    { kind: "gap", re: new RegExp(`^G-(?:${p})-\\d+$`), example: "G-GM-03", means: "A question the stories leave open, or a contradiction, for the story's owner", where: "A test-data gaps table" },
    { kind: "dataset", re: new RegExp(`^DS-(?:${p})-\\d+$`), example: "DS-GM-27", means: "A named, seeded set of test data", where: "A `### DS-GM-27. Name` heading in the test-data spec" },
    { kind: "story", re: new RegExp(`^(?:${p})-\\d{2,}$`), example: "GM-07", means: "One thing a user wants, with its acceptance lines", where: "A `### GM-07. Title` heading in the area's stories" },
    { kind: "decision", re: /^D-[A-Z]+-\d{3}$/, example: "D-GM-101", means: "A decision, by area or topic", where: "A decisions file's table" },
    { kind: "question", re: /^Q-\d{3}$/, example: "Q-113", means: "An open question, or one settled", where: "The open questions log, or the resolved one" },
    { kind: "chunk", re: /^CH-\d+[a-z]?$/i, example: "CH-12", means: "One chunk of the build", where: "The build order" },
    { kind: "finding", re: /^[A-Z][A-Z0-9]*-\d+$/, example: "SEC-083", means: "A code review or E2E finding", where: "The review ledger, or its closed file" },
  ];
}

/** Old IDs, from before areas qualified them: R-12, C-41, G-03, D27. */
export const OLD = { rule: /^R-\d+$/, check: /^C-\d+$/, gap: /^G-\d+$/, dataset: /^D\d+$/ };

/** What kind of ID this is, or "name" for a fixture, state, or input, or null. */
export function kindOf(id, config) {
  const s = String(id ?? "").trim();
  const kinds = idKinds(config);
  // An old R-12 has a finding's shape, so it is told apart before the finding.
  for (const each of kinds.slice(0, -1)) if (each.re.test(s)) return each.kind;
  for (const [kind, re] of Object.entries(OLD)) if (re.test(s)) return `old ${kind}`;
  if (kinds.at(-1).re.test(s)) return kinds.at(-1).kind;
  return /^[a-z0-9][a-z0-9_-]*$/.test(s) ? "name" : null;
}

/** An area-qualified ID from an old one: ("R-12", "GM") gives R-GM-12, and D27 gives DS-GM-27. */
export function qualify(old, prefix) {
  const m = /^(R|C|G)-(\d+)$/.exec(old) ?? /^(D)(\d+)$/.exec(old);
  if (!m) return null;
  return `${m[1] === "D" ? "DS" : m[1]}-${prefix}-${m[2]}`;
}

/** A pattern that finds an ID inside text, whole: R-GM-1 never matches inside R-GM-12, nor R-12 inside R-GM-12. */
export const within = (id) => new RegExp(`(?<![A-Za-z0-9_-])${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9_-])`);
