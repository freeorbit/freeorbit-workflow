#!/usr/bin/env python3
"""Tests for ledger.py, on small copies of the ledger's shape.

    python3 -I plugins/review/scripts/ledger_test.py
"""

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

TOOL = Path(__file__).with_name("ledger.py")
MIGRATE = Path(__file__).with_name("ledger_migrate.py")

LEDGER = """# Review findings

Last reviewed: abc on 2026-01-01, diff.
Deep reviewed: abc on 2026-01-01.
Deferred: 1 times, last at abc on 2026-01-01.

## Light runs

| Range | Date | Mode |
| --- | --- | --- |
| `a..b` | 2026-01-01 | diff |

## Summary

### Open

| ID | Severity | Status | Title | Where |
| --- | --- | --- | --- | --- |
| [MOD-001](#mod-001) | Low | proposed | One | `a.rs:1` |

### Fixed, waiting for review

None.

## Open

### MOD-001

**One**

| Field | Value |
| --- | --- |
| Status | proposed |
| Severity | Low |
| Confidence | High |
| Rule | CS-MOD |
| Found | 2026-01-01 at abc |
| Evidence | It is there. |
| Why it matters | It matters. |
| Suggestion | Change it. |
| Decision |  |

## Fixed, waiting for review

None.
"""

CLOSED = """# Closed review findings

Intro.

## Summary

| ID | Severity | Status | Title | Where |
| --- | --- | --- | --- | --- |
| [SEC-001](closed/2026-01.md#sec-001) | High | verified | Old | `b.rs:2` |
"""

JANUARY = """# Closed review findings, 2026-01

Intro.

## Details

### SEC-001

**Old**

| Field | Value |
| --- | --- |
| Status | verified |
| Severity | High |
| Confidence | High |
| Rule | SEC-NET |
| Found | 2026-01-01 at abc |
| Closed | 2026-01-02 |
| Evidence | Gone. |
| Why it matters | It did. |
| Suggestion | Done. |
| Decision |  |
"""


class Ledger(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.ledger = Path(self.folder.name, "ledger.md")
        self.closed = Path(self.folder.name, "closed.md")
        self.details = Path(self.folder.name, "closed")
        self.january = self.details / "2026-01.md"
        self.ledger.write_text(LEDGER)
        self.closed.write_text(CLOSED)
        self.details.mkdir()
        self.january.write_text(JANUARY)

    def tearDown(self):
        self.folder.cleanup()

    def run_tool(self, *args):
        command = [sys.executable, str(TOOL), "--ledger", str(self.ledger), "--closed", str(self.closed), "--details", str(self.details), *args]
        return subprocess.run(command, capture_output=True, text=True, check=False)

    def assert_in_step(self):
        result = self.run_tool("check")
        self.assertEqual(result.returncode, 0, result.stdout)

    def test_a_clean_ledger_is_in_step(self):
        self.assert_in_step()

    def test_add_takes_the_next_number(self):
        item = dict(prefix="SEC", title="New | one", severity="High", confidence="High", rule="SEC-NET",
                    where="`c.rs:3`", evidence="Here | there.", why="Bad.", suggestion="Fix.")
        path = Path(self.folder.name, "new.json")
        path.write_text(json.dumps([item]))
        result = self.run_tool("--date", "2026-02-02", "add", str(path))
        self.assertEqual(result.stdout.strip(), "SEC-002")
        self.assertIn("Here \\| there.", self.ledger.read_text())
        self.assert_in_step()

    def test_fixed_moves_to_its_group_and_leaves_none_behind(self):
        self.assertEqual(self.run_tool("set", "MOD-001", "--status", "fixed", "--note", "Done in abc.").returncode, 0)
        text = self.ledger.read_text()
        self.assertIn("| Note | Done in abc. |", text)
        self.assertLess(text.index("| Note |"), text.index("| Found |"))
        self.assert_in_step()

    def test_closing_files_the_details_under_the_week_it_closed(self):
        self.assertEqual(self.run_tool("--date", "2026-02-05", "set", "MOD-001", "--status", "verified").returncode, 0)
        self.assertNotIn("MOD-001", self.ledger.read_text())
        self.assertIn("[MOD-001](closed/2026-W06.md#mod-001) | Low | verified", self.closed.read_text())
        week = (self.details / "2026-W06.md").read_text()
        self.assertIn("### MOD-001", week)
        self.assertIn("| Closed | 2026-02-05 |", week)
        self.assertIn("[the closed summary](../closed.md)", week)
        self.assertNotIn("None.", week)
        self.assertEqual(self.january.read_text(), JANUARY, "an older file is not touched")
        self.assert_in_step()

    def test_a_project_may_file_by_month(self):
        self.run_tool("--period", "month", "--date", "2026-02-05", "set", "MOD-001", "--status", "verified")
        self.assertIn("### MOD-001", (self.details / "2026-02.md").read_text())
        self.assertIn("[MOD-001](closed/2026-02.md#mod-001)", self.closed.read_text())
        self.assert_in_step()

    def test_a_week_starts_the_year_it_falls_in(self):
        self.run_tool("--date", "2027-01-01", "set", "MOD-001", "--status", "verified")
        self.assertTrue((self.details / "2026-W53.md").exists(), "1 January 2027 is in ISO week 53 of 2026")

    def test_a_closed_file_still_holding_details_asks_for_the_migration(self):
        self.closed.write_text(CLOSED + "\n## Details\n\nNone.\n")
        result = self.run_tool("summary")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("npx wf ledger migrate", result.stderr)

    def test_check_finds_details_filed_under_another_month(self):
        moved = self.details / "2026-03.md"
        moved.write_text(JANUARY.replace("2026-01\n", "2026-03\n"))
        self.january.unlink()
        self.closed.write_text(CLOSED.replace("2026-01.md", "2026-03.md"))
        self.assertIn("SEC-001: closed in 2026-01, filed under 2026-03", self.run_tool("check").stdout)

    def test_check_finds_a_closed_row_linking_the_wrong_month(self):
        self.closed.write_text(CLOSED.replace("2026-01.md", "2026-02.md"))
        self.assertIn("SEC-001: link points at the wrong place", self.run_tool("check").stdout)

    def test_an_accepted_cost_is_closed(self):
        self.run_tool("set", "MOD-001", "--status", "accepted-cost", "--decision", "Accept cost, 2026-11-17.")
        self.assertIn("| Low | accepted-cost", self.closed.read_text())
        self.assert_in_step()

    def test_a_closed_finding_can_come_back(self):
        self.run_tool("set", "SEC-001", "--status", "accepted", "--severity", "Low", "--note", "Back.")
        text = self.ledger.read_text()
        self.assertIn("### SEC-001", text)
        self.assertIn("[SEC-001](#sec-001) | Low | accepted", text)
        self.assertNotIn("| Closed |", text, "a finding that comes back loses its close date")
        self.assertNotIn("SEC-001", self.closed.read_text())
        self.assertIn("## Details\n\nNone.", self.january.read_text())
        self.assert_in_step()

    def test_a_closed_finding_can_change_its_closed_status(self):
        self.run_tool("--date", "2026-04-04", "set", "SEC-001", "--status", "superseded")
        self.assertIn("[SEC-001](closed/2026-01.md#sec-001) | High | superseded", self.closed.read_text())
        self.assertIn("| Status | superseded |", self.january.read_text(), "it stays under the month it first closed")
        self.assert_in_step()

    def test_summary_counts_closed_rows_in_the_closed_file(self):
        self.assertIn("Closed: 1", self.run_tool("summary").stdout)

    def test_a_decision_is_written(self):
        self.run_tool("set", "MOD-001", "--status", "accepted", "--decision", "Accept, 2026-02-02.")
        self.assertIn("| Decision | Accept, 2026-02-02. |", self.ledger.read_text())

    def test_a_wrong_status_changes_nothing(self):
        result = self.run_tool("set", "MOD-001", "--status", "maybe")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.ledger.read_text(), LEDGER)

    def test_a_change_that_breaks_the_ledger_is_not_written(self):
        # A Where cell with a line break in it would write a second row.
        result = self.run_tool("set", "MOD-001", "--where", "`a.rs:1` |\n| [MOD-001](#mod-001) | Low | proposed | One | `b.rs:2`")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Nothing written", result.stderr)
        self.assertEqual(self.ledger.read_text(), LEDGER)

    def test_a_finding_with_no_summary_row_says_so(self):
        self.ledger.write_text(LEDGER.replace("| [MOD-001](#mod-001) | Low | proposed | One | `a.rs:1` |\n", ""))
        result = self.run_tool("set", "MOD-001", "--status", "accepted")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("MOD-001 has details but no row", result.stderr)
        self.assertNotIn("Traceback", result.stderr)

    def test_a_deep_run_clears_the_light_runs(self):
        self.run_tool("state", "--last", "def on 2026-02-02, diff.", "--deep", "def on 2026-02-02.")
        text = self.ledger.read_text()
        self.assertIn("Deep reviewed: def on 2026-02-02.", text)
        self.assertIn("Deferred: none.", text)
        self.assertNotIn("`a..b`", text)

    def test_a_light_run_adds_its_row(self):
        self.run_tool("state", "--last", "def on 2026-02-02, diff.", "--light", "| `b..c` | 2026-02-02 | diff |")
        text = self.ledger.read_text()
        self.assertIn("`a..b`", text)
        self.assertIn("`b..c`", text)

    def test_a_deferral_adds_one_and_keeps_last_reviewed(self):
        self.run_tool("--date", "2026-02-03", "defer", "--at", "fed")
        text = self.ledger.read_text()
        self.assertIn("Deferred: 2 times, last at fed on 2026-02-03.", text)
        self.assertIn(LEDGER.splitlines()[2], text.splitlines()[2])

    def test_a_first_deferral_starts_at_one(self):
        self.ledger.write_text(LEDGER.replace("Deferred: 1 times, last at abc on 2026-01-01.", "Deferred: none."))
        self.run_tool("--date", "2026-02-03", "defer", "--at", "fed")
        self.assertIn("Deferred: 1 times, last at fed on 2026-02-03.", self.ledger.read_text())

    def test_check_finds_details_in_the_summary(self):
        self.ledger.write_text(LEDGER.replace("### Fixed, waiting for review\n", "### MOD-009\n\n### Fixed, waiting for review\n", 1))
        self.assertIn("MOD-009: details in the summary", self.run_tool("check").stdout)

    def test_check_finds_a_row_that_disagrees(self):
        self.ledger.write_text(LEDGER.replace("| Low | proposed | One", "| Low | accepted | One"))
        result = self.run_tool("check")
        self.assertEqual(result.returncode, 1)
        self.assertIn("MOD-001", result.stdout)



OLD_CLOSED = """# Closed review findings

Rows with the same columns as [the ledger](review-findings.md). Rubric: [standards](../workflow/code-standards.md).

## Summary

| ID | Severity | Status | Title | Where |
| --- | --- | --- | --- | --- |
| [SEC-002](#sec-002) | Low | verified | Newer | `c.rs:3` |
| [SEC-001](#sec-001) | High | verified | Old | `b.rs:2` |

## Details

### SEC-002

**Newer**

| Field | Value |
| --- | --- |
| Status | verified |
| Found | 2026-11-17 at abc |
| Evidence | Same as [SEC-001](#sec-001). |

### SEC-001

**Old**

| Field | Value |
| --- | --- |
| Status | verified |
| Found | 2026-11-02 at abc |
| Evidence | Gone. |
"""


class Migrate(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.root = Path(self.folder.name)
        log = self.root / "docs/log"
        log.mkdir(parents=True)
        (self.root / "docs/workflow").mkdir()
        (log / "review-findings.md").write_text(LEDGER.replace("# Review findings\n", "# Review findings\n\nClosed ones: [closed](review-findings-closed.md).\n"))
        (log / "review-findings-closed.md").write_text(OLD_CLOSED)
        (self.root / "docs/workflow/notes.md").write_text("See [SEC-001](../log/review-findings-closed.md#sec-001) and [the ledger](../log/review-findings.md).\n")
        (self.root / "tool.mjs").write_text('const ledger = "docs/log/review-findings.md";\n')
        subprocess.run(["git", "init", "-q"], cwd=self.root, check=True)
        subprocess.run(["git", "add", "."], cwd=self.root, check=True)

    def tearDown(self):
        self.folder.cleanup()

    def migrate(self, *extra):
        places = ["--from-ledger", "docs/log/review-findings.md", "--from-closed", "docs/log/review-findings-closed.md",
                  "--ledger", "docs/log/review/findings.md", "--closed", "docs/log/review/closed.md", "--details", "docs/log/review/closed"]
        return subprocess.run([sys.executable, "-I", str(MIGRATE), *places, *extra], cwd=self.root, capture_output=True, text=True, check=False)

    def test_the_ledger_moves_and_the_details_are_filed_by_week(self):
        result = self.migrate()
        self.assertEqual(result.returncode, 0, result.stderr)
        review = self.root / "docs/log/review"
        self.assertFalse((self.root / "docs/log/review-findings-closed.md").exists())
        summary = (review / "closed.md").read_text()
        self.assertNotIn("## Details", summary)
        self.assertIn("[SEC-002](closed/2026-W47.md#sec-002)", summary)
        self.assertIn("[SEC-001](closed/2026-W45.md#sec-001)", summary)
        self.assertIn("[the ledger](findings.md)", summary)
        self.assertIn("[standards](../../workflow/code-standards.md)", summary)
        self.assertIn("[closed](closed.md)", (review / "findings.md").read_text())
        week = (review / "closed/2026-W47.md").read_text()
        self.assertIn("Same as [SEC-001](2026-W45.md#sec-001).", week, "a link to a finding filed in another week follows it")
        self.assertIn("[the closed summary](../closed.md)", week)
        notes = (self.root / "docs/workflow/notes.md").read_text()
        self.assertIn("[SEC-001](../log/review/closed/2026-W45.md#sec-001)", notes)
        self.assertIn("[the ledger](../log/review/findings.md)", notes)
        self.assertIn("still name an old path; change them by hand: tool.mjs", result.stdout)
        check = subprocess.run([sys.executable, "-I", str(TOOL), "--ledger", str(review / "findings.md"), "--closed", str(review / "closed.md"),
                                "--details", str(review / "closed"), "check"], capture_output=True, text=True, check=False)
        self.assertEqual(check.returncode, 0, check.stdout)

    def test_a_project_may_file_by_month(self):
        self.assertEqual(self.migrate("--period", "month").returncode, 0)
        self.assertIn("### SEC-001", (self.root / "docs/log/review/closed/2026-11.md").read_text())

    def test_a_linked_markdown_file_is_not_written_through(self):
        outside = Path(self.folder.name, "..", Path(self.folder.name).name + "-outside.md").resolve()
        outside.write_text("[x](docs/log/review-findings.md)\n")
        try:
            (self.root / "linked.md").symlink_to(outside)
            subprocess.run(["git", "add", "linked.md"], cwd=self.root, check=True)
            self.assertEqual(self.migrate().returncode, 0)
            self.assertEqual(outside.read_text(), "[x](docs/log/review-findings.md)\n")
        finally:
            outside.unlink()

    def test_a_second_run_moves_nothing(self):
        self.migrate()
        result = self.migrate()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("No docs/log/review-findings.md to move", result.stderr)


if __name__ == "__main__":
    unittest.main()
