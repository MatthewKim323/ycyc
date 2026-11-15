import { ActivityIndicator, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { colors, radius } from "@/theme";

import { PressableScale, type HapticKind } from "./pressable-scale";
import { Text } from "./text";

export function Button({
  label,
  onPress,
  kind = "primary",
  size = "large",
  disabled,
  loading,
  fullWidth,
  style,
  haptic,
}: {
  label: string;
  onPress: () => void;
  kind?: "primary" | "secondary" | "danger";
  size?: "large" | "small";
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  haptic?: HapticKind;
}) {
  const primary = kind === "primary";
  const fg = primary ? colors.onAccent : kind === "danger" ? colors.error : colors.text;
  const inactive = disabled || loading;
  return (
    <PressableScale
      onPress={onPress}
      haptic={haptic ?? (primary ? "light" : "selection")}
      dim={primary && !inactive}
      disabled={inactive}
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      style={[
        styles.base,
        size === "large" ? styles.large : styles.small,
        primary ? styles.primary : styles.secondary,
        kind === "danger" && styles.danger,
        fullWidth && styles.full,
        disabled && styles.disabled,
        style,
      ]}
    >
      <View style={styles.row}>
        {loading ? <ActivityIndicator size="small" color={fg} /> : null}
        <Text variant="button" color={fg} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  large: { height: 52, paddingHorizontal: 24 },
  small: { height: 36, paddingHorizontal: 16 },
  primary: { backgroundColor: colors.accent },
  secondary: { backgroundColor: "transparent", borderWidth: 1, borderColor: colors.borderStrong },
  danger: { borderColor: "rgba(255,69,58,0.35)" },
  full: { alignSelf: "stretch" },
  disabled: { opacity: 0.4 },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
});
