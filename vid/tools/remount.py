#!/usr/bin/env python3
"""Rebuild dialogue + timing + index.html mount, serialized with a file lock so parallel scene agents can preview
their new scene lengths safely (the EDL is shared; each run reflects every agent's current edits). No fx/mix."""
import fcntl, os, subprocess, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # vid/
with open(os.path.join(ROOT, ".remount.lock"), "w") as lk:
    fcntl.flock(lk, fcntl.LOCK_EX)
    subprocess.run(["uv", "run", "-q", "audio/tools/build-dialogue.py", "audio/edl.json", "assets"], cwd=ROOT, check=True)
    subprocess.run([sys.executable, "tools/mount.py"], cwd=ROOT, check=True)
    print(open(os.path.join(ROOT, "assets", "timing.json")).read()[:600])
