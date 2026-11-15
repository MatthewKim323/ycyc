import { StyleSheet, TextInput, View, type LayoutChangeEvent } from "react-native";

import { colors, fonts, radius, space } from "@/theme";

import { PressableScale } from "../pressable-scale";
import { Text } from "../text";
import { SendButton } from "./send-button";

/** Rounded composer: multiline input, assistant pill on the left, send on the right. */
export function Composer({
  value,
  onChangeText,
  onSend,
  assistantName,
  onPickAssistant,
  pickerOpen,
  busy,
  sendKey,
  footnote,
  onLayout,
}: {
  value: string;
  onChangeText: (t: string) => void;
  onSend: () => void;
  assistantName: string | null;
  onPickAssistant: () => void;
  pickerOpen: boolean;
  busy: boolean;
  sendKey: number;
  footnote: string | null;
  onLayout?: (e: LayoutChangeEvent) => void;
}) {
  const ready = value.trim().length > 0 && !busy && !!assistantName;
  return (
    <View style={styles.wrap} onLayout={onLayout}>
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
        <View style={styles.row}>
          {assistantName ? (
            <PressableScale
              onPress={onPickAssistant}
              haptic="selection"
              scaleTo={0.95}
              hitSlop={6}
              accessibilityLabel={`Assistant: ${assistantName}. Change`}
              accessibilityState={{ expanded: pickerOpen }}
              style={[styles.pill, pickerOpen && styles.pillOpen]}
            >
              <Text variant="label" color={colors.text}>
                {assistantName}
              </Text>
            </PressableScale>
          ) : (
            <View />
          )}
          <SendButton ready={ready} onPress={onSend} playKey={sendKey} />
        </View>
      </View>
      {footnote ? (
        <Text variant="caption" color={colors.textTertiary} style={styles.footnote} numberOfLines={1}>
          {footnote}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: space.md, paddingTop: space.sm, paddingBottom: space.sm, backgroundColor: colors.bg },
  box: {
    backgroundColor: colors.surface,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: colors.border,
    paddingTop: space.md,
    paddingBottom: space.sm,
    paddingHorizontal: space.sm,
  },
  input: {
    fontFamily: fonts.regular,
    fontSize: 16,
    lineHeight: 22,
    color: colors.text,
    paddingHorizontal: space.sm,
    paddingTop: 0,
    paddingBottom: 0,
    minHeight: 24,
    maxHeight: 132,
    textAlignVertical: "top",
  },
  row: {
    marginTop: space.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  pill: {
    height: 34,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: "center",
  },
  pillOpen: { borderColor: colors.borderStrong },
  footnote: { textAlign: "center", marginTop: space.sm, fontSize: 12, lineHeight: 16 },
});
