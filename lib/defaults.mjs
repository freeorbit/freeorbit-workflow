// The kit's defaults, each with the reason it has that value. A project's
// .workflow/config.json overrides any of them. `wf config` prints both, so no
// number in the workflow is without a reason (audit W-14).

export const DEFAULTS = {
  project: "",
  team: "solo",
  people: [],
  roles: ["owner", "designer", "developer", "reviewer"],
  // The words a commit subject and a branch name start with.
  areas: ["app", "workflow"],
  // Which role answers each kind of choice, from the asking rules. A list means each of them.
  decisions: {
    plans: "developer",
    "missing-information": "owner",
    design: "designer",
    architecture: "developer",
    approach: "developer",
    scope: "owner",
    irreversible: "owner",
    library: ["developer", "owner"],
    naming: "owner",
    security: "reviewer",
    "data-kept": ["reviewer", "owner"],
    conflict: "owner",
    "test-data": "reviewer",
    findings: "reviewer",
    screens: "designer",
    merge: "owner",
    release: "owner",
  },
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
  review: {
    rubric: "docs/workflow/code-standards.md",
    threatModel: "",
    // Docs the reviewer may read besides the rubric and the threat model; it searches the large ones.
    reads: [],
    web: "advisory and official sources only: OSV, GitHub advisories, NVD, and package registry pages",
    // A change to one of these, by file name, runs the deps scans.
    depFiles: ["package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock"],
    // Globs a review leaves out of its scope and diff; lockfiles are left to the scanners.
    diffExclude: ["docs/**", "**/package-lock.json", "**/pnpm-lock.yaml", "**/yarn.lock"],
    models: { deep: { review: "opus", verify: "sonnet" }, light: { review: "sonnet", verify: "opus" } },
    // Shell commands, run from the project root with SCAN (the output folder), FILES (the scope list), and KIT set.
    scans: { every: [], deps: [], full: [], structure: [] },
  },
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
  "review.models":
    "The deep pass reads whole files on the strongest model; verify always runs on a different model than the pass it checks, so one model's blind spot is not checked by itself.",
  "efficiency.checkEvery":
    "Five chunks gives enough rows to see a repeat without letting one run for a week; it is a hypothesis the check itself reviews.",
  "growth.largeDoc": "15,000 bytes is about 4,000 tokens, the point where reading a doc whole costs more than searching it.",
  "growth.largePrompt": "A skill or agent over 10,000 bytes loads about 2,500 tokens each time it runs; split reference parts out.",
  "buildOrder.stepWords": "A step cell starts with one status word so status can be read by a script, not by reading the log.",
  team: "Solo gives one person every role and flags nothing for sign-off.",
  areas: "A commit subject and a branch start with the part of the project they change, so the log reads at a glance; a project lists its own parts.",
  roles: "Four roles cover a team of 4 to 5: one person may hold several, and developer may carry a specialty such as developer:frontend.",
  decisions: "Each kind of choice in the asking rules goes to the role that owns its outcome, so a team knows whom to ask before work depends on it.",
};
