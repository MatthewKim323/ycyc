import { useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";

import { colors, enter, radius, space } from "@/theme";

import { PressableScale } from "./pressable-scale";
import { Text } from "./text";

type AssistantKey = "claude" | "chatgpt" | "grok" | "muse";

const GUIDES: Record<AssistantKey, { name: string; steps: string[] }> = {
  claude: {
    name: "Claude",
    steps: [
      "Settings → Connectors → Add custom connector",
      "Name it ycyc and paste your link",
      "In a chat, turn ycyc on from the tools menu",
    ],
  },
  chatgpt: {
    name: "ChatGPT",
    steps: [
      "Settings → Connectors → Advanced → turn on Developer mode",
      "Connectors → Create, name it ycyc, paste your link, no auth",
      "In a chat, pick Developer mode and select ycyc",
    ],
  },
  grok: {
    name: "Grok",
    steps: ["Settings → Connectors → Add custom connector", "Paste your link and save", "Ask Grok to use ycyc"],
  },
  muse: {
    name: "Muse",
    steps: ["Settings → Connectors → Add MCP server", "Paste your link and save", "Ask Muse to use ycyc"],
  },
};

const ORDER: AssistantKey[] = ["claude", "chatgpt", "grok", "muse"];

/** Assistant picker plus the three concrete steps for the picked one. */
export function AssistantGuide({ title = "Add it to" }: { title?: string }) {
  const [picked, setPicked] = useState<AssistantKey>("claude");
  const guide = GUIDES[picked];

  return (
    <View style={styles.wrap}>
      <View>
        <Text variant="label" color={colors.textSecondary} style={styles.title}>
          {title}
        </Text>
        <View style={styles.chips}>
          {ORDER.map((key) => {
            const active = key === picked;
            return (
              <PressableScale
                key={key}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                haptic={active ? "none" : "selection"}
                scaleTo={0.95}
                onPress={() => setPicked(key)}
                style={[styles.chip, active && styles.chipActive]}
              >
                <Text variant="label" color={active ? colors.onAccent : colors.textSecondary}>
                  {GUIDES[key].name}
                </Text>
              </PressableScale>
            );
          })}
        </View>
      </View>

      <Animated.View key={picked} entering={FadeIn.duration(220)} style={styles.steps}>
        {guide.steps.map((step, i) => (
          <Animated.View key={step} entering={enter(i)} style={styles.step}>
            <View style={styles.num}>
              <Text variant="label">{i + 1}</Text>
            </View>
            <Text variant="body" style={styles.stepText}>
              {step}
            </Text>
          </Animated.View>
        ))}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.lg },
  title: { marginBottom: space.sm, paddingHorizontal: space.xs },
  chips: { flexDirection: "row", gap: space.sm, flexWrap: "wrap" },
  chip: {
    height: 34,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  steps: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
    gap: space.lg,
  },
  step: { flexDirection: "row", gap: space.md, alignItems: "flex-start" },
  num: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
    marginTop: -1,
  },
  stepText: { flex: 1 },
});
