// Renderer for PatternWaves. A by-hand port of the React Bits original (docs/ref/PatternWaves.web.jsx):
// the ogl Renderer, Program, Mesh, Triangle and RenderTarget pieces are re-implemented with raw
// WebGL2 calls so the same code runs on expo-gl (iOS/Android) and on the web. The JS math, render
// order, clears and uniform values follow the original line for line.

import { fieldFragment, markFragment, passVertex, presentFragment, rippleFragment } from "./shaders";

export type RGBA = [number, number, number, number];

export type PresetName = "silk" | "ocean" | "pond" | "lines" | "mesh";
export type PatternName = "dot" | "square" | "plus" | "line";
export type WaveName = "silk" | "swell" | "ripple";
export type FadeName = "none" | "edges" | "center" | "bottom" | "top";

type Surface = {
  pattern: PatternName;
  wave: WaveName;
  spacing: number;
  markSize: number;
  depth: number;
  light: number;
  shine: number;
  contrast: number;
  speed: number;
  scale: number;
  direction: number;
};

// The "terminal" preset and the glyph pattern are left out on purpose (monospace atlas look).
export const SURFACE_PRESETS: Record<PresetName, Surface> = {
  silk: {
    pattern: "dot",
    wave: "silk",
    spacing: 9,
    markSize: 0.95,
    depth: 0.95,
    light: 0,
    shine: 0.8,
    contrast: 1.2,
    speed: 0.35,
    scale: 1,
    direction: 20,
  },
  ocean: {
    pattern: "dot",
    wave: "swell",
    spacing: 10,
    markSize: 0.9,
    depth: 0.42,
    light: 0,
    shine: 1,
    contrast: 1.2,
    speed: 0.5,
    scale: 1,
    direction: 100,
  },
  pond: {
    pattern: "dot",
    wave: "ripple",
    spacing: 10,
    markSize: 0.9,
    depth: 0.55,
    light: 0,
    shine: 1.2,
    contrast: 1.2,
    speed: 0.5,
    scale: 1,
    direction: 35,
  },
  lines: {
    pattern: "line",
    wave: "silk",
    spacing: 12,
    markSize: 0.42,
    depth: 0.9,
    light: 0,
    shine: 0.6,
    contrast: 1.2,
    speed: 0.3,
    scale: 1,
    direction: 20,
  },
  mesh: {
    pattern: "plus",
    wave: "silk",
    spacing: 14,
    markSize: 0.8,
    depth: 0.95,
    light: 0,
    shine: 1,
    contrast: 1.45,
    speed: 0.4,
    scale: 1.1,
    direction: 325,
  },
};

export type Settings = Surface & {
  color: RGBA;
  background: RGBA;
  opacity: number;
  fade: FadeName;
  fadeSize: number;
  interactive: boolean;
  cursorSize: number;
  cursorStrength: number;
  intro: boolean;
  paused: boolean;
};

const PATTERNS: Record<string, number> = { dot: 0, square: 1, plus: 2, line: 3 };
const WAVES: Record<string, number> = { silk: 0, swell: 1, ripple: 2 };
const FADES: Record<string, number> = { none: 0, edges: 1, center: 2, bottom: 3, top: 4 };
const WAVE_UNIT = 520;
const RIPPLE_CELL = 8;
const RIPPLE_RATE = 60;
const PIXEL_BUDGET = 4.5e6;
const INTRO_SECONDS = 2;
// Same cap as the original renderer. A 3x phone renders at 2x and is upscaled, like a browser would.
export const MAX_DPR = 3; // native 3x on iPhone for crisper dots (web original caps at 2)

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const luminance = (rgba: RGBA) => 0.2126 * rgba[0] + 0.7152 * rgba[1] + 0.0722 * rgba[2];

const NAMED_COLORS: Record<string, RGBA> = {
  black: [0, 0, 0, 1],
  white: [1, 1, 1, 1],
  transparent: [0, 0, 0, 0],
};

// Stand-in for the canvas fillStyle trick in the original: hex (#rgb, #rgba, #rrggbb, #rrggbbaa),
// rgb()/rgba() and a few names.
export const parseColor = (value: string, fallback: RGBA): RGBA => {
  if (typeof value !== "string") return fallback;
  const v = value.trim().toLowerCase();
  const named = NAMED_COLORS[v];
  if (named) return [...named] as RGBA;
  if (v.startsWith("#")) {
    let hex = v.slice(1);
    if (!/^[0-9a-f]+$/.test(hex)) return fallback;
    if (hex.length === 3 || hex.length === 4) hex = Array.from(hex, (c) => c + c).join("");
    if (hex.length !== 6 && hex.length !== 8) return fallback;
    const n = parseInt(hex.slice(0, 6), 16);
    const a = hex.length === 8 ? parseInt(hex.slice(6), 16) / 255 : 1;
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, a];
  }
  const fn = v.match(/^rgba?\((.*)\)$/);
  if (!fn) return fallback;
  const parts = fn[1].match(/[\d.]+%?/g);
  if (!parts || parts.length < 3) return fallback;
  const channel = (p: string) => clamp(p.endsWith("%") ? (parseFloat(p) / 100) * 255 : parseFloat(p), 0, 255) / 255;
  const alpha = parts[3] ? (parts[3].endsWith("%") ? parseFloat(parts[3]) / 100 : parseFloat(parts[3])) : 1;
  return [channel(parts[0]), channel(parts[1]), channel(parts[2]), clamp(alpha, 0, 1)];
};

type GL = WebGL2RenderingContext & { endFrameEXP?: () => void };

type Target = { width: number; height: number; texture: WebGLTexture; buffer: WebGLFramebuffer };

type Pass = {
  program: WebGLProgram;
  u: Record<string, WebGLUniformLocation | null>;
};

export type EngineHost = {
  getSettings: () => Settings | null;
  // Device pixel ratio of the screen (window.devicePixelRatio on web).
  pixelRatio: () => number;
  // Make sure the default framebuffer can hold the canvas size and return its real pixel size.
  // Web sets the canvas size like ogl does; native returns the view's drawing buffer size.
  prepareBuffer: (canvasW: number, canvasH: number, width: number, height: number) => [number, number];
};

export type Engine = {
  resize: (width: number, height: number) => void;
  wake: () => void;
  setVisible: (visible: boolean) => void;
  setReducedMotion: (reduced: boolean) => void;
  pointerMove: (x: number, y: number, inside: boolean) => void;
  pointerDown: (x: number, y: number, inside: boolean) => void;
  pointerLeave: () => void;
  rippleSupported: boolean;
  dispose: () => void;
};

export const createEngine = (gl: GL, host: EngineHost): Engine => {
  const HALF_FLOAT = (gl as any).HALF_FLOAT ?? 0x140b;
  const RGBA16F = (gl as any).RGBA16F ?? 0x881a;

  // ogl Program defaults for these meshes: no blending, no depth, cull BACK on a CCW triangle.
  gl.disable(gl.BLEND);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.STENCIL_TEST);
  gl.disable(gl.CULL_FACE);
  gl.depthMask(false);
  gl.clearColor(0, 0, 0, 0);

  // ogl Triangle: one oversized triangle that covers the viewport.
  const triangle = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, triangle);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const shaders: WebGLShader[] = [];
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type) as WebGLShader;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`PatternWaves shader failed to compile: ${log}`);
    }
    shaders.push(shader);
    return shader;
  };

  const vertex = compile(gl.VERTEX_SHADER, passVertex);
  const programs: WebGLProgram[] = [];
  const makePass = (fragment: string, names: string[], samplers: string[] = []): Pass => {
    const program = gl.createProgram() as WebGLProgram;
    gl.attachShader(program, vertex);
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment));
    gl.bindAttribLocation(program, 0, "position");
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`PatternWaves program failed to link: ${gl.getProgramInfoLog(program)}`);
    }
    programs.push(program);
    const u: Pass["u"] = {};
    [...names, ...samplers].forEach((name) => {
      u[name] = gl.getUniformLocation(program, name);
    });
    gl.useProgram(program);
    samplers.forEach((name, unit) => {
      if (u[name]) gl.uniform1i(u[name], unit);
    });
    return { program, u };
  };

  const fieldPass = makePass(
    fieldFragment,
    [
      "uSize",
      "uDpr",
      "uOrigin",
      "uPitch",
      "uWave",
      "uTime",
      "uUnit",
      "uHeading",
      "uAmp",
      "uDepth",
      "uLight",
      "uShine",
      "uContrast",
      "uInk",
      "uOpacity",
      "uFade",
      "uFadeSize",
      "uAppear",
      "uRipple",
    ],
    ["tRipple"],
  );
  const ripplePass = makePass(
    rippleFragment,
    ["uTexel", "uSize", "uFrom", "uTo", "uRadius", "uImpulse", "uDamping"],
    ["tState"],
  );
  const markPass = makePass(
    markFragment,
    ["uOrigin", "uPitch", "uGrid", "uPattern", "uMarkSize", "uStroke", "uColor", "uAccent", "uBackground", "uAtlas"],
    ["tField", "tAtlas"],
  );
  const presentPass = makePass(presentFragment, ["uViewport"], ["tCanvas"]);

  // ogl uploads a 1x1 transparent pixel for a Texture with no image.
  const textures: WebGLTexture[] = [];
  const blank = gl.createTexture() as WebGLTexture;
  gl.bindTexture(gl.TEXTURE_2D, blank);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  textures.push(blank);

  // Uniforms that never change. uDamping keeps the original default; the glyph atlas is unused.
  gl.useProgram(ripplePass.program);
  if (ripplePass.u.uDamping) gl.uniform1f(ripplePass.u.uDamping, 0.975);
  gl.useProgram(markPass.program);
  if (markPass.u.uAtlas) gl.uniform3f(markPass.u.uAtlas, 1, 1, 0);

  const makeTarget = (
    w: number,
    h: number,
    filter: number,
    internalFormat: number = gl.RGBA,
    type: number = gl.UNSIGNED_BYTE,
  ): Target => {
    const texture = gl.createTexture() as WebGLTexture;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, gl.RGBA, type, null);
    const buffer = gl.createFramebuffer() as WebGLFramebuffer;
    gl.bindFramebuffer(gl.FRAMEBUFFER, buffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { width: w, height: h, texture, buffer };
  };

  const dispose = (target: Target) => {
    gl.deleteFramebuffer(target.buffer);
    gl.deleteTexture(target.texture);
  };

  const fieldTargetFor = (w: number, h: number) => makeTarget(w, h, gl.NEAREST);
  const rippleTargetFor = (w: number, h: number) => makeTarget(w, h, gl.LINEAR, RGBA16F, HALF_FLOAT);

  // The original checks EXT_color_buffer_float. expo-gl on iOS reports the GLES extension list, which
  // usually has EXT_color_buffer_half_float instead, so ask for both (this also enables them on web)
  // and trust the framebuffer completeness check.
  gl.getExtension("EXT_color_buffer_float");
  gl.getExtension("EXT_color_buffer_half_float");
  const floatTargets = (() => {
    try {
      const probe = rippleTargetFor(4, 4);
      gl.bindFramebuffer(gl.FRAMEBUFFER, probe.buffer);
      const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      dispose(probe);
      return complete;
    } catch {
      return false;
    }
  })();

  let fieldTarget = fieldTargetFor(1, 1);
  let canvasTarget: Target | null = null;
  let ripple: { width: number; height: number; read: Target; write: Target } | null = null;

  const bindTarget = (target: Target | null, w: number, h: number) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.buffer : null);
    gl.viewport(0, 0, w, h);
  };

  const drawPass = (pass: Pass) => {
    gl.useProgram(pass.program);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  const bindTexture = (unit: number, texture: WebGLTexture) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
  };

  let reducedMotion = false;
  let layoutW = 0;
  let layoutH = 0;
  let width = 1;
  let height = 1;
  let canvasW = 1;
  let canvasH = 1;
  let raf = 0;
  let last = performance.now();
  let time = 0;
  let introClock = 0;
  let visible = true;
  let alive = true;
  let dirty = true;
  let rippleUntil = 0;
  let rippleLive = false;
  let rippleClock = 0;
  const pointer = { x: 0, y: 0, inside: false, placed: false, lastX: 0, lastY: 0, burst: 0 };

  const buildRipple = () => {
    if (!floatTargets) return;
    const w = clamp(Math.ceil(width / RIPPLE_CELL), 4, 512);
    const h = clamp(Math.ceil(height / RIPPLE_CELL), 4, 512);
    if (ripple && ripple.width === w && ripple.height === h) return;
    if (ripple) {
      dispose(ripple.read);
      dispose(ripple.write);
    }
    ripple = { width: w, height: h, read: rippleTargetFor(w, h), write: rippleTargetFor(w, h) };
    // Fresh textures hold undefined data on some drivers; the original relies on zeroed memory.
    [ripple.read, ripple.write].forEach((target) => {
      bindTarget(target, target.width, target.height);
      gl.clear(gl.COLOR_BUFFER_BIT);
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    rippleLive = false;
  };

  const clearRipple = () => {
    if (!ripple) return;
    [ripple.read, ripple.write].forEach((target) => {
      bindTarget(target, target.width, target.height);
      gl.clear(gl.COLOR_BUFFER_BIT);
    });
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  };

  let resizePending = false;
  const applyResize = () => {
    width = Math.max(1, layoutW);
    height = Math.max(1, layoutH);
    const dpr = Math.min(host.pixelRatio() || 1, MAX_DPR, Math.sqrt(PIXEL_BUDGET / (width * height)));
    // canvas.width = width * dpr truncates in the browser.
    canvasW = Math.max(1, Math.floor(width * dpr));
    canvasH = Math.max(1, Math.floor(height * dpr));
    buildRipple();
    dirty = true;
  };

  const stepRipple = (field: NonNullable<typeof ripple>, s: Settings, dt: number) => {
    rippleClock = Math.min(rippleClock + dt * RIPPLE_RATE, 4);
    const strength = clamp(s.cursorStrength, 0, 1);
    const moved = Math.hypot(pointer.x - pointer.lastX, pointer.y - pointer.lastY);
    let impulse = (pointer.inside ? Math.min(moved / 14, 1) * 0.35 * strength : 0) + pointer.burst * strength;
    pointer.burst = 0;
    const u = ripplePass.u;
    gl.useProgram(ripplePass.program);
    gl.uniform2f(u.uTexel, 1 / field.width, 1 / field.height);
    gl.uniform2f(u.uSize, width, height);
    gl.uniform2f(u.uFrom, pointer.lastX, height - pointer.lastY);
    gl.uniform2f(u.uTo, pointer.x, height - pointer.y);
    gl.uniform1f(u.uRadius, clamp(s.cursorSize, 8, 400));
    while (rippleClock >= 1) {
      rippleClock -= 1;
      bindTexture(0, field.read.texture);
      gl.useProgram(ripplePass.program);
      gl.uniform1f(u.uImpulse, impulse);
      bindTarget(field.write, field.width, field.height);
      drawPass(ripplePass);
      const next = field.read;
      field.read = field.write;
      field.write = next;
      impulse = 0;
    }
    pointer.lastX = pointer.x;
    pointer.lastY = pointer.y;
  };

  const frame = () => {
    raf = 0;
    const now = performance.now();
    if (!alive) return;
    if (resizePending) {
      resizePending = false;
      applyResize();
    }
    const s = host.getSettings();
    const dt = Math.min(0.05, Math.max(1 / 240, (now - last) / 1000));
    last = now;
    if (!s || layoutW <= 0 || layoutH <= 0) return;

    const moving = !s.paused && !reducedMotion && s.speed !== 0;
    if (moving) time += dt * s.speed;
    introClock = s.intro && !reducedMotion ? Math.min(1, introClock + dt / INTRO_SECONDS) : 1;
    const appear = 1 - Math.pow(1 - clamp(introClock / 0.75, 0, 1), 3);
    const rise = clamp((introClock - 0.1) / 0.9, 0, 1);
    const amp = rise * rise * (3 - 2 * rise);

    const rippling = s.interactive && !reducedMotion && !!ripple && s.cursorStrength > 0;
    if (rippling && pointer.inside && !pointer.placed) {
      pointer.lastX = pointer.x;
      pointer.lastY = pointer.y;
      pointer.placed = true;
    }
    if (rippling && (pointer.inside || pointer.burst > 0)) rippleUntil = now + 5000;
    const rippleActive = rippling && now < rippleUntil;
    if (rippleActive && ripple) {
      stepRipple(ripple, s, dt);
      rippleLive = true;
    } else if (rippleLive) {
      clearRipple();
      rippleLive = false;
    }

    const patternIndex = PATTERNS[s.pattern] ?? 0;

    const [bufferW, bufferH] = host.prepareBuffer(canvasW, canvasH, width, height);
    const direct = bufferW === canvasW && bufferH === canvasH;
    if (!direct && (!canvasTarget || canvasTarget.width !== canvasW || canvasTarget.height !== canvasH)) {
      if (canvasTarget) dispose(canvasTarget);
      canvasTarget = makeTarget(canvasW, canvasH, gl.LINEAR);
    }

    const dpr = canvasW / width;
    const pitchY = Math.max(4, Math.round(clamp(s.spacing, 4, 120) * dpr));
    const pitchX = patternIndex === 3 ? Math.max(2, Math.round(pitchY / 4)) : pitchY;
    const cols = Math.min(4096, Math.ceil(canvasW / pitchX) + 1);
    const rows = Math.min(4096, Math.ceil(canvasH / pitchY) + 2);
    const origin = [Math.floor((canvasW - cols * pitchX) / 2), Math.floor((canvasH - rows * pitchY) / 2)];
    if (fieldTarget.width !== cols || fieldTarget.height !== rows) {
      dispose(fieldTarget);
      fieldTarget = fieldTargetFor(cols, rows);
    }
    const heading = (s.direction * Math.PI) / 180;
    const lightAngle = ((s.direction + 180 + clamp(s.light, -90, 90)) * Math.PI) / 180;
    const background = s.background;
    const ink = background[3] > 0.02 ? luminance(s.color) < luminance(background) : luminance(s.color) < 0.5;

    // Field pass: one texel per mark, cleared then drawn (renderer.render with autoClear).
    const fu = fieldPass.u;
    gl.useProgram(fieldPass.program);
    gl.uniform2f(fu.uSize, width, height);
    gl.uniform1f(fu.uDpr, dpr);
    gl.uniform2f(fu.uOrigin, origin[0], origin[1]);
    gl.uniform2f(fu.uPitch, pitchX, pitchY);
    gl.uniform1i(fu.uWave, WAVES[s.wave] ?? 0);
    gl.uniform1f(fu.uTime, time);
    gl.uniform1f(fu.uUnit, WAVE_UNIT * clamp(s.scale, 0.2, 5));
    gl.uniform2f(fu.uHeading, Math.cos(heading), Math.sin(heading));
    gl.uniform1f(fu.uAmp, amp);
    gl.uniform1f(fu.uDepth, clamp(s.depth, 0, 1.5));
    gl.uniform3f(fu.uLight, Math.cos(lightAngle) * 0.78, Math.sin(lightAngle) * 0.78, 0.62);
    gl.uniform1f(fu.uShine, clamp(s.shine, 0, 2));
    gl.uniform1f(fu.uContrast, clamp(s.contrast, 0.3, 3));
    gl.uniform1f(fu.uInk, ink ? 1 : 0);
    gl.uniform1f(fu.uOpacity, clamp(s.opacity, 0, 1));
    gl.uniform1i(fu.uFade, FADES[s.fade] ?? 0);
    gl.uniform1f(fu.uFadeSize, clamp(s.fadeSize, 0.05, 1));
    gl.uniform1f(fu.uAppear, appear);
    gl.uniform1f(fu.uRipple, rippleLive ? 0.32 : 0);
    bindTexture(0, ripple && rippleLive ? ripple.read.texture : blank);
    bindTarget(fieldTarget, cols, rows);
    gl.clear(gl.COLOR_BUFFER_BIT);
    drawPass(fieldPass);

    // Mark pass: straight into the canvas when the drawing buffer is canvas sized, otherwise into a
    // canvas sized target that the present pass stretches over the drawing buffer.
    const mu = markPass.u;
    gl.useProgram(markPass.program);
    gl.uniform2f(mu.uOrigin, origin[0], origin[1]);
    gl.uniform2f(mu.uPitch, pitchX, pitchY);
    gl.uniform2f(mu.uGrid, cols, rows);
    gl.uniform1i(mu.uPattern, patternIndex);
    gl.uniform1f(mu.uMarkSize, clamp(s.markSize, 0.05, 1));
    gl.uniform1f(mu.uStroke, patternIndex === 3 ? 0.9 * dpr : Math.max(1.1 * dpr, pitchY * 0.08));
    const tint = ink ? 0 : 1;
    const blend = ink ? 0.35 : 0.55;
    const [r, g, b] = s.color;
    gl.uniform3f(mu.uColor, r, g, b);
    gl.uniform3f(mu.uAccent, r + (tint - r) * blend, g + (tint - g) * blend, b + (tint - b) * blend);
    gl.uniform4f(mu.uBackground, background[0], background[1], background[2], background[3]);
    bindTexture(0, fieldTarget.texture);
    bindTexture(1, blank);
    bindTarget(direct ? null : canvasTarget, canvasW, canvasH);
    gl.clear(gl.COLOR_BUFFER_BIT);
    drawPass(markPass);

    if (!direct && canvasTarget) {
      gl.useProgram(presentPass.program);
      gl.uniform2f(presentPass.u.uViewport, bufferW, bufferH);
      bindTexture(0, canvasTarget.texture);
      bindTarget(null, bufferW, bufferH);
      gl.clear(gl.COLOR_BUFFER_BIT);
      drawPass(presentPass);
    }
    gl.endFrameEXP?.();
    dirty = false;

    if (visible && (moving || introClock < 1 || rippleActive || dirty)) raf = requestAnimationFrame(frame);
  };

  const start = () => {
    if (raf || !visible || !alive) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  };

  return {
    rippleSupported: floatTargets,
    resize: (w, h) => {
      layoutW = w;
      layoutH = h;
      resizePending = true;
      start();
    },
    wake: () => {
      dirty = true;
      start();
    },
    setVisible: (next) => {
      visible = next;
      if (!visible && raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
      start();
    },
    setReducedMotion: (reduced) => {
      reducedMotion = reduced;
      dirty = true;
      start();
    },
    pointerMove: (x, y, inside) => {
      pointer.x = x;
      pointer.y = y;
      if (inside !== pointer.inside) pointer.placed = false;
      pointer.inside = inside;
      if (inside) start();
    },
    pointerDown: (x, y, inside) => {
      if (!inside) return;
      pointer.x = x;
      pointer.y = y;
      if (!pointer.inside) {
        pointer.lastX = x;
        pointer.lastY = y;
      }
      pointer.burst = 1.2;
      start();
    },
    pointerLeave: () => {
      pointer.inside = false;
      pointer.placed = false;
      start();
    },
    dispose: () => {
      alive = false;
      visible = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      try {
        if (ripple) {
          dispose(ripple.read);
          dispose(ripple.write);
        }
        if (canvasTarget) dispose(canvasTarget);
        dispose(fieldTarget);
        textures.forEach((texture) => gl.deleteTexture(texture));
        programs.forEach((program) => gl.deleteProgram(program));
        shaders.forEach((shader) => gl.deleteShader(shader));
        gl.deleteBuffer(triangle);
        gl.endFrameEXP?.();
      } catch {
        // The context can already be gone when the view unmounts first.
      }
    },
  };
};
