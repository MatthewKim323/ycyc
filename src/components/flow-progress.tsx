import { memo, useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

import { colors, easeFill, radius, space } from "@/theme";

import { Text } from "./text";

const LABELS = ["Sign in", "Set up", "Done"] as const;

function Segment({ fill, label, active }: { fill: number; label: string; active: boolean }) {
  const v = useSharedValue(fill);
  useEffect(() => {
    v.set(withTiming(fill, { duration: 400, easing: easeFill }));
  }, [fill, v]);
  const style = useAnimatedStyle(() => ({ transform: [{ scaleX: v.get() }] }));
  return (
    <View style={styles.segment}>
      <View style={styles.track}>
        <Animated.View style={[styles.fill, style]} />
      </View>
      <Text variant="micro" color={active ? colors.text : colors.textTertiary}>
        {label}
      </Text>
    </View>
  );
}

/** Sign in · Set up · Done. Lives once at the top of the connect modal and never resets. */
export const FlowProgress = memo(function FlowProgress({ fills, active }: { fills: [number, number, number]; active: 0 | 1 | 2 }) {
  return (
    <View style={styles.row}>
      {LABELS.map((label, i) => (
        <Segment key={label} label={label} fill={fills[i]} active={i === active} />
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: 4, paddingHorizontal: space.gutter },
  segment: { flex: 1, gap: 6 },
  track: { height: 3, borderRadius: radius.pill, backgroundColor: colors.border, overflow: "hidden" },
  fill: { flex: 1, backgroundColor: colors.text, transformOrigin: "left" },
});
