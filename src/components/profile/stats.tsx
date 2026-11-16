import { StyleSheet, View } from "react-native";

import { Text } from "@/components/text";
import { colors, motion, radius, space } from "@/theme";

import { CountUp } from "./count-up";

type Stats = { apps: number; actionsThisWeek: number; streakDays: number; xp: number };

const TILES: { key: keyof Stats; label: string }[] = [
  { key: "apps", label: "Apps" },
  { key: "actionsThisWeek", label: "This week" },
  { key: "streakDays", label: "Day streak" },
  { key: "xp", label: "XP" },
];

/** Four equal columns of big tabular numbers that count up as the screen opens. */
export function StatsRow({ stats, delay = 0 }: { stats: Stats; delay?: number }) {
  return (
    <View style={styles.card}>
      {TILES.map((t, i) => (
        <View key={t.key} style={[styles.tile, i > 0 && styles.tileBorder]} accessible accessibilityLabel={`${t.label}: ${stats[t.key]}`}>
          <CountUp value={stats[t.key]} delay={delay + i * motion.stagger} variant="heading" />
          <Text variant="caption" color={colors.textTertiary} numberOfLines={1}>
            {t.label}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tile: { flex: 1, alignItems: "center", gap: 2, paddingVertical: space.lg },
  tileBorder: { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.border },
});
