import * as Haptics from "expo-haptics";
import { memo, useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  ZoomIn,
} from "react-native-reanimated";

import type { BuildStep } from "@/lib/contract";
import { colors, enter, layout, space, springs } from "@/theme";

import { Icon } from "./icon";
import { Text } from "./text";

export type DisplayStatus = "pending" | "running" | "done" | "error";
export type DisplayStep = { key: string; label: string; status: DisplayStatus; detail?: string };

// The backend runs six steps; people see four.
const GROUPS: { key: string; label: string; from: BuildStep["key"][] }[] = [
  { key: "signin", label: "Signed in", from: ["signin"] },
  { key: "read", label: "Reading your account", from: ["capture", "map"] },
  { key: "write", label: "Writing tools", from: ["generate"] },
  { key: "test", label: "Testing a real request", from: ["verify", "publish"] },
];

export function mergeSteps(steps: BuildStep[] | undefined): DisplayStep[] {
  return GROUPS.map((g) => {
    const parts = g.from.map((k) => steps?.find((s) => s.key === k)).filter(Boolean) as BuildStep[];
    const settled = (s: BuildStep) => s.status === "done" || s.status === "skipped";
    const err = parts.find((s) => s.status === "error");
    const run = parts.find((s) => s.status === "running");
    let status: DisplayStatus = "pending";
    if (err) status = "error";
    else if (parts.length > 0 && parts.every(settled)) status = "done";
    else if (run || parts.some(settled)) status = "running";
    return { key: g.key, label: g.label, status, detail: (err ?? run)?.detail };
  });
}

const DWELL_MS = 600;

/**
 * Shows steps finishing no faster than one every 600 ms so nothing flashes, with a selection tick
 * per finished step. Calls onSettled once every step is shown done.
 */
export function useDwell(steps: DisplayStep[], onSettled?: () => void): DisplayStep[] {
  const target = (() => {
    let n = 0;
    while (n < steps.length && steps[n].status === "done") n++;
    return n;
  })();
  const [shown, setShown] = useState(0);
  const settledRef = useRef(false);

  useEffect(() => {
    if (shown >= target) return;
    const id = setTimeout(() => {
      setShown((s) => s + 1);
      Haptics.selectionAsync().catch(() => {});
    }, DWELL_MS);
    return () => clearTimeout(id);
  }, [shown, target]);

  useEffect(() => {
    if (shown === steps.length && !settledRef.current) {
      settledRef.current = true;
      onSettled?.();
    }
  }, [shown, steps.length, onSettled]);

  return steps.map((s, i) => {
    if (i < shown) return { ...s, status: "done", detail: undefined };
    if (i === shown) return s.status === "done" ? { ...s, status: "running", detail: undefined } : s;
    return s.status === "error" ? s : { ...s, status: "pending", detail: undefined };
  });
}

function Spinner() {
  const r = useSharedValue(0);
  useEffect(() => {
    r.set(withRepeat(withTiming(360, { duration: 900, easing: Easing.linear }), -1));
  }, [r]);
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${r.get()}deg` }] }));
  return <Animated.View style={[styles.ring, styles.arc, style]} />;
}

function Indicator({ status }: { status: DisplayStatus }) {
  if (status === "done") {
    return (
      <Animated.View
        entering={ZoomIn.springify().damping(springs.pop.damping).stiffness(springs.pop.stiffness)}
        style={styles.doneDot}
      >
        <Icon name="checkBlack" size={14} autoPlay />
      </Animated.View>
    );
  }
  if (status === "running") return <Spinner />;
  if (status === "error") return <View style={[styles.ring, styles.errorRing]} />;
  return <View style={styles.ring} />;
}

export const StepList = memo(function StepList({ steps }: { steps: DisplayStep[] }) {
  return (
    <View style={styles.list}>
      {steps.map((s, i) => (
        <Animated.View key={s.key} entering={enter(i)} layout={layout} style={styles.step}>
          <View style={styles.indicator}>
            <Indicator status={s.status} />
          </View>
          <View style={styles.text}>
            <Text
              variant="bodyMedium"
              color={
                s.status === "running"
                  ? colors.text
                  : s.status === "error"
                    ? colors.error
                    : s.status === "done"
                      ? colors.textSecondary
                      : colors.textTertiary
              }
            >
              {s.label}
            </Text>
            {s.detail && (s.status === "running" || s.status === "error") ? (
              <Text variant="caption" color={s.status === "error" ? colors.error : colors.textSecondary}>
                {s.detail}
              </Text>
            ) : null}
          </View>
        </Animated.View>
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  list: { gap: space.lg },
  step: { flexDirection: "row", alignItems: "flex-start", gap: space.md },
  indicator: { width: 20, height: 22, alignItems: "center", justifyContent: "center" },
  text: { flex: 1, gap: 2 },
  ring: { width: 16, height: 16, borderRadius: 8, borderWidth: 1.5, borderColor: colors.textTertiary },
  arc: { borderColor: colors.text, borderTopColor: "transparent" },
  errorRing: { borderColor: colors.error, backgroundColor: colors.error },
  doneDot: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
});
