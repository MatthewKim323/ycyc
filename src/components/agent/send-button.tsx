import LottieView from "lottie-react-native";
import { useEffect, useRef } from "react";
import { StyleSheet } from "react-native";
import Animated, { useAnimatedStyle, withTiming } from "react-native-reanimated";

import { colors } from "@/theme";

import { PressableScale } from "../pressable-scale";

// Lordicon trending-flat arrow (the app's back arrow, which points left), turned to point up.
// Black copy for the white fill.
const ARROW_BLACK = require("@/assets/icons/arrow-back-black.json");
const ARROW_WHITE = require("@/assets/icons/arrow-back.json");

const SIZE = 34;

export function SendButton({ ready, onPress, playKey }: { ready: boolean; onPress: () => void; playKey: number }) {
  const ref = useRef<LottieView>(null);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    ref.current?.reset();
    ref.current?.play();
  }, [playKey]);

  const fill = useAnimatedStyle(() => ({ opacity: withTiming(ready ? 1 : 0, { duration: 160 }) }));
  const idle = useAnimatedStyle(() => ({ opacity: withTiming(ready ? 0 : 0.35, { duration: 160 }) }));

  return (
    <PressableScale
      onPress={onPress}
      disabled={!ready}
      haptic="light"
      scaleTo={0.9}
      hitSlop={8}
      accessibilityLabel="Send"
      accessibilityState={{ disabled: !ready }}
      style={styles.button}
    >
      <Animated.View style={[StyleSheet.absoluteFill, styles.fill, fill]} />
      <Animated.View style={[styles.arrow, idle]} pointerEvents="none">
        <LottieView source={ARROW_WHITE} autoPlay={false} loop={false} style={styles.lottie} />
      </Animated.View>
      <Animated.View style={[styles.arrow, fill]} pointerEvents="none">
        <LottieView ref={ref} source={ARROW_BLACK} autoPlay={false} loop={false} style={styles.lottie} />
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
  arrow: {
    position: "absolute",
    width: 20,
    height: 20,
    transform: [{ rotate: "90deg" }],
  },
  lottie: { width: 20, height: 20 },
});
