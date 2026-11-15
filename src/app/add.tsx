import { useQuery } from "convex/react";
import { useRouter } from "expo-router";
import { ActivityIndicator, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PickTile } from "@/components/app-tile";
import { TopBar } from "@/components/layout";
import { Text } from "@/components/text";
import { api } from "@/hooks/convex";
import { useUser } from "@/hooks/user";
import { colors, enter, space } from "@/theme";

/** App picker opened from the Add tile. Only apps you haven't added yet. */
export default function AddApp() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { userId } = useUser();
  const apps = useQuery(api.apps.list);
  const connections = useQuery(api.connections.mine, userId ? { userId } : "skip");
  const added = new Set((connections ?? []).map((c) => c.appSlug));
  const choices = (apps ?? []).filter((a) => !added.has(a.slug));
  const cardWidth = (Math.min(width, 520) - space.gutter * 2 - space.md) / 2;

  const pick = (slug: string) => {
    router.back();
    router.push({ pathname: "/connect/[slug]", params: { slug } });
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <TopBar left="Close" onLeft={() => router.back()} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space.xxl }]}>
        <Animated.View entering={enter(0)}>
          <Text variant="title">Add an app</Text>
        </Animated.View>
        {apps === undefined ? (
          <ActivityIndicator color={colors.textTertiary} style={styles.loading} />
        ) : choices.length === 0 ? (
          <Text variant="body" color={colors.textSecondary}>
            You&apos;ve added every app we support so far.
          </Text>
        ) : (
          <View style={styles.grid}>
            {choices.map((a, i) => (
              <PickTile key={a.slug} app={a} index={i + 1} width={cardWidth} onPress={() => pick(a.slug)} />
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: space.gutter, paddingTop: space.sm, gap: space.xl },
  loading: { paddingVertical: space.xl },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space.md },
});
