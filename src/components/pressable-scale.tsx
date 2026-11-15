import * as Haptics from "expo-haptics";
import { memo, type ReactNode } from "react";
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";

import { motion, springs } from "@/theme";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export type HapticKind = "light" | "medium" | "selection" | "none";

function buzz(kind: HapticKind) {
  if (kind === "none") return;
  const p =
    kind === "selection"
      ? Haptics.selectionAsync()
      : Haptics.impactAsync(kind === "medium" ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light);
  p.catch(() => {});
}

function PressableScaleBase({
  children,
  style,
  scaleTo = motion.pressScale,
  haptic = "none",
  dim = false,
  onPress,
  onPressIn,
  onPressOut,
  ...rest
}: Omit<PressableProps, "style" | "children"> & {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  scaleTo?: number;
  haptic?: HapticKind;
  /** Primary pills also drop to 0.92 opacity while held. */
  dim?: boolean;
}) {
  const scale = useSharedValue(1);
  const dimRange = 0.08 / (1 - motion.pressScale);
  const animated = useAnimatedStyle(() =>
    dim
      ? { transform: [{ scale: scale.get() }], opacity: 1 - (1 - scale.get()) * dimRange }
      : { transform: [{ scale: scale.get() }] },
  );
  return (
    <AnimatedPressable
      accessibilityRole="button"
      {...rest}
      onPress={(e) => {
        buzz(haptic);
        onPress?.(e);
      }}
      onPressIn={(e) => {
        scale.set(withSpring(scaleTo, springs.press));
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        scale.set(withSpring(1, springs.release));
        onPressOut?.(e);
      }}
      style={[style, animated]}
    >
      {children}
    </AnimatedPressable>
  );
}

export const PressableScale = memo(PressableScaleBase);
