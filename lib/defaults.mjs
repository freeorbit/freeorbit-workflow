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
    // The project's own words for the index's words table, { word: meaning }, after the kit's.
    words: {},
    // The kit docs this project takes; null takes every one, [] takes none.
    synced: null,
    // Research and past findings quote what was true then, so their links and blocks are not checked.
    history: ["docs/research/**", "docs/log/review-findings*", "docs/log/decisions-closed/**", "docs/log/efficiency-log*"],
    held: ["AGENTS.md", ".claude/skills/*/SKILL.md", ".claude/agents/*.md", "docs/**/*.md"],
    notHeld: ["docs/log/**", "docs/research/**"],
    notIndexed: [],
    loose: [],
    blockWords: 60,
    written: ["docs/log/**", "docs/workflow/**"],
    // A decision's Decision and Why cells are each at most this many words; the detail goes in the doc that owns it.
    cellWords: 30,
    // A line in a table cell split with <br>, such as a bullet, is at most this many words.
    bulletWords: 15,
    // Docs whose table cells are not yet split; their cells are not counted.
    looseCells: [],
    // Decisions files still in their long form, before their shortening pass; their cells are not counted.
    longDecisions: [],
    // Logs whose rows are only added, never edited in place, merge by union; a row edited on two branches would come out twice.
    union: ["docs/log/decisions/**", "docs/log/efficiency-log.md", "docs/log/troubleshooting.md", "docs/log/e2e-runs.md", "docs/log/chunks-done.md"],
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
    questionsResolved: "docs/log/questions-resolved.md",
    troubleshooting: "docs/log/troubleshooting.md",
    efficiencyLog: "docs/log/efficiency-log.md",
    ledger: "docs/log/review-findings.md",
    ledgerClosed: "docs/log/review-findings-closed.md",
    efficiency: "docs/workflow/efficiency.md",
    // One decisions file per area and topic, and the superseded ones beside them.
    decisions: "docs/log/decisions",
    decisionsClosed: "docs/log/decisions-closed",
    // One row per end-to-end test run, to judge whether it earns its cost.
    e2eRuns: "docs/log/e2e-runs.md",
  },
  efficiency: { checkEvery: 5 },
  // Project-wide decision files beside the areas' own, each with its ID prefix.
  decisionTopics: [
    { id: "stack", prefix: "ST" },
    { id: "design", prefix: "DS" },
    { id: "workflow", prefix: "WF" },
  ],
  testdata: {
    // The folder of the one tool that writes the project's synthetic test data.
    dir: "tools/testdata",
    // The project's test-data doc: its process, its folder, and its generator.
    processDoc: "docs/workflow/test-data-process.md",
    // Docs the blind designer may read besides an area's own, such as the personas.
    reads: [],
    // Paths every dataset set must cover, such as a mode every story works in.
    mustCover: "",
    // Shell command prefixes for route, stale, covered, index, journeys, and e2e-files; wf testdata appends the arguments.
    commands: {},
  },
  review: {
    rubric: "docs/workflow/code-standards.md",
    threatModel: "",
    // Docs the reviewer may read besides the rubric and the threat model; it searches the large ones.
    reads: [],
    web: "advisory and official sources only: OSV, GitHub advisories, NVD, and package registry pages",
    // The hosts the reviewer's web fetches may reach; the core plugin's guard enforces it. Empty means the guard's own list.
    webDomains: [],
    // A change to one of these, by file name, runs the deps scans.
    depFiles: ["package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock"],
    // Globs a review leaves out of its scope and diff; lockfiles are left to the scanners.
    diffExclude: ["docs/**", "**/package-lock.json", "**/pnpm-lock.yaml", "**/yarn.lock"],
    models: { deep: { review: "opus", verify: "sonnet" }, light: { review: "sonnet", verify: "opus" } },
    // Shell commands, run from the project root with SCAN (the output folder), FILES (the scope list), and KIT set.
    scans: { every: [], deps: [], full: [], structure: [] },
  },
  design: {
    // "html": frames are HTML the kit renders and checks. "png": pictures exported from a design tool, such as Figma.
    source: "html",
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
    // The font for an annotated sheet's labels and numbers; when it is not here, a bold font found on this computer.
    font: "/usr/share/fonts/noto/NotoSans-Bold.ttf",
    // The browser the design tools and the web driver run; empty finds Chromium or Chrome here, macOS's app bundles included.
    browser: "",
    // The project's own kinds of mark, { name: { color, word, use } }, after the kit's.
    kinds: {},
    // Frames changed since this branch are listed for review in story order.
    base: "main",
  },
  app: {
    // How the driver starts and stops what it runs: "systemd" units, detached "process" groups, or "auto".
    runner: "auto",
    // "tauri": the debug binary and Vite, through WebKit's inspector. "web": the project's servers, then Chromium.
    kind: "tauri",
    // The project's app-testing doc: its checks, test data, test services, and stubs.
    doc: "",
    // Names the driver's units and its state folder, /tmp/<name>-agent.
    name: "",
    // The debug binary, from the project root, and the Tauri identifier its data folder is named after.
    binary: "",
    bundleId: "",
    vite: {
      cwd: ".",
      command: ["pnpm", "vite", "--port", "1420", "--strictPort"],
      url: "http://localhost:1420/",
    },
    memoryMax: "1500M",
    runtimeMaxSec: 900,
    // Instance N's WebKit inspector listens on this port plus N.
    inspectorPort: 9333,
    // The variable that picks a second app instance, and the one the app reads its window size from.
    instanceEnv: "WF_APP_INSTANCE",
    sizeEnv: "",
    // The project's module with prepare(ctx) and stop(ctx), from the project root.
    hooks: "",
    // `wf app db <name>` reads these: for tauri a file under the app's data folder, `*` standing for the name; for web a psql connection address.
    databases: {},
    web: {
      // The address Chromium opens, and the servers that serve it, each { name, command, cwd?, url?, env? }; a server with a url is waited for.
      url: "",
      servers: [],
      // Instance N's Chromium debugging port is this plus N.
      debugPort: 9444,
      // The window a run opens at; unset, the project's frame size (design.size).
      size: null,
      // Named viewports for start --size and the size step, as a website is checked at several widths.
      sizes: { desktop: [1440, 900], tablet: [768, 1024], mobile: [390, 844] },
      headless: true,
      // Turn off only where the system forbids Chromium's sandbox, such as Ubuntu 24.04's CI runners.
      sandbox: true,
    },
  },
  release: {
    // The project's release runbook: its branches, keys, build, and what runs where.
    doc: "",
    // Shell command prefixes for next, check, set, and verify; wf release appends the arguments.
    commands: {},
    // The workflows the skill starts after the tag, by step; build runs on the tag push.
    workflows: { build: "", sign: "", publish: "" },
    changelog: "CHANGELOG.md",
    // A tag is <tagPrefix><version>, and a pre-release version holds this, such as 0.2.0-rc.1.
    tagPrefix: "v",
    preRelease: "-rc.",
  },
  e2e: {
    // The model the blind e2e-tester runs on.
    testerModel: "sonnet",
    // Journeys one tester walks, so its context stays small; more go to further testers, one after another.
    journeysPerAgent: 8,
    // Docs the tester may read besides its area's own, such as the project's app-testing doc for the commands and stubs.
    reads: [],
  },
  screens: {
    // The project's module whose lists({ root, config, state, screens }) gives the light and deep lists.
    scope: "",
    // A shell command that prints the test-data scenario names, one a line.
    scenarios: "",
    // A shell command run once before a run shoots, such as building the test-data tool.
    build: "",
    // The stress look: data attributes put on the page's root element, such as { "appearance": "light" }.
    stress: {},
    // The narrow viewport, shot as the whole page.
    narrow: "800x560",
    jobsMax: 8,
    // Parallel apps each get a virtual display: "kwin" (kwin_wayland --virtual) or "none" (one app, on the user's screen).
    display: "kwin",
    // The model the screen-reader agent runs on.
    readerModel: "sonnet",
  },
  disk: {
    minimumGb: 10,
    // Step 1: test output nothing uses again. `recreate` folders are made again, empty.
    leftovers: [".cache/view", "target/tmp"],
    recreate: [".cache/view"],
    // Step 2: incremental build data.
    incremental: ["target/debug/incremental", "target/release/incremental"],
    // Step 3: build files untouched for `days`.
    stale: { dirs: ["target/debug/deps"], days: 7 },
    // Processes that mean a build is running, so steps 2 and 3 wait.
    busy: ["cargo", "rustc"],
    // Listed with their sizes when the disk is still short.
    report: ["target", "node_modules", ".git"],
  },
  github: {
    // What the hosting plan can enforce: free, pro, team, or enterprise, and whether the repository is public.
    plan: "free",
    public: false,
    // Each file wf github sync writes, on or off; the init turns on what the plan and the team need.
    prTemplate: false,
    issueTemplates: false,
    codeowners: false,
    checkWorkflow: false,
    dependabot: false,
    // The check workflow's command and the shell steps before it, such as installing a toolchain.
    check: { command: "", setup: [] },
    // Organization admins may merge past the ruleset, for a team whose only reviewer would otherwise approve their own pull requests.
    adminBypass: false,
  },
  tracks: {
    // The project's quick check for the quick track, such as its docs and tools tests.
    check: "",
    // The project's whole check for the chunk track, run before its pull request.
    fullCheck: "",
    // A quick change stays within these; one that reaches further is a chunk.
    quickPaths: ["docs/**", "**/*.md", "tools/**", ".claude/**", ".opencode/**", ".workflow/**", ".github/**"],
    // Paths inside those that are still not quick, besides the story files: test-data specs feed the generator's tests.
    notQuick: ["docs/**/test-data/**"],
  },
  check: {
    // The project's checks for wf check, in order: { name, command, slow? }; a slow step runs only with --all.
    steps: [],
    // Where each step's output is saved.
    logs: ".cache/check",
  },
  lanes: {
    // The lane names a chunk row may end in, such as CH-01-fe.
    names: ["contract", "fe", "be", "integration"],
    // The API contract the lanes share: its file and the project's commands for it.
    contract: { file: "", check: "", mock: "", breaking: "" },
  },
  branches: {
    // Branches nothing is committed or pushed to directly, as patterns matched whole.
    protected: ["main", "release/\\d+\\.\\d+"],
    // A branch's slug, after its scope, is at most this long.
    slugMax: 40,
  },
  ai: {
    // The agent tools the team uses: "claude" (Claude Code) and "opencode". wf ai:sync writes OpenCode's files only for it.
    tools: ["claude", "opencode"],
  },
  hooks: {
    // The core plugin's guard keeps the blind agents to what their prompts allow (W-08).
    blindness: true,
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
    "The drawing size and a small window, 800 by 560, so a layout that only works wide is caught before the app is built (from Freeorbit's smallest-window story).",
  "design.check.narrowBelow":
    "Wide frames draw a scrolling list as a pane cut at the bottom on purpose; below 1100 wide, panes grow instead, so a cut there is a fault.",
  "design.kinds":
    "A mark's colour means one thing in every picture; the kit's five cover most questions, and a project adds its own rather than changing one.",
  "app.memoryMax":
    "A runaway page once used all of a VM's memory and froze the machine; 1500 MB holds a Tauri debug app with room, and the cap stops a loop before the desktop does.",
  "app.runtimeMaxSec": "An agent's app left running after a turn stops itself in 15 minutes, longer than any one test run.",
  "e2e.testerModel": "Walking journeys and reading page text is steady, long work that Sonnet does well; every draft is replayed by the main session before it counts.",
  "e2e.journeysPerAgent": "About eight journeys filled a tester's context in the 2026-11-06 Uplink run (76k to 135k tokens a walk); more made later journeys less careful.",
  "github.plan": "Rulesets and branch protection need a public repository or a paid plan, so the plan decides whether main is held by GitHub or only by the local git hooks.",
  "github.checkWorkflow": "Off by default: private Actions minutes are capped on the free plan, and a full check can need a whole toolchain; the local gates run it before every pull request.",
  "docs.union":
    "GitHub's merge ignores merge=union (tested 2026-11-09), but a local rebase onto main honours it, so rows added on two branches both land; logs edited in place, such as the ledger, stay out, since union would keep both edits.",
  "docs.bulletWords": "A bullet a reader takes in at once is a short line; 15 words keeps a split table cell scannable (2026-11-09, the screen lists).",
  "docs.cellWords":
    "Thirty words is one plain sentence; the 2026-11-09 decisions log had 271 rows of 60 to 110 words, read by date and too long to scan.",
  decisionTopics: "Decisions that span areas need a home of their own; stack, design, and workflow covered every Freeorbit decision that was not one area's.",
  "screens.jobsMax": "Eight apps at once measured fastest on an 8-core machine (2026-11-09: 8 and 10 tied); more only adds memory.",
  "screens.readerModel":
    "Reading a picture pair for differences is triage the main session checks; Sonnet does it well for less, and the main session reads every flag in full.",
  "disk.minimumGb":
    "10 GB holds one more Rust debug build and its tests; below it a build can fail midway with No space left on device.",
  "disk.stale.days":
    "A dependency change leaves old binaries behind under new names; a week keeps what any current branch still links, and cargo rebuilds the rest from local sources.",
  "tracks.notQuick": "A test-data spec is a doc, but the generator's stamp test reads it, so a one-cell edit there failed the full check (2026-11-10, Freeorbit PR #94); such a change takes the chunk track.",
  "tracks.quickPaths":
    "Docs, tools, and the workflow's own files change no story or screen, so a fix there needs no chunk start, review, or screen check; anything else is a chunk.",
  "check.steps": "Each project's checks differ by stack, so the kit runs the list and the project names its steps; slow ones wait for --all so a check while working stays quick.",
  "branches.protected": "The base stays releasable and a release line takes only fixes, so both change only through pull requests (branches.md).",
  "branches.slugMax": "Forty characters keeps a branch name readable in a list and a prompt.",
  "design.source": "Some designers draw in HTML beside the code, others only in a design tool; with png the exported pictures are the frames, and the storyboard and screen review work the same.",
  "ai.tools": "Claude Code reads the kit's plugins directly; OpenCode needs generated agent and command files, which only a team using it should carry.",
  "github.adminBypass": "GitHub never lets an author approve their own pull request, so a team with one reviewer could not merge that reviewer's work; init turns it on only then. It names organization admins, so it fits an organization's repository, and it lets them merge a pull request, never push.",
  "app.web.sizes": "A website is used at many widths; desktop, tablet, and mobile are common device sizes (a 1440-wide laptop, a portrait tablet, a 390-wide phone), and a project changes or adds its own.",
  "app.runner": "systemd units give the memory cap and the journal on Linux; macOS has no systemd, so auto falls back to process groups with the time limit kept and no memory cap.",
  "app.web.sandbox": "Chromium's sandbox keeps a page's code away from the computer; Ubuntu 24.04 runners forbid the user namespaces it needs, so CI turns it off there and nowhere else. It covers the web driver only.",
  "app.web.headless": "An agent reads the page and its pictures, not the screen, so a headless browser leaves the person's desktop alone; turn it off to watch a run.",
  "lanes.names": "A contract first, then the front end and the back end at once, then integration: the order that lets two developers build one chunk without waiting on each other.",
  team: "Solo gives one person every role and flags nothing for sign-off.",
  scopes: "A commit subject and a branch start with the part of the project they change, so the log reads at a glance; a project lists its own.",
  areas: "Each area goes through the four steps on its own, and its prefix makes story IDs, a prefix and a number, that never change.",
  roles: "Four roles cover a team of 4 to 5: one person may hold several, and developer may carry a specialty such as developer:frontend.",
  decisions: "Each kind of choice in the asking rules goes to the role that owns its outcome, so a team knows whom to ask before work depends on it.",
};
