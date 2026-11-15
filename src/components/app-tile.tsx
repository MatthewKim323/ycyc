import * as Haptics from "expo-haptics";
import { memo, useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";

import type { CatalogApp } from "@/lib/contract";
import { colors, enter, radius, space, springs } from "@/theme";

import { taglineFor } from "./app-copy";
import { AppGlyph } from "./app-glyph";
import { Icon } from "./icon";
import { PressableScale } from "./pressable-scale";
import { Text } from "./text";

export { taglineFor as capabilityOf } from "./app-copy";

export const TILE = 88;
const FLIP = { damping: 20, stiffness: 140, mass: 1 };

/**
 * Home-screen style app tile: big logo, name underneath. While an app is still being set up the logo
 * sits dimmed with a short note; the moment it's ready the tile flips to the full logo once, with a
 * Success haptic.
 */
export const AppTile = memo(function AppTile({
  app,
  ready,
  note,
  index,
  width,
  onPress,
}: {
  app: Pick<CatalogApp, "slug" | "name" | "category">;
  ready: boolean;
  /** Short state under the name while not ready ("Setting up", "Sign in"). */
  note?: string;
  index: number;
  width: number;
  onPress: () => void;
}) {
  const rot = useSharedValue(ready ? 180 : 0);
  const wasReady = useRef(ready);

  useEffect(() => {
    if (ready && !wasReady.current) {
      rot.set(withSpring(180, FLIP));
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } else if (!ready && wasReady.current) {
      rot.set(withSpring(0, springs.layout));
    }
    wasReady.current = ready;
  }, [ready, rot]);

  const front = useAnimatedStyle(() => ({
    transform: [{ perspective: 800 }, { rotateY: `${rot.get()}deg` }],
    opacity: rot.get() < 90 ? 1 : 0,
  }));
  const back = useAnimatedStyle(() => ({
    transform: [{ perspective: 800 }, { rotateY: `${rot.get() - 180}deg` }],
    opacity: rot.get() >= 90 ? 1 : 0,
  }));

  return (
    <Animated.View entering={enter(index)} style={{ width }}>
      <PressableScale
        onPress={onPress}
        haptic="selection"
        accessibilityLabel={note ? `${app.name}, ${note}` : app.name}
        style={styles.press}
      >
        <View style={styles.logoBox}>
          <Animated.View style={[styles.face, front]}>
            <View style={styles.dim}>
              <AppGlyph app={app} size={TILE} />
            </View>
          </Animated.View>
          <Animated.View style={[styles.face, back]}>
            <AppGlyph app={app} size={TILE} />
          </Animated.View>
        </View>
        <Text variant="label" numberOfLines={1} style={styles.center}>
          {app.name}
        </Text>
        {!ready && note ? (
          <Text variant="micro" color={colors.textTertiary} numberOfLines={1} style={styles.center}>
            {note}
          </Text>
        ) : null}
      </PressableScale>
    </Animated.View>
  );
});

/** Dashed "Add" tile that opens the app picker. */
export function AddTile({ index, width, onPress }: { index: number; width: number; onPress: () => void }) {
  return (
    <Animated.View entering={enter(index)} style={{ width }}>
      <PressableScale onPress={onPress} haptic="selection" accessibilityLabel="Add an app" style={styles.press}>
        <View style={styles.add}>
          <Icon name="plus" size={30} opacity={0.5} />
        </View>
        <Text variant="label" color={colors.textSecondary} style={styles.center}>
          Add
        </Text>
      </PressableScale>
    </Animated.View>
  );
}

/** Wider picker card: logo, name and what it's for. */
export const PickTile = memo(function PickTile({
  app,
  index,
  width,
  onPress,
}: {
  app: Pick<CatalogApp, "slug" | "name" | "category" | "blurb">;
  index: number;
  width: number;
  onPress: () => void;
}) {
  return (
    <Animated.View entering={enter(index)} style={{ width }}>
      <PressableScale onPress={onPress} haptic="selection" accessibilityLabel={`Connect ${app.name}`} style={styles.card}>
        <AppGlyph app={app} size={44} />
        <View style={styles.cardText}>
          <Text variant="rowTitle" numberOfLines={1}>
            {app.name}
          </Text>
          <Text variant="caption" color={colors.textTertiary} numberOfLines={1}>
            {taglineFor(app)}
          </Text>
        </View>
      </PressableScale>
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  press: { alignItems: "center", gap: 6 },
  logoBox: { width: TILE, height: TILE, marginBottom: 4 },
  face: { ...StyleSheet.absoluteFill, backfaceVisibility: "hidden" },
  dim: { opacity: 0.35 },
  center: { textAlign: "center" },
  add: {
    width: TILE,
    height: TILE,
    borderRadius: 24,
    borderWidth: 1.5,
    borderStyle: "dashed",
    borderColor: colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  card: {
    height: 128,
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
    justifyContent: "space-between",
  },
  cardText: { gap: 2 },
});
