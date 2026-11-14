// Every ID the workflow makes, in one place: its kind, its pattern, an
// example, what it names, and where it is defined, and the patterns that find
// one inside text. doc:check, the story checks, the trace, `wf testdata ids`,
// `wf testdata rename-ids`, and `wf id` build theirs from here, and
// docs/workflow/ids.md describes it, so they cannot drift apart.
//
// An ID is unique across the whole app. A kind with an area in it carries
// the area's prefix, such as GM: R-GM-119 is the Gmail area's rule 119.

/** The area prefixes a project has, such as ["APP", "GM", "DR"]. */
export const prefixesOf = (config) => config.areas.map((area) => area.prefix).filter(Boolean);

/** Text with every regex metacharacter escaped. */
export const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The files an ID may be written in: docs, code, config, and data. */
export const TEXT = /\.(md|rs|ts|tsx|js|mjs|cjs|py|toml|json|ya?ml|html|css|txt)$/;

/** The letter each kind with an area in it starts with: R-GM-119, DS-GM-27. */
export const LETTER = { rule: "R", check: "C", gap: "G", dataset: "DS" };

// Nothing before or after but a space or punctuation: R-GM-1 never inside R-GM-12, nor R-12 inside R-GM-12.
const BEFORE = "(?<![A-Za-z0-9_-])";
const AFTER = "(?![A-Za-z0-9_-])";

/**
 * A story ID inside text, with its prefix and number as groups 1 and 2. A
 * story is its area's prefix and two digits, GM-07; GM-49 inside C-GM-49 is
 * part of another ID. With no prefixes it matches nothing.
 */
export const storyPattern = (prefixes, flags = "g") =>
  new RegExp(prefixes.length ? `(?<![A-Za-z0-9_]-)\\b(${prefixes.map(escapeRe).join("|")})-(\\d{2})\\b` : "(?!)", flags);

/** A rule ID inside text, area-qualified or old: R-GM-119, R-12. */
export const RULE_IN_TEXT = /\bR-(?:[A-Z]+-)?\d+\b/g;

/** An old, unqualified test-data ID inside text: R-12, C-41, G-03, D27. */
export const OLD_IN_TEXT = new RegExp(`${BEFORE}(?:[RCG]-\\d+|D\\d+)${AFTER}`, "g");

/** A decision ID of one area inside text: D-GM-101. */
export const decisionPattern = (prefix) => new RegExp(`\\bD-${escapeRe(prefix)}-\\d{3}\\b`);

/**
 * Each kind of ID: `kind`, `re` (the whole ID), `example`, `means`, and
 * `where` it is defined. The area kinds take the project's prefixes, and a
 * project with none has no area kinds. The order matters: a finding's shape
 * is the loosest.
 */
export function idKinds(config) {
  const prefixes = prefixesOf(config);
  const p = prefixes.map(escapeRe).join("|");
  const area = prefixes.length
    ? [
        { kind: "rule", re: new RegExp(`^R-(?:${p})-\\d+$`), example: "R-GM-119", means: "A rule the test data and the app follow", where: "A test-data rules table" },
        { kind: "check", re: new RegExp(`^C-(?:${p})-\\d+$`), example: "C-GM-41", means: "What a passing run shows in one flow", where: "A test-data checks table" },
        { kind: "gap", re: new RegExp(`^G-(?:${p})-\\d+$`), example: "G-GM-03", means: "A question the stories leave open, or a contradiction, for the story's owner", where: "A test-data gaps table" },
        { kind: "dataset", re: new RegExp(`^DS-(?:${p})-\\d+$`), example: "DS-GM-27", means: "A named, seeded set of test data", where: "A `### DS-GM-27. Name` heading in the test-data spec" },
        { kind: "story", re: new RegExp(`^(?:${p})-\\d{2}$`), example: "GM-07", means: "One thing a user wants, with its acceptance lines", where: "A `### GM-07. Title` heading in the area's stories" },
      ]
    : [];
  return [
    ...area,
    { kind: "decision", re: /^D-[A-Z]+-\d{3}$/, example: "D-GM-101", means: "A decision, by area or topic", where: "A decisions file's table" },
    { kind: "question", re: /^Q-\d{3}$/, example: "Q-113", means: "An open question, or one settled", where: "The open questions log, or the resolved one" },
    { kind: "chunk", re: /^CH-\d+[a-z]?$/i, example: "CH-12", means: "One chunk of the build", where: "The build order" },
    { kind: "finding", re: /^[A-Z][A-Z0-9]*-\d+$/, example: "SEC-083", means: "A code review or E2E finding", where: "The review ledger, or its closed file" },
  ];
}

/** Old IDs, from before areas qualified them: R-12, C-41, G-03, D27. */
export const OLD = { rule: /^R-\d+$/, check: /^C-\d+$/, gap: /^G-\d+$/, dataset: /^D\d+$/ };

/**
 * An area kind's ID taken apart: `{ prefix, number }` for R-GM-12, `{ prefix:
 * null, number }` for an old R-12 (D27 for a dataset), or null for neither.
 */
export function splitId(kind, id) {
  const letter = LETTER[kind];
  if (!letter) return null;
  const qualified = new RegExp(`^${letter}-([A-Z]+)-(\\d+)$`).exec(id);
  if (qualified) return { prefix: qualified[1], number: qualified[2] };
  const old = (kind === "dataset" ? /^D(\d+)$/ : new RegExp(`^${letter}-(\\d+)$`)).exec(id);
  return old ? { prefix: null, number: old[1] } : null;
}

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

/** An area-qualified ID from an old one, keeping its number as written: ("R-12", "GM") gives R-GM-12, and D27 gives DS-GM-27. */
export function qualify(old, prefix) {
  const kind = Object.keys(OLD).find((each) => OLD[each].test(old));
  return kind ? `${LETTER[kind]}-${prefix}-${splitId(kind, old).number}` : null;
}

/** A pattern that finds an ID inside text, whole. */
export const within = (id) => new RegExp(`${BEFORE}${escapeRe(id)}${AFTER}`);
