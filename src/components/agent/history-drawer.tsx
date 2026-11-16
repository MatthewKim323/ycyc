import { useEffect, type ReactNode } from "react";
import { Keyboard, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import { GestureDetector, usePanGesture } from "react-native-gesture-handler";
import Animated, { interpolate, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { scheduleOnRN } from "react-native-worklets";

import { colors, hairline, space, springs } from "@/theme";

import { Icon } from "../icon";
import { PressableScale } from "../pressable-scale";
import { Text } from "../text";

export type HistoryThread = {
  threadId: string;
  title: string;
  updatedAt: number;
};

const DAY = 24 * 60 * 60 * 1000;
const FLING = 500;

/** Today, Yesterday, Previous 7 days, Older. Newest first inside each. */
export function groupThreads(threads: HistoryThread[], now = Date.now()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const today = start.getTime();
  const groups: { title: string; items: HistoryThread[] }[] = [
    { title: "Today", items: [] },
    { title: "Yesterday", items: [] },
    { title: "Previous 7 days", items: [] },
    { title: "Older", items: [] },
  ];
  for (const t of threads) {
    const i = t.updatedAt >= today ? 0 : t.updatedAt >= today - DAY ? 1 : t.updatedAt >= today - 7 * DAY ? 2 : 3;
    groups[i]!.items.push(t);
  }
  return groups.filter((g) => g.items.length > 0);
}

/**
 * Left drawer for past chats. The screen slides right and dims while the panel shows. Swipe from
 * the left to open, swipe back, tap the dimmed screen or pick a row to close.
 */
export function HistoryDrawer({
  open,
  onOpenChange,
  threads,
  currentId,
  onPick,
  onNewChat,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  threads: HistoryThread[];
  currentId: string | null;
  onPick: (threadId: string) => void;
  onNewChat: () => void;
  children: ReactNode;
}) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const panelW = Math.min(Math.round(width * 0.84), 340);
  const progress = useSharedValue(0);
  const target = useSharedValue(0);
  const start = useSharedValue(0);

  useEffect(() => {
    const to = open ? 1 : 0;
    if (open) Keyboard.dismiss();
    if (target.get() === to) return;
    target.set(to);
    progress.set(withSpring(to, springs.sheet));
  }, [open, progress, target]);

  const pan = usePanGesture({
    activeOffsetX: [-12, 12],
    failOffsetY: [-12, 12],
    onActivate: () => {
      "worklet";
      start.set(progress.get());
    },
    onUpdate: (e) => {
      "worklet";
      progress.set(Math.min(1, Math.max(0, start.get() + e.translationX / panelW)));
    },
    onDeactivate: (e) => {
      "worklet";
      const v = e.velocityX;
      const to = v > FLING ? 1 : v < -FLING ? 0 : progress.get() > 0.5 ? 1 : 0;
      target.set(to);
      progress.set(withSpring(to, { ...springs.sheet, velocity: v / panelW }));
      scheduleOnRN(onOpenChange, to === 1);
    },
  });

  const mainStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: progress.get() * panelW }],
  }));
  const dimStyle = useAnimatedStyle(() => ({ opacity: progress.get() * 0.6 }));
  const edgeStyle = useAnimatedStyle(() => ({ opacity: progress.get() }));
  const panelStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: interpolate(progress.get(), [0, 1], [-panelW * 0.25, 0]) }],
  }));

  const groups = groupThreads(threads);

  return (
    <View style={styles.root}>
      <Animated.View
        style={[styles.panel, { width: panelW, paddingTop: insets.top + space.sm }, panelStyle]}
        accessibilityElementsHidden={!open}
        importantForAccessibility={open ? "auto" : "no-hide-descendants"}
      >
        <PressableScale onPress={onNewChat} haptic="selection" accessibilityLabel="New chat" style={styles.newChat}>
          <Icon name="plus" size={22} />
          <Text variant="rowTitle">New chat</Text>
        </PressableScale>
        <ScrollView
          style={styles.flex}
          contentContainerStyle={{ paddingBottom: insets.bottom + space.lg }}
          showsVerticalScrollIndicator={false}
        >
          {groups.map((g) => (
            <View key={g.title} style={styles.group}>
              <Text variant="micro" color={colors.textTertiary} style={styles.groupTitle}>
                {g.title}
              </Text>
              {g.items.map((t) => (
                <ThreadRow
                  key={t.threadId}
                  thread={t}
                  current={t.threadId === currentId}
                  onPress={() => onPick(t.threadId)}
                />
              ))}
            </View>
          ))}
        </ScrollView>
      </Animated.View>

      <GestureDetector gesture={pan}>
        <Animated.View style={[styles.main, mainStyle]}>
          {children}
          <Animated.View pointerEvents="none" style={[styles.edge, edgeStyle]} />
          <Animated.View pointerEvents={open ? "auto" : "none"} style={[StyleSheet.absoluteFill, styles.dim, dimStyle]}>
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={() => onOpenChange(false)}
              accessibilityLabel="Close chats"
            />
          </Animated.View>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

export function ThreadRow({
  thread,
  current,
  onPress,
  currentBg = colors.surface2,
}: {
  thread: HistoryThread;
  current: boolean;
  onPress: () => void;
  currentBg?: string;
}) {
  return (
    <PressableScale
      onPress={onPress}
      haptic="selection"
      accessibilityLabel={thread.title || "Chat"}
      accessibilityState={{ selected: current }}
      style={[styles.row, current && { backgroundColor: currentBg }]}
    >
      <Text variant="body" color={colors.textSecondary} numberOfLines={1}>
        {thread.title || "Chat"}
      </Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surface, overflow: "hidden" },
  flex: { flex: 1 },
  panel: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    backgroundColor: colors.surface,
  },
  main: { flex: 1, backgroundColor: colors.bg },
  edge: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    width: hairline,
    backgroundColor: colors.border,
  },
  dim: { backgroundColor: colors.bg },
  newChat: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    minHeight: 48,
    marginHorizontal: space.sm,
    paddingHorizontal: space.md,
    borderRadius: 12,
  },
  group: { paddingTop: space.lg },
  groupTitle: {
    paddingHorizontal: space.lg + space.sm,
    paddingBottom: space.xs,
  },
  row: {
    minHeight: 44,
    justifyContent: "center",
    marginHorizontal: space.sm,
    paddingHorizontal: space.md,
    borderRadius: 12,
  },
});
