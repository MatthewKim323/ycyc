// PatternWaves for React Native (expo-gl). Port of the React Bits web component with the same props,
// minus className and characters (the glyph pattern and the "terminal" preset are not ported).
//
//   <PatternWaves preset="silk" color="#ffffff" backgroundColor="#000000" fade="edges" style={StyleSheet.absoluteFill} />
//
// Children render on top of the field. Touches anywhere inside the component (children included)
// drive the ripple, the way the original listens on window.

import { GLView } from "expo-gl";
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { useIsFocused } from "expo-router";
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  AppState,
  type GestureResponderEvent,
  type HostInstance,
  Image,
  type LayoutChangeEvent,
  PixelRatio,
  Platform,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from "react-native";

import {
  createEngine,
  type Engine,
  type FadeName,
  parseColor,
  type PatternName,
  type PresetName,
  type Settings,
  SURFACE_PRESETS,
  type WaveName,
} from "./engine";

export type { FadeName, PatternName, PresetName, WaveName } from "./engine";

export type PatternWavesProps = {
  preset?: PresetName;
  pattern?: PatternName;
  wave?: WaveName;
  spacing?: number;
  markSize?: number;
  depth?: number;
  light?: number;
  shine?: number;
  contrast?: number;
  speed?: number;
  scale?: number;
  direction?: number;
  color?: string;
  backgroundColor?: string;
  opacity?: number;
  fade?: FadeName;
  fadeSize?: number;
  interactive?: boolean;
  cursorSize?: number;
  cursorStrength?: number;
  intro?: boolean;
  paused?: boolean;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
};

const isWeb = Platform.OS === "web";

// Matches ogl's Renderer({ alpha: true, premultipliedAlpha: true, antialias: false, depth: false }).
const WEB_CONTEXT_ATTRIBUTES = {
  alpha: true,
  premultipliedAlpha: true,
  antialias: false,
  depth: false,
  stencil: false,
  preserveDrawingBuffer: false,
};

// useIsFocused throws outside a navigator; treat that as always focused.
const useFocusedSafe = () => {
  try {
    return useIsFocused();
  } catch {
    return true;
  }
};

const PatternWaves = ({
  preset = "silk",
  pattern,
  wave,
  spacing,
  markSize,
  depth,
  light,
  shine,
  contrast,
  speed,
  scale,
  direction,
  color = "#ffffff",
  backgroundColor = "#000000",
  opacity = 1,
  fade = "edges",
  fadeSize = 0.5,
  interactive = true,
  cursorSize = 50,
  cursorStrength = 0.6,
  intro = true,
  paused = false,
  style,
  children,
}: PatternWavesProps) => {
  const containerRef = useRef<HostInstance>(null);
  const engineRef = useRef<Engine | null>(null);
  const settingsRef = useRef<Settings | null>(null);
  const sizeRef = useRef({ width: 0, height: 0 });
  const offsetRef = useRef({ x: 0, y: 0 });
  const visibleRef = useRef(true);
  const reducedRef = useRef(false);
  const aliveRef = useRef(false);
  const [appActive, setAppActive] = useState(AppState.currentState !== "background");
  // If GL never presents a frame (no ES3 context, shader rejected), show the same silk frame as a still.
  const drawnRef = useRef(false);
  // iOS simulators (and some devices) present expo-gl frames black; native uses the pre-rendered silk still.
  const [fallback, setFallback] = useState(!isWeb && !NATIVE_GL);
  useEffect(() => {
    if (isWeb) return undefined;
    const t = setTimeout(() => {
      if (!drawnRef.current) setFallback(true);
    }, 1500);
    return () => clearTimeout(t);
  }, []);
  const focused = useFocusedSafe();

  const base = SURFACE_PRESETS[preset] || SURFACE_PRESETS.silk;
  const pick = <K extends keyof typeof base>(value: (typeof base)[K] | undefined | null, key: K) =>
    value === undefined || value === null ? base[key] : value;

  const colors = useMemo(
    () => ({
      color: parseColor(color, [1, 1, 1, 1]),
      background: parseColor(backgroundColor, [0, 0, 0, 1]),
    }),
    [color, backgroundColor],
  );

  useEffect(() => {
    settingsRef.current = {
      ...colors,
      pattern: pick(pattern, "pattern"),
      wave: pick(wave, "wave"),
      spacing: pick(spacing, "spacing"),
      markSize: pick(markSize, "markSize"),
      depth: pick(depth, "depth"),
      light: pick(light, "light"),
      shine: pick(shine, "shine"),
      contrast: pick(contrast, "contrast"),
      speed: pick(speed, "speed"),
      scale: pick(scale, "scale"),
      direction: pick(direction, "direction"),
      opacity,
      fade,
      fadeSize,
      interactive,
      cursorSize,
      cursorStrength,
      intro,
      paused,
    };
    engineRef.current?.wake();
  });

  // Mount flag plus GL teardown. A layout effect so it runs before GLView drops its context.
  useLayoutEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
      engineRef.current?.dispose();
      engineRef.current = null;
    };
  }, []);

  // Stop the loop when the screen loses focus or the app leaves the foreground.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => setAppActive(state === "active"));
    return () => sub.remove();
  }, []);

  useEffect(() => {
    visibleRef.current = focused && appActive;
    engineRef.current?.setVisible(visibleRef.current);
  }, [focused, appActive]);

  useEffect(() => {
    let live = true;
    const apply = (reduced: boolean) => {
      reducedRef.current = reduced;
      engineRef.current?.setReducedMotion(reduced);
    };
    AccessibilityInfo.isReduceMotionEnabled()
      .then((reduced) => live && apply(reduced))
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", apply);
    return () => {
      live = false;
      sub.remove();
    };
  }, []);

  const onContextCreate = (gl: WebGL2RenderingContext) => {
    if (!aliveRef.current || engineRef.current) return;
    let canvasObserver: MutationObserver | null = null;
    try {
      const engine = createEngine(gl, {
        getSettings: () => settingsRef.current,
        pixelRatio: () => PixelRatio.get(),
        onProbe: (max) => {
          console.warn(`[pattern-waves] probe max=${max}`);
          if (!isWeb && max >= 0 && max < 12) setFallback(true);
        },
        onFrame: () => {
          if (drawnRef.current) return;
          drawnRef.current = true;
          setFallback(false);
        },
        prepareBuffer: (canvasW, canvasH, width, height) => {
          if (isWeb) {
            // Same as ogl's renderer.setSize: the canvas holds canvasW x canvasH, CSS stretches it.
            const canvas = gl.canvas as HTMLCanvasElement;
            if (canvas.width !== canvasW) canvas.width = canvasW;
            if (canvas.height !== canvasH) canvas.height = canvasH;
            return [canvas.width, canvas.height];
          }
          const ratio = PixelRatio.get();
          return [Math.round(width * ratio), Math.round(height * ratio)];
        },
      });
      engine.setReducedMotion(reducedRef.current);
      engine.setVisible(visibleRef.current);
      if (isWeb && typeof MutationObserver !== "undefined") {
        // expo-gl's web canvas resets its size on layout, which wipes the bitmap. Redraw when it does.
        canvasObserver = new MutationObserver(() => engine.wake());
        canvasObserver.observe(gl.canvas as HTMLCanvasElement, {
          attributes: true,
          attributeFilter: ["width", "height"],
        });
        const dispose = engine.dispose;
        engine.dispose = () => {
          canvasObserver?.disconnect();
          dispose();
        };
      }
      engineRef.current = engine;
      const { width, height } = sizeRef.current;
      if (width > 0 && height > 0) engine.resize(width, height);
    } catch (error) {
      canvasObserver?.disconnect();
      console.warn("[pattern-waves] GL init failed", error);
      setFallback(true);
    }
  };

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    sizeRef.current = { width, height };
    engineRef.current?.resize(width, height);
    containerRef.current?.measureInWindow((x, y) => {
      offsetRef.current = { x, y };
    });
  };

  // Web: the original's window listeners, unchanged.
  useEffect(() => {
    if (!isWeb || typeof window === "undefined") return undefined;
    const node = containerRef.current as unknown as HTMLElement | null;
    if (!node || typeof node.getBoundingClientRect !== "function") return undefined;

    const locate = (e: PointerEvent) => {
      const rect = node.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      return { x, y, inside: x >= 0 && y >= 0 && x <= rect.width && y <= rect.height };
    };
    const onPointerMove = (e: PointerEvent) => {
      const spot = locate(e);
      engineRef.current?.pointerMove(spot.x, spot.y, spot.inside);
    };
    const onPointerDown = (e: PointerEvent) => {
      const spot = locate(e);
      engineRef.current?.pointerDown(spot.x, spot.y, spot.inside);
    };
    const onPointerLeave = () => engineRef.current?.pointerLeave();
    const onPointerOut = (e: PointerEvent) => {
      if (!e.relatedTarget) onPointerLeave();
    };
    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerType === "touch") onPointerLeave();
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerdown", onPointerDown, { passive: true });
    window.addEventListener("pointerout", onPointerOut, { passive: true });
    window.addEventListener("pointerup", onPointerUp, { passive: true });
    window.addEventListener("blur", onPointerLeave);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointerout", onPointerOut);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("blur", onPointerLeave);
    };
  }, []);

  // Native: raw touch events bubble from any child without joining the responder system, so
  // buttons on top keep working. Touch down = pointerdown (burst), move = pointermove, up = leave.
  const locateTouch = (event: GestureResponderEvent) => {
    const { pageX, pageY } = event.nativeEvent;
    const { width, height } = sizeRef.current;
    const x = pageX - offsetRef.current.x;
    const y = pageY - offsetRef.current.y;
    return { x, y, inside: x >= 0 && y >= 0 && x <= width && y <= height };
  };
  const touchHandlers = isWeb
    ? {}
    : {
        onTouchStart: (event: GestureResponderEvent) => {
          containerRef.current?.measureInWindow((x, y) => {
            offsetRef.current = { x, y };
          });
          const spot = locateTouch(event);
          engineRef.current?.pointerDown(spot.x, spot.y, spot.inside);
        },
        onTouchMove: (event: GestureResponderEvent) => {
          const spot = locateTouch(event);
          engineRef.current?.pointerMove(spot.x, spot.y, spot.inside);
        },
        onTouchEnd: () => engineRef.current?.pointerLeave(),
        onTouchCancel: () => engineRef.current?.pointerLeave(),
      };

  return (
    <View ref={containerRef} style={[styles.root, style]} onLayout={onLayout} {...touchHandlers}>
      {isWeb || NATIVE_GL ? (
      <GLView
        style={StyleSheet.absoluteFill}
        msaaSamples={0}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        onContextCreate={onContextCreate as (gl: unknown) => void}
        {...(isWeb ? { webglContextAttributes: WEB_CONTEXT_ATTRIBUTES } : null)}
      />
      ) : null}
      {fallback ? <SilkStill /> : null}
      {children}
    </View>
  );
};

// Pre-rendered frame of preset="silk" (same pixels as the shader), drifting slowly.
const SilkStill = () => {
  const drift = useSharedValue(0);
  useEffect(() => {
    drift.value = withRepeat(withTiming(1, { duration: 9000, easing: Easing.inOut(Easing.sin) }), -1, true);
  }, [drift]);
  const animated = useAnimatedStyle(() => ({
    opacity: 1,
    transform: [{ scale: 1.04 + drift.value * 0.05 }, { translateY: -6 + drift.value * 12 }],
  }));
  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, animated]}>
      <Image source={SILK_STILL} style={StyleSheet.absoluteFill} resizeMode="cover" />
    </Animated.View>
  );
};

// Flip to true to run the live shader on native once expo-gl presentation is verified on device.
const NATIVE_GL = false;

const SILK_STILL = require("../../../assets/images/pattern-silk.png");

const styles = StyleSheet.create({
  root: {
    position: "relative",
    width: "100%",
    height: "100%",
    overflow: "hidden",
  },
});

export default PatternWaves;
