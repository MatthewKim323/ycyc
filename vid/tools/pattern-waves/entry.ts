// window.PatternWaves.create(canvas, opts) -> { renderAt(t), resize(w, h), dispose() }
// The ycyc onboarding shader (silk, white dots on black, fade edges) as a seekable video layer.
// opts: any Surface/Settings override + { preset, color, background, width, height, dpr }.
import { createEngine, parseColor, SURFACE_PRESETS, type PresetName, type Settings } from "./engine";

type Opts = Partial<Omit<Settings, "color" | "background">> & {
  preset?: PresetName;
  color?: string;
  background?: string;
  width?: number;
  height?: number;
  dpr?: number;
};

function create(canvas: HTMLCanvasElement, opts: Opts = {}) {
  const { preset = "silk", color = "#ffffff", background = "#000000", width, height, dpr = 1, ...rest } = opts;
  const gl = canvas.getContext("webgl2", { alpha: true, antialias: false, premultipliedAlpha: true, preserveDrawingBuffer: true });
  if (!gl) throw new Error("PatternWaves: WebGL2 unavailable");
  // Same defaults the app passes on onboarding (src/app/onboarding/_layout.tsx via onboarding-chrome.tsx).
  const settings: Settings = {
    ...SURFACE_PRESETS[preset],
    color: parseColor(color, [1, 1, 1, 1]),
    background: parseColor(background, [0, 0, 0, 1]),
    opacity: 1,
    fade: "edges",
    fadeSize: 0.5,
    interactive: false,
    cursorSize: 50,
    cursorStrength: 0,
    intro: true,
    paused: false,
    ...rest,
  } as Settings;
  const engine = createEngine(gl, {
    manual: true,
    getSettings: () => settings,
    pixelRatio: () => dpr,
    prepareBuffer: (cw, ch) => {
      if (canvas.width !== cw) canvas.width = cw;
      if (canvas.height !== ch) canvas.height = ch;
      return [canvas.width, canvas.height];
    },
  });
  engine.resize(width ?? canvas.clientWidth, height ?? canvas.clientHeight);
  return { renderAt: engine.renderAt, resize: engine.resize, dispose: engine.dispose, settings };
}

(window as any).PatternWaves = { create, presets: SURFACE_PRESETS };
