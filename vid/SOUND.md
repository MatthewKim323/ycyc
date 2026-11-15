# Sound

Built by `python3 audio/tools/build-fx.py` from the cue comments in `compositions/<scene>.html` (only the
scenes in `assets/timing.json`) and `assets/timing.json`. Re-run it after any scene or timing change, then
`python3 tools/mount.py`.

- `assets/audio/fx.wav`: effects stem, pre-master, balanced against `dialogue.wav` (what index.html plays).
- `assets/audio/mix.wav`: dialogue + fx, mastered (compressor, +11.6 dB, limiter at -2.1 dBFS). Use it for the final render.

## Cues (scene-local seconds; 1.2, 1.2s or 36f)

- `<!-- sfx: t=1.23 name=text-tick gain=0.2 pan=0 -->` one-shot from `assets/sfx/`. Optional `pitch=`, `vary=0`, `len=`, `fade=`, `every= until=`. `name=type-micro` types thocky keys for the caller line at that moment (`chars=N` to force, `cps=` the on-screen rate, default 30). `name=room-*` / `callcenter-bed` swaps the scene's bed.
- `<!-- crowd: t=1.20 pan=-0.6 gain=0.8 reply=1 -->` one caller (24 voices, cycled, neighbours never repeat), phone band 300 to 3400 Hz + a little room. Every 3rd gets a short phone-band reply unless `reply=0`; `reply=1` forces one.
- `<!-- duck: t=2.10 len=0.4 -->` suck-out: cues, crowd and rooms -10 dB (air -5 so it never goes silent) over 0.25s from t, hold to t+len, back over 0.1s. Land the reveal at t+len. Max 4.
- `<!-- fade-crowd: t=4.0 len=1.0 -->` every crowd voice playing at t (and the callcenter-bed) is gone by t+len.

## Master

Integrated **-14.2 LUFS**, true peak **-1.8 dBTP**, LRA **3.0 LU**.
Spans under -50 dBFS for 0.2s+: 0 (never silent).

## Per scene

Mix columns are the mastered mix (LUFS / dBTP). Voice and fx are the pre-master stems; "voice I" is every voiced line, "under" is how far the fx sit below them while they talk (after ducking). "lift" is the second-act fx lift.

| scene | start | sfx | crowd | ducks | bed | lift | mix I | mix TP | voice I | fx I | under |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| s01-guess | 0.00 | 14 | 0 | 0 | air |  | -13.7 | -2.0 | -15.0 | -31.2 | 16.2 |
| s02-islands | 6.21 | 17 | 0 | 0 | air |  | -13.6 | -2.1 | -15.9 | -30.1 | 14.3 |
| s03-reveal | 13.74 | 4 | 0 | 1 | air |  | -14.0 | -2.1 | -14.8 | -22.3 | 7.4 |
| s04-connect | 18.78 | 8 | 0 | 0 | air |  | -14.7 | -1.9 | -14.9 | -24.1 | 16.1 |
| s05-link | 26.78 | 4 | 0 | 0 | air |  | -14.2 | -1.9 | -17.1 | -23.3 | 6.3 |
| s06-knows | 31.28 | 8 | 0 | 1 | air |  | -15.4 | -1.9 | -18.8 | -21.2 | 4.6 |
| s07-approve | 41.28 | 6 | 0 | 0 | air |  | -14.1 | -1.9 | -14.1 | -21.6 | 9.1 |
| s08-chatgpt | 47.28 | 3 | 0 | 0 | air |  | -15.1 | -2.0 | -16.6 | -21.4 | 7.3 |
| s09-text | 52.28 | 3 | 0 | 0 | air |  | -15.0 | -2.0 | -13.9 | -21.0 | 8.0 |
| s09b-any | 57.28 | 19 | 0 | 0 | air |  | -13.0 | -2.0 | -15.1 | -22.5 | 8.3 |
| s10-more | 65.45 | 4 | 0 | 0 | air |  | -13.6 | -2.0 | -15.3 | -22.5 | 7.8 |
| s11-endless | 70.45 | 11 | 0 | 0 | air |  | -13.8 | -1.8 | -14.1 | -21.4 | 9.1 |
| s12-built | 77.45 | 3 | 0 | 0 | air |  | -14.1 | -2.0 | -15.6 | -22.6 | 8.1 |
| s13-end | 83.45 | 2 | 0 | 0 | air -> pad |  | -14.1 | -2.0 | -14.1 | -22.2 | 8.7 |

## Layers

- Air bed (pink noise 90 Hz to 6.5 kHz, -57 dBFS RMS) under everything; through s13-end it crossfades into a soft brown-noise pad (-56 dBFS RMS, 110 to 900 Hz, slow breathing). Ending by subtraction, no hit unless a scene authors `endcard-hit`. 0.5s fade at the very end.
- Rooms (0.25s lead, crossfade past the cut):  dBFS RMS. Other scenes: air only.
- None: callcenter-bed from 0.5s before, rising -32 to -20 dBFS RMS, out 0.6s into the next scene.
- Crowd: one caller at -23 LUFS after the phone band, -1.0 dB per doubling of voices already playing so a pile-up roars under the narrator; replies -3 dB under their caller. Scenes with no crowd cues get a fallback crowd: .
- One-shots: onset-aligned, peak-normalized, capped per sound (text-tick -27, digit-tick -19, type-micro -30, pops -17, clicks -15, whooshes -17, whip -12, endcard-hit -9, low-hit -6, slam-impact -7, final-hit -5 dBFS peak), the author's gain scales down from the cap relative to its loudest use (endcard-hit, wall-riser, logo-bloom: relative to at least 0.6, and their tails clear out 0.5s into the next voice line). Repeats jitter up to +-2 semitones and +-1.5 dB.
- Sources: the sfx library carried over from the Davey film (Mixkit free-license previews + ElevenLabs generations, processed in ~/dev/nautshow1/audio/tools/process-sfx.py). New sounds: `node audio/tools/gen-sfx.mjs` from `audio/sfx.json`.
- Crowd voices, phone replies and the wall walla duck another 4 dB under any voice line, so the narrator stays on top of the wall.
- Whole stem ducks under voiced lines (narrator 3 dB, assistant 5 dB, user 4 dB; 0.12s in, 0.3s out). Lift: off.
- Music: `bed.mp3` at -22.0 dBFS RMS from 3.904s (song offset 0.0s), ducked with the stem.

## Cue sheet (scene-local seconds)

- **s01-guess**: 0.55 ui-roll, 1.15 ui-roll, 1.90 flash-tick, 2.08 text-tick, 2.36 text-tick, 2.64 text-tick, 2.92 text-tick, 3.08 ui-confirm, 4.32 case-pop, 4.44 case-pop, 4.56 case-pop, 4.68 case-pop, 4.80 case-pop, 5.35 low-hit
- **s02-islands**: 0.00 flash-tick, 0.02 whoosh-soft, 1.25 card-morph, 1.93 row-tick, 2.05 row-tick, 2.17 row-tick, 3.00 whoosh-soft, 3.35 row-tick, 3.47 row-tick, 3.59 row-tick, 4.38 whoosh-soft, 4.71 row-tick, 4.83 row-tick, 4.95 row-tick, 6.01 whoosh-soft, 6.69 row-tick, 6.98 card-morph
- **s03-reveal**: 0.80 duck 0.40s, 1.20 slam-impact, 1.20 low-hit, 1.22 logo-bloom, 1.30 brand-shimmer
- **s04-connect**: 0.93 ui-confirm, 1.15 ui-open, 2.00 ui-confirm, 2.15 card-morph, 2.97 row-tick, 3.65 row-tick, 4.33 row-tick, 6.37 row-tick
- **s05-link**: 0.42 ding-success, 1.50 ui-confirm, 1.70 whoosh-soft, 2.46 ui-confirm
- **s06-knows**: 1.40 case-pop, 2.40 case-pop, 3.40 case-pop, 4.08 whoosh-soft, 4.40 duck 0.40s, 4.80 slam-impact, 6.81 row-tick, 7.49 row-tick, 8.17 row-tick
- **s07-approve**: 0.20 phone-buzz, 0.62 card-morph, 2.40 ui-confirm, 2.64 whoosh-soft, 3.30 row-tick, 5.66 whoosh-soft
- **s08-chatgpt**: 0.80 case-pop, 1.60 msg-in, 4.68 whoosh-soft
- **s09-text**: 0.50 msg-sent, 2.00 msg-in, 4.60 whoosh-soft
- **s09b-any**: 0.54 text-tick, 0.88 ui-open, 1.22 ui-roll, 1.64 ui-open, 1.90 ui-roll, 2.24 ui-confirm, 2.32 whoosh-soft, 3.26 case-pop, 3.94 msg-in, 5.00 whoosh-soft, 5.30 row-tick, 5.64 row-tick, 5.98 row-tick, 6.32 row-tick, 6.66 row-tick, 7.00 row-tick, 7.35 row-tick, 7.69 row-tick, 7.80 whoosh-soft
- **s10-more**: 1.22 case-pop, 2.47 riser-tight, 2.59 case-pop, 3.95 case-pop
- **s11-endless**: 0.00 wall-riser, 1.30 text-tick, 1.55 text-tick, 1.78 text-tick, 1.98 text-tick, 2.16 text-tick, 2.33 text-tick, 2.52 text-tick, 2.75 text-tick, 3.05 text-tick, 3.45 text-tick
- **s12-built**: 0.00 whoosh-soft, 2.10 whoosh-soft, 4.14 whoosh-soft
- **s13-end**: 0.72 logo-bloom, 1.60 brand-shimmer

