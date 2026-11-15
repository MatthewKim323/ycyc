#!/usr/bin/env python3
"""python3 tools/captions.py -> captions.srt from assets/timing.json (the VO lines). Upload it to YouTube as the
English subtitles: exact text beats auto-captions, and the vibeapps AI judge reads YouTube captions."""
import json
from pathlib import Path

L = Path(__file__).resolve().parents[1]
t = json.loads((L / "assets" / "timing.json").read_text())


def ts(s):
    ms = int(round(s * 1000))
    return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"


out = []
for i, l in enumerate(sorted(t["lines"], key=lambda x: x["start"]), 1):
    text = " ".join(l["text"]) if isinstance(l["text"], list) else l["text"]
    out.append(f"{i}\n{ts(l['start'])} --> {ts(l['end'])}\n{text}\n")
(L / "captions.srt").write_text("\n".join(out))
print(f"{len(out)} captions")
