import * as Haptics from "expo-haptics";
import { memo, useEffect, useRef } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";

import type { CatalogApp } from "@/lib/contract";
import { colors, enter, radius, space, springs } from "@/theme";

import { AppGlyph } from "./app-glyph";
import { PressableScale } from "./pressable-scale";
import { StatusDot, type DotState } from "./status-dot";
import { Text } from "./text";

const CAPABILITY: Record<string, string> = {
  myfitnesspal: "Food diary, macros",
  strong: "Workouts, sets, PRs",
  flo: "Cycle, symptoms",
};

export function capabilityOf(app: Pick<CatalogApp, "slug" | "blurb">): string {
  return CAPABILITY[app.slug] ?? app.blurb;
}

export type TileState = { kind: "available" } | { kind: "live"; tools: number } | { kind: "status"; dot: DotState; label: string };

const FLIP = { damping: 20, stiffness: 140, mass: 1 };

/**
 * Collectible app tile. Front face shows the app and what it does; the live face shows it working.
 * When a connection goes live while the tile is on screen, it flips over once with a Success haptic.
 */
export const AppTile = memo(function AppTile({
  app,
  state,
  index,
  onPress,
}: {
  app: Pick<CatalogApp, "slug" | "name" | "category" | "blurb">;
  state: TileState;
  index: number;
  onPress: () => void;
}) {
  const { width } = useWindowDimensions();
  const cellWidth = (Math.min(width, 520) - space.gutter * 2 - space.md) / 2;
  const live = state.kind === "live";
  const rot = useSharedValue(live ? 180 : 0);
  const wasLive = useRef(live);

  useEffect(() => {
    if (live && !wasLive.current) {
      rot.set(withSpring(180, FLIP));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } else if (!live && wasLive.current) {
      rot.set(withSpring(0, springs.layout));
    }
    wasLive.current = live;
  }, [live, rot]);

  const front = useAnimatedStyle(() => ({
    transform: [{ perspective: 800 }, { rotateY: `${rot.get()}deg` }],
    opacity: rot.get() < 90 ? 1 : 0,
  }));
  const back = useAnimatedStyle(() => ({
    transform: [{ perspective: 800 }, { rotateY: `${rot.get() - 180}deg` }],
    opacity: rot.get() >= 90 ? 1 : 0,
  }));

  const label =
    state.kind === "live"
      ? `${app.name}, live, ${state.tools} tools`
      : state.kind === "status"
        ? `${app.name}, ${state.label}`
        : `Connect ${app.name}`;

  return (
    <Animated.View entering={enter(index)} style={{ width: cellWidth }}>
      <PressableScale onPress={onPress} haptic="selection" accessibilityLabel={label} style={styles.press}>
        <Animated.View style={[styles.face, front]}>
          <AppGlyph app={app} size={40} />
          <View style={styles.text}>
            <Text variant="rowTitle" numberOfLines={1}>
              {app.name}
            </Text>
            {state.kind === "status" ? (
              <View style={styles.statusLine}>
                <StatusDot state={state.dot} size={6} />
                <Text variant="caption" color={state.dot === "error" ? colors.error : colors.textSecondary} numberOfLines={1}>
                  {state.label}
                </Text>
              </View>
            ) : (
              <Text variant="caption" color={colors.textTertiary} numberOfLines={1}>
                {capabilityOf(app)}
              </Text>
            )}
          </View>
        </Animated.View>
        <Animated.View style={[styles.face, styles.liveFace, back]}>
          <View style={styles.liveTop}>
            <AppGlyph app={app} size={40} />
            <View style={styles.livePill}>
              <StatusDot state="live" size={6} />
              <Text variant="micro" color={colors.text}>
                Live
              </Text>
            </View>
          </View>
          <View style={styles.text}>
            <Text variant="rowTitle" numberOfLines={1}>
              {app.name}
            </Text>
            <Text variant="caption" color={colors.textSecondary} style={styles.tabular} numberOfLines={1}>
              {state.kind === "live" ? `${state.tools} ${state.tools === 1 ? "tool" : "tools"} in every assistant` : ""}
            </Text>
          </View>
        </Animated.View>
      </PressableScale>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  press: { height: 128 },
  face: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
    justifyContent: "space-between",
    backfaceVisibility: "hidden",
  },
  liveFace: { borderColor: colors.borderStrong, backgroundColor: colors.surface2 },
  liveTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  livePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  text: { gap: 2 },
  statusLine: { flexDirection: "row", alignItems: "center", gap: 6 },
  tabular: { fontVariant: ["tabular-nums"] },
});
