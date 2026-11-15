// Native renderer for PatternWaves on Skia (Metal). Two passes per frame, built on the UI thread:
// the field shader runs once per mark into a cols x rows picture, then the mark shader draws the
// dots, squares, pluses or lines at full resolution, sampling that picture as a child shader.
// The intro clock, time and ripple rings advance in a Reanimated frame callback.

import {
  Canvas,
  FilterMode,
  Picture,
  Skia,
  type SkPicture,
  type SkRuntimeEffect,
  TileMode,
} from "@shopify/react-native-skia";
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { AccessibilityInfo, PixelRatio, StyleSheet } from "react-native";
import { runOnJS, runOnUI, useFrameCallback, useSharedValue } from "react-native-reanimated";

import type { Settings } from "./engine";
import { RING_COUNT, skiaFieldShader, skiaMarkShader } from "./skia-shaders";

export type NativeFieldHandle = {
  pointerDown: (x: number, y: number) => void;
  pointerMove: (x: number, y: number) => void;
  pointerLeave: () => void;
};

type Props = {
  settings: Settings | null;
  width: number;
  height: number;
  active: boolean;
  onError: () => void;
};

const make = (source: string): SkRuntimeEffect | null => {
  try {
    return Skia.RuntimeEffect.Make(source);
  } catch {
    return null;
  }
};

const fieldEffect = make(skiaFieldShader);
const markEffect = make(skiaMarkShader);

export const nativeFieldAvailable = !!fieldEffect && !!markEffect;

const EMPTY_PICTURE = (() => {
  const recorder = Skia.PictureRecorder();
  recorder.beginRecording(Skia.XYWHRect(0, 0, 1, 1));
  return recorder.finishRecordingAsPicture();
})();

const slotsOf = (effect: SkRuntimeEffect | null) => {
  const slots: Record<string, number> = {};
  if (!effect) return slots;
  for (let i = 0; i < effect.getUniformCount(); i++) slots[effect.getUniformName(i)] = effect.getUniform(i).slot;
  return slots;
};

const FIELD_SLOTS = slotsOf(fieldEffect);
const MARK_SLOTS = slotsOf(markEffect);
const FIELD_FLOATS = fieldEffect ? fieldEffect.getUniformFloatCount() : 0;
const MARK_FLOATS = markEffect ? markEffect.getUniformFloatCount() : 0;
const CLAMP = TileMode.Clamp;
const NEAREST = FilterMode.Nearest;

const PATTERNS: Record<string, number> = { dot: 0, square: 1, plus: 2, line: 3 };
const WAVES: Record<string, number> = { silk: 0, swell: 1, ripple: 2 };
const FADES: Record<string, number> = { none: 0, edges: 1, center: 2, bottom: 3, top: 4 };
const WAVE_UNIT = 520;
const PIXEL_BUDGET = 4.5e6;
const INTRO_SECONDS = 2;
const MAX_DPR = 2;
// Wave speed and decay of the original ripple sim: 0.707 cells per step, 8 px cells, 60 steps a
// second, damping 0.975 per step.
const RING_SPEED = 340;
const RING_LIFE = 3;

const NativeField = forwardRef<NativeFieldHandle, Props>(({ settings, width, height, active, onError }, ref) => {
  const pd = PixelRatio.get();
  const settingsSV = useSharedValue<Settings | null>(settings);
  const sizeSV = useSharedValue({ width, height });
  const dirty = useSharedValue(true);
  const reduced = useSharedValue(false);
  const clock = useSharedValue({ time: 0, intro: 0, now: 0 });
  // Ring slots: x, y (GL css px, y up), birth (seconds on the UI clock), amplitude.
  const rings = useSharedValue<number[]>(new Array(RING_COUNT * 4).fill(0));
  const ringCursor = useSharedValue(0);
  const picture = useSharedValue<SkPicture>(EMPTY_PICTURE);
  const failed = useRef(false);
  const pointer = useRef({ x: 0, y: 0, inside: false, lastX: 0, lastY: 0, pending: 0, lastSpawn: 0 });

  useEffect(() => {
    settingsSV.value = settings;
    dirty.value = true;
  }, [settings, settingsSV, dirty]);

  useEffect(() => {
    sizeSV.value = { width, height };
    dirty.value = true;
  }, [width, height, sizeSV, dirty]);

  useEffect(() => {
    let live = true;
    const apply = (value: boolean) => {
      reduced.value = value;
      dirty.value = true;
    };
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => live && apply(value))
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", apply);
    return () => {
      live = false;
      sub.remove();
    };
  }, [reduced, dirty]);

  const reportError = () => {
    if (failed.current) return;
    failed.current = true;
    onError();
  };

  const frame = useFrameCallback((info) => {
    "worklet";
    const s = settingsSV.value;
    const { width: w, height: h } = sizeSV.value;
    if (!s || w <= 0 || h <= 0 || !fieldEffect || !markEffect) return;
    const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
    const lum = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

    const dt = Math.min(0.05, Math.max(1 / 240, (info.timeSincePreviousFrame ?? 16.7) / 1000));
    const c = clock.value;
    const now = c.now + dt;
    const moving = !s.paused && !reduced.value && s.speed !== 0;
    const time = moving ? c.time + dt * s.speed : c.time;
    const introClock = s.intro && !reduced.value ? Math.min(1, c.intro + dt / INTRO_SECONDS) : 1;
    clock.value = { time, intro: introClock, now };

    const rippling = s.interactive && !reduced.value && s.cursorStrength > 0;
    const ringData = rings.value;
    const ringU: number[] = new Array(RING_COUNT * 4).fill(0);
    let ringsLive = false;
    if (rippling) {
      for (let i = 0; i < RING_COUNT; i++) {
        const amp = ringData[i * 4 + 3];
        const age = now - ringData[i * 4 + 2];
        if (amp <= 0 || age < 0 || age > RING_LIFE) continue;
        ringU[i * 4] = ringData[i * 4];
        ringU[i * 4 + 1] = ringData[i * 4 + 1];
        ringU[i * 4 + 2] = age;
        ringU[i * 4 + 3] = amp;
        ringsLive = true;
      }
    }

    if (!(moving || c.intro < 1 || ringsLive || dirty.value)) return;
    dirty.value = false;

    const appear = 1 - Math.pow(1 - clamp(introClock / 0.75, 0, 1), 3);
    const rise = clamp((introClock - 0.1) / 0.9, 0, 1);
    const amp = rise * rise * (3 - 2 * rise);

    const dprCap = Math.min(pd, MAX_DPR, Math.sqrt(PIXEL_BUDGET / (w * h)));
    const canvasW = Math.max(1, Math.floor(w * dprCap));
    const canvasH = Math.max(1, Math.floor(h * dprCap));
    const dpr = canvasW / w;
    const patternIndex = PATTERNS[s.pattern] ?? 0;
    const pitchY = Math.max(4, Math.round(clamp(s.spacing, 4, 120) * dpr));
    const pitchX = patternIndex === 3 ? Math.max(2, Math.round(pitchY / 4)) : pitchY;
    const cols = Math.min(4096, Math.ceil(canvasW / pitchX) + 1);
    const rows = Math.min(4096, Math.ceil(canvasH / pitchY) + 2);
    const ox = Math.floor((canvasW - cols * pitchX) / 2);
    const oy = Math.floor((canvasH - rows * pitchY) / 2);
    const heading = (s.direction * Math.PI) / 180;
    const lightAngle = ((s.direction + 180 + clamp(s.light, -90, 90)) * Math.PI) / 180;
    const bg = s.background;
    const ink = bg[3] > 0.02 ? lum(s.color) < lum(bg) : lum(s.color) < 0.5;

    const fu: number[] = new Array(FIELD_FLOATS).fill(0);
    const setF = (name: string, values: number[]) => {
      const slot = FIELD_SLOTS[name];
      if (slot === undefined) return;
      for (let i = 0; i < values.length; i++) fu[slot + i] = values[i];
    };
    setF("uSize", [w, h]);
    setF("uDpr", [dpr]);
    setF("uOrigin", [ox, oy]);
    setF("uPitch", [pitchX, pitchY]);
    setF("uGrid", [cols, rows]);
    setF("uWave", [WAVES[s.wave] ?? 0]);
    setF("uTime", [time]);
    setF("uUnit", [WAVE_UNIT * clamp(s.scale, 0.2, 5)]);
    setF("uHeading", [Math.cos(heading), Math.sin(heading)]);
    setF("uAmp", [amp]);
    setF("uDepth", [clamp(s.depth, 0, 1.5)]);
    setF("uLight", [Math.cos(lightAngle) * 0.78, Math.sin(lightAngle) * 0.78, 0.62]);
    setF("uShine", [clamp(s.shine, 0, 2)]);
    setF("uContrast", [clamp(s.contrast, 0.3, 3)]);
    setF("uInk", [ink ? 1 : 0]);
    setF("uRipple", [ringsLive ? 0.32 : 0]);
    setF("uRippleSpeed", [RING_SPEED]);
    setF("uRippleWidth", [clamp(s.cursorSize, 8, 400) * 0.5]);
    setF("uRings", ringU);

    const tint = ink ? 0 : 1;
    const blend = ink ? 0.35 : 0.55;
    const [r, g, b] = s.color;
    const mu: number[] = new Array(MARK_FLOATS).fill(0);
    const setM = (name: string, values: number[]) => {
      const slot = MARK_SLOTS[name];
      if (slot === undefined) return;
      for (let i = 0; i < values.length; i++) mu[slot + i] = values[i];
    };
    setM("uSize", [w, h]);
    setM("uDpr", [dpr]);
    setM("uPxScale", [dpr / pd]);
    setM("uCanvas", [canvasW, canvasH]);
    setM("uOrigin", [ox, oy]);
    setM("uPitch", [pitchX, pitchY]);
    setM("uGrid", [cols, rows]);
    setM("uPattern", [patternIndex]);
    setM("uMarkSize", [clamp(s.markSize, 0.05, 1)]);
    setM("uStroke", [patternIndex === 3 ? 0.9 * dpr : Math.max(1.1 * dpr, pitchY * 0.08)]);
    setM("uColor", [r, g, b]);
    setM("uAccent", [r + (tint - r) * blend, g + (tint - g) * blend, b + (tint - b) * blend]);
    setM("uBackground", [bg[0], bg[1], bg[2], bg[3]]);
    setM("uOpacity", [clamp(s.opacity, 0, 1)]);
    setM("uFade", [FADES[s.fade] ?? 0]);
    setM("uFadeSize", [clamp(s.fadeSize, 0.05, 1)]);
    setM("uAppear", [appear]);

    try {
      // Field pass: one pixel per mark, as a picture so Skia rasterizes it on the GPU.
      const fieldRecorder = Skia.PictureRecorder();
      const fieldBounds = Skia.XYWHRect(0, 0, cols, rows);
      const fieldCanvas = fieldRecorder.beginRecording(fieldBounds);
      const fieldPaint = Skia.Paint();
      const fieldShader = fieldEffect.makeShader(fu);
      fieldPaint.setShader(fieldShader);
      fieldCanvas.drawRect(fieldBounds, fieldPaint);
      const fieldPicture = fieldRecorder.finishRecordingAsPicture();
      const fieldImage = fieldPicture.makeShader(CLAMP, CLAMP, NEAREST);

      // Mark pass in device pixels (undo the view's pixel density scale) so the field tile is
      // rasterized at exactly cols x rows.
      const recorder = Skia.PictureRecorder();
      const canvas = recorder.beginRecording(Skia.XYWHRect(0, 0, w, h));
      const markPaint = Skia.Paint();
      const markShader = markEffect.makeShaderWithChildren(mu, [fieldImage]);
      markPaint.setShader(markShader);
      canvas.save();
      canvas.scale(1 / pd, 1 / pd);
      canvas.drawRect(Skia.XYWHRect(0, 0, w * pd, h * pd), markPaint);
      canvas.restore();
      picture.value = recorder.finishRecordingAsPicture();

      // Recorded paints hold their own refs, so the wrappers can go now.
      fieldPaint.dispose();
      fieldShader.dispose();
      fieldImage.dispose();
      fieldPicture.dispose();
      markPaint.dispose();
      markShader.dispose();
    } catch {
      runOnJS(reportError)();
    }
  }, false);

  useEffect(() => {
    frame.setActive(active);
    if (active) dirty.value = true;
  }, [active, frame, dirty]);

  useEffect(() => {
    if (!nativeFieldAvailable) reportError();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const spawn = (x: number, y: number, amplitude: number) => {
    const gx = x;
    const gy = sizeSV.value.height - y;
    runOnUI((px: number, py: number, a: number) => {
      "worklet";
      const next = rings.value.slice();
      const i = ringCursor.value % RING_COUNT;
      next[i * 4] = px;
      next[i * 4 + 1] = py;
      next[i * 4 + 2] = clock.value.now;
      next[i * 4 + 3] = a;
      rings.value = next;
      ringCursor.value = ringCursor.value + 1;
    })(gx, gy, amplitude);
  };

  useImperativeHandle(ref, () => ({
    // Touch down = the original's pointerdown burst (1.2 x strength) at the touch point.
    pointerDown: (x, y) => {
      const s = settingsSV.value;
      if (!s || !s.interactive || s.cursorStrength <= 0) return;
      const p = pointer.current;
      p.x = x;
      p.y = y;
      if (!p.inside) {
        p.lastX = x;
        p.lastY = y;
      }
      p.pending = 0;
      p.lastSpawn = Date.now();
      spawn(x, y, 1.2 * Math.min(Math.max(s.cursorStrength, 0), 1));
    },
    // Moves accumulate the original's per frame impulse (min(moved / 14, 1) * 0.35 * strength) and
    // drop a ring along the path every ~45 ms.
    pointerMove: (x, y) => {
      const s = settingsSV.value;
      if (!s || !s.interactive || s.cursorStrength <= 0) return;
      const p = pointer.current;
      if (!p.inside) {
        p.lastX = x;
        p.lastY = y;
        p.inside = true;
      }
      const moved = Math.hypot(x - p.lastX, y - p.lastY);
      p.pending += Math.min(moved / 14, 1) * 0.35 * Math.min(Math.max(s.cursorStrength, 0), 1);
      p.lastX = x;
      p.lastY = y;
      p.x = x;
      p.y = y;
      const t = Date.now();
      if (t - p.lastSpawn >= 45 && p.pending > 0.02) {
        spawn(x, y, Math.min(p.pending, 1));
        p.pending = 0;
        p.lastSpawn = t;
      }
    },
    pointerLeave: () => {
      pointer.current.inside = false;
      pointer.current.pending = 0;
    },
  }));

  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
      <Picture picture={picture} />
    </Canvas>
  );
});

NativeField.displayName = "NativeField";

export default NativeField;
