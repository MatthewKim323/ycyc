import * as Haptics from "expo-haptics";
import { useEffect, useState } from "react";
import { StyleSheet } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring, withTiming } from "react-native-reanimated";

import { colors, space, springs } from "@/theme";

import { Icon } from "./icon";

/** The one success recipe: white circle, drawn check, Success haptic at the end of the stroke. */
export function SuccessMark({ size = 72 }: { size?: number }) {
  const pop = useSharedValue(0.6);
  const fade = useSharedValue(0);
  const [drawCheck, setDrawCheck] = useState(false);
  useEffect(() => {
    pop.set(withSpring(1, springs.pop));
    fade.set(withTiming(1, { duration: 200 }));
    const a = setTimeout(() => setDrawCheck(true), 120);
    const b = setTimeout(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {}), 440);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
  }, [pop, fade]);
  const style = useAnimatedStyle(() => ({ opacity: fade.get(), transform: [{ scale: pop.get() }] }));
  return (
    <Animated.View style={[styles.circle, { width: size, height: size, borderRadius: size / 2 }, style]}>
      {drawCheck ? <Icon name="checkBlack" size={Math.round(size * 0.55)} autoPlay /> : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  circle: { backgroundColor: colors.accent, alignItems: "center", justifyContent: "center", marginBottom: space.md },
});
