import { useAction, useQuery } from "convex/react";
import { useRouter } from "expo-router";
import { Component, memo, useEffect, useState, type ReactNode } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import Animated, { FadeIn, FadeOut, SlideInDown, SlideOutDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, type Id, type MyConnection } from "@/hooks/convex";
import { colors, enter, layout, motion, radius, space, springs } from "@/theme";

import { Button } from "./button";
import { Icon, type IconName } from "./icon";
import { PressableScale } from "./pressable-scale";
import { ProgressRing } from "./progress-ring";
import { statusLook } from "./rows";
import { Text } from "./text";
import { TweenNumber } from "./tween-number";

type Metric = { value: number; goal: number } | null;
type Achievement = { key: string; title: string; unlocked: boolean; at?: number };

// Only badges we can explain are shown. Anything else from the backend stays hidden.
const BADGES: Record<string, { icon: IconName; took: string; how: string }> = {
  first_log: { icon: "pencil", took: "An assistant logged something for you.", how: "Have an assistant log something for you." },
  first_approval: { icon: "check", took: "You approved a change from your phone.", how: "Approve a change from your phone." },
  streak_3: { icon: "flame", took: "Something got logged three days in a row.", how: "Log something three days in a row." },
  two_apps: { icon: "puzzle", took: "Two apps connected at the same time.", how: "Connect a second app." },
};

const HIDDEN_BADGES = new Set(["logged_by_text"]);

const APP_NAMES: Record<string, string> = {
  myfitnesspal: "MyFitnessPal",
  cronometer: "Cronometer",
  strong: "Strong",
};

const fmt = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");

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
  slug,
  connection,
  index,
  size,
  ready,
}: {
  label: string;
  unit: string;
  metric: Metric;
  slug: string;
  connection: MyConnection | undefined;
  index: number;
  size: number;
  /** False until connections load, so a connected ring never flashes "Connect". */
  ready: boolean;
}) {
  const router = useRouter();
  const appName = APP_NAMES[slug] ?? slug;
  const live = connection?.status === "live";
  const hasGoal = !!metric && metric.goal > 0;
  const progress = live && metric && hasGoal ? metric.value / metric.goal : 0;
  const delay = Math.min(index, 8) * motion.stagger + 120;

  const open = () => {
    if (live) {
      router.push({ pathname: "/app/[slug]", params: { slug } });
    } else if (connection && (connection.status === "building" || connection.status === "capturing" || connection.status === "needs_code")) {
      router.push({ pathname: "/build/[connectionId]", params: { connectionId: connection._id, slug } });
    } else {
      router.push({ pathname: "/connect/[slug]", params: { slug } });
    }
  };

  const action = connection && !live ? statusLook(connection.status).label || "Connect" : "Connect";
  const a11y = live
    ? `${label}, ${metric ? `${fmt(metric.value)}${hasGoal ? ` of ${fmt(metric.goal)}` : ""} ${unit}` : "no data yet"}. Open ${appName}`
    : `${action} ${appName} for ${label}`;

  return (
    <Animated.View entering={enter(index)} style={styles.ringCell}>
      <PressableScale haptic="selection" accessibilityLabel={a11y} onPress={open} disabled={!ready} style={styles.ringPress}>
        <ProgressRing progress={progress} size={size} stroke={Math.round(size / 13)} delay={delay}>
          {live && metric ? (
            hasGoal ? (
              <View style={styles.pct}>
                <TweenNumber value={Math.round((metric.value / metric.goal) * 100)} variant="heading" />
                <Text variant="label" color={colors.textSecondary}>
                  %
                </Text>
              </View>
            ) : (
              <TweenNumber value={Math.round(metric.value)} variant="heading" />
            )
          ) : null}
        </ProgressRing>
        <View style={styles.ringText}>
          <Text variant="label">
            {label}
            {live && metric ? <Text variant="label" color={colors.textTertiary}>{` ${unit}`}</Text> : null}
          </Text>
          {live ? (
            <Text variant="caption" color={colors.textSecondary} style={styles.tabular} numberOfLines={1} adjustsFontSizeToFit>
              {metric ? (hasGoal ? `${fmt(metric.value)} / ${fmt(metric.goal)}` : "No goal set") : "No data yet"}
            </Text>
          ) : (
            <Text variant="caption" color={colors.text} numberOfLines={1}>
              {ready ? action : " "}
            </Text>
          )}
        </View>
      </PressableScale>
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
              {meta ? (badge.unlocked ? meta.took : meta.how) : "Keep using yuzu to unlock it."}
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

function TodayBody({
  userId,
  connections,
  afterRings,
}: {
  userId: Id<"users">;
  connections: MyConnection[] | undefined;
  afterRings?: ReactNode;
}) {
  const today = useQuery(api.today.get, { userId });
  const refresh = useAction(api.today.summary);
  const [open, setOpen] = useState<Achievement | null>(null);
  const { width } = useWindowDimensions();
  const ringSize = Math.max(84, Math.min(108, Math.floor((Math.min(width, 520) - space.gutter * 2 - space.md * 2) / 3)));

  useEffect(() => {
    refresh({ userId }).catch(() => {});
  }, [refresh, userId]);

  const conn = (slug: string) => connections?.find((c) => c.appSlug === slug);
  const isLive = (slug: string) => conn(slug)?.status === "live";
  // Food rings fill from MyFitnessPal; Cronometer stands in only when it's the one you connected.
  const foodSlug = !isLive("myfitnesspal") && isLive("cronometer") ? "cronometer" : "myfitnesspal";

  const streak = today?.streakDays ?? 0;
  const xp = today?.xp ?? 0;
  const badges = (today?.achievements ?? []).filter((a) => a.key in BADGES && !HIDDEN_BADGES.has(a.key));
  const unlocked = badges.filter((a) => a.unlocked).length;

  return (
    <View style={styles.wrap}>
      <View style={styles.rings}>
        <Ring index={0} size={ringSize} label="Fuel" unit="kcal" metric={today?.fuel ?? null} slug={foodSlug} connection={conn(foodSlug)} ready={connections !== undefined} />
        <Ring index={1} size={ringSize} label="Protein" unit="g" metric={today?.protein ?? null} slug={foodSlug} connection={conn(foodSlug)} ready={connections !== undefined} />
        <Ring index={2} size={ringSize} label="Training" unit="sets" metric={today?.training ?? null} slug="strong" connection={conn("strong")} ready={connections !== undefined} />
      </View>

      {afterRings}

      {today && (streak > 0 || xp > 0) ? (
        <Animated.View entering={enter(3)} layout={layout} style={styles.statsRow}>
          <View style={styles.chip}>
            {streak > 0 ? <Icon name="flame" size={18} autoPlay /> : null}
            <Text variant="label" style={styles.tabular}>
              {streak > 0 ? `${streak}-day streak` : "Log today to start a streak"}
            </Text>
          </View>
          <View style={styles.xp}>
            <TweenNumber value={xp} variant="heading" />
            <Text variant="label" color={colors.textTertiary}>
              XP
            </Text>
          </View>
        </Animated.View>
      ) : null}

      {badges.length > 0 ? (
        <Animated.View entering={enter(4)} layout={layout}>
          <View style={styles.sectionHead}>
            <Text variant="label" color={colors.textSecondary}>
              Achievements
            </Text>
            <Text variant="label" color={colors.textTertiary} style={styles.tabular}>
              {unlocked} of {badges.length}
            </Text>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.badges}>
            {badges.map((a, i) => (
              <Badge key={a.key} a={a} index={i + 5} onPress={() => setOpen(a)} />
            ))}
          </ScrollView>
        </Animated.View>
      ) : null}

      <AchievementSheet badge={open} onClose={() => setOpen(null)} />
    </View>
  );
}

export function TodayPanel({
  userId,
  connections,
  afterRings,
}: {
  userId: Id<"users"> | null;
  connections: MyConnection[] | undefined;
  /** Rendered right under the rings (the first-run prompt lives here). */
  afterRings?: ReactNode;
}) {
  if (!userId) return afterRings ?? null;
  return (
    <Boundary fallback={afterRings ?? null}>
      <TodayBody userId={userId} connections={connections} afterRings={afterRings} />
    </Boundary>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.xl },
  rings: { flexDirection: "row", justifyContent: "space-between", gap: space.md },
  ringCell: { flex: 1, alignItems: "center" },
  ringPress: { alignItems: "center", gap: space.md },
  ringText: { alignItems: "center", gap: 2 },
  pct: { flexDirection: "row", alignItems: "baseline", gap: 1 },
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
  xp: { flexDirection: "row", alignItems: "baseline", gap: 4 },
  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: space.sm,
    paddingHorizontal: space.xs,
  },
  badges: { gap: space.md, paddingHorizontal: space.xs },
  badge: {
    width: 48,
    height: 48,
    borderRadius: 24,
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
