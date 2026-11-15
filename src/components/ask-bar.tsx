import { StyleSheet, TextInput, View } from "react-native";

import { colors, fonts, radius, space } from "@/theme";

// Flip on once ask.send exists in convex/. Until then the bar is shown but inert.
export const ASK_ENABLED = false;

/** Composer pinned to the bottom of Today. Disabled and non-interactive until ask.send ships. */
export function AskBar() {
  return (
    <View style={styles.wrap} pointerEvents={ASK_ENABLED ? "auto" : "none"}>
      <View style={[styles.bar, !ASK_ENABLED && styles.disabled]} accessibilityState={{ disabled: !ASK_ENABLED }}>
        <TextInput
          editable={ASK_ENABLED}
          placeholder="Log food, a workout, or ask anything"
          placeholderTextColor={colors.textTertiary}
          style={styles.input}
          selectionColor={colors.text}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: space.gutter, paddingTop: space.sm, paddingBottom: space.sm, backgroundColor: colors.bg },
  bar: {
    minHeight: 48,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: space.lg,
    justifyContent: "center",
  },
  disabled: { opacity: 0.5 },
  input: { color: colors.text, fontFamily: fonts.regular, fontSize: 15, paddingVertical: 12 },
});
