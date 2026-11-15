import { memo, useEffect, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { useAnimatedProps, useReducedMotion, useSharedValue, withDelay, withSpring } from "react-native-reanimated";
import Svg, { Circle } from "react-native-svg";

import { colors } from "@/theme";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
// Critically damped so the arc never overshoots its target.
const FILL = { damping: 26, stiffness: 90, mass: 1 };

/** Thin monochrome ring: white arc on a #141414 track, spring-filled on mount and on change. */
export const ProgressRing = memo(function ProgressRing({
  progress,
  size = 88,
  stroke = 6,
  delay = 0,
  children,
}: {
  progress: number;
  size?: number;
  stroke?: number;
  /** Wait this many ms before the first fill, to line up with a staggered entrance. */
  delay?: number;
  children?: ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = useSharedValue(0);
  const reduced = useReducedMotion();
  const target = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;

  useEffect(() => {
    if (reduced) p.set(target);
    else p.set(withDelay(delay, withSpring(target, FILL)));
  }, [target, delay, reduced, p]);

  // A zero-length round cap still draws a dot, so hide the arc until there's something to show.
  const arc = useAnimatedProps(() => ({
    strokeDashoffset: c * (1 - p.get()),
    strokeOpacity: p.get() > 0.002 ? 1 : 0,
  }));

  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} style={styles.svg}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.surface2} strokeWidth={stroke} fill="none" />
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={colors.text}
          strokeWidth={stroke}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${c} ${c}`}
          animatedProps={arc}
        />
      </Svg>
      <View style={styles.center}>{children}</View>
    </View>
  );
});

const styles = StyleSheet.create({
  svg: { transform: [{ rotate: "-90deg" }] },
  center: { ...StyleSheet.absoluteFill, alignItems: "center", justifyContent: "center" },
});
