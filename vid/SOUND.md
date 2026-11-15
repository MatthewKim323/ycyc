# Sound

Built by `python3 audio/tools/build-fx.py` from the cue comments in `compositions/<scene>.html` (only the
scenes in `assets/timing.json`) and `assets/timing.json`. Re-run it after any scene or timing change, then
`python3 tools/mount.py`.

- `assets/audio/fx.wav`: effects stem, pre-master, balanced against `dialogue.wav` (what index.html plays).
- `assets/audio/mix.wav`: dialogue + fx, mastered (compressor, +11.8 dB, limiter at -2.1 dBFS). Use it for the final render.

## Cues (scene-local seconds; 1.2, 1.2s or 36f)

- `<!-- sfx: t=1.23 name=text-tick gain=0.2 pan=0 -->` one-shot from `assets/sfx/`. Optional `pitch=`, `vary=0`, `len=`, `fade=`, `every= until=`. `name=type-micro` types thocky keys for the caller line at that moment (`chars=N` to force, `cps=` the on-screen rate, default 30). `name=room-*` / `callcenter-bed` swaps the scene's bed.
- `<!-- crowd: t=1.20 pan=-0.6 gain=0.8 reply=1 -->` one caller (24 voices, cycled, neighbours never repeat), phone band 300 to 3400 Hz + a little room. Every 3rd gets a short phone-band reply unless `reply=0`; `reply=1` forces one.
- `<!-- duck: t=2.10 len=0.4 -->` suck-out: cues, crowd and rooms -10 dB (air -5 so it never goes silent) over 0.25s from t, hold to t+len, back over 0.1s. Land the reveal at t+len. Max 4.
- `<!-- fade-crowd: t=4.0 len=1.0 -->` every crowd voice playing at t (and the callcenter-bed) is gone by t+len.

## Master

Integrated **-14.2 LUFS**, true peak **-1.6 dBTP**, LRA **3.0 LU**.
Spans under -50 dBFS for 0.2s+: 0 (never silent).

## Per scene

Mix columns are the mastered mix (LUFS / dBTP). Voice and fx are the pre-master stems; "voice I" is every voiced line, "under" is how far the fx sit below them while they talk (after ducking). "lift" is the second-act fx lift.

| scene | start | sfx | crowd | ducks | bed | lift | mix I | mix TP | voice I | fx I | under |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| s01-guess | 0.00 | 0 | 0 | 0 | air |  | -13.5 | -2.0 | -15.0 | -31.7 | 17.0 |
| s02-islands | 6.21 | 0 | 0 | 0 | air |  | -12.7 | -2.1 | -14.8 | -30.7 | 15.8 |
| s03-reveal | 13.74 | 0 | 0 | 0 | air |  | -13.2 | -2.0 | -14.6 | -23.4 | 9.2 |
| s04-connect | 18.78 | 0 | 0 | 0 | air |  | -14.1 | -2.1 | -15.6 | -25.2 | 14.0 |
| s05-link | 26.78 | 0 | 0 | 0 | air |  | -14.2 | -1.9 | -17.1 | -23.3 | 6.5 |
| s06-knows | 31.28 | 0 | 0 | 0 | air |  | -15.2 | -1.9 | -18.8 | -21.1 | 4.6 |
| s07-approve | 41.28 | 0 | 0 | 0 | air |  | -14.1 | -1.6 | -14.1 | -21.8 | 8.9 |
| s08-chatgpt | 47.28 | 0 | 0 | 0 | air |  | -15.0 | -2.0 | -16.6 | -21.4 | 7.2 |
| s09-text | 52.28 | 0 | 0 | 0 | air |  | -15.0 | -2.0 | -14.0 | -21.1 | 8.0 |
| s10-more | 57.28 | 0 | 0 | 0 | air |  | -13.7 | -1.9 | -14.6 | -22.3 | 9.1 |
| s11-endless | 62.28 | 0 | 0 | 0 | air |  | -14.3 | -1.8 | -14.2 | -22.2 | 9.3 |
| s12-built | 69.28 | 0 | 0 | 0 | air |  | -13.9 | -2.1 | -15.7 | -22.1 | 8.0 |
| s13-end | 75.28 | 0 | 0 | 0 | air -> pad |  | -14.7 | -1.8 | -16.3 | -22.6 | 7.0 |

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

- (no authored cues yet)

