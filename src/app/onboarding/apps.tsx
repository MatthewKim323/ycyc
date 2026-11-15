import { useQuery } from "convex/react";
import { useRouter } from "expo-router";
import { ActivityIndicator, ScrollView, StyleSheet, useWindowDimensions, View } from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PickTile } from "@/components/app-tile";
import { useBackdropDim } from "@/components/onboarding-chrome";
import { PressableScale } from "@/components/pressable-scale";
import { Text } from "@/components/text";
import { api } from "@/hooks/convex";
import { useOnboarding } from "@/hooks/onboarding";
import { colors, enter, space } from "@/theme";

/** First-run app picker. The shader fades to solid black: lists never sit on it. */
export default function PickApp() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const cardWidth = (Math.min(width, 520) - space.gutter * 2 - space.md) / 2;
  const apps = useQuery(api.apps.list);
  const { finish } = useOnboarding();
  useBackdropDim(1, 300);

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
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space.xxl }]}>
        <Animated.View entering={enter(0)}>
          <Text variant="title">Pick an app</Text>
        </Animated.View>
        {apps === undefined ? (
          <ActivityIndicator color={colors.textTertiary} style={styles.loading} />
        ) : (
          <View style={styles.grid}>
            {apps.map((a, i) => (
              <PickTile
                key={a.slug}
                app={a}
                index={i + 1}
                width={cardWidth}
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
    paddingHorizontal: space.gutter,
  },
  content: { paddingHorizontal: space.gutter, paddingTop: space.sm, gap: space.xl },
  loading: { paddingVertical: space.xl },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space.md },
});
