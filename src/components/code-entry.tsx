import * as Haptics from "expo-haptics";
import { useEffect, useRef, useState, type ComponentRef } from "react";
import { ActivityIndicator, Pressable, StyleSheet, TextInput, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import { colors, enter, fonts, radius, space, springs } from "@/theme";

import { Text } from "./text";

const LENGTH = 6;

function Box({ digit, active, state }: { digit?: string; active: boolean; state: "idle" | "error" | "ok" }) {
  const lift = useSharedValue(1);
  const caret = useSharedValue(0);

  useEffect(() => {
    if (digit) lift.set(withSequence(withSpring(1.08, springs.press), withSpring(1, springs.release)));
  }, [digit, lift]);

  useEffect(() => {
    caret.set(active && !digit ? withRepeat(withSequence(withTiming(1, { duration: 450 }), withTiming(0, { duration: 450 })), -1) : 0);
  }, [active, digit, caret]);

  const boxStyle = useAnimatedStyle(() => ({ transform: [{ scale: lift.get() }] }));
  const caretStyle = useAnimatedStyle(() => ({ opacity: caret.get() }));

  return (
    <Animated.View
      style={[
        styles.box,
        active && styles.boxActive,
        state === "error" && styles.boxError,
        state === "ok" && styles.boxOk,
        boxStyle,
      ]}
    >
      {digit ? (
        <Text style={styles.digit} color={state === "ok" ? colors.onAccent : colors.text}>
          {digit}
        </Text>
      ) : (
        <Animated.View style={[styles.caret, caretStyle]} />
      )}
    </Animated.View>
  );
}

/**
 * Six-digit verification code entry. One hidden input drives the boxes, so typing, paste and
 * iOS one-time-code autofill all work. Submits on the sixth digit.
 */
export function CodeEntry({
  title,
  prompt,
  onSubmit,
}: {
  title: string;
  prompt: string;
  onSubmit: (code: string) => Promise<void>;
}) {
  const [code, setCode] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "error" | "ok">("idle");
  const [error, setError] = useState<string | null>(null);
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  const shake = useSharedValue(0);

  useEffect(() => {
    const id = setTimeout(() => input.current?.focus(), 350);
    return () => clearTimeout(id);
  }, []);

  const submit = async (value: string) => {
    setState("busy");
    setError(null);
    try {
      await onSubmit(value);
      setState("ok");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (e) {
      setState("error");
      setError(e instanceof Error && e.message ? e.message : "That code didn't work. Try again.");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      shake.set(
        withSequence(
          withTiming(-10, { duration: 50 }),
          withTiming(10, { duration: 70 }),
          withTiming(-6, { duration: 60 }),
          withTiming(6, { duration: 60 }),
          withSpring(0, springs.release),
        ),
      );
      setTimeout(() => {
        setCode("");
        setState("idle");
        input.current?.focus();
      }, 650);
    }
  };

  const onChange = (raw: string) => {
    if (state === "busy" || state === "ok") return;
    const next = raw.replace(/\D/g, "").slice(0, LENGTH);
    setCode(next);
    if (state === "error") setState("idle");
    if (next.length === LENGTH) submit(next);
  };

  const rowStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shake.get() }] }));
  const boxState = state === "error" ? "error" : state === "ok" ? "ok" : "idle";

  return (
    <View style={styles.wrap}>
      <Animated.View entering={enter(0)} style={styles.head}>
        <Text variant="title" style={styles.center}>
          {title}
        </Text>
        <Text variant="body" color={colors.textSecondary} style={styles.center}>
          {prompt}
        </Text>
      </Animated.View>

      <Animated.View entering={enter(1)}>
        <Pressable onPress={() => input.current?.focus()} accessibilityLabel="Verification code">
          <Animated.View style={[styles.row, rowStyle]}>
            {Array.from({ length: LENGTH }, (_, i) => (
              <Box
                key={i}
                digit={code[i]}
                active={state !== "ok" && i === Math.min(code.length, LENGTH - 1)}
                state={boxState}
              />
            ))}
          </Animated.View>
        </Pressable>
        <TextInput
          ref={input}
          value={code}
          onChangeText={onChange}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="one-time-code"
          maxLength={LENGTH}
          caretHidden
          style={styles.hidden}
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
      </Animated.View>

      <View style={styles.status}>
        {state === "busy" ? (
          <View style={styles.busy}>
            <ActivityIndicator size="small" color={colors.textSecondary} />
            <Text variant="label" color={colors.textSecondary}>
              Checking code
            </Text>
          </View>
        ) : error ? (
          <Text variant="label" color={colors.error} style={styles.center}>
            {error}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.xl },
  head: { gap: space.sm, alignItems: "center", paddingHorizontal: space.lg },
  center: { textAlign: "center" },
  row: { flexDirection: "row", justifyContent: "center", gap: space.sm },
  box: {
    width: 48,
    height: 60,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  boxActive: { borderColor: colors.textSecondary },
  boxError: { borderColor: colors.error },
  boxOk: { backgroundColor: colors.accent, borderColor: colors.accent },
  digit: { fontFamily: fonts.semibold, fontSize: 28, lineHeight: 34, fontVariant: ["tabular-nums"] },
  caret: { width: 2, height: 26, borderRadius: 1, backgroundColor: colors.text },
  hidden: { position: "absolute", width: 1, height: 1, opacity: 0 },
  status: { minHeight: 24, alignItems: "center" },
  busy: { flexDirection: "row", alignItems: "center", gap: space.sm },
});
