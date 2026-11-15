import type { ReactNode } from "react";
import { ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, radius, space } from "@/theme";

import { PressableScale } from "./pressable-scale";
import { Text } from "./text";

/** Scrollable screen body with the 16 pt gutter and safe-area top. */
export function Screen({
  children,
  header,
  footer,
  contentStyle,
  topInset = true,
}: {
  children: ReactNode;
  header?: ReactNode;
  footer?: ReactNode;
  contentStyle?: StyleProp<ViewStyle>;
  topInset?: boolean;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.screen, { paddingTop: topInset ? insets.top : 0 }]}>
      {header}
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.content, contentStyle]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {children}
      </ScrollView>
      {footer}
    </View>
  );
}

/** Top bar for pushed and modal screens: a text action on the left, optional title and right slot. */
export function TopBar({
  left,
  onLeft,
  title,
  right,
}: {
  left?: string;
  onLeft?: () => void;
  title?: string;
  right?: ReactNode;
}) {
  return (
    <View style={styles.topBar}>
      <View style={styles.topSide}>
        {left && onLeft ? (
          <PressableScale onPress={onLeft} hitSlop={12} scaleTo={0.94} haptic="selection" accessibilityLabel={left}>
            <Text variant="bodyMedium" color={colors.textSecondary}>
              {left}
            </Text>
          </PressableScale>
        ) : null}
      </View>
      <Text variant="bodyMedium" numberOfLines={1} style={styles.topTitle}>
        {title ?? ""}
      </Text>
      <View style={[styles.topSide, styles.topRight]}>{right}</View>
    </View>
  );
}

export function LargeTitle({ children, sub }: { children: string; sub?: string }) {
  return (
    <View style={styles.largeTitle}>
      <Text variant="title">{children}</Text>
      {sub ? (
        <Text variant="body" color={colors.textSecondary}>
          {sub}
        </Text>
      ) : null}
    </View>
  );
}

export function SectionHeader({ title, right }: { title: string; right?: ReactNode }) {
  return (
    <View style={styles.sectionHeader}>
      <Text variant="label" color={colors.textSecondary}>
        {title}
      </Text>
      {right}
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Divider({ inset = 0 }: { inset?: number }) {
  return <View style={[styles.divider, { marginLeft: inset }]} />;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  content: { paddingHorizontal: space.gutter, paddingBottom: space.xxl, gap: space.xl },
  topBar: {
    height: 48,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: space.gutter,
  },
  topSide: { width: 96, justifyContent: "center" },
  topRight: { alignItems: "flex-end" },
  topTitle: { flex: 1, textAlign: "center" },
  largeTitle: { gap: space.xs, paddingTop: space.sm },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: space.sm,
    paddingHorizontal: space.xs,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
});
