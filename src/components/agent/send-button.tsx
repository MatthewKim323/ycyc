import LottieView from "lottie-react-native";
import { StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle, withSpring, withTiming } from "react-native-reanimated";

import { colors, springs } from "@/theme";

import { PressableScale } from "../pressable-scale";

// Lordicon trending-flat arrow, trimmed to its single-arrow resting frame and turned to point up.
// It never plays, so it always reads as one arrow. Black copy for the white fill.
const ARROW_BLACK = require("@/assets/icons/arrow-back-black.json");
const ARROW_WHITE = require("@/assets/icons/arrow-back.json");

const SIZE = 36;

/** White circle with an up arrow; while a reply runs it becomes stop (white circle, black square). */
export function SendButton({
  ready,
  running,
  onPress,
  onStop,
}: {
  ready: boolean;
  running: boolean;
  onPress: () => void;
  onStop: () => void;
}) {
  const filled = ready || running;
  const fill = useAnimatedStyle(() => ({ opacity: withTiming(filled ? 1 : 0, { duration: 160 }) }));
  const idle = useAnimatedStyle(() => ({ opacity: withTiming(filled ? 0 : 0.4, { duration: 160 }) }));
  const arrow = useAnimatedStyle(() => ({
    opacity: withTiming(running ? 0 : filled ? 1 : 0, { duration: 140 }),
    transform: [{ rotate: "90deg" }, { scale: withSpring(running ? 0.6 : 1, springs.press) }],
  }));
  const stop = useAnimatedStyle(() => ({
    opacity: withTiming(running ? 1 : 0, { duration: 140 }),
    transform: [{ scale: withSpring(running ? 1 : 0.5, springs.press) }],
  }));

  return (
    <PressableScale
      onPress={running ? onStop : onPress}
      disabled={!running && !ready}
      haptic={running ? "selection" : "light"}
      scaleTo={0.9}
      hitSlop={8}
      accessibilityLabel={running ? "Stop" : "Send"}
      accessibilityState={{ disabled: !running && !ready }}
      style={styles.button}
    >
      <Animated.View style={[StyleSheet.absoluteFill, styles.fill, fill]} />
      <Animated.View style={[styles.arrow, styles.rotate, idle]} pointerEvents="none">
        <LottieView source={ARROW_WHITE} autoPlay={false} loop={false} progress={0} style={styles.lottie} />
      </Animated.View>
      <Animated.View style={[styles.arrow, arrow]} pointerEvents="none">
        <LottieView source={ARROW_BLACK} autoPlay={false} loop={false} progress={0} style={styles.lottie} />
      </Animated.View>
      <Animated.View style={[styles.stopWrap, stop]} pointerEvents="none">
        <View style={styles.stop} />
      </Animated.View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  button: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    backgroundColor: colors.surface2,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  fill: { backgroundColor: colors.accent, borderRadius: SIZE / 2 },
  arrow: { position: "absolute", width: 20, height: 20 },
  rotate: { transform: [{ rotate: "90deg" }] },
  lottie: { width: 20, height: 20 },
  stopWrap: { position: "absolute" },
  stop: { width: 12, height: 12, borderRadius: 3, backgroundColor: colors.onAccent },
});
