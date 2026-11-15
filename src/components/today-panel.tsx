import { useAction, useQuery } from "convex/react";
import { useRouter } from "expo-router";
import { Component, memo, useEffect, useState, type ReactNode } from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";
import Animated, { FadeIn, FadeOut, SlideInDown, SlideOutDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, type Id, type MyConnection } from "@/hooks/convex";
import { colors, enter, radius, space, springs } from "@/theme";

import { Button } from "./button";
import { Icon, type IconName } from "./icon";
import { PressableScale } from "./pressable-scale";
import { ProgressRing } from "./progress-ring";
import { Text } from "./text";
import { TweenNumber } from "./tween-number";

type Metric = { value: number; goal: number } | null;
type Achievement = { key: string; title: string; unlocked: boolean; at?: number };

const BADGES: Record<string, { icon: IconName; took: string }> = {
  first_log: { icon: "pencil", took: "An assistant logged something for you." },
  first_approval: { icon: "check", took: "You approved a change from your phone." },
  streak_3: { icon: "flame", took: "Something got logged three days in a row." },
  two_apps: { icon: "puzzle", took: "Two apps connected at the same time." },
  logged_by_text: { icon: "chat", took: "You logged something by typing it." },
};

/** Keeps Today from taking the screen down if the backend query is missing or throws. */
class Boundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function Ring({
  label,
  unit,
  metric,
  app,
  appName,
  connected,
  index,
}: {
  label: string;
  unit: string;
  metric: Metric;
  app: string;
  appName: string;
  connected: boolean;
  index: number;
}) {
  const router = useRouter();
  const progress = metric && metric.goal > 0 ? metric.value / metric.goal : 0;
  return (
    <Animated.View entering={enter(index)} style={styles.ringCell}>
      {connected ? (
        <ProgressRing progress={progress}>
          <TweenNumber value={Math.round(metric?.value ?? 0)} variant="heading" />
        </ProgressRing>
      ) : (
        <PressableScale
          haptic="selection"
          accessibilityLabel={`Connect ${appName} for ${label}`}
          onPress={() => router.push({ pathname: "/connect/[slug]", params: { slug: app } })}
        >
          <ProgressRing progress={0}>
            <Text variant="micro" color={colors.textSecondary}>
              Connect
            </Text>
          </ProgressRing>
        </PressableScale>
      )}
      <View style={styles.ringText}>
        <Text variant="label">{label}</Text>
        <Text variant="micro" color={colors.textTertiary} style={styles.tabular}>
          {connected ? (metric ? `of ${Math.round(metric.goal)} ${unit}` : "No data yet") : appName}
        </Text>
      </View>
    </Animated.View>
  );
}

function AchievementSheet({ badge, onClose }: { badge: Achievement | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const meta = badge ? BADGES[badge.key] : undefined;
  return (
    <Modal visible={!!badge} transparent animationType="none" onRequestClose={onClose}>
      {badge ? (
        <View style={styles.modalRoot}>
          <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(200)} style={StyleSheet.absoluteFill}>
            <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close" />
          </Animated.View>
          <Animated.View
            entering={SlideInDown.springify().damping(springs.sheet.damping).stiffness(springs.sheet.stiffness)}
            exiting={SlideOutDown.duration(200)}
            style={[styles.sheet, { paddingBottom: insets.bottom + space.lg }]}
          >
            <View style={[styles.sheetBadge, !badge.unlocked && styles.locked]}>
              <Icon name={meta?.icon ?? "badge"} size={32} autoPlay={badge.unlocked} />
            </View>
            <Text variant="heading" style={styles.center}>
              {badge.title}
            </Text>
            <Text variant="body" color={colors.textSecondary} style={styles.center}>
              {meta?.took ?? "Keep using ycyc to unlock it."}
            </Text>
            <Text variant="label" color={colors.textTertiary} style={styles.center}>
              {badge.unlocked
                ? badge.at
                  ? `Unlocked ${new Date(badge.at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
                  : "Unlocked"
                : "Locked"}
            </Text>
            <Button label="Close" kind="secondary" onPress={onClose} fullWidth />
          </Animated.View>
        </View>
      ) : null}
    </Modal>
  );
}

const Badge = memo(function Badge({ a, index, onPress }: { a: Achievement; index: number; onPress: () => void }) {
  return (
    <Animated.View entering={enter(index)}>
      <PressableScale onPress={onPress} haptic="selection" accessibilityLabel={`${a.title}, ${a.unlocked ? "unlocked" : "locked"}`}>
        <View style={[styles.badge, !a.unlocked && styles.locked]}>
          <Icon name={BADGES[a.key]?.icon ?? "badge"} size={22} />
        </View>
      </PressableScale>
    </Animated.View>
  );
});

function TodayBody({ userId, connections }: { userId: Id<"users">; connections: MyConnection[] | undefined }) {
  const today = useQuery(api.today.get, { userId });
  const refresh = useAction(api.today.summary);
  const [open, setOpen] = useState<Achievement | null>(null);

  useEffect(() => {
    refresh({ userId }).catch(() => {});
  }, [refresh, userId]);

  const live = (slug: string) => !!connections?.some((c) => c.appSlug === slug && c.status === "live");
  const streak = today?.streakDays ?? 0;

  return (
    <View style={styles.wrap}>
      <View style={styles.rings}>
        <Ring index={0} label="Fuel" unit="kcal" metric={today?.fuel ?? null} app="myfitnesspal" appName="MyFitnessPal" connected={live("myfitnesspal")} />
        <Ring index={1} label="Protein" unit="g" metric={today?.protein ?? null} app="myfitnesspal" appName="MyFitnessPal" connected={live("myfitnesspal")} />
        <Ring index={2} label="Training" unit="sets" metric={today?.training ?? null} app="strong" appName="Strong" connected={live("strong")} />
      </View>

      <Animated.View entering={enter(3)} style={styles.statsRow}>
        <View style={styles.chip}>
          <Icon name="flame" size={18} autoPlay={streak > 0} />
          <Text variant="label" style={styles.tabular}>
            {streak > 0 ? `${streak}-day streak` : "Log today to start a streak"}
          </Text>
        </View>
        <View style={styles.xp}>
          <TweenNumber value={today?.xp ?? 0} variant="label" />
          <Text variant="label" color={colors.textTertiary}>
            XP
          </Text>
        </View>
      </Animated.View>

      {today && today.achievements.length > 0 ? (
        <View style={styles.badges}>
          {today.achievements.map((a, i) => (
            <Badge key={a.key} a={a} index={i + 4} onPress={() => setOpen(a)} />
          ))}
        </View>
      ) : null}

      <AchievementSheet badge={open} onClose={() => setOpen(null)} />
    </View>
  );
}

export function TodayPanel({ userId, connections }: { userId: Id<"users"> | null; connections: MyConnection[] | undefined }) {
  if (!userId) return null;
  return (
    <Boundary fallback={null}>
      <TodayBody userId={userId} connections={connections} />
    </Boundary>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.lg },
  rings: { flexDirection: "row", justifyContent: "space-between" },
  ringCell: { alignItems: "center", gap: space.sm, flex: 1 },
  ringText: { alignItems: "center", gap: 1 },
  tabular: { fontVariant: ["tabular-nums"] },
  statsRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 34,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  xp: { flexDirection: "row", alignItems: "center", gap: 4 },
  badges: { flexDirection: "row", justifyContent: "space-between" },
  badge: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  locked: { opacity: 0.3 },
  modalRoot: { flex: 1, justifyContent: "flex-end" },
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)" },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: space.xl,
    paddingTop: space.xl,
    gap: space.md,
    alignItems: "center",
  },
  sheetBadge: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: space.sm,
  },
  center: { textAlign: "center" },
});
