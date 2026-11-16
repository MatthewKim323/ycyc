import { useMutation, useQuery } from "convex/react";
import { type Href, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import Animated, {
  FadeIn,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSpring,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { copyFor, type Capability } from "@/components/app-copy";
import { AppGlyph } from "@/components/app-glyph";
import { Button } from "@/components/button";
import { Icon } from "@/components/icon";
import { usePlan } from "@/components/paywall/use-plan";
import { Text } from "@/components/text";
import { api } from "@/hooks/convex";
import { useUser } from "@/hooks/user";
import { CAPTURE_APPS } from "@/lib/capture/apps";
import type { CatalogApp } from "@/lib/contract";
import { colors, enter, radius, space, springs } from "@/theme";

const MARK = 56;

/** yuzu mark and the app's logo slide together, then the link between them plays once. */
function Lockup({ app }: { app: Pick<CatalogApp, "slug" | "category"> }) {
  const reduced = useReducedMotion();
  const apart = useSharedValue(reduced ? 0 : 16);
  const [linkPlay, setLinkPlay] = useState(0);

  useEffect(() => {
    if (reduced) return;
    apart.set(withDelay(150, withSpring(0, springs.enter)));
    const t = setTimeout(() => setLinkPlay(1), 480);
    return () => clearTimeout(t);
  }, [apart, reduced]);

  const left = useAnimatedStyle(() => ({ transform: [{ translateX: -apart.get() }] }));
  const right = useAnimatedStyle(() => ({ transform: [{ translateX: apart.get() }] }));

  return (
    <View style={styles.lockup} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Animated.View style={[styles.mark, left]}>
        <Text variant="label" color={colors.onAccent} style={styles.markText}>
          yuzu
        </Text>
      </Animated.View>
      <Animated.View entering={reduced ? undefined : FadeIn.delay(250).duration(240)}>
        <Icon name="link" size={20} opacity={0.6} playKey={linkPlay} />
      </Animated.View>
      <Animated.View style={right}>
        <AppGlyph app={app} size={MARK} />
      </Animated.View>
    </View>
  );
}

/** Two reads and the first write (writes wait for an OK), or three reads when the app has no writes. */
function highlights(slug: string): Capability[] {
  const can = copyFor(slug)?.can ?? [];
  const reads = can.filter((c) => !c.asks);
  const write = can.find((c) => c.asks);
  return write ? [...reads.slice(0, 2), write] : reads.slice(0, 3);
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
    } catch {
      setError("Couldn't start. Try again.");
      setStarting(false);
    }
  };

  if (!app) {
    return (
      <View style={[styles.sheet, styles.loading]}>
        {app === null ? (
          <Text variant="body" color={colors.textSecondary}>
            This app isn&apos;t available yet.
          </Text>
        ) : (
          <ActivityIndicator color={colors.textTertiary} />
        )}
      </View>
    );
  }

  const caps = highlights(app.slug);
  const signsInWithLink = !!CAPTURE_APPS[app.slug]?.magicLink;

  return (
    <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, space.lg) + space.sm }]}>
      <Lockup app={app} />

      <Animated.View entering={enter(1)}>
        <Text variant="title" style={styles.center}>
          Connect {app.name}
        </Text>
      </Animated.View>

      {caps.length ? (
        <Animated.View entering={enter(2)} style={styles.section}>
          <Text variant="label" color={colors.textTertiary} style={styles.sectionLabel}>
            Your assistants can
          </Text>
          <View style={styles.card}>
            {caps.map((c, i) => (
              <View key={c.verb} style={[styles.capRow, i > 0 && styles.capDivider]}>
                <Text variant="body" numberOfLines={1} style={styles.capVerb}>
                  {c.verb}
                </Text>
                {c.asks ? (
                  <Text variant="caption" color={colors.textSecondary}>
                    Asks you first
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
        </Animated.View>
      ) : null}

      <Animated.View entering={enter(3)} style={styles.footer}>
        {signsInWithLink ? (
          <Text variant="caption" color={colors.textSecondary} style={styles.center}>
            {app.name} sends you a sign-in link by email or text.
          </Text>
        ) : null}
        <Text variant="caption" color={colors.textSecondary} style={styles.center}>
          yuzu never keeps your password.
        </Text>
      </Animated.View>

      {error ? (
        <Text variant="caption" color={colors.error} style={styles.center}>
          {error}
        </Text>
      ) : null}

      <Animated.View entering={enter(4)}>
        <Button label="Continue" onPress={begin} loading={starting} disabled={!userId} fullWidth />
      </Animated.View>
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
    width: MARK,
    height: MARK,
    borderRadius: Math.round(MARK * 0.27),
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  markText: { fontFamily: "Inter_600SemiBold", letterSpacing: -0.2 },
  section: { gap: space.sm },
  sectionLabel: { paddingHorizontal: space.xs },
  card: {
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    overflow: "hidden",
  },
  capRow: {
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  capDivider: { borderTopWidth: 1, borderTopColor: colors.border },
  capVerb: { flex: 1, fontSize: 16, lineHeight: 22 },
  footer: { gap: space.xs },
});
