// The kit's defaults, each with the reason it has that value. A project's
// .workflow/config.json overrides any of them. `wf config` prints both, so no
// number in the workflow is without a reason (audit W-14).

export const DEFAULTS = {
  project: "",
  team: "solo",
  people: [],
  docs: {
    index: "docs/README.md",
    // Research and past findings quote what was true then, so their links and blocks are not checked.
    history: ["docs/research/**", "docs/log/review-findings*", "docs/log/decisions.md", "docs/log/efficiency-log*"],
    held: ["AGENTS.md", ".claude/skills/*/SKILL.md", ".claude/agents/*.md", "docs/**/*.md"],
    notHeld: ["docs/log/**", "docs/research/**"],
    notIndexed: [],
    loose: [],
    blockWords: 60,
    written: ["docs/log/**", "docs/workflow/**"],
  },
  stories: {
    files: ["docs/app/user-stories.md", "docs/plugins/*/user-stories.md"],
    prefixes: [],
  },
  buildOrder: {
    file: "docs/log/build-order.md",
    done: "docs/log/chunks-done.md",
    groups: ["In progress", "Waiting", "Not started"],
    stepWords: ["Done", "Waiting on the owner", "In progress", "Not started"],
  },
  logs: {
    openQuestions: "docs/log/open-questions.md",
    ledger: "docs/log/review-findings.md",
    ledgerClosed: "docs/log/review-findings-closed.md",
    efficiency: "docs/workflow/efficiency.md",
  },
  efficiency: { checkEvery: 5 },
  growth: {
    always: ["AGENTS.md"],
    prompts: [".claude/skills/*/SKILL.md", ".claude/agents/*.md"],
    docs: ["docs/**/*.md"],
    notDocs: ["docs/research/**"],
    largeDoc: 15000,
    largePrompt: 10000,
  },
  extensions: [],
};

export const REASONS = {
  "docs.blockWords":
    "A paragraph or bullet over 60 words stops reading at a glance; the 2026-11-04 count found blocks up to 304 words that people skipped.",
  "docs.written":
    "Dates in logs and workflow docs say when something was written, so one after today is a slip (2026-11-08: 105 dates a day ahead).",
  "docs.history": "Research and closed findings record what was true then; checking their links would rewrite history.",
  "efficiency.checkEvery":
    "Five chunks gives enough rows to see a repeat without letting one run for a week; it is a hypothesis the check itself reviews.",
  "growth.largeDoc": "15,000 bytes is about 4,000 tokens, the point where reading a doc whole costs more than searching it.",
  "growth.largePrompt": "A skill or agent over 10,000 bytes loads about 2,500 tokens each time it runs; split reference parts out.",
  "buildOrder.stepWords": "A step cell starts with one status word so status can be read by a script, not by reading the log.",
  team: "Solo gives one person every role and flags nothing for sign-off.",
};
