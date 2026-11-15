---
name: code-review-ledger
description: >-
  Runs the read-only code review: scans, the code-reviewer agent in security
  and structure modes, an optional verify pass on another model, then asks the reviewer
  for a verdict on each finding and keeps the findings ledger. Use at chunk end
  before the commit proposal, and for any review, security, CVE, dependency, or
  structure check.
---

# Code review ledger

The rubric, the ledger, and the scans are in the `review` and `logs` settings of `.workflow/config.json`; `npx wf config` prints them. The agent is `code-reviewer`, which is read-only. Only this skill writes the ledger, and only through `npx wf ledger`. Verdicts go to the reviewer in **Who decides** in `AGENTS.md`.

The ledger's header keeps three lines of state and a `Light runs` table:

```text
Last reviewed: <short commit> on <date>, <diff | full>[, plus uncommitted changes].
Deep reviewed: <short commit> on <date>.
Deferred: none. | Deferred: <n> times, last at <short HEAD> on <date>.
```

`Last reviewed` moves on any run, never on a deferral, so the backlog is always `Last reviewed..HEAD` plus uncommitted changes. `Deep reviewed` moves only on a deep run.

## 0. Trigger

- **Asked for a review.** No defer prompt. Ask once whether to run deep or light, unless they named one.
- **Chunk end**, before the commit proposal. Ask the reviewer once: a light diff run now, a deep one now, or defer.
  - **Show** the range `<Last reviewed>..HEAD` (plus uncommitted), its commit count, and the `Deferred` line when it is not `none`. When `Light runs` has rows, also show `<Deep reviewed>..HEAD` and its count.
  - **Recommend** light, or deep when two or more light runs are waiting, or when the change is mostly in a repo the scope list does not reach.
  - **Before a deep run**, check how much of the usage limit is left, and call any cost or time you give an estimate.
  - **Defer:** run nothing. `npx wf ledger defer --at <short HEAD>`, then go on to the commit proposal. The ledger edit is committed with the chunk, as step 6 says.

## 1. Scan

A light run starts from `Last reviewed`, a deep run from `Deep reviewed`; that commit is `<since>`.

```bash
npx wf scan diff <since> --light   # light: scope list, scans, and the diff the agent starts from
npx wf scan diff <since>           # deep: scope list and scans; the agent reads whole files
npx wf scan full                   # when asked, or when Last reviewed is none
```

It empties `.cache/review-scan`, writes `scope.txt`, runs the `every` scans, the `deps` scans when a dependency file changed or in full mode, the `full` scans in full mode, then the `structure` scans. A non-zero exit means "found something" as often as "failed": read the output before treating it as a failure.

- **Nothing in scope** and no dependency file changed: say "No new findings", close the run as in step 6, and stop.
- **Code in a repo the scope list does not reach:** copy those files into `.cache/review-scan` now, after the scan has emptied it, so the agent can read them.
- **A scanner missing:** name it, give the install command from the project's tools doc, and stop. Do not install it.

## 2. Review

Models come from `review.models`. In Claude Code, pass them to each subagent. In OpenCode, run both review passes on the session model; with `review.verify` on, verify on an available fully qualified `provider/model` different from it, and if there is none, ask rather than verifying with the same model, and record the run as light.

Run the `code-reviewer` agent twice, in parallel. The prompt holds only these lines, naming each scanner file, because search tools can skip a gitignored folder. Add nothing of your own about the code:

```text
Mode: security | structure
Scope: full | <the lines of scope.txt>
Diff: .cache/review-scan/changes.diff
Scanner output: .cache/review-scan, files: <file names; structure mode: the structure scan files>
Ledger: <logs.ledger>
Closed: <logs.ledgerClosed>
Decisions: <logs.decisions>
Rubric: <review.rubric>
Threat model: <review.threatModel>
Reads: <review.reads>
Web: <review.web>
```

Take those settings from `npx wf config`, which prints the kit's defaults too; the agent has no shell, and the project's config file holds only what the project changed. Leave out the `Diff` line when no diff was written, and a setting's line when it is empty.

## 3. Verify

Merge the New and Changed sections of both deltas into one list of drafts. With `review.verify` off, the default, the drafts go on to step 4 as the two passes wrote them; say in the summary that no verify pass ran.

With it on, run `code-reviewer` once more, on the verify model:

```text
Mode: verify
Drafts:
<the merged drafts, as the agent wrote them>
```

Drop what it drops and apply its downgrades. Keep each dropped draft's ID and reason for the summary, but not in the ledger.

## 4. Apply

Change the ledger only with `npx wf ledger`; it keeps every row in step and refuses a change that would break the ledger. Never read the closed file in full. The commands and the ledger's shape are in [ledger-format.md](ledger-format.md).

- New findings: write them to `.cache/review-scan/findings.json`, a list with the fields [ledger-format.md](ledger-format.md) names, then `npx wf ledger add .cache/review-scan/findings.json`. It gives each the next ID, `proposed`, and Found.
- "Changed": `set <ID>` with `--severity` when it changed, and the new evidence in a dated `--note`.
- "Now fixed": a `fixed` finding becomes `verified`. A `proposed` or `accepted` one that is gone becomes `fixed`, with the evidence in its Note, and is shown to the reviewer.
- A `fixed` finding still there goes back to `accepted`, with a dated Note.

## 5. Ask the reviewer

Ask once, in batches up to the question tool's limit or all on one `triage` ask page with these options as its `verdicts` (the `ask-page` skill), one question per new or changed finding: its ID, severity, title, and evidence in a line. Options are Accept, Defer, and Reject, plus Accept risk for a `SEC-` or `DEP-` finding. Recommend one and say why.

In the same batch, read the `Revisit` lines of `npx wf doc:facts status` against this run's findings. Where a trigger now holds, such as a kind of finding it names coming up again, ask that question's role whether it moves under the chunk.

Write each answer as its Status and a Decision of `<note>, <date>`. An accepted `STD-` finding adds its rule to the rubric, with the date, and becomes `verified`. Accepted findings are work: fix the small ones in this chunk with the reviewer's yes, and propose a larger one as a session of its own.

## 6. Close

`npx wf ledger state --last "<short HEAD> on <date>, <diff | full>[, plus uncommitted changes]."`. It also sets `Deferred: none.`, since the run covered the backlog.

- **Light run:** also `--light "| \`<since>..<HEAD>\`[ and uncommitted] | <date> | diff |"`.
- **Deep run:** also `--deep "<short HEAD> on <date>."`, which clears `Light runs`.

The ledger is committed with the chunk, in a commit after the one `Last reviewed` names. `wf done chunk` and a chunk-end screen review pass when every commit after it changes only the ledger and its closed file; a code change after it needs another run or a deferral.
