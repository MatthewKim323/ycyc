import { useFocusEffect } from "expo-router";
import { createContext, useCallback, useContext, useEffect, type ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

import PatternWaves from "@/components/pattern-waves";
import { colors, easeFill, radius } from "@/theme";

const DimContext = createContext<SharedValue<number> | null>(null);

/** Highest scrim any onboarding step may use. The shader is never dimmed to black. */
export const MAX_SCRIM = 0.4;

/**
 * One shader for the whole onboarding, mounted once and kept interactive on every step.
 * Steps lay a light scrim over it where text needs contrast. Reduce Motion freezes it.
 */
export function OnboardingBackdrop({ children }: { children: ReactNode }) {
  const dim = useSharedValue(0);
  const reduced = useReducedMotion();
  const overlay = useAnimatedStyle(() => ({
    opacity: Math.min(dim.get(), MAX_SCRIM),
  }));
  // Content sits inside the shader so touches bubble up to it for ripples; buttons still work.
  return (
    <DimContext.Provider value={dim}>
      <View style={styles.root}>
        <PatternWaves
          preset="silk"
          color="#ffffff"
          backgroundColor="#000000"
          fade="edges"
          interactive={!reduced}
          intro={!reduced}
          paused={reduced}
          style={StyleSheet.absoluteFill}
        >
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.overlay, overlay]} />
          {children}
        </PatternWaves>
      </View>
    </DimContext.Provider>
  );
}

/** Animates the scrim to `value` (0 = full shader) whenever it changes. Capped at MAX_SCRIM. */
export function useScrim(value: number, duration = 420) {
  const dim = useContext(DimContext);
  useEffect(() => {
    dim?.set(withTiming(value, { duration, easing: easeFill }));
  }, [dim, value, duration]);
}

/** Route-level variant: sets the scrim while this screen is focused. */
export function useBackdropDim(value: number, duration = 420) {
  const dim = useContext(DimContext);
  useFocusEffect(
    useCallback(() => {
      dim?.set(withTiming(value, { duration, easing: easeFill }));
    }, [dim, value, duration]),
  );
}

/** Translucent card over the shader: the dots stay visible around it. */
export function Glass({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.glass, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  overlay: { backgroundColor: "#000000" },
  glass: {
    backgroundColor: "rgba(11,11,11,0.8)",
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.14)",
    overflow: "hidden",
  },
});
