# Code standards

The rules the `code-reviewer` agent checks, and that people and agents follow when they write code here. Each rule has an ID that a finding cites.

<!-- wf:local layout -->

The code is written by people and by agents. A rule here serves both: a person can read a file top to bottom, and an agent can find the right file from its name.

## How this file grows

Nobody adds a rule here without a finding the reviewer accepted, or a dated owner decision in decisions.md.

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

<!-- wf:local security -->
