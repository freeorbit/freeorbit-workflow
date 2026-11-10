#!/usr/bin/env python3
"""Render design frames to PNG review copies. Run through `wf design render`,
which passes the folders and size from `design` in the project's config.

    render.py --root R --frames F --review V --shared S --size 1280x800 [name | area | area/section ...]

Frames are <frames>/<area>/<section>/<frame>.html.
PNGs go to <review>/<area>/<section>/<frame>.png.
"""

import argparse
import shutil
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path


def all_frames(frames, shared):
    # <area>/<section>/<frame>.html; the shared folder holds the styles, not frames.
    return sorted(p for p in frames.glob("*/*/*.html") if p.parts[-3] != shared)


def area_of(frames, frame):
    return frame.relative_to(frames).parts[0]


def pick(frames, shared, args):
    found = all_frames(frames, shared)
    if not args:
        return found
    picked = []
    for arg in args:
        match = [
            p
            for p in found
            if arg in (p.stem, area_of(frames, p), f"{area_of(frames, p)}/{p.parent.name}")
        ]
        if not match:
            sys.exit(f"No frame or area named {arg!r} under {frames}")
        picked += match
    return picked


def render(opts, frame):
    out = opts.review / frame.relative_to(opts.frames).with_suffix(".png")
    out.parent.mkdir(parents=True, exist_ok=True)
    # Chromium needs a writable profile, and a sandbox may only allow the workspace.
    profile = opts.root / ".cache" / "chromium-design" / frame.stem
    result = subprocess.run(
        [
            opts.browser,
            "--headless",
            "--disable-gpu",
            "--no-sandbox",
            "--hide-scrollbars",
            "--force-device-scale-factor=1",
            f"--user-data-dir={profile}",
            f"--window-size={opts.width},{opts.height}",
            f"--screenshot={out}",
            frame.as_uri(),
        ],
        capture_output=True,
        text=True,
        timeout=60,
    )
    shutil.rmtree(profile, ignore_errors=True)
    if result.returncode != 0 or not out.exists():
        return frame, f"failed: {result.stderr.strip().splitlines()[-1:]}"
    return frame, str(out.relative_to(opts.root))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--frames", type=Path, required=True)
    parser.add_argument("--review", type=Path, required=True)
    parser.add_argument("--shared", default="shared")
    parser.add_argument("--size", default="1280x800")
    parser.add_argument("--browser", default="chromium")
    parser.add_argument("names", nargs="*")
    opts = parser.parse_args()
    opts.width, opts.height = (int(n) for n in opts.size.split("x"))
    frames = pick(opts.frames, opts.shared, opts.names)
    failed = False
    with ThreadPoolExecutor(max_workers=4) as pool:
        for frame, message in pool.map(lambda f: render(opts, f), frames):
            print(f"{frame.stem}: {message}")
            failed |= message.startswith("failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
