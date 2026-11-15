#!/usr/bin/env python3
"""python3 tools/footage.py [--dry]  ->  swaps every capture placeholder whose recording exists into the scene.

Placeholders look like (written by the scene builders):
    <!-- footage: assets/footage/r5-claude-knows.mp4 -->
    <div id="s06-screen" class="k-screen ...">R5 · Claude: ...</div>
Drop the recording in assets/footage/ under that stem with any extension (.MOV/.mov/.mp4 for video, .PNG/.png/.jpg for
stills). Video is transcoded to H.264 (headless Chrome can't be trusted with iPhone HEVC) into assets/footage/_proc/,
then the placeholder div becomes a muted, timed <video> (same id/classes) trimmed by footage.json:
    { "r5-claude-knows": { "media_start": 12.4, "rate": 1.5, "start": 0, "duration": null } }
(media_start = seconds into the recording at scene-local `start`; rate = playback speed; duration defaults to the rest
of the scene). The scene's .clip wrapper is untimed so the video isn't nested in a timed element (lint rule).
Re-run after changing footage.json: already-swapped videos are updated in place.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

L = Path(__file__).resolve().parents[1]
FOOT = L / "assets" / "footage"
PROC = FOOT / "_proc"
CFG = json.loads((L / "footage.json").read_text()) if (L / "footage.json").exists() else {}
TIMING = json.loads((L / "assets" / "timing.json").read_text())
DRY = "--dry" in sys.argv
VIDEO_EXT = [".mp4", ".mov", ".MOV", ".MP4", ".m4v"]
IMAGE_EXT = [".png", ".PNG", ".jpg", ".jpeg", ".JPG", ".JPEG", ".webp"]


def find_source(stem):
    for ext in VIDEO_EXT + IMAGE_EXT:
        p = FOOT / f"{stem}{ext}"
        if p.exists():
            return p
    return None


def transcode(src, stem):
    PROC.mkdir(parents=True, exist_ok=True)
    out = PROC / f"{stem}.mp4"
    if out.exists() and out.stat().st_mtime > src.stat().st_mtime:
        return out
    print(f"  transcoding {src.name} -> _proc/{out.name}")
    if not DRY:
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(src), "-an", "-vf", "scale='min(1290,iw)':-2,fps=60",
                        "-c:v", "libx264", "-preset", "fast", "-crf", "17", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
                        str(out)], check=True)
    return out


def div_span(s, start):
    """[start, end) of the balanced <div ...>...</div> beginning at `start`."""
    depth, i = 0, start
    tag = re.compile(r"<(/?)div\b[^>]*>")
    for m in tag.finditer(s, start):
        depth += -1 if m.group(1) else 1
        if depth == 0:
            return m.end()
    raise ValueError("unbalanced div")


def scene_duration(path):
    sid = path.stem
    return TIMING["scenes"].get(sid, {}).get("duration")


COMMENT = re.compile(r"<!--\s*footage:\s*assets/footage/([\w.-]+?)(?:\.\w+)?\s*-->\s*")
changed = 0
for comp in sorted((L / "compositions").glob("*.html")):
    s = comp.read_text()
    orig = s
    pos = 0
    swapped_video = False
    while True:
        m = COMMENT.search(s, pos)
        if not m:
            break
        stem = m.group(1)
        pos = m.end()
        src = find_source(stem)
        el_start = m.end()
        head = re.match(r"<(div|video|img)\b([^>]*)>", s[el_start:])
        if not head:
            continue
        attrs = head.group(2)
        el_id = re.search(r'\bid="([^"]+)"', attrs)
        el_cls = re.search(r'\bclass="([^"]+)"', attrs)
        if not (src and el_id):
            continue
        cfg = CFG.get(stem, {})
        dur_scene = scene_duration(comp) or 10
        start = float(cfg.get("start", 0))
        dur = cfg.get("duration") or round(dur_scene - start, 3)
        cls = re.sub(r"\bclip\b", "", el_cls.group(1) if el_cls else "k-screen").strip()
        if src.suffix in IMAGE_EXT:
            new = f'<img id="{el_id.group(1)}" class="{cls}" src="assets/footage/{src.name}" alt="" style="object-fit: cover;">'
        else:
            mp4 = transcode(src, stem)
            rate = cfg.get("rate", 1)
            new = (f'<video id="{el_id.group(1)}" class="clip {cls}" src="assets/footage/_proc/{mp4.name}" muted playsinline '
                   f'data-start="{start}" data-duration="{dur}" data-media-start="{cfg.get("media_start", 0)}" '
                   f'data-playback-rate="{rate}" data-track-index="2" style="object-fit: cover;"></video>')
            swapped_video = True
        tagname = head.group(1)
        if tagname == "div":
            end = div_span(s, el_start)
        else:
            end = el_start + head.end() + (s[el_start + head.end():].find("</video>") + len("</video>") if tagname == "video" else 0)
        s = s[:el_start] + new + s[end:]
        print(f"{comp.name}: {stem} <- {src.name}")
    if swapped_video:
        # untime the scene wrapper so the video isn't nested in a timed element
        s = re.sub(r'(<div id="[\w-]+-wrap" class=")clip ([^"]*)"([^>]*?) data-start="0" data-duration="[\d.]+"',
                   r'\1\2"\3', s, count=1)
    if s != orig:
        changed += 1
        if not DRY:
            comp.write_text(s)
print(f"{changed} scene(s) updated" + (" (dry run)" if DRY else ""))
