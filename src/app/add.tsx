import { useQuery } from "convex/react";
import { useRouter } from "expo-router";
import { memo, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { taglineFor } from "@/components/app-copy";
import { AppGlyph } from "@/components/app-glyph";
import { Icon } from "@/components/icon";
import { PressableScale } from "@/components/pressable-scale";
import { Text } from "@/components/text";
import { api, type MyConnection } from "@/hooks/convex";
import { useUser } from "@/hooks/user";
import type { CatalogApp } from "@/lib/contract";
import { colors, enter, space } from "@/theme";

const TILE = 88;
const GUTTER = 20;
const COL_GAP = 18;
const ORDER = ["myfitnesspal", "strong", "duolingo", "cronometer", "parkmobile"];
const IN_PROGRESS = new Set(["building", "capturing", "needs_code"]);
const STATUS_RANK: Record<string, number> = { live: 0, building: 1, capturing: 1, needs_code: 1, needs_login: 2, error: 3 };

const rank = (slug: string) => {
  const i = ORDER.indexOf(slug);
  return i === -1 ? ORDER.length : i;
};

/** Taglines show only when every one fits on a single line under its tile. */
function useTaglinesFit(texts: string[], width: number) {
  const [lines, setLines] = useState<Record<string, number>>({});
  const key = (t: string) => `${Math.round(width)}|${t}`;
  const fits = texts.length > 0 && texts.every((t) => lines[key(t)] === 1);
  const probe = (
    <View
      pointerEvents="none"
      style={[styles.probe, { width }]}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {texts.map((t) => (
        <Text
          key={t}
          variant="micro"
          onTextLayout={(e) => {
            const n = e.nativeEvent.lines.length;
            setLines((prev) => (prev[key(t)] === n ? prev : { ...prev, [key(t)]: n }));
          }}
        >
          {t}
        </Text>
      ))}
    </View>
  );
  return { fits, probe };
}

const PickerTile = memo(function PickerTile({
  app,
  tagline,
  connected,
  index,
  width,
  onPress,
}: {
  app: Pick<CatalogApp, "slug" | "name" | "category">;
  tagline?: string;
  connected: boolean;
  index: number;
  width: number;
  onPress: () => void;
}) {
  return (
    <Animated.View entering={enter(index)} style={{ width }}>
      <PressableScale
        onPress={onPress}
        haptic="selection"
        accessibilityLabel={connected ? `Open ${app.name}` : `Connect ${app.name}`}
        style={styles.tile}
      >
        <View style={styles.logo}>
          <AppGlyph app={app} size={TILE} />
          {connected ? (
            <View style={styles.badge}>
              <Icon name="checkBlack" size={16} />
            </View>
          ) : null}
        </View>
        <Text variant="label" numberOfLines={1} style={styles.center}>
          {app.name}
        </Text>
        {tagline ? (
          <Text variant="micro" color={colors.textTertiary} numberOfLines={1} style={styles.center}>
            {tagline}
          </Text>
        ) : null}
      </PressableScale>
    </Animated.View>
  );
});

/** App picker opened from the Add tile. Apps you already have open their page. */
export default function AddApp() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { userId } = useUser();
  const apps = useQuery(api.apps.list);
  const connections = useQuery(api.connections.mine, userId ? { userId } : "skip");
  const tileWidth = Math.floor((Math.min(width, 520) - GUTTER * 2 - COL_GAP * 2) / 3);

  const sorted = [...(apps ?? [])].sort((a, b) => rank(a.slug) - rank(b.slug));
  const { fits, probe } = useTaglinesFit(
    sorted.map((a) => taglineFor(a)).filter(Boolean),
    tileWidth,
  );

  // One connection per app: the most useful one when there are several.
  const bySlug = new Map<string, MyConnection>();
  for (const c of connections ?? []) {
    const cur = bySlug.get(c.appSlug);
    if (!cur || (STATUS_RANK[String(c.status)] ?? 9) < (STATUS_RANK[String(cur.status)] ?? 9)) bySlug.set(c.appSlug, c);
  }

  const pick = (slug: string) => {
    const c = bySlug.get(slug);
    const status = c ? String(c.status) : undefined;
    router.back();
    if (status === "live") router.push({ pathname: "/app/[slug]", params: { slug } });
    else if (c && status && IN_PROGRESS.has(status))
      router.push({ pathname: "/build/[connectionId]", params: { connectionId: c._id, slug } });
    else router.push({ pathname: "/connect/[slug]", params: { slug } });
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.bar}>
        <PressableScale onPress={() => router.back()} hitSlop={12} scaleTo={0.94} haptic="selection" accessibilityLabel="Close">
          <Text variant="bodyMedium" color={colors.textSecondary}>
            Close
          </Text>
        </PressableScale>
      </View>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space.xxl }]}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View entering={enter(0)}>
          <Text style={styles.title}>Add an app</Text>
        </Animated.View>
        {apps === undefined ? (
          <ActivityIndicator color={colors.textTertiary} style={styles.loading} />
        ) : (
          <View style={styles.grid}>
            {probe}
            {sorted.map((a, i) => (
              <PickerTile
                key={a.slug}
                app={a}
                tagline={fits ? taglineFor(a) : undefined}
                connected={bySlug.get(a.slug)?.status === "live"}
                index={i + 1}
                width={tileWidth}
                onPress={() => pick(a.slug)}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  bar: { height: 48, flexDirection: "row", alignItems: "center", paddingHorizontal: GUTTER },
  content: { paddingHorizontal: GUTTER, paddingTop: space.sm, gap: space.xxl },
  title: { fontFamily: "Inter_600SemiBold", fontSize: 30, lineHeight: 36, letterSpacing: -0.6, color: colors.text },
  loading: { paddingVertical: space.xl },
  grid: { flexDirection: "row", flexWrap: "wrap", columnGap: COL_GAP, rowGap: 28 },
  probe: { position: "absolute", top: 0, left: 0, opacity: 0 },
  tile: { alignItems: "center", gap: 6 },
  logo: { width: TILE, height: TILE, marginBottom: 4 },
  badge: {
    position: "absolute",
    top: -5,
    right: -5,
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2.5,
    borderColor: colors.bg,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  center: { textAlign: "center" },
});
