import { memo, useEffect, type ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { useAnimatedProps, useSharedValue, withSpring } from "react-native-reanimated";
import Svg, { Circle } from "react-native-svg";

import { colors } from "@/theme";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const FILL = { damping: 26, stiffness: 90, mass: 1 };

/** Thin monochrome ring: white arc on a #141414 track, spring-filled on mount and on change. */
export const ProgressRing = memo(function ProgressRing({
  progress,
  size = 88,
  stroke = 6,
  children,
}: {
  progress: number;
  size?: number;
  stroke?: number;
  children?: ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = useSharedValue(0);
  useEffect(() => {
    p.set(withSpring(Math.max(0, Math.min(1, progress)), FILL));
  }, [progress, p]);
  const arc = useAnimatedProps(() => ({ strokeDashoffset: c * (1 - p.get()) }));

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
