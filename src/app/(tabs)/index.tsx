import { useQuery } from "convex/react";
import { useRouter } from "expo-router";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import Animated from "react-native-reanimated";

import { AskBar } from "@/components/ask-bar";
import { Button } from "@/components/button";
import { Card, Divider, Screen, SectionHeader } from "@/components/layout";
import { McpLinkCard } from "@/components/mcp-link-card";
import { ActivityRow, ApprovalCard } from "@/components/rows";
import { Text } from "@/components/text";
import { TodayPanel } from "@/components/today-panel";
import { api } from "@/hooks/convex";
import { useNow } from "@/hooks/format";
import { useUser } from "@/hooks/user";
import { colors, enter, fadeOut, layout, space } from "@/theme";

export default function TodayScreen() {
  const router = useRouter();
  const { userId, mcpUrl, error } = useUser();
  const now = useNow();
  const apps = useQuery(api.apps.list);
  const connections = useQuery(api.connections.mine, userId ? { userId } : "skip");
  const approvals = useQuery(api.approvals.pending, userId ? { userId } : "skip");
  const feed = useQuery(api.activity.feed, userId ? { userId, limit: 30 } : "skip");

  const appBySlug = new Map((apps ?? []).map((a) => [a.slug, a]));

  return (
    <Screen footer={<AskBar />}>
      <View style={styles.header}>
        <Text variant="title">Today</Text>
      </View>

      <TodayPanel userId={userId} connections={connections} />

      {error && !userId ? (
        <Text variant="caption" color={colors.error}>
          Can&apos;t reach ycyc. Retrying.
        </Text>
      ) : null}

      {connections && connections.length === 0 ? (
        <Animated.View entering={enter(1)} exiting={fadeOut} layout={layout}>
          <Card style={styles.empty}>
            <Text variant="rowTitle">Connect your first app</Text>
            <Text variant="body" color={colors.textSecondary}>
              {apps && apps.length
                ? `${apps.map((a) => a.name).join(", ")} are ready to connect.`
                : "Pick an app and sign in once."}
            </Text>
            <Button label="Browse apps" size="small" onPress={() => router.navigate("/library")} style={styles.emptyButton} />
          </Card>
        </Animated.View>
      ) : null}

      {approvals && approvals.length > 0 ? (
        <Animated.View entering={enter(0)} exiting={fadeOut} layout={layout}>
          <SectionHeader title={approvals.length === 1 ? "Needs you" : `Needs you · ${approvals.length}`} />
          <View style={styles.stack}>
            {approvals.map((a, i) => (
              <ApprovalCard key={a._id} approval={a} app={appBySlug.get(a.appSlug)} index={i} />
            ))}
          </View>
        </Animated.View>
      ) : null}

      <Animated.View layout={layout}>
        <SectionHeader title="Activity" />
        {feed === undefined ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.textTertiary} />
          </View>
        ) : feed.length === 0 ? (
          <Card style={styles.emptyFeed}>
            <Text variant="body" color={colors.textSecondary}>
              Nothing yet. Ask your assistant to log a meal or a workout.
            </Text>
          </Card>
        ) : (
          <Card>
            {feed.map((item, i) => (
              <View key={item._id}>
                {i > 0 ? <Divider inset={64} /> : null}
                <ActivityRow
                  item={item}
                  app={appBySlug.get(item.appSlug)}
                  now={now}
                  index={i}
                  onPress={() => router.push({ pathname: "/app/[slug]", params: { slug: item.appSlug } })}
                />
              </View>
            ))}
          </Card>
        )}
      </Animated.View>

      <Animated.View layout={layout}>
        <McpLinkCard url={mcpUrl} compact />
      </Animated.View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { paddingTop: space.sm, paddingHorizontal: space.xs },
  empty: { padding: space.lg, gap: space.sm },
  emptyButton: { alignSelf: "flex-start", marginTop: space.xs },
  emptyFeed: { padding: space.lg },
  stack: { gap: space.md },
  loading: { paddingVertical: space.xl },
});
