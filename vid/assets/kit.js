/*
 * ycyc film kit. Ported from the Davey launch film kit (~/dev/nautshow1/launch/assets/kit.js), re-tuned to the
 * app's own motion tokens (~/dev/ycyc/src/theme/tokens.ts + motion.ts). Every helper adds tweens to a scene
 * timeline, so all motion stays a function of timeline time (HyperFrames seeks it frame by frame).
 * Text timings are the reference teardowns' (research/reference-video.md, reference-2.md): 9-frame word reveals,
 * 2 frames per typed character, 30 cps smear typing.
 */
(function () {
  const F = 1 / 30;

  // A damped spring as a GSAP ease, settled at progress 1. zeta < 1 overshoots.
  function springEase(zeta, omega) {
    const wd = omega * Math.sqrt(Math.max(1e-6, 1 - zeta * zeta));
    const settle = 4.6 / (zeta * omega);
    return (p) => {
      if (p >= 1) return 1;
      const t = p * settle;
      return 1 - Math.exp(-zeta * omega * t) * (Math.cos(wd * t) + ((zeta * omega) / wd) * Math.sin(wd * t));
    };
  }
  // The app's reanimated springs ({damping c, stiffness k, mass m}) as GSAP eases + the duration they settle in.
  // omega = sqrt(k/m), zeta = c / (2 sqrt(k m)). Use: tl.to(el, { y: 0, ease: KIT.springs.enter.ease, duration: KIT.springs.enter.dur }, t)
  const APP_SPRINGS = {
    press: { damping: 26, stiffness: 420, mass: 0.6 },
    release: { damping: 20, stiffness: 260, mass: 0.7 },
    enter: { damping: 22, stiffness: 170, mass: 1 },
    layout: { damping: 24, stiffness: 200, mass: 1 },
    pop: { damping: 18, stiffness: 180, mass: 0.8 },
    sheet: { damping: 30, stiffness: 300, mass: 1 },
    flip: { damping: 20, stiffness: 140, mass: 1 }, // AppTile 3D flip when a connection goes live
    ring: { damping: 26, stiffness: 90, mass: 1 }, // ProgressRing fill
  };
  const springs = {};
  for (const [k, { damping, stiffness, mass }] of Object.entries(APP_SPRINGS)) {
    const omega = Math.sqrt(stiffness / mass), zeta = damping / (2 * Math.sqrt(stiffness * mass));
    springs[k] = { ease: springEase(zeta, omega), dur: 4.6 / (zeta * omega), zeta, omega };
  }

  // The app's curves: easeEnter = bezier(0.16, 1, 0.3, 1) (Reveal, 600ms), easeFill = out cubic (fills, counters).
  if (window.CustomEase) gsap.registerPlugin(CustomEase);
  const ease = {
    enter: window.CustomEase ? CustomEase.create("ycEnter", "M0,0 C0.16,1 0.3,1 1,1") : "expo.out",
    fill: "power3.out",
  };
  // App timings in seconds (motion tokens): fade 280ms, stagger 55ms, press scale 0.97, Reveal 600ms rising 12pt.
  const T = { fade: 0.28, fadeOut: 0.2, stagger: 0.055, pressScale: 0.97, reveal: 0.6, revealY: 12 };

  const split = (el) => {
    if (!el.dataset.split) {
      el.innerHTML = el.textContent.trim().split(/\s+/).map((w) => `<span class="k-w">${w}</span>`).join(" ");
      el.dataset.split = "1";
    }
    return [...el.querySelectorAll(".k-w")];
  };

  const KIT = {
    F, springs, ease, T, springEase,

    // Word reveal: each word blurs 10px -> 0 and .4 -> 1 opacity over 9 frames, next word +10 frames.
    // `span` fits all reveals into a duration. `from` is the colour a word enters in (ycyc is monochrome: grey -> ink).
    words(tl, el, at, { gap = 10 * F, dur = 9 * F, span = null, from = "#6b6b6b" } = {}) {
      const ws = split(el);
      const step = span ? Math.max(2 * F, (span - dur) / Math.max(1, ws.length - 1)) : gap;
      const ink = getComputedStyle(el).color;
      gsap.set(ws, { opacity: 0 });
      ws.forEach((w, i) =>
        tl.fromTo(w, { opacity: 0.4, filter: "blur(10px)", color: from },
          { opacity: 1, filter: "blur(0px)", color: ink, duration: dur, ease: "power3.out", immediateRender: false }, at + i * step));
      return at + (ws.length - 1) * step + dur;
    },

    // Voice-locked word build: each word enters dim + blurred on its onset, then settles. `onsets` = scene times
    // per word (from timing.json / whisper), else spread across [at, end].
    vo(tl, el, at, end, { onsets = null, from = "#6b6b6b" } = {}) {
      const ws = split(el);
      const ink = getComputedStyle(el).color;
      gsap.set(ws, { opacity: 0 });
      ws.forEach((w, i) => {
        const t = onsets ? onsets[i] : at + ((end - at - 0.3) * i) / Math.max(1, ws.length - 1);
        tl.fromTo(w, { opacity: 0, filter: "blur(6px)", x: 10, color: from }, { opacity: 0.45, filter: "blur(2px)", x: 0, duration: 0.12, ease: "power2.out", immediateRender: false }, t - 0.08);
        tl.fromTo(w, { opacity: 0.45, filter: "blur(2px)" }, { opacity: 1, filter: "blur(0px)", color: ink, duration: 0.4, ease: "power3.out", immediateRender: false }, t + 0.04);
      });
    },

    // The app's Reveal: fade up 12px over 600ms on easeEnter. Pass a list for the 55ms stagger.
    reveal(tl, els, at, { y = T.revealY, dur = T.reveal, stagger = T.stagger } = {}) {
      gsap.set(els, { opacity: 0, y });
      tl.fromTo(els, { opacity: 0, y }, { opacity: 1, y: 0, duration: dur, ease: ease.enter, stagger, immediateRender: false }, at);
    },

    // Typing at 2 frames per character with a caret (`<!-- sfx: name=type-micro -->` adds the keys).
    type(tl, el, at, { perChar = 2 * F, caret = true } = {}) {
      const text = el.dataset.text || el.textContent;
      el.dataset.text = text;
      el.textContent = "";
      const state = { n: 0 };
      const render = () => { el.textContent = text.slice(0, Math.round(state.n)); el.classList.toggle("k-caret", caret && state.n < text.length); };
      tl.fromTo(state, { n: 0 }, { n: text.length, duration: text.length * perChar, ease: "none", onUpdate: render, immediateRender: false }, at);
      render();
      return at + text.length * perChar;
    },

    // Typewriter with smear: 30 cps, newest 3 characters dim + blurred, resolving when typing ends.
    smear(tl, el, at, { cps = 30 } = {}) {
      const text = el.dataset.text || el.textContent;
      el.dataset.text = text;
      const state = { n: 0 };
      const render = () => {
        const n = Math.round(state.n), solid = n >= text.length ? n : Math.max(0, n - 3);
        el.innerHTML = text.slice(0, solid) + `<span style="opacity:.4;filter:blur(1.5px)">${text.slice(solid, n)}</span>` + (n < text.length ? '<span class="k-caret"></span>' : "");
      };
      tl.fromTo(state, { n: 0 }, { n: text.length, duration: text.length / cps, ease: "none", onUpdate: render, immediateRender: false }, at);
      render();
      return at + text.length / cps;
    },

    // Number tween like the app's TweenNumber (500ms out-cubic, tabular figures).
    count(tl, el, at, to, { from = 0, dur = 0.5, fmt = (v) => Math.round(v).toLocaleString("en-US") } = {}) {
      const st = { v: from };
      const draw = () => { el.textContent = fmt(st.v); };
      tl.fromTo(st, { v: from }, { v: to, duration: dur, ease: ease.fill, onUpdate: draw, immediateRender: false }, at);
      draw();
    },

    // Constant camera life: a slow 3-6% scale drift over a hold.
    drift(tl, el, at, dur, { from = 1, to = 1.045, origin = "50% 50%" } = {}) {
      tl.fromTo(el, { scale: from, transformOrigin: origin }, { scale: to, duration: dur, ease: "none", immediateRender: false }, at);
    },

    // Detail-to-whole pull-back: the whole UI scales from ~220% (centred on a detail) to 100%.
    pullback(tl, el, at, { from = 2.2, dur = 22 * F, origin = "50% 50%" } = {}) {
      tl.fromTo(el, { scale: from, transformOrigin: origin }, { scale: 1, duration: dur, ease: "power4.out", immediateRender: false }, at);
    },

    // Morph through bloom: A blooms out, B un-blooms in.
    bloomSwap(tl, a, b, at) {
      tl.fromTo(a, { filter: "brightness(1) blur(0px)", opacity: 1 }, { filter: "brightness(3) blur(10px)", opacity: 0, duration: 0.22, ease: "power2.in", immediateRender: false }, at);
      tl.fromTo(b, { filter: "brightness(3) blur(10px)", opacity: 0 }, { filter: "brightness(1) blur(0px)", opacity: 1, duration: 0.36, ease: "power3.out", immediateRender: false }, at + 0.16);
    },

    // Feathered diagonal mask wipe: `inEl` (stacked above the outgoing layer) is revealed edge to edge.
    // `glowEl` (optional, .k-wipe-glow sibling above both) rides the leading edge as a soft white light band.
    wipe(tl, inEl, at, { dur = 0.75, angle = 112, feather = 26, glowEl = null, ease: e = "power3.inOut", reverse = false } = {}) {
      const st = { p: 0 };
      const span = 100 + feather * 2;
      const draw = () => {
        const edge = -feather + st.p * span;
        const a = reverse ? angle + 180 : angle;
        const m = `linear-gradient(${a}deg, #000 ${edge - feather / 2}%, transparent ${edge + feather / 2}%)`;
        inEl.style.maskImage = m;
        inEl.style.webkitMaskImage = m;
        if (glowEl) {
          glowEl.style.background = `linear-gradient(${a}deg, transparent ${edge - feather}%, rgb(255 255 255 / 0) ${edge - feather * 0.8}%, rgb(255 255 255 / 0.55) ${edge - feather * 0.2}%, rgb(255 255 255 / 0.85) ${edge}%, transparent ${edge + feather * 0.6}%)`;
          glowEl.style.opacity = st.p <= 0 || st.p >= 1 ? 0 : 1;
        }
      };
      tl.fromTo(st, { p: 0 }, { p: 1, duration: dur, ease: e, onUpdate: draw, immediateRender: false }, at);
      tl.call(() => { st.p = 0; draw(); }, null, Math.max(0, at - 1 / 600));
      tl.call(() => { st.p = 1; draw(); inEl.style.maskImage = inEl.style.webkitMaskImage = "none"; }, null, at + dur);
      st.p = 0; draw();
      return at + dur;
    },

    // The ycyc onboarding shader (PatternWaves silk: white dots on black, edge fade, 2s intro) as a seekable layer.
    // Markup: <canvas id="..." class="k-waves"></canvas> inside a sized box. Shader time = offset + (t - from).
    // opts pass through to PatternWaves (preset, color, background, speed, direction, fade, intro, dpr, ...).
    // Load assets/pattern-waves.js in the scene (or root) first.
    waves(tl, canvas, { from = 0, to = 10, offset = 0, width = 1920, height = 1080, dpr = 1.5, ...opts } = {}) {
      if (!window.PatternWaves) { console.warn("KIT.waves: load assets/pattern-waves.js"); return null; }
      const pw = PatternWaves.create(canvas, { width, height, dpr, ...opts });
      const clk = { t: from };
      tl.fromTo(clk, { t: from }, { t: to, duration: to - from, ease: "none", immediateRender: false, onUpdate: () => pw.renderAt(offset + clk.t - from) }, from);
      pw.renderAt(offset);
      return pw;
    },

    // An app Lordicon (assets/lordicons/icons.js), deterministic: resting frame until `at`, plays its motion once
    // from `at`, then holds the end. at = null: static resting icon (cheap, no seeking).
    // `tint` recolours the baked-white strokes (e.g. "#000" on a white tile).
    icon(tl, el, name, { at = null, speed = 1, tint = null } = {}) {
      const def = window.YC_ICONS && window.YC_ICONS[name];
      if (!def || !window.lottie) { console.warn("KIT.icon: missing", name); return; }
      const anim = lottie.loadAnimation({ container: el, renderer: "svg", loop: false, autoplay: false, animationData: JSON.parse(JSON.stringify(def.data)) });
      const [a, b] = def.seg, len = (b - a) / def.fr / speed;
      const frameAt = (t) => (at == null || t < at ? a : t >= at + len ? b - 1 : a + (t - at) * def.fr * speed);
      const go = anim.goToAndStop.bind(anim);
      anim.goToAndStop = (v, isFrame) => go(isFrame ? v : frameAt(v / 1000), true);
      go(frameAt(0), true);
      anim.addEventListener("DOMLoaded", () => go(frameAt(0), true)); // first seek can land before lottie builds its DOM
      if (tint) el.style.setProperty("--k-icon-tint", tint), el.classList.add("k-tint");
      if (at == null) { const svg = el.innerHTML; anim.destroy(); el.innerHTML = svg; return; }
      const clk = { t: at };
      tl.fromTo(clk, { t: at }, { t: at + len, duration: len, ease: "none", immediateRender: false, onUpdate: () => go(frameAt(clk.t), true) }, at);
    },

    // The app's press: scale to 0.97 on the press spring, release on the release spring. Pair with a ui-confirm cue.
    press(tl, el, at, { hold = 0.12 } = {}) {
      tl.to(el, { scale: T.pressScale, duration: springs.press.dur * 0.6, ease: springs.press.ease }, at);
      tl.to(el, { scale: 1, duration: springs.release.dur, ease: springs.release.ease }, at + hold);
    },
  };
  window.KIT = KIT;
})();
