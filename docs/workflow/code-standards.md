# Code standards

The rules the `code-reviewer` agent checks, and that people and agents follow when they write code here. Each rule has an ID that a finding cites.

<!-- wf:local layout -->

The code is written by people and by agents. A rule here serves both: a person can read a file top to bottom, and an agent can find the right file from its name.

## How this file grows

Nobody adds a rule here without a finding the reviewer accepted, or an owner decision in the decisions log, cited by its ID.

1. The reviewer proposes a new rule or a change, as an `STD-` finding in [the ledger](../log/review-findings.md).
2. The reviewer accepts, rejects, or defers it like any other finding.
3. An accepted rule is added here with its date. A rejected one stays closed in the ledger, so it is not proposed again.

## Severity

| Severity | Meaning |
| --- | --- |
| Critical | Exploitable now, or leaks credentials or personal data. Fix before the next commit. |
| High | Exploitable with a crafted input or a known advisory, or breaks a dependency rule in the project's structure doc. Fix this chunk. |
| Medium | A real weakness or a structure problem that makes the next feature harder. Plan a fix. |
| Low | Readability, naming, or a comment that is missing or wrong. |
| Info | An observation with no fix asked for, such as an outdated package with no advisory. |

## Structure

- **CS-MOD.** A guideline, not a hard rule. Group code by what it does. Features may overlap.
  - Code that two or more features use goes into a shared module they both depend on. It is not copied, and it does not live inside one feature's folder.
  - The reviewer flags duplicated logic, and a shared piece kept inside one feature. It does not flag every overlap.
- **CS-SIZE.** A file stays near 400 lines. Above 600 it is flagged, with a suggested split along what the parts do. Generated files, such as `packages/plugin-client/src/bindings.ts`, are exempt. A test file is flagged only above 1000.
- **CS-FUNC.** A guideline, not a hard rule (added 2026-11-02). The check asks whether a reader can hold a function at once.
  - Near 60 lines it gets a look. Above 100 it is flagged, with a suggested split along its steps.
  - A long function that runs straight through one job may stay, when a split would only move lines.
  - A React component counts its body.
- **CS-FOLDER.** A guideline, not a hard rule (added 2026-10-31). A folder with more than 10 code files gets a look. The check asks whether a group helps. It is not a limit.
  - A component and its styles count as one file.
  - Group files that share a job or a name prefix into a subfolder, when at least three belong together.
  - A folder of like items stays flat, such as one component or one data record per file.
  - A group's name says what it holds (CS-NAME), and a move adds no re-export layer (CS-BOIL).
  - It applies in review, and when a change adds a file to a folder past the line. A move is its own commit.
- **CS-NAME.** A file name says what is in it, and a function name says what it does. No `utils`, `helpers`, `misc`, or `common` without a word that says which. One word means one thing across the code, and the project's word list says which (changed 2026-11-02).
- **CS-CMT.** A public function or component has a one-line comment that says what it is for (changed 2026-11-02).
  - So does a private one whose purpose its name does not make plain.
  - Tests and their helpers, plain getters, and one-line trait methods are exempt.
  - Code that is hard to follow gets a longer comment on why. Comments do not retell the code line by line.
  - A comment or doc line that no longer holds is a finding too (changed 2026-11-02).
- **CS-BOIL.** A simple feature does not need many files, wrappers, or registrations. A pattern that makes every new command or screen touch several layers for nothing is flagged.
- **CS-ADD.** Adding a feature or a plugin touches few files. When a finding is about this, it lists the files a new feature had to touch.
- **CS-TEST.** A test proves an acceptance line, a bug fix, or a limit (added 2026-11-01). A test that repeats what another test already proves is flagged. Keep the one closest to the behavior. A fix, a limit, or logic in the UI with no test is a gap (changed 2026-11-02).
  - **A rule is tested where it lives** (added 2026-11-14). A caller gets one test that it uses the rule, never the rule's cases again.
  - **Cases of one shape are one table.** Tests that differ only in their values become one test over rows, each row saying what it shows: rstest or test-case in Rust, a loop or `test.each` in JavaScript. A test-data spec's input classes are such a table. The structure scan lists tests of one shape.
  - **A property for a rule that holds for every input**, such as a parser's round trip or a validator that never panics: one property test (proptest, fast-check) in place of many examples, keeping the examples of bugs it found.
  - **A mutation tool prunes**, where the project runs one in `review.scans.full`, such as cargo-mutants or Stryker on the changed files. A test that kills no mutant another test leaves alive adds nothing.
  - **The spec is the one copy** (added 2026-11-14). A test reads an input class's values, or a fixture's expectation, from the test-data spec or the file the generator writes, never retyped in the test. A test cites the check (`C-NN`), rule, fixture, or story it proves, so `npx wf testdata trace` finds it.
  - **A skip is a failure in the full check.** A test that skips for a missing tool, such as a container, passes nothing. A smaller stand-in in the same process is better than a test that does not run.
  - **Fast first.** The tests a change touches run with each change, and the whole suite in the full check before the commit. Changed-line coverage, such as cargo-llvm-cov with diff-cover, may report the risky lines a change left untested.
- **CS-PROOF.** A hash, a snapshot, or another recorded value becomes a check only once two fresh runs agree on it (added 2026-11-04). One run can record its own accident.
- **CS-FMT.** Format only with what the project's check runs, and read a failing check's command before fixing it (added 2026-11-05). A formatter the check does not run rewrites files no one changed.
<!-- wf:local structure-tests -->

- **CS-ERR.** A failure reaches the user as one plain sentence that says what to do, and a job ends in a state it can leave (added 2026-11-02).
<!-- wf:local errors -->

- **CS-STATE.** A piece of state has one owner (added 2026-11-02). Fields that change together are held together and reset in one place. A lock is not held across slow work: the network, a sweep of the disk, or a model starting.
<!-- wf:local structure-ui -->

- **CS-STATUS.** A status on a screen comes from the state it names, and a placeholder has a comment and a chunk (added 2026-11-02).
- **CS-DEAD.** No unused code or dependency (added 2026-11-02). A feature that is removed takes its helpers, styles, docs, and tests with it.
- **CS-TYPES.** A guideline, not a hard rule (added 2026-11-02). Group types and constants by feature, not by kind.
  - One used in one file stays at the top of that file.
  - One used by two or more files in a feature, or more than about 8 definitions crowding the logic, goes in `types.rs` or `types.ts` in that feature's folder.
  - One used across features goes in the crate that owns the idea.
  - Constants are named by purpose, such as `limits.rs`, never `constants`, `enums`, or `interfaces`.
- **CS-LIST.** Data that grows is found automatically, not listed by hand, and a lookup over it does not scan everything (added 2026-11-02). A list fixed by a spec, such as a test dataset, may stay by hand. Work does not grow faster than the data: no step that repeats over everything so far for each new item (changed 2026-11-02).

## Security

The threat model, from `review.threatModel` in the config, says what is protected, from whom, and at which boundaries. These rules say what must hold at those boundaries.

- **SEC-DEP.** No dependency with a known advisory (GHSA, OSV, or the ecosystem's own database) at the version in a lockfile. A yanked or unmaintained package is reported too. Every committed lockfile is scanned.
- **SEC-PATH.** A path built from input (an archive entry, a file name, a setting) cannot leave the folder it is meant for. Archive entries are checked for `..`, absolute paths, and links.
- **SEC-PARSE.** Parsing untrusted input (archives, file formats, headers, server replies) has a limit on size, depth, and count, and does not crash on bad input.
- **SEC-NET.** Network calls use TLS and verify certificates, and only reach a host the product declares or the user entered. Plain http is only for this computer or, where a decision allows it, the private network. A redirect cannot move a request to another host.
  - The one exception is a public download pinned by size and SHA-256. It may follow https redirects, since the file is checked before use and the request carries no user data.
- **SEC-SECRET.** Credentials live only in the system's secret store, such as the OS keychain. They are not written to databases, logs, backups, exports, or error text.
  - Personal data, such as message text, addresses, and account names, is not written to logs or error text either.
  - No secret is committed to the repo.
- **SEC-FAIL.** A check that cannot finish refuses. An error in a guard, a lookup, or a parse never lets the action through or reads as "nothing there" unless that is the only way it can fail.
- **SEC-TRUST.** A file or setting from a backup or an import is untrusted, even one the product wrote. It decides nothing about where a secret goes or what runs, and it passes the same checks as new input.
- **SEC-INJECT.** Text from outside the product cannot change the structure it is put into: protocol commands, CSV, Markdown, HTML, process arguments, SQL, or terminal output. It is escaped, refused, or passed as a parameter. Model output counts as text from outside.
- **SEC-CLAIM.** What a screen says about where data goes matches what the code does, in every state it can reach.
- **SEC-MIN.** A model, a cloud service, or a tool server gets only the data its task needs, and only what the control the user pressed adds.
- **SEC-STORE.** Files that hold user data, temp and staged copies included, can be read only by the user. A partial or staged copy of a user's data is removed when its job ends. Delete leaves nothing behind that the story says is gone.
- **SEC-SUPPLY.** Only signed or pinned bytes run. A download is checked against its hash or signature before use, and a signing key is never in the repo. A build script does no network access.

### With a model

These hold when the product sends text to a language model.

- **SEC-PROMPT.** Text that comes from outside the product and reaches a model is sent as marked data, never as the user's words, and has a length limit. Nothing a model is sent holds a key, a password, or another secret.
- **SEC-MODEL.** A model that reads outside text holds no file or shell tool, whether it runs in the product or in a tool of ours. What it returns is written by our code, for names our code chose.

### This project's

<!-- wf:local security -->
