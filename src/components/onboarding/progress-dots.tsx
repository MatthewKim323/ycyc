import { memo, useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import { colors, springs } from "@/theme";

function Dot({ state }: { state: "done" | "active" | "todo" }) {
  const reduced = useReducedMotion();
  const target = state === "active" ? 22 : 6;
  const w = useSharedValue(target);
  const o = useSharedValue(state === "todo" ? 0.28 : state === "done" ? 0.6 : 1);
  useEffect(() => {
    w.set(reduced ? withTiming(target, { duration: 200 }) : withSpring(target, springs.layout));
    o.set(
      withTiming(state === "todo" ? 0.28 : state === "done" ? 0.6 : 1, {
        duration: 240,
      }),
    );
  }, [target, state, reduced, w, o]);
  const style = useAnimatedStyle(() => ({ width: w.get(), opacity: o.get() }));
  return <Animated.View style={[styles.dot, style]} />;
}

/** Where you are in onboarding. The active dot stretches into a pill on a spring. */
export const ProgressDots = memo(function ProgressDots({ count, index }: { count: number; index: number }) {
  return (
    <View style={styles.row} accessibilityRole="progressbar" accessibilityLabel={`Step ${index + 1} of ${count}`}>
      {Array.from({ length: count }, (_, i) => (
        <Dot key={i} state={i < index ? "done" : i === index ? "active" : "todo"} />
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { height: 6, borderRadius: 3, backgroundColor: colors.text },
});
