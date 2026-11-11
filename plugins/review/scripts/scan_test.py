#!/usr/bin/env python3
"""Tests for structure-scan.py and direct-outdated.py, on small fixture trees.

    python3 -I plugins/review/scripts/scan_test.py
"""

import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).parent
STRUCTURE = HERE / "structure-scan.py"
OUTDATED = HERE / "direct-outdated.py"


def long_body(lines):
    return "".join(f"    let x{i} = {i};\n" for i in range(lines))


# One file per fact the scan reports, plus files it must leave out.
TREE = {
    "src/big.rs": "fn a() {}\n" * 610,
    "src/near.rs": "fn a() {}\n" * 410,
    "src/long.rs": (
        "/// Said.\npub fn long_one() {\n" + long_body(105) + "}\n"
        "pub fn medium_one() {\n" + long_body(65) + "}\n"
        "fn tiny() {\n    1;\n}\n"
        "#[cfg(test)]\nmod tests {\n" + long_body(700) + "}\n"
    ),
    "src/errors.rs": (
        "/// Said.\npub fn bad() -> Result<(), String> {\n    x.unwrap();\n    Ok(())\n}\n"
    ),
    "web/view.tsx": (
        "export function View() {\n  return <div style={{ color: 1 }} />;\n"
        + "".join(f"  // {i}\n" for i in range(5))
        + "}\n"
    ),
    "web/said.ts": "/** Said. */\nexport function said() {\n  return 1;\n  return 2;\n  return 3;\n}\n",
    "web/view.css": ".a { color: #fff; }\n",
    "web/tokens.css": ":root { --a: #000; }\n",
    "web/utils.ts": "export const a = 1;\n",
    "web/bindings.ts": "export function generated() {\n" + "  1;\n" * 700 + "}\n",
    "docs/page.rs": "fn a() {}\n" * 900,
    "tools/testdata/fixtures/x.rs": "fn a() {}\n" * 900,
    "crate/tests/whole.rs": "fn a() {}\n" * 900,
}
for i in range(11):
    TREE[f"many/m{i}.ts"] = "export const a = 1;\n"


def git(root, *args):
    subprocess.run(["git", *args], cwd=root, check=True, capture_output=True)


class StructureScan(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        root = Path(cls.tmp.name) / "repo"
        root.mkdir()
        git(root, "init", "-q")
        git(root, "config", "user.email", "scan@example.test")
        git(root, "config", "user.name", "Scan Test")
        for path, text in TREE.items():
            (root / path).parent.mkdir(parents=True, exist_ok=True)
            (root / path).write_text(text)
        git(root, "add", ".")
        git(root, "commit", "-q", "-m", "one")
        (root / "src/errors.rs").write_text(TREE["src/errors.rs"] + "\n")
        git(root, "commit", "-qam", "two")
        cls.root = root

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def scan(self, keep=None):
        out = Path(self.tmp.name) / "out"
        out.mkdir(exist_ok=True)
        args = [sys.executable, "-I", str(STRUCTURE), str(out)]
        if keep is not None:
            listed = Path(self.tmp.name) / "keep.txt"
            listed.write_text("\n".join(keep))
            args.append(str(listed))
        subprocess.run(args, cwd=self.root, check=True, capture_output=True)
        return (out / "structure.txt").read_text()

    def section(self, text, title):
        part = text.split(f"## {title}")[1]
        return part.split("\n## ")[0]

    def test_file_size_over_and_near_with_rust_counted_above_its_tests(self):
        size = self.section(self.scan(), "File size")
        self.assertIn("src/big.rs: 611 lines, over 600", size)
        self.assertIn("src/near.rs: 411 lines, near", size)
        # Its test module would put it over; above the tests it is short.
        self.assertNotIn("src/long.rs", size)

    def test_left_out_paths_and_whole_test_files(self):
        text = self.scan()
        for path in ("docs/page.rs", "tools/testdata/fixtures/x.rs", "web/bindings.ts"):
            self.assertNotIn(path, text)
        # A whole test file is held to the higher line only, with no function
        # facts; it still counts among the most changed.
        self.assertNotIn("crate/tests/whole.rs", text.split("## Most changed")[0])

    def test_long_functions_and_missing_comments(self):
        text = self.scan()
        functions = self.section(text, "Long functions")
        self.assertIn("src/long.rs:2 long_one: 106 lines, over 100", functions)
        self.assertRegex(functions, r"src/long.rs:\d+ medium_one: 66 lines\n")
        comments = self.section(text, "Public functions with no comment")
        self.assertRegex(comments, r"src/long.rs:\d+ medium_one")
        self.assertIn("web/view.tsx:1 View", comments)
        self.assertNotIn("long_one", comments)
        self.assertNotIn("said", comments)
        self.assertNotIn("tiny", comments)

    def test_errors_unwinds_and_ui(self):
        text = self.scan()
        self.assertIn("src/errors.rs:2 returns a bare String error", self.section(text, "Bare String errors"))
        self.assertIn("src/errors.rs:3 x.unwrap();", self.section(text, "unwrap, expect"))
        ui = self.section(text, "Inline styles")
        self.assertIn("web/view.tsx:2 inline style", ui)
        self.assertIn("web/view.css:1 hard-coded color", ui)
        self.assertNotIn("tokens.css", ui)

    def test_folders_names_and_most_changed(self):
        text = self.scan()
        self.assertIn("many: 11 code files", self.section(text, "Folders past the line"))
        self.assertIn("web/utils.ts", self.section(text, "File names not allowed"))
        changed = self.section(text, "Most changed lately")
        self.assertIn("src/errors.rs: 2 of the last 40 commits", changed)

    def test_a_list_keeps_only_those_paths(self):
        text = self.scan(keep=["src/big.rs"])
        self.assertIn("src/big.rs: 611 lines", text)
        self.assertNotIn("src/near.rs", text)
        self.assertNotIn("many:", text)


METADATA = {
    "workspace_members": ["app 0.1.0"],
    "packages": [
        {"id": "app 0.1.0", "name": "app", "version": "0.1.0", "source": None},
        {"id": "serde 1.0.1", "name": "serde", "version": "1.0.1", "source": "registry+https://github.com/rust-lang/crates.io-index"},
        {"id": "serde 1.0.9", "name": "serde", "version": "1.0.9", "source": "registry+https://github.com/rust-lang/crates.io-index"},
        {"id": "rand 0.8.5", "name": "rand", "version": "0.8.5", "source": "registry+https://github.com/rust-lang/crates.io-index"},
        {"id": "local 0.1.0", "name": "local", "version": "0.1.0", "source": None},
        {"id": "deep 2.0.0", "name": "deep", "version": "2.0.0", "source": "registry+https://github.com/rust-lang/crates.io-index"},
    ],
    "resolve": {
        "nodes": [
            {"id": "app 0.1.0", "deps": [{"pkg": "serde 1.0.1"}, {"pkg": "rand 0.8.5"}, {"pkg": "local 0.1.0"}]},
            # Only a workspace crate's own deps count: a dep's dep does not.
            {"id": "rand 0.8.5", "deps": [{"pkg": "serde 1.0.9"}, {"pkg": "deep 2.0.0"}]},
        ]
    },
}


class DirectOutdated(unittest.TestCase):
    def run_script(self, answers, failing=()):
        """Run the script with a stand-in cargo that answers `cargo search` from `answers`."""
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        folder = Path(tmp.name)
        bin_dir = folder / "bin"
        bin_dir.mkdir()
        cargo = bin_dir / "cargo"
        cargo.write_text(
            f"#!{sys.executable}\n"
            "import json, sys\n"
            f"answers = {json.dumps(answers)}\n"
            f"failing = {json.dumps(list(failing))}\n"
            "name = sys.argv[2]\n"
            "if name in failing:\n"
            "    print('error: network down', file=sys.stderr)\n"
            "    sys.exit(101)\n"
            "if name in answers:\n"
            "    print(f'{name} = \"{answers[name]}\"    # a crate')\n"
        )
        cargo.chmod(0o755)
        env = {**os.environ, "PATH": f"{bin_dir}{os.pathsep}{os.environ['PATH']}"}
        result = subprocess.run(
            [sys.executable, "-I", str(OUTDATED), str(folder)],
            input=json.dumps(METADATA), capture_output=True, text=True, env=env,
        )
        report = (folder / "direct-outdated.txt").read_text() if (folder / "direct-outdated.txt").exists() else ""
        return result, report

    def test_lists_only_direct_registry_deps_behind_the_newest(self):
        result, report = self.run_script({"serde": "1.0.9", "rand": "0.8.5"})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("serde\tlocked 1.0.1\tlatest 1.0.9", report)
        self.assertNotIn("rand", report)
        self.assertNotIn("deep", report)
        self.assertNotIn("local", report)
        self.assertIn("2 direct deps, 1 behind", result.stdout)

    def test_a_crate_search_does_not_find_is_reported_unknown(self):
        result, report = self.run_script({"rand": "0.8.5"})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("serde\tlocked 1.0.1\tlatest ?", report)


if __name__ == "__main__":
    unittest.main()
