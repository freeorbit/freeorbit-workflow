// The kit's defaults, each with the reason it has that value. A project's
// .workflow/config.json overrides any of them. `wf config` prints both, so no
// number in the workflow is without a reason (audit W-14).

export const DEFAULTS = {
  project: "",
  team: "solo",
  people: [],
  roles: ["owner", "designer", "developer", "reviewer"],
  // The words a commit subject and a branch name start with.
  scopes: ["app", "workflow"],
  // The parts of the product that each go through the four steps, with their story ID prefix, such as { "id": "app", "prefix": "APP" }.
  areas: [],
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
    // Where the kit's workflow docs are written; a project's own parts sit inside them.
    workflow: "docs/workflow",
    // The kit docs this project takes; null takes every one, [] takes none.
    synced: null,
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
  testdata: {
    // The project's test-data doc: its process, its folder, and its generator.
    processDoc: "docs/workflow/test-data-process.md",
    // Docs the blind designer may read besides an area's own, such as the personas.
    reads: [],
    // Paths every dataset set must cover, such as a mode every story works in.
    mustCover: "",
    // Shell command prefixes for route, stale, covered, index, and journeys; wf testdata appends the arguments.
    commands: {},
  },
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
  design: {
    // The project's frames doc: its areas, shared pieces, shell, and look.
    doc: "docs/design/frames.md",
    // Frames are <frames>/<area>/<section>/<frame>.html, pictures the same path under <review> with .png.
    frames: "docs/design/frames",
    review: "docs/design/review",
    // The folder under frames that holds shared styles, not an area.
    shared: "shared",
    // Each area's screen list, under its docs folder.
    screens: "design/screens.md",
    // The window a frame renders at, width and height.
    size: [1280, 800],
    check: {
      // Each window size the checker opens every frame at.
      sizes: [
        [1280, 800],
        [800, 560],
      ],
      // The page area, which scrolls up and down but never sideways.
      page: ".content",
      // Boxes inside this are not checked for clipping, such as a dialog's overlay.
      skip: ".overlay",
      narrowBelow: 1100,
    },
    // The font for an annotated sheet's labels and numbers.
    font: "/usr/share/fonts/noto/NotoSans-Bold.ttf",
    // The project's own kinds of mark, { name: { color, word, use } }, after the kit's.
    kinds: {},
    // Frames changed since this branch are listed for review in story order.
    base: "main",
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
  "design.size": "1280 by 800 is a common laptop window and the size the Freeorbit frames were drawn and reviewed at; a frame is a still picture of one window.",
  "design.check.sizes":
    "The drawing size and a small window, 800 by 560, so a layout that only works wide is caught before the app is built (Freeorbit APP-25).",
  "design.check.narrowBelow":
    "Wide frames draw a scrolling list as a pane cut at the bottom on purpose; below 1100 wide, panes grow instead, so a cut there is a fault.",
  "design.kinds":
    "A mark's colour means one thing in every picture; the kit's five cover most questions, and a project adds its own rather than changing one.",
  team: "Solo gives one person every role and flags nothing for sign-off.",
  scopes: "A commit subject and a branch start with the part of the project they change, so the log reads at a glance; a project lists its own.",
  areas: "Each area goes through the four steps on its own, and its prefix makes story IDs such as APP-04 that never change.",
  roles: "Four roles cover a team of 4 to 5: one person may hold several, and developer may carry a specialty such as developer:frontend.",
  decisions: "Each kind of choice in the asking rules goes to the role that owns its outcome, so a team knows whom to ask before work depends on it.",
};
