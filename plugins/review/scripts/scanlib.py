"""What the review's scans share: the tracked files, what a test file is, and a
Rust file's lines above its tests. structure-scan.py and perf-scan.py import
it from beside them, so the two read one rule.
"""

import re
import subprocess

# A file of tests, by its name, in every language the scans read.
TEST_SUFFIXES = (".test.ts", ".test.tsx", ".test.js", ".test.mjs", ".spec.ts", ".spec.tsx", ".spec.js", ".spec.mjs", "_test.py")
# Folders that hold only tests.
TEST_FOLDERS = {"test", "tests", "plugin_tests"}


def tracked():
    """Every tracked path."""
    return subprocess.check_output(["git", "ls-files"], text=True).splitlines()


def is_test_file(path):
    """True for a whole file of tests: by its name, or a folder of tests above it."""
    return path.endswith(TEST_SUFFIXES) or bool(TEST_FOLDERS & set(path.split("/")[:-1]))


def before_tests(text):
    """A Rust file's lines above its test module."""
    return re.split(r"#\[cfg\((?:all\()?test", text)[0].split("\n")
