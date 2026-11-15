#!/usr/bin/env python3
"""python3 tools/bundle-icons.py -> assets/lordicons/icons.js (window.YC_ICONS, loads synchronously, no fetch).

Source: ../assets/icons/*.json, the app's own Lordicons (: wired outline,
baked white, trimmed so ip..op is the motion; ip is the resting frame, check.json is a draw-in from empty).
Add an icon: drop its Lordicon JSON in ycyc/assets/icons and re-run. Use with KIT.icon(tl, el, "name", { at }).
"""
import json
from pathlib import Path

L = Path(__file__).resolve().parents[1]
src = L.parent / "assets" / "icons"
out = {}
for p in sorted(src.glob("*.json")):
    d = json.loads(p.read_text())
    out[p.stem] = {"data": d, "seg": [d.get("ip", 0), d.get("op", 60)], "fr": d.get("fr", 60)}
(L / "assets" / "lordicons" / "icons.js").write_text("window.YC_ICONS = " + json.dumps(out, separators=(",", ":")) + ";\n")
print(f"{len(out)} icons: {', '.join(out)}")
