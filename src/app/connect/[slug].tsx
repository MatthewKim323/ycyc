import { useMutation, useQuery } from "convex/react";
import { type Href, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import Animated, {
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppGlyph } from "@/components/app-glyph";
import { Button } from "@/components/button";
import { Icon, type IconName } from "@/components/icon";
import { Text } from "@/components/text";
import { api } from "@/hooks/convex";
import { usePlan } from "@/components/paywall/use-plan";
import { useUser } from "@/hooks/user";
import { colors, enter, radius, space, springs } from "@/theme";

function Lockup({ app }: { app: { slug: string; category: "nutrition" | "training" | "cycle" | "other" } }) {
  const apart = useSharedValue(8);
  useEffect(() => {
    apart.set(withDelay(150, withSpring(0, springs.enter)));
  }, [apart]);
  const left = useAnimatedStyle(() => ({ transform: [{ translateX: -apart.get() }] }));
  const right = useAnimatedStyle(() => ({ transform: [{ translateX: apart.get() }] }));
  return (
    <View style={styles.lockup}>
      <Animated.View style={[styles.mark, left]}>
        <Text variant="label" color={colors.onAccent}>
          ycyc
        </Text>
      </Animated.View>
      <Animated.View entering={FadeIn.delay(250).duration(280)}>
        <Icon name="link" size={20} opacity={0.7} />
      </Animated.View>
      <Animated.View style={right}>
        <AppGlyph app={app} size={48} />
      </Animated.View>
    </View>
  );
}

function ValueRow({ icon, title, body, index }: { icon: IconName; title: string; body: string; index: number }) {
  return (
    <Animated.View entering={enter(index + 2)} style={styles.valueRow}>
      <View style={styles.valueIcon}>
        <Icon name={icon} size={22} />
      </View>
      <View style={styles.valueText}>
        <Text variant="bodyMedium">{title}</Text>
        <Text variant="caption" color={colors.textSecondary}>
          {body}
        </Text>
      </View>
    </Animated.View>
  );
}

/** Pre-sign-in sheet: what connecting means, then one Continue. */
export default function ConnectSheet() {
  const { slug, onboarding } = useLocalSearchParams<{ slug: string; onboarding?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { userId } = useUser();
  const app = useQuery(api.apps.get, slug ? { slug } : "skip");
  const start = useMutation(api.connections.start);
  const { isPro } = usePlan();
  const mine = useQuery(api.connections.mine, userId ? { userId } : "skip");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const begin = async () => {
    if (!userId || !app) return;
    const otherLive = (mine ?? []).filter((c) => c.status === "live" && c.appSlug !== app.slug).length;
    if (!isPro && otherLive >= 1) {
      router.back();
      router.push("/paywall" as Href);
      return;
    }
    setError(null);
    setStarting(true);
    try {
      const connectionId = await start({ userId, appSlug: app.slug });
      router.back();
      router.push({
        pathname: "/build/[connectionId]",
        params: onboarding ? { connectionId, slug: app.slug, onboarding } : { connectionId, slug: app.slug },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start. Try again.");
      setStarting(false);
    }
  };

  if (!app) {
    return (
      <View style={[styles.sheet, styles.loading]}>
        {app === null ? (
          <Text variant="body" color={colors.textSecondary}>
            This app isn&apos;t in the library.
          </Text>
        ) : (
          <ActivityIndicator color={colors.textTertiary} />
        )}
      </View>
    );
  }

  const web = app.route === "web";

  return (
    <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, space.lg) + space.sm }]}>
      <Lockup app={app} />
      <Animated.View entering={enter(1)}>
        <Text variant="title" style={styles.center}>
          Connect {app.name}
        </Text>
      </Animated.View>
      <View style={styles.rows}>
        <ValueRow
          index={0}
          icon="fingerprint"
          title={web ? `Sign in on ${app.name}'s own page` : `Sign in with your ${app.name} account`}
          body="ycyc never stores your password."
        />
        <ValueRow
          index={1}
          icon="check"
          title="You approve every change"
          body="Assistants read freely. Logging or editing waits for your OK."
        />
      </View>
      {error ? (
        <Text variant="caption" color={colors.error} style={styles.center}>
          {error}
        </Text>
      ) : null}
      <Button label="Continue" onPress={begin} loading={starting} disabled={!userId} fullWidth />
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: colors.surface,
    paddingHorizontal: space.xl,
    paddingTop: space.xxl,
    gap: space.xl,
  },
  loading: { minHeight: 240, alignItems: "center", justifyContent: "center" },
  center: { textAlign: "center" },
  lockup: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.md },
  mark: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  rows: { gap: space.lg },
  valueRow: { flexDirection: "row", gap: space.md, alignItems: "flex-start" },
  valueIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  valueText: { flex: 1, gap: 2 },
});
