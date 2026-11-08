#!/usr/bin/env python3
"""Tests for ledger.py, on small copies of the ledger's shape.

    python3 -I .claude/skills/code-review-ledger/ledger_test.py
"""

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

TOOL = Path(__file__).with_name("ledger.py")

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
| [SEC-001](#sec-001) | High | verified | Old | `b.rs:2` |

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
        self.ledger.write_text(LEDGER)
        self.closed.write_text(CLOSED)

    def tearDown(self):
        self.folder.cleanup()

    def run_tool(self, *args):
        command = [sys.executable, str(TOOL), "--ledger", str(self.ledger), "--closed", str(self.closed), *args]
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

    def test_closing_moves_the_details_to_the_closed_file(self):
        self.run_tool("set", "MOD-001", "--status", "verified")
        self.assertNotIn("### MOD-001", self.ledger.read_text())
        closed = self.closed.read_text()
        self.assertIn("### MOD-001", closed)
        self.assertIn("[MOD-001](#mod-001) | Low | verified", closed)
        self.assertNotIn("MOD-001", self.ledger.read_text())
        self.assert_in_step()

    def test_a_closed_finding_can_come_back(self):
        self.run_tool("set", "SEC-001", "--status", "accepted", "--severity", "Low", "--note", "Back.")
        text = self.ledger.read_text()
        self.assertIn("### SEC-001", text)
        self.assertIn("[SEC-001](#sec-001) | Low | accepted", text)
        self.assertNotIn("SEC-001", self.closed.read_text())
        self.assertIn("## Details\n\nNone.", self.closed.read_text())
        self.assert_in_step()

    def test_a_closed_finding_can_change_its_closed_status(self):
        self.run_tool("set", "SEC-001", "--status", "superseded")
        self.assertIn("[SEC-001](#sec-001) | High | superseded", self.closed.read_text())
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


if __name__ == "__main__":
    unittest.main()
