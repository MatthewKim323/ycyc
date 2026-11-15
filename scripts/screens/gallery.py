"""Build the screen gallery page from a folder of PNG captures.

Usage: python3 scripts/screens/gallery.py <shots_dir> <out_dir> "<build label>"
Writes <out_dir>/index.html and <out_dir>/shots/*.jpg (compressed with sips).
"""
import html
import os
import subprocess
import sys

shots_dir, out_dir, label = sys.argv[1], sys.argv[2], sys.argv[3]
os.makedirs(os.path.join(out_dir, "shots"), exist_ok=True)

CAPTIONS = {
    "01-welcome": ("Welcome", "The silk pattern behind the headline."),
    "02-set-it-up": ("Set it up once", "Three steps on a glass card."),
    "03-pick": ("Pick your first app", "Search, then the apps you have first."),
    "04-search": ("Search any app", "Live results from the App Store."),
    "05-connect": ("Connect", "What your assistants can do, then Continue."),
    "06-today": ("Today", "Rings, streak and recent activity."),
    "07-agent": ("Agent", "Ask your apps; opens in your assistant."),
    "08-apps": ("Your apps", "Connected apps as logo tiles."),
    "09-add": ("Add an app", "Search any app or pick a ready one."),
    "10-link": ("Link", "One link, every assistant."),
    "11-link-dev": ("For developers", "Claude Code, Codex and Cursor setup."),
    "12-paywall": ("Pro", "Unlimited apps."),
}
GROUPS = [
    ("Onboarding", ["01-welcome", "02-set-it-up", "03-pick", "04-search", "05-connect"]),
    ("Tabs", ["06-today", "07-agent", "08-apps", "09-add", "10-link", "11-link-dev"]),
    ("Upgrade", ["12-paywall"]),
]

have = {os.path.splitext(f)[0] for f in os.listdir(shots_dir) if f.endswith(".png")}
for name in have:
    subprocess.run(
        ["sips", "-s", "format", "jpeg", "-s", "formatOptions", "80", "--resampleWidth", "660",
         os.path.join(shots_dir, name + ".png"), "--out", os.path.join(out_dir, "shots", name + ".jpg")],
        check=False, capture_output=True,
    )

sections = []
for title, names in GROUPS:
    figs = []
    for n in names:
        if n not in have:
            continue
        cap, sub = CAPTIONS.get(n, (n, ""))
        figs.append(
            f'<figure><div class="phone"><img src="shots/{n}.jpg" alt="{html.escape(cap)} screen" loading="lazy"></div>'
            f"<figcaption><strong>{html.escape(cap)}</strong><span>{html.escape(sub)}</span></figcaption></figure>"
        )
    if figs:
        sections.append(f'<section><h2>{html.escape(title)}</h2><div class="grid">{"".join(figs)}</div></section>')

page = f"""<title>yuzu build screens</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap">
<style>
  /* Layout: a quiet contact sheet of real device captures, grouped by flow, phone frames in a wrapping grid. */
  :root {{ color-scheme: dark; --bg: #000000; --surface: #0b0b0b; --line: #1f1f1f; --fg: #ffffff; --muted: #a1a1a1; --faint: #6b6b6b;
    --font: "Inter", system-ui, -apple-system, "Segoe UI", sans-serif; }}
  body {{ background: var(--bg); color: var(--fg); font-family: var(--font); }}
  .wrap {{ max-width: 1240px; margin: 0 auto; padding-block: 56px 80px;
    padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px));
    display: flex; flex-direction: column; gap: 56px; }}
  header {{ display: flex; flex-direction: column; gap: 10px; max-width: 640px; }}
  h1 {{ margin: 0; font-size: clamp(32px, 5vw, 44px); font-weight: 600; letter-spacing: -0.03em; text-wrap: balance; }}
  header p {{ margin: 0; color: var(--muted); font-size: 16px; line-height: 1.55; }}
  .meta {{ color: var(--faint); font-size: 13px; }}
  section {{ display: flex; flex-direction: column; gap: 20px; }}
  h2 {{ margin: 0; font-size: 13px; font-weight: 500; color: var(--faint); letter-spacing: 0.08em; text-transform: uppercase; }}
  .grid {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 28px 24px; }}
  figure {{ margin: 0; display: flex; flex-direction: column; gap: 12px; min-width: 0; }}
  .phone {{ border-radius: 34px; overflow: hidden; border: 1px solid var(--line); background: var(--surface); aspect-ratio: 1320 / 2868; max-width: 100%; }}
  .phone img {{ display: block; width: 100%; height: 100%; object-fit: cover; }}
  figcaption {{ display: flex; flex-direction: column; gap: 3px; }}
  figcaption strong {{ font-size: 15px; font-weight: 500; }}
  figcaption span {{ font-size: 13px; color: var(--muted); line-height: 1.45; }}
</style>
<div class="wrap">
  <header>
    <h1>yuzu, on a cloud iPhone</h1>
    <p>Real captures of the current build running on a Revyl cloud iPhone. Nothing here is a mockup.</p>
    <span class="meta">{html.escape(label)}</span>
  </header>
  {"".join(sections)}
</div>
"""
open(os.path.join(out_dir, "index.html"), "w").write(page)
print("gallery:", len(have), "screens")
