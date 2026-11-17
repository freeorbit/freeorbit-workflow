# Ledger format

The commands that change the review ledger, and the shape they keep. Read this when `wf ledger` refuses a change, or before reading the ledger by hand.

## Commands

`npx wf ledger` runs `ledger.py` on the config's `logs.ledger` and `logs.ledgerClosed` files and its `logs.ledgerClosedDetails` folder, filing by `logs.ledgerClosedPeriod`.

```bash
npx wf ledger add .cache/review-scan/findings.json      # prints each new ID
npx wf ledger set MOD-031 --status fixed --note "Fixed in abc1234."
npx wf ledger set SEC-020 --status accepted --decision "Accept, fix now, 2026-11-02."
npx wf ledger state --last "abc on 2026-11-02, diff." --deep "abc on 2026-11-02."
npx wf ledger state --last "abc on 2026-11-02, diff." --light "| \`a..b\` | 2026-11-02 | diff |"
npx wf ledger defer --at abc1234
npx wf ledger summary
npx wf ledger check
npx wf ledger migrate                                    # once, from the layout before v1.3.0
```

`add` reads a JSON list of objects with `prefix`, `title`, `severity`, `confidence`, `rule`, `where`, `evidence`, `why`, `suggestion`, and optionally `note` and `found`.

## Shape

- **Three groups**, by what is left to do. **Open**: proposed, accepted, deferred. **Fixed, waiting for review**: fixed. **Closed**: verified, rejected, accepted-risk, accepted-cost, superseded. An empty group says "None." and is kept.
- **Summary.** One table per group, one row per finding: `| [ID](#id) | Severity | Status | Title | Where |`. Where is the main file and line, or the advisory ID, as a short code span.
- **Details.** Each finding is `### <ID>`, its title in bold, and a `| Field | Value |` table with the rows Status, Severity, Confidence, Rule, Note (only when there is one), Found, Closed (only while closed), Evidence, Why it matters, Suggestion, Decision. A `|` in a cell is `\|`.
- **The closed file** holds only the Closed summary under `## Summary`, newest first, so the ledger stays the size of what is left to do. A finding moves there when it closes, and back under Open when it returns.
- **The closed details** are in the details folder, one file per ISO week a finding closed in (`2026-W46.md`), or per month (`2026-11.md`), each with its details under `## Details`, newest first. Closing stamps the Closed row with the date, which picks the file; the finding stays in that file while it stays closed. Only the newest file grows.
- **Links.** A ledger row links `#id` in the ledger; a closed row links its details file, such as `closed/2026-W46.md#sec-001`.
