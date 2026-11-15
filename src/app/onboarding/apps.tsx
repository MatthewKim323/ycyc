import { useQuery } from "convex/react";
import { useRouter } from "expo-router";
import { memo, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { taglineFor } from "@/components/app-copy";
import { AppGlyph } from "@/components/app-glyph";
import { useBackdropDim } from "@/components/onboarding-chrome";
import { PressableScale } from "@/components/pressable-scale";
import { Text } from "@/components/text";
import { api } from "@/hooks/convex";
import { useOnboarding } from "@/hooks/onboarding";
import type { CatalogApp } from "@/lib/contract";
import { colors, enter, space } from "@/theme";

const TILE = 88;
const GUTTER = 20;
const COL_GAP = 18;
const ORDER = ["myfitnesspal", "strong", "duolingo", "cronometer", "parkmobile"];

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
  index,
  width,
  onPress,
}: {
  app: Pick<CatalogApp, "slug" | "name" | "category">;
  tagline?: string;
  index: number;
  width: number;
  onPress: () => void;
}) {
  return (
    <Animated.View entering={enter(index)} style={{ width }}>
      <PressableScale onPress={onPress} haptic="selection" accessibilityLabel={`Connect ${app.name}`} style={styles.tile}>
        <View style={styles.logo}>
          <AppGlyph app={app} size={TILE} />
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

/** First-run app picker. The shader fades to solid black: lists never sit on it. */
export default function PickApp() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const tileWidth = Math.floor((Math.min(width, 520) - GUTTER * 2 - COL_GAP * 2) / 3);
  const apps = useQuery(api.apps.list);
  const { finish } = useOnboarding();
  useBackdropDim(1, 300);

  const sorted = [...(apps ?? [])].sort((a, b) => rank(a.slug) - rank(b.slug));
  const { fits, probe } = useTaglinesFit(
    sorted.map((a) => taglineFor(a)).filter(Boolean),
    tileWidth,
  );

  const skip = async () => {
    await finish();
    router.replace("/");
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.bar}>
        <PressableScale onPress={() => router.back()} hitSlop={12} scaleTo={0.94} haptic="selection" accessibilityLabel="Back">
          <Text variant="bodyMedium" color={colors.textSecondary}>
            Back
          </Text>
        </PressableScale>
        <PressableScale onPress={skip} hitSlop={12} scaleTo={0.94} haptic="selection" accessibilityLabel="Skip for now">
          <Text variant="bodyMedium" color={colors.textSecondary}>
            Skip
          </Text>
        </PressableScale>
      </View>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space.xxl }]}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View entering={enter(0)}>
          <Text style={styles.title}>Pick an app</Text>
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
                index={i + 1}
                width={tileWidth}
                onPress={() => router.push({ pathname: "/connect/[slug]", params: { slug: a.slug, onboarding: "1" } })}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  bar: {
    height: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: GUTTER,
  },
  content: { paddingHorizontal: GUTTER, paddingTop: space.sm, gap: space.xxl },
  title: { fontFamily: "Inter_600SemiBold", fontSize: 30, lineHeight: 36, letterSpacing: -0.6, color: colors.text },
  loading: { paddingVertical: space.xl },
  grid: { flexDirection: "row", flexWrap: "wrap", columnGap: COL_GAP, rowGap: 28 },
  probe: { position: "absolute", top: 0, left: 0, opacity: 0 },
  tile: { alignItems: "center", gap: 6 },
  logo: { width: TILE, height: TILE, marginBottom: 4 },
  center: { textAlign: "center" },
});
