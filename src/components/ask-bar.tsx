import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useEffect, useState } from "react";
import { Linking, StyleSheet, TextInput, View } from "react-native";

import { store } from "@/hooks/storage";
import { colors, fonts, radius, space } from "@/theme";

import { PressableScale } from "./pressable-scale";
import { Text } from "./text";

type Target = "claude" | "chatgpt" | "grok";

const TARGETS: { key: Target; name: string; url: (q: string) => string }[] = [
  { key: "claude", name: "Claude", url: (q) => `https://claude.ai/new?q=${q}` },
  { key: "chatgpt", name: "ChatGPT", url: (q) => `https://chatgpt.com/?q=${q}` },
  { key: "grok", name: "Grok", url: (q) => `https://grok.com/?q=${q}` },
];

const KEY = "ycyc.askTarget";

/**
 * Hands the request to the person's own assistant (no model runs in ycyc). The prompt is copied
 * first in case the app drops the prefill, then the assistant opens with it.
 */
export function AskBar() {
  const [text, setText] = useState("");
  const [target, setTarget] = useState<Target>("claude");

  useEffect(() => {
    store
      .get(KEY)
      .then((v) => {
        if (v === "claude" || v === "chatgpt" || v === "grok") setTarget(v);
      })
      .catch(() => {});
  }, []);

  const pick = (t: Target) => {
    setTarget(t);
    store.set(KEY, t).catch(() => {});
  };

  const current = TARGETS.find((t) => t.key === target) ?? TARGETS[0];

  const send = async () => {
    const value = text.trim();
    if (!value) return;
    const prompt = `Use my ycyc tools: ${value}`;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    await Clipboard.setStringAsync(prompt).catch(() => {});
    await Linking.openURL(current.url(encodeURIComponent(prompt))).catch(() => {});
    setText("");
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.bar}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Log food, a workout, or ask anything"
          placeholderTextColor={colors.textTertiary}
          style={styles.input}
          selectionColor={colors.text}
          returnKeyType="send"
          onSubmitEditing={send}
          blurOnSubmit
        />
        {text.trim() ? (
          <PressableScale onPress={send} haptic="none" scaleTo={0.92} accessibilityLabel={`Ask ${current.name}`} style={styles.send}>
            <Text variant="label" color={colors.onAccent}>
              Ask
            </Text>
          </PressableScale>
        ) : null}
      </View>
      <View style={styles.under}>
        <View style={styles.chips}>
          {TARGETS.map((t) => {
            const active = t.key === target;
            return (
              <PressableScale
                key={t.key}
                onPress={() => pick(t.key)}
                haptic={active ? "none" : "selection"}
                scaleTo={0.95}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text variant="micro" color={active ? colors.onAccent : colors.textSecondary}>
                  {t.name}
                </Text>
              </PressableScale>
            );
          })}
        </View>
        <Text variant="micro" color={colors.textTertiary} numberOfLines={1} style={styles.helper}>
          Opens in {current.name} with your apps attached
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: space.gutter, paddingTop: space.sm, paddingBottom: space.sm, backgroundColor: colors.bg, gap: space.sm },
  bar: {
    minHeight: 48,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingLeft: space.lg,
    paddingRight: 6,
    flexDirection: "row",
    alignItems: "center",
  },
  input: { flex: 1, color: colors.text, fontFamily: fonts.regular, fontSize: 15, paddingVertical: 12 },
  send: {
    height: 36,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  under: { flexDirection: "row", alignItems: "center", gap: space.sm },
  chips: { flexDirection: "row", gap: 6 },
  chip: {
    height: 26,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  helper: { flex: 1, textAlign: "right" },
});
