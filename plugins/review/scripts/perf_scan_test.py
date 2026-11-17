#!/usr/bin/env python3
"""Tests for perf-scan.py, perf-clippy.py, and bundle-size.py, on small fixture trees.

    python3 -I plugins/review/scripts/perf_scan_test.py
"""

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).parent
SCAN = HERE / "perf-scan.py"
CLIPPY = HERE / "perf-clippy.py"
BUNDLE = HERE / "bundle-size.py"

# One file per kind of place the scan lists, plus places it must leave alone.
TREE = {
    "src/sync.rs": (
        "pub async fn sync(ids: &[u32]) {\n"
        "    for id in ids {\n"
        "        fetch(*id).await;\n"
        "    }\n"
        "    let text = std::fs::read_to_string(\"big.txt\").unwrap();\n"
        "    tokio::task::spawn_blocking(move || {\n"
        "        std::fs::write(\"out.txt\", text).unwrap();\n"
        "    });\n"
        "}\n"
        "pub fn bounded(reply: R) {\n"
        "    let _ = reply.take(10).read_to_end(&mut bytes);\n"
        "}\n"
        "pub fn wait() {\n"
        "    loop {\n"
        "        if ready() { break; }\n"
        "        std::thread::sleep(TICK);\n"
        "    }\n"
        "}\n"
        "// for x in xs { a.await }\n"
        "#[cfg(test)]\nmod tests {\n    async fn t() { for x in xs { x.await; } }\n}\n"
    ),
    "src/commands.rs": (
        "#[tauri::command]\n"
        "pub fn load(path: String) -> String {\n"
        "    std::fs::read_to_string(path).unwrap()\n"
        "}\n"
        "#[tauri::command(async)]\n"
        "pub fn load_async(path: String) -> String {\n"
        "    std::fs::read_to_string(path).unwrap()\n"
        "}\n"
        "#[tauri::command]\n"
        "pub fn pure(a: u32) -> u32 {\n"
        "    a + 1\n"
        "}\n"
    ),
    "web/list.ts": (
        "export async function names(ids: string[]) {\n"
        "  for (const id of ids) {\n"
        "    await invoke('name', { id });\n"
        "  }\n"
        "  for await (const line of lines) {\n"
        "    await use(line);\n"
        "  }\n"
        "  ids.forEach(async (id) => save(id));\n"
        "  setInterval(refresh, 1000);\n"
        "  for (let i = 0; i < 3; i++) {\n"
        "    total += i;\n"
        "  }\n"
        "}\n"
    ),
    "web/list.test.ts": "for (const id of ids) {\n  await invoke('x');\n}\n",
    "tools/gen.mjs": "for (const f of files) {\n  await write(f);\n}\n",
}


def git(root, *args):
    subprocess.run(["git", *args], cwd=root, check=True, capture_output=True)


class PerfScan(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        root = Path(cls.tmp.name) / "repo"
        root.mkdir()
        git(root, "init", "-q")
        for path, text in TREE.items():
            (root / path).parent.mkdir(parents=True, exist_ok=True)
            (root / path).write_text(text)
        git(root, "add", ".")
        cls.root = root

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def scan(self, keep=None):
        out = Path(self.tmp.name) / "out"
        out.mkdir(exist_ok=True)
        args = [sys.executable, "-I", str(SCAN), str(out)]
        if keep is not None:
            listed = Path(self.tmp.name) / "keep.txt"
            listed.write_text("\n".join(keep))
            args.append(str(listed))
        subprocess.run(args, cwd=self.root, check=True, capture_output=True)
        return (out / "perf-scan.txt").read_text()

    def section(self, text, title):
        return text.split(f"## {title}")[1].split("\n## ")[0]

    def test_each_place_is_listed_under_its_rule(self):
        text = self.scan()
        rows = [
            ("Loops", "src/sync.rs:2 a loop that waits or does I/O in its body, at line 3", "a Rust loop that awaits each turn"),
            ("Loops", "web/list.ts:2 a loop that waits or calls out in its body, at line 3", "a loop that calls the backend each turn"),
            ("Loops", "web/list.ts:8 an async callback per item", "forEach with an async callback"),
            ("Blocking", "src/sync.rs:5 blocking work in async fn", "a file read on the async runtime"),
            ("Blocking", "src/commands.rs:2 a sync Tauri command, which runs on the main thread, does I/O at line 3", "a sync command that reads a file"),
            ("Whole files", "src/sync.rs:5 ", "a whole file read"),
            ("Timers", "web/list.ts:9 setInterval(refresh, 1000);", "a polling timer"),
            ("Timers", "src/sync.rs:14 a loop that sleeps and checks again", "a sleep loop"),
        ]
        for title, line, why in rows:
            with self.subTest(why):
                self.assertIn(line, self.section(text, title))

    def test_places_it_leaves_alone(self):
        text = self.scan()
        rows = [
            ("src/sync.rs:7", "a write inside spawn_blocking"),
            ("src/sync.rs:11", "a read held to a size by take"),
            ("src/sync.rs:19", "a loop in a comment"),
            ("src/commands.rs:6", "a command marked async"),
            ("src/commands.rs:10", "a sync command with no I/O"),
            ("web/list.ts:5", "for await, which streams"),
            ("web/list.ts:10", "a loop that only counts"),
            ("web/list.test.ts", "a test file"),
            ("tools/gen.mjs", "a folder that does not ship"),
            ("mod tests", "Rust's test module"),
        ]
        for place, why in rows:
            with self.subTest(why):
                self.assertNotIn(place, text)

    def test_a_list_keeps_only_those_paths(self):
        text = self.scan(keep=["web/list.ts"])
        self.assertIn("web/list.ts:2", text)
        self.assertNotIn("src/", text)


def record(code, file, line, text="msg"):
    """One line of `cargo clippy --message-format=json`."""
    span = {"is_primary": True, "file_name": file, "line_start": line}
    return json.dumps({"reason": "compiler-message", "message": {"code": {"code": code}, "message": text, "spans": [{"is_primary": False, "file_name": "x.rs", "line_start": 1}, span]}})


class PerfClippy(unittest.TestCase):
    def run_script(self, lines, keep=None):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        out = Path(tmp.name)
        args = [sys.executable, "-I", str(CLIPPY), str(out)]
        if keep is not None:
            (out / "keep.txt").write_text("\n".join(keep))
            args.append(str(out / "keep.txt"))
        subprocess.run([*args, "-"], input="\n".join(lines), text=True, check=True, capture_output=True)
        return (out / "perf-clippy.txt").read_text()

    def test_lints_are_counted_most_first_each_place_once_in_the_kept_paths(self):
        lines = [
            record("clippy::redundant_clone", "src/a.rs", 7, "redundant clone"),
            record("clippy::needless_collect", "src/a.rs", 3),
            record("clippy::needless_collect", "src/b.rs", 9),
            record("clippy::needless_collect", "src/b.rs", 9),
            record("unused_variables", "src/a.rs", 1),
            record("clippy::redundant_clone", "src/c.rs", 2),
            '{"reason": "build-finished", "success": true}',
            "not json",
        ]
        text = self.run_script(lines, keep=["src/a.rs", "src/b.rs"])
        self.assertLess(text.index("## clippy::needless_collect: 2"), text.index("## clippy::redundant_clone: 1"))
        self.assertIn("src/a.rs:7 redundant clone", text)
        self.assertNotIn("src/c.rs", text)
        self.assertNotIn("unused_variables", text)

    def test_none_fired_says_so(self):
        self.assertIn("None fired.", self.run_script([]))


class BundleSize(unittest.TestCase):
    def test_totals_largest_and_what_changed_since_the_last_measure(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        root = Path(tmp.name)
        build, out, last = root / "dist", root / "out", root / "cache" / "last.json"
        (build / "assets").mkdir(parents=True)
        out.mkdir()
        (build / "assets/index-B2xK9_aQ.js").write_bytes(b"x" * 4000)
        (build / "assets/style.css").write_bytes(b"y" * 1000)
        (build / "assets/index.js.map").write_bytes(b"z" * 9000)
        (build / "assets/gone.js").write_bytes(b"g" * 100)
        run = lambda: subprocess.run([sys.executable, "-I", str(BUNDLE), str(out), str(build), str(last)], check=True, capture_output=True)
        run()
        first = (out / "bundle-size.txt").read_text()
        self.assertIn("No last measure", first)
        self.assertIn("assets/index.js:", first)
        self.assertNotIn(".map", first)
        # A rebuild with a new hash, a file that grew, one new, and one gone.
        (build / "assets/index-B2xK9_aQ.js").rename(build / "assets/index-Zq81kLmP.js")
        (build / "assets/style.css").write_bytes(bytes(range(256)) * 8)
        (build / "assets/new.js").write_bytes(b"n" * 100)
        (build / "assets/gone.js").unlink()
        run()
        second = (out / "bundle-size.txt").read_text()
        self.assertIn("grew: assets/style.css", second)
        self.assertIn("new: assets/new.js", second)
        self.assertIn("gone: assets/gone.js", second)
        self.assertNotIn("new: assets/index.js", second)
        self.assertTrue(json.loads(last.read_text())["assets/new.js"]["raw"] == 100)

    def test_a_missing_build_folder_says_to_build_first(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        run = subprocess.run([sys.executable, "-I", str(BUNDLE), tmp.name, str(Path(tmp.name) / "dist")], capture_output=True, text=True)
        self.assertNotEqual(run.returncode, 0)
        self.assertIn("build the project first", run.stderr)


if __name__ == "__main__":
    unittest.main()
