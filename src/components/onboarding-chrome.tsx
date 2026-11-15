import { useFocusEffect } from "expo-router";
import { createContext, useCallback, useContext, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

import PatternWaves from "@/components/pattern-waves";
import { colors, easeFill } from "@/theme";

const DimContext = createContext<SharedValue<number> | null>(null);

/**
 * One shader for the whole onboarding stack, mounted once. Screens dim it with a black overlay
 * instead of remounting it. Reduce Motion freezes it.
 */
export function OnboardingBackdrop({ children }: { children: ReactNode }) {
  const dim = useSharedValue(0);
  const reduced = useReducedMotion();
  const overlay = useAnimatedStyle(() => ({ opacity: dim.get() }));
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

/** Sets the shader dim while this screen is focused (0 = full shader, 1 = solid black). */
export function useBackdropDim(value: number, duration = 400) {
  const dim = useContext(DimContext);
  useFocusEffect(
    useCallback(() => {
      dim?.set(withTiming(value, { duration, easing: easeFill }));
    }, [dim, value, duration]),
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  overlay: { backgroundColor: "#000000" },
});
