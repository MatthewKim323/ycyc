import { useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import Animated, { FadeIn, FadeOut, interpolateColor, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import * as Haptics from "expo-haptics";

import { Icon, type IconName } from "@/components/icon";
import { PressableScale } from "@/components/pressable-scale";
import { Text } from "@/components/text";
import { colors, layout, radius, space, springs } from "@/theme";

/** Labeled inset group. */
export function Group({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <View>
      {title ? (
        <Text variant="label" color={colors.textSecondary} style={styles.groupTitle}>
          {title}
        </Text>
      ) : null}
      <Animated.View layout={layout} style={styles.card}>
        {children}
      </Animated.View>
    </View>
  );
}

export function RowDivider({ inset = space.lg }: { inset?: number }) {
  return <View style={[styles.divider, { marginLeft: inset }]} />;
}

function Lead({ icon }: { icon?: IconName }) {
  if (!icon) return null;
  return <Icon name={icon} size={22} opacity={0.9} />;
}

/** Title left, value right. Gets a chevron only when it navigates; plain rows are not pressable. */
export function Row({
  icon,
  title,
  value,
  onPress,
  navigates = false,
  loading = false,
  tone = colors.text,
  center = false,
  accessibilityLabel,
}: {
  icon?: IconName;
  title: string;
  value?: string;
  onPress?: () => void;
  navigates?: boolean;
  loading?: boolean;
  tone?: string;
  center?: boolean;
  accessibilityLabel?: string;
}) {
  const body = (
    <>
      <Lead icon={icon} />
      <Text variant="rowTitle" color={tone} style={[styles.flex, center && styles.center]} numberOfLines={1}>
        {title}
      </Text>
      {value ? (
        <Text variant="body" color={colors.textSecondary} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {loading ? <ActivityIndicator size="small" color={colors.textSecondary} /> : null}
      {navigates && !loading ? <Icon name="back" size={18} opacity={0.4} style={styles.chevron} /> : null}
    </>
  );
  if (!onPress) {
    return <View style={styles.row}>{body}</View>;
  }
  return (
    <PressableScale
      onPress={onPress}
      disabled={loading}
      haptic="selection"
      scaleTo={0.98}
      accessibilityLabel={accessibilityLabel ?? title}
      style={styles.row}
    >
      {body}
    </PressableScale>
  );
}

/** A real switch: white track when on, springs the thumb. */
export function Toggle({ value, onChange, label }: { value: boolean; onChange: (next: boolean) => void; label: string }) {
  const x = useSharedValue(value ? 1 : 0);
  useEffect(() => {
    x.set(withSpring(value ? 1 : 0, springs.layout));
  }, [value, x]);
  const track = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(x.get(), [0, 1], [colors.surface2, colors.accent]),
    borderColor: interpolateColor(x.get(), [0, 1], [colors.borderStrong, colors.accent]),
  }));
  const thumb = useAnimatedStyle(() => ({
    transform: [{ translateX: x.get() * 20 }],
    backgroundColor: interpolateColor(x.get(), [0, 1], [colors.textSecondary, colors.onAccent]),
  }));
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}
      hitSlop={8}
      onPress={() => {
        Haptics.selectionAsync().catch(() => {});
        onChange(!value);
      }}
    >
      <Animated.View style={[styles.track, track]}>
        <Animated.View style={[styles.thumb, thumb]} />
      </Animated.View>
    </Pressable>
  );
}

export function SwitchRow({
  icon,
  title,
  value,
  onChange,
}: {
  icon?: IconName;
  title: string;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <View style={styles.row}>
      <Lead icon={icon} />
      <Text variant="rowTitle" style={styles.flex} numberOfLines={1}>
        {title}
      </Text>
      <Toggle value={value} onChange={onChange} label={title} />
    </View>
  );
}

/** Row that opens in place to pick one option. */
export function ChoiceRow<T extends string>({
  icon,
  title,
  value,
  options,
  onChange,
}: {
  icon?: IconName;
  title: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (next: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value)?.label ?? "";
  return (
    <Animated.View layout={layout}>
      <PressableScale
        onPress={() => setOpen((o) => !o)}
        haptic="selection"
        scaleTo={0.98}
        accessibilityLabel={`${title}, ${current}`}
        accessibilityState={{ expanded: open }}
        style={styles.row}
      >
        <Lead icon={icon} />
        <Text variant="rowTitle" style={styles.flex} numberOfLines={1}>
          {title}
        </Text>
        <Text variant="body" color={colors.textSecondary} numberOfLines={1}>
          {current}
        </Text>
      </PressableScale>
      {open ? (
        <Animated.View entering={FadeIn.duration(220)} exiting={FadeOut.duration(140)} style={styles.options}>
          {options.map((o) => {
            const on = o.value === value;
            return (
              <PressableScale
                key={o.value}
                onPress={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                haptic="selection"
                scaleTo={0.98}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                accessibilityLabel={o.label}
                style={[styles.option, on && styles.optionOn]}
              >
                <Text variant="bodyMedium" color={on ? colors.text : colors.textSecondary} style={styles.flex}>
                  {o.label}
                </Text>
                {on ? <View style={styles.dot} /> : null}
              </PressableScale>
            );
          })}
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  groupTitle: { marginBottom: space.sm, paddingHorizontal: space.xs },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: "hidden",
  },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  row: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
  },
  flex: { flex: 1 },
  center: { textAlign: "center" },
  // The back arrow, mirrored: a single-stroke forward arrow.
  chevron: { transform: [{ scaleX: -1 }] },
  track: {
    width: 48,
    height: 28,
    borderRadius: radius.pill,
    borderWidth: 1,
    padding: 2,
    justifyContent: "center",
  },
  thumb: { width: 22, height: 22, borderRadius: 11 },
  options: { paddingHorizontal: space.md, paddingBottom: space.md, gap: space.xs },
  option: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: space.md,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
  },
  optionOn: { backgroundColor: colors.surface2 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.text },
});
