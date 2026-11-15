import { memo, useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withDelay, withSequence, withTiming } from "react-native-reanimated";

import { looksInternal, verbForTool } from "@/components/app-copy";
import type { Activity, CatalogEntry } from "@/hooks/convex";
import { assistantName, timeAgo } from "@/hooks/format";
import { colors, easeFill, enter, layout, space } from "@/theme";

import { AppGlyph } from "../app-glyph";
import { PressableScale } from "../pressable-scale";
import { Text } from "../text";

// Backend id for actions taken inside yuzu itself (old and new name).
const IN_APP = new Set<string>(["ycyc", "yuzu"]);

function readable(text: string | undefined | null): boolean {
  return !!text && !looksInternal(text) && !/[{}[\]"<>]/.test(text) && text.length <= 80;
}

/** "Logged 2 eggs" -> "logged 2 eggs", but leaves names like "MyFitnessPal" alone. */
function lowerFirst(s: string): string {
  const word = s.split(" ")[0] ?? "";
  return /^[A-Z][a-z']*$/.test(word) && word !== "I" ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

/** One plain sentence: "Claude logged 2 eggs to breakfast in MyFitnessPal". */
export function activityLine(item: Activity, appName: string): string {
  if (item.tool === "connect") return `Connected ${appName}`;
  let what = readable(item.summary) ? item.summary : item.summary.split(":")[0]?.trim();
  if (!readable(what)) what = verbForTool(item.appSlug, item.tool) ?? `Used ${appName}`;
  const where = what.toLowerCase().includes(appName.toLowerCase()) ? "" : ` in ${appName}`;
  if (IN_APP.has(item.assistant)) return `${what}${where}`;
  return `${assistantName(item.assistant)} ${lowerFirst(what)}${where}`;
}

function statusLine(item: Activity): { text: string; tone: string } | null {
  if (item.status === "pending_approval") return { text: "Waiting for you", tone: colors.textSecondary };
  if (item.status === "denied") return { text: "Denied", tone: colors.textSecondary };
  if (item.status === "error") return { text: "Didn't go through", tone: colors.error };
  return null;
}

export const RecentRow = memo(function RecentRow({
  item,
  app,
  now,
  index,
  flash,
  onPress,
}: {
  item: Activity;
  app: CatalogEntry | undefined;
  now: number;
  index: number;
  /** Change to briefly light the row up (newest row after returning from an assistant). */
  flash: number;
  onPress: () => void;
}) {
  const line = activityLine(item, app?.name ?? "yuzu");
  const status = statusLine(item);
  const glow = useSharedValue(0);

  useEffect(() => {
    if (!flash) return;
    glow.set(
      withSequence(
        withTiming(1, { duration: 220, easing: easeFill }),
        withDelay(900, withTiming(0, { duration: 700, easing: easeFill })),
      ),
    );
  }, [flash, glow]);

  const glowStyle = useAnimatedStyle(() => ({ opacity: glow.get() }));

  return (
    <Animated.View entering={enter(index)} layout={layout}>
      <PressableScale onPress={onPress} accessibilityLabel={line} scaleTo={0.98} haptic="selection" style={styles.row}>
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.glow, glowStyle]} />
        <AppGlyph app={app ?? { slug: item.appSlug, category: "other" }} size={28} />
        <View style={styles.text}>
          <Text variant="body" numberOfLines={2}>
            {line}
          </Text>
          {status ? (
            <Text variant="caption" color={status.tone} numberOfLines={1}>
              {status.text}
            </Text>
          ) : null}
        </View>
        <Text variant="caption" color={colors.textTertiary} style={styles.time}>
          {timeAgo(item.at, now)}
        </Text>
      </PressableScale>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingVertical: 10,
    paddingHorizontal: space.sm,
    borderRadius: 14,
  },
  glow: { backgroundColor: colors.surface2, borderRadius: 14 },
  text: { flex: 1, gap: 2 },
  time: { fontVariant: ["tabular-nums"] },
});
