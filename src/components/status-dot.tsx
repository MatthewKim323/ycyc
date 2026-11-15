import { useEffect, useRef } from "react";
import { StyleSheet } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import { colors, springs } from "@/theme";

export type DotState = "live" | "building" | "error" | "idle";

export function StatusDot({ state, size = 8 }: { state: DotState; size?: number }) {
  const pulse = useSharedValue(1);
  const pop = useSharedValue(1);
  const prev = useRef(state);

  useEffect(() => {
    // A connection just went live: one soft pop.
    if (state === "live" && prev.current !== "live") {
      pop.set(withSequence(withSpring(1.8, springs.pop), withSpring(1, springs.release)));
    }
    prev.current = state;
  }, [state, pop]);

  useEffect(() => {
    if (state === "building") {
      // On, ease down, rest, repeat: a breathing dot, not a strobe.
      pulse.set(
        withRepeat(
          withSequence(
            withTiming(0.25, { duration: 700, easing: Easing.inOut(Easing.quad) }),
            withTiming(1, { duration: 700, easing: Easing.inOut(Easing.quad) }),
            withDelay(400, withTiming(1, { duration: 0 })),
          ),
          -1,
        ),
      );
    } else {
      cancelAnimation(pulse);
      pulse.set(1);
    }
    return () => cancelAnimation(pulse);
  }, [state, pulse]);

  const animated = useAnimatedStyle(() => ({ opacity: pulse.get(), transform: [{ scale: pop.get() }] }));
  const fill =
    state === "live"
      ? colors.live
      : state === "building"
        ? colors.building
        : state === "error"
          ? colors.error
          : "transparent";

  return (
    <Animated.View
      style={[
        styles.dot,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: fill },
        state === "idle" && styles.idle,
        animated,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  dot: {},
  idle: { borderWidth: 1, borderColor: colors.textTertiary },
});
