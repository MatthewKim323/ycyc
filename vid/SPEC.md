# SPEC: "Your apps, in every AI"

GOAL:    In 15 s a judge (sound on or muted) gets that yuzu lets the AI they already pay for read and act in the apps
         on their phone, even apps with no API; by 0:40 they've watched it work for real; at the end they feel it's endless.
OUTPUT:  HyperFrames 0.8.197, 1920x1080, authored at 30 fps, delivery render at 60 fps. Unlisted YouTube, captions on.
TIME:    ~80 s (2400 frames @30). Scene lengths come from the VO (`audio/edl.json` → `tools/remount.py`).
         Temp music ~87.6 BPM = 20.5 frames per beat @30; cut the s02 islands and the s10 replays on beats.

LOOK
  ground:  #000. Home stage = the app's own silk dot wave (`KIT.waves`, preset silk, white dots, fade edges), the brand's
           real material. Full strength only in s03 and s13; behind UI it sits under a black dim at 0.55 (as onboarding/how).
  ink:     #FFFFFF text and fills; #A1A1A1 secondary; #6B6B6B tertiary; surfaces #0B0B0B / #141414; hairlines #1F1F1F /
           #2A2A2A. No accent colour. State is white fill (live) vs 50% white (building). Red #FF453A only if a real
           capture shows an error.
  type:    Inter only. Titles Inter 600, 120-150 px, tracking -0.03em, line-height 1.04, max 6 words a line.
           UI text Inter 500/600 at 3x the app's sizes (title 28pt → 84 px, row 16pt → 48 px, label 13pt → 39 px).
           Nothing read on screen under 28 px. Numbers tabular.
  medium:  (1) real iPhone captures inside `.k-phone` (430x932 box, scaled so the phone is at least 80% of frame height,
           or cropped macro at 1.6-2.4x on the part that matters); (2) app UI rebuilt from the code at 3x: surface #0B0B0B,
           1.5 px #1F1F1F hairline, card radius 48 px (16pt x3), pills 156 px tall (52pt x3), Lordicons from
           `assets/lordicons/icons.js`.
  depth:   no drop shadows, no glow (the brand has none). Depth = the shader dim + neighbours at blur 8 px / 40%
           opacity (`.p-dim`) + scale. Grain 0. Vignette 0.

OBJECTS  the phone (black slab, 68 px corner radius, 14 px bezel, real capture inside); an assistant chat (always a real
         capture, never redrawn); the yuzu mark (white rounded square, "yuzu" in Inter 600, black, as on the connect sheet);
         app glyphs (the app's Lordicons: Flo lotus, MyFitnessPal apple, Strong person-pushups, others as they're bundled);
         the approval card (the app's ApprovalCard: countdown, Deny / Approve); app tiles (the app's AppTile, front glyph +
         name + capability, back "Live" + "N tools in every assistant").

PACE     Director's rule: something new on screen every 2-3 s at most (a cut, a new element, a camera move that changes
         what you read). The intro runs faster, a change every ~1.5-2 s. Only the end-card hold (3 s) is exempt.

MOTION
  enter:   `KIT.ease.enter` = cubic-bezier(0.16, 1, 0.3, 1), 18 frames, rising 36 px (the app's Reveal x3)
  UI:      the app's springs via `KIT.springs`: enter (zeta 0.84, omega 13), pop (0.75, 15), flip (0.85, 11.8) for the
           tile flip, press 0.97 scale (`KIT.press`)
  camera:  push/punch power2.inOut over 12-18 frames landing just after the tap it follows; every hold drifts 3-5%
           (sine.inOut); scale ladder: macro → phone → wall, never two beats at the same distance
  text:    titles with `KIT.words`; VO punchlines with `KIT.vo` locked to the line; tool names with `KIT.smear` (30 cps)
  cuts:    on phrase boundaries, never mid-word; s02 hard cuts on beats; elsewhere match cuts carried by one object
           (the bubble becomes a dot, the link lifts out and drops in, a tile becomes a dot). `KIT.wipe` at most twice.
  exits:   12 frames, opacity + 8 px blur, power2.in, overlapping the next entry by 6-10 frames (never a gap)

SHOTS    see STORYBOARD.md (13 scenes, s01-guess … s13-end). Every scene: one hero move, secondary moves at 50-70% of its
         travel starting 3-6 frames later, everything else still.

SOUND    VO (Chris) on top at ~-19 LUFS; music bed -22 dBFS RMS ducking 3-5 dB under the VO; UI ticks per tap and per
         step; 3 suck-outs max (before s03 reveal, before the s06 answer, before s13 end); one big hit (the s06 answer
         landing); master -14 LUFS, never silent, end by subtraction.

BANNED   the spec.md defaults (dark void with small floating things, glow/bloom/particles, purple/blue or mesh gradients,
         glass cards, cream-serif-mono look, everything centred and fading up at once, text moving while read, corner
         labels, three cards in a row, title over a dimmed screenshot, docked logo), plus for this film:
         a small phone floating in the middle of black; any redrawn Claude / ChatGPT / iMessage UI (captures only);
         typing into a prompt box as the opener; chat text that types perfectly; invented numbers or counters (only the
         real tool counts from recipes/*.json and numbers visible in the captures); other companies' logos redrawn;
         emoji other than the real "done ✓" in the Keiki capture; em dashes in any copy.

QA       0.0 s (the thumbnail: Claude with the question and the generic answer, legible); first and last frame of every
         scene (handoffs carry one object); the s03 mark landing; the s06 answer frame (every cited number readable for
         0.5 s + 0.3 s a word); the s10 flips; the s11 wall to dots; the s13 hold. `npm run check` clean.
