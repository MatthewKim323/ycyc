import { useEffect, type ReactNode } from "react";
import type { StyleProp, ViewStyle } from "react-native";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";

import { easeEnter } from "@/theme";

/** Hero text entrance: fade up 12 pt over 600 ms after a delay. Reduce Motion keeps only the fade. */
export function Reveal({ delay = 0, children, style }: { delay?: number; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const reduced = useReducedMotion();
  const t = useSharedValue(0);
  useEffect(() => {
    t.set(withDelay(delay, withTiming(1, { duration: 600, easing: easeEnter })));
  }, [t, delay]);
  const animated = useAnimatedStyle(() => ({
    opacity: t.get(),
    transform: [{ translateY: reduced ? 0 : 12 * (1 - t.get()) }],
  }));
  return <Animated.View style={[style, animated]}>{children}</Animated.View>;
}
