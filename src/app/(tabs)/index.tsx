import { useQuery } from "convex/react";
import { useRouter } from "expo-router";
import { memo } from "react";
import { StyleSheet, View } from "react-native";
import Animated from "react-native-reanimated";

import { looksInternal, verbForTool } from "@/components/app-copy";
import { AppGlyph } from "@/components/app-glyph";
import { Button } from "@/components/button";
import { Card, Divider, Screen, SectionHeader } from "@/components/layout";
import { PressableScale } from "@/components/pressable-scale";
import { ProfileButton } from "@/components/profile/profile-button";
import { Text } from "@/components/text";
import { TodayPanel } from "@/components/today-panel";
import { api, type Activity, type CatalogEntry } from "@/hooks/convex";
import { assistantName, timeAgo, useNow } from "@/hooks/format";
import { useUser } from "@/hooks/user";
import { colors, enter, fadeOut, layout, space } from "@/theme";

const RECENT = 5;
// Backend id for actions taken inside the app itself (old and new name).
const IN_APP = new Set<string>(["ycyc", "yuzu"]);

/** Safe to show as-is: not an internal name, no JSON or markup, short enough for one line. */
function readable(text: string | undefined | null): boolean {
  return !!text && !looksInternal(text) && !/[{}[\]"<>]/.test(text) && text.length <= 80;
}

/** Plain words for an activity row. Backend text is used only when it reads like a person wrote it. */
function recentSummary(item: Activity, appName: string): string {
  if (item.tool === "connect") return `Connected ${appName}`;
  if (readable(item.summary)) return item.summary;
  const head = item.summary.split(":")[0]?.trim();
  if (head && readable(head)) return head;
  return verbForTool(item.appSlug, item.tool) ?? `Used ${appName}`;
}

function recentMeta(item: Activity): { text: string; tone: string } | null {
  if (item.status === "pending_approval") return { text: "Waiting for you", tone: colors.textSecondary };
  if (item.status === "denied") return { text: "Denied", tone: colors.textSecondary };
  if (item.status === "error") return { text: "Didn't go through", tone: colors.error };
  // In-app actions (connecting an app) have no assistant worth naming.
  if (IN_APP.has(item.assistant)) return null;
  return { text: assistantName(item.assistant), tone: colors.textTertiary };
}

const RecentRow = memo(function RecentRow({
  item,
  app,
  now,
  index,
  onPress,
}: {
  item: Activity;
  app: CatalogEntry | undefined;
  now: number;
  index: number;
  onPress: () => void;
}) {
  const appName = app?.name ?? "yuzu";
  const summary = recentSummary(item, appName);
  const meta = recentMeta(item);
  return (
    <Animated.View entering={enter(index)} layout={layout}>
      <PressableScale onPress={onPress} accessibilityLabel={summary} scaleTo={0.98} haptic="selection" style={styles.row}>
        <AppGlyph app={app ?? { slug: item.appSlug, category: "other" }} size={32} />
        <View style={styles.rowText}>
          <Text variant="bodyMedium" numberOfLines={1}>
            {summary}
          </Text>
          {meta ? (
            <Text variant="caption" color={meta.tone} numberOfLines={1}>
              {meta.text}
            </Text>
          ) : null}
        </View>
        <Text variant="caption" color={colors.textTertiary} style={styles.tabular}>
          {timeAgo(item.at, now)}
        </Text>
      </PressableScale>
    </Animated.View>
  );
});

export default function TodayScreen() {
  const router = useRouter();
  const { userId, error } = useUser();
  const now = useNow();
  const apps = useQuery(api.apps.list);
  const connections = useQuery(api.connections.mine, userId ? { userId } : "skip");
  const feed = useQuery(api.activity.feed, userId ? { userId, limit: RECENT } : "skip");

  const appBySlug = new Map((apps ?? []).map((a) => [a.slug, a]));
  const recent = (feed ?? []).slice(0, RECENT);
  const dateLine = new Date(now).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  const firstRun =
    connections && connections.length === 0 ? (
      <Animated.View entering={enter(3)} exiting={fadeOut} layout={layout} style={styles.empty}>
        <Text variant="body" color={colors.textSecondary} style={styles.center}>
          Connect an app to fill your day
        </Text>
        <Button label="Add an app" size="small" onPress={() => router.push("/add")} />
      </Animated.View>
    ) : null;

  return (
    <Screen>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text variant="label" color={colors.textTertiary}>
            {dateLine}
          </Text>
          <Text variant="title">Today</Text>
        </View>
        <ProfileButton />
      </View>

      {error && !userId ? (
        <Text variant="caption" color={colors.error}>
          Can&apos;t reach yuzu. Retrying.
        </Text>
      ) : null}

      <TodayPanel userId={userId} connections={connections} afterRings={firstRun} />

      {recent.length > 0 ? (
        <Animated.View entering={enter(6)} layout={layout}>
          <SectionHeader title="Recent" />
          <Card>
            {recent.map((item, i) => (
              <View key={item._id}>
                {i > 0 ? <Divider inset={60} /> : null}
                <RecentRow
                  item={item}
                  app={appBySlug.get(item.appSlug)}
                  now={now}
                  index={i + 6}
                  onPress={() =>
                    appBySlug.has(item.appSlug)
                      ? router.push({ pathname: "/app/[slug]", params: { slug: item.appSlug } })
                      : router.push("/library")
                  }
                />
              </View>
            ))}
          </Card>
        </Animated.View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { paddingTop: space.sm, paddingHorizontal: space.xs, flexDirection: "row", alignItems: "flex-end", gap: space.md },
  headerText: { flex: 1, gap: 2 },
  empty: { alignItems: "center", gap: space.md, paddingVertical: space.sm },
  center: { textAlign: "center" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
  },
  rowText: { flex: 1, gap: 2 },
  tabular: { fontVariant: ["tabular-nums"] },
});
