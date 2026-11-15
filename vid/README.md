# vid

The ycyc demo video. HyperFrames 0.8.197 (HTML + GSAP, rendered in headless Chrome), same pipeline as the Davey film in `~/dev/nautshow1` (its `research/` has the measured reference teardowns and motion curves).

## Pipeline

1. **Voice (optional).** Lines in `audio/voice/script.json`, takes via `node audio/tools/gen-voice.mjs <name> <elevenLabsVoiceId> [takes]`.
2. **Timing.** Scene order and line placement in `audio/edl.json`. `python3 tools/remount.py` builds `assets/audio/dialogue.wav` + `assets/timing.json` (scene lengths come from the lines) and mounts `index.html`, with a placeholder for any scene not built yet.
3. **Scenes.** One file per scene, `compositions/<id>.html`, timeline `window.__timelines["<id>"]`. Never hand-edit `index.html`.
4. **Sound.** Cue comments in each scene (`<!-- sfx: t=1.2 name=ui-confirm gain=0.5 -->`, `duck`, `crowd`), then `python3 audio/tools/build-fx.py` writes `assets/audio/fx.wav`, the mastered `mix.wav` (-14 LUFS) and `SOUND.md`. Music: drop a track at `assets/music/bed.mp3`. `assets/sfx/` is local only (gitignored, Mixkit license); copy it from `~/dev/nautshow1/launch/assets/sfx`.
5. **Check, look, render.** `npm run check`, `npx hyperframes snapshot --at 1,3,5`, `npm run render`.

## What's in assets

- `kit.js` / `kit.css`: the app's tokens and motion. Colours, Inter, radii and springs are copied verbatim from `src/theme`. Helpers: `KIT.words`, `vo`, `reveal`, `type`, `smear`, `count`, `drift`, `pullback`, `bloomSwap`, `wipe`, `press`, `springs.<name>`, `ease.enter`.
- `pattern-waves.js`: the onboarding silk shader, seekable (`KIT.waves(tl, canvas, { from, to })`). Rebuild it with `tools/pattern-waves/build.sh` after the app's engine changes.
- `lordicons/icons.js`: the app's own Lordicons from `../assets/icons`, played with `KIT.icon(tl, el, "link", { at })`. Re-bundle with `python3 tools/bundle-icons.py`.
- `fonts/`: Inter 400, 500, 600 and 700.
- `ui/`, `footage/`, `brand/`: empty, ready for app captures and recordings.
