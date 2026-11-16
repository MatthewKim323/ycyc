import { StyleSheet, TextInput, View, type LayoutChangeEvent } from "react-native";
import Animated from "react-native-reanimated";

import { colors, fadeIn, fadeOut, fonts, space } from "@/theme";

import { Text } from "../text";
import { SendButton } from "./send-button";

/** Rounded composer: multiline input and send (stop while a reply runs). */
export function Composer({
  value,
  onChangeText,
  onSend,
  onStop,
  canSend,
  busy,
  running,
  error,
  label,
  onLayout,
}: {
  value: string;
  onChangeText: (t: string) => void;
  onSend: () => void;
  onStop: () => void;
  canSend: boolean;
  busy: boolean;
  running: boolean;
  error: string | null;
  /** Quiet line above the input naming the active plan. */
  label?: string | null;
  onLayout?: (e: LayoutChangeEvent) => void;
}) {
  const ready = value.trim().length > 0 && !busy && canSend;
  return (
    <View style={styles.wrap} onLayout={onLayout}>
      {label ? (
        <Text variant="caption" color={colors.textTertiary} numberOfLines={1} style={styles.label}>
          {label}
        </Text>
      ) : null}
      <View style={styles.box}>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder="Ask anything"
          placeholderTextColor={colors.textTertiary}
          selectionColor={colors.text}
          cursorColor={colors.text}
          keyboardAppearance="dark"
          multiline
          style={styles.input}
          accessibilityLabel="Message"
        />
        <SendButton ready={ready} running={running} onPress={onSend} onStop={onStop} />
      </View>
      {error ? (
        <Animated.View entering={fadeIn} exiting={fadeOut}>
          <Text variant="caption" color={colors.textSecondary} style={styles.error} numberOfLines={2}>
            {error}
          </Text>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: space.md, paddingTop: space.sm, paddingBottom: space.sm, backgroundColor: colors.bg },
  box: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: space.sm,
    backgroundColor: colors.surface,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 7,
    paddingLeft: space.lg,
    paddingRight: 7,
  },
  input: {
    flex: 1,
    fontFamily: fonts.regular,
    fontSize: 16,
    lineHeight: 22,
    color: colors.text,
    paddingTop: 7,
    paddingBottom: 7,
    minHeight: 36,
    maxHeight: 132,
    textAlignVertical: "top",
  },
  label: { paddingLeft: space.lg + 1, marginBottom: space.xs },
  error: { textAlign: "center", marginTop: space.sm, fontSize: 12, lineHeight: 16 },
});
