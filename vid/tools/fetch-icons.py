#!/usr/bin/env python3
"""python3 tools/fetch-icons.py -> assets/apps/store/<slug>.jpg (512px App Store icons via Apple's public iTunes Search API).
Local only (gitignored): third-party marks shown as the integrations they are, not redistributed in the repo."""
import json, re, sys, urllib.parse, urllib.request
from pathlib import Path
OUT = Path(__file__).resolve().parents[1] / "assets" / "apps" / "store"
OUT.mkdir(parents=True, exist_ok=True)
TERMS = {  # display name -> search term (disambiguation)
 "Delta": "Fly Delta", "Canvas": "Canvas Student", "Ladder": "Ladder strength training", "Streaks": "Streaks habit",
 "Oura": "Oura ring", "WhatsApp": "WhatsApp Messenger", "Ring": "Ring always home", "Tesla": "Tesla app",
 "Google Nest": "Google Home", "Apple Notes": "Notes apple", "Apple Reminders": "Reminders apple", "Chase": "Chase Mobile",
 "Amazon": "Amazon Shopping", "Stardust": "Stardust period tracker", "Finch": "Finch self care pet", "Cal AI": "Cal AI calorie tracker",
 "How We Feel": "How We Feel", "Natural Cycles": "Natural Cycles", "Eight Sleep": "Eight Sleep", "Handshake": "Handshake jobs",
 "Piazza": "Piazza", "Medisafe": "Medisafe", "MyChart": "MyChart", "Partiful": "Partiful", "AMC": "AMC Theatres",
}
names = [l.strip() for l in sys.stdin if l.strip()]
got = {}
for n in names:
    slug = re.sub(r"[^a-z0-9]+", "-", n.lower()).strip("-")
    dest = OUT / f"{slug}.jpg"
    if dest.exists():
        got[n] = slug; continue
    q = urllib.parse.urlencode({"term": TERMS.get(n, n), "entity": "software", "country": "us", "limit": 1})
    try:
        with urllib.request.urlopen(f"https://itunes.apple.com/search?{q}", timeout=10) as r:
            res = json.load(r).get("results", [])
        if not res: print("none:", n); continue
        url = res[0].get("artworkUrl512") or res[0].get("artworkUrl100")
        with urllib.request.urlopen(url, timeout=10) as r: dest.write_bytes(r.read())
        got[n] = slug; print(f"{n} <- {res[0].get('trackName')}")
    except Exception as e:
        print("fail:", n, e)
(OUT / "index.json").write_text(json.dumps(got, indent=1))
print(len(got), "icons")
