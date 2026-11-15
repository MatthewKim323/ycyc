import { useMutation, useQuery } from "convex/react";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, View } from "react-native";

import { AppGlyph } from "@/components/app-glyph";
import { Button } from "@/components/button";
import { Card, Divider, Screen, SectionHeader, TopBar } from "@/components/layout";
import { ActivityRow, statusLook } from "@/components/rows";
import { StatusDot } from "@/components/status-dot";
import { Text } from "@/components/text";
import { api } from "@/hooks/convex";
import { useNow } from "@/hooks/format";
import { useUser } from "@/hooks/user";
import { colors, radius, space } from "@/theme";

export default function AppDetailScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const now = useNow();
  const { userId } = useUser();
  const app = useQuery(api.apps.get, slug ? { slug } : "skip");
  const connections = useQuery(api.connections.mine, userId ? { userId } : "skip");
  const recipe = useQuery(api.recipes.forApp, slug ? { slug } : "skip");
  const feed = useQuery(api.activity.feed, userId ? { userId, limit: 100 } : "skip");
  const disconnect = useMutation(api.connections.disconnect);
  const [removing, setRemoving] = useState(false);

  const conn = connections?.find((c) => c.appSlug === slug);
  const tools =
    conn && conn.tools.length > 0
      ? conn.tools
      : (recipe?.tools ?? []).map((t) => ({ name: t.name, title: t.title, kind: t.kind }));
  const activity = (feed ?? []).filter((a) => a.appSlug === slug).slice(0, 20);

  const back = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/library");
  };

  const confirmDisconnect = () => {
    if (!conn || !app) return;
    Alert.alert(`Disconnect ${app.name}?`, "Your assistants lose its tools until you connect again.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Disconnect",
        style: "destructive",
        onPress: async () => {
          setRemoving(true);
          try {
            await disconnect({ connectionId: conn._id });
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
            back();
          } finally {
            setRemoving(false);
          }
        },
      },
    ]);
  };

  if (app === undefined) {
    return (
      <Screen header={<TopBar left="Back" onLeft={back} />}>
        <View style={styles.loading}>
          <ActivityIndicator color={colors.textTertiary} />
        </View>
      </Screen>
    );
  }

  if (app === null) {
    return (
      <Screen header={<TopBar left="Back" onLeft={back} />}>
        <Text variant="body" color={colors.textSecondary}>
          This app isn&apos;t in the library.
        </Text>
      </Screen>
    );
  }

  const look = conn ? statusLook(conn.status, conn.toolCount) : null;
  const goConnect = () => router.push({ pathname: "/connect/[slug]", params: { slug: app.slug } });

  return (
    <Screen header={<TopBar left="Back" onLeft={back} />}>
      <View style={styles.hero}>
        <AppGlyph app={app} size={56} playKey={app.slug} />
        <View style={styles.heroText}>
          <Text variant="title">{app.name}</Text>
          <View style={styles.statusLine}>
            <StatusDot state={look?.dot ?? "idle"} />
            <Text variant="label" color={conn?.status === "error" ? colors.error : colors.textSecondary} numberOfLines={2}>
              {conn ? (conn.status === "error" && conn.error ? conn.error : look?.label) : "Not connected"}
            </Text>
          </View>
        </View>
      </View>

      {!conn || conn.status === "needs_login" || conn.status === "error" ? (
        <Button label={conn ? "Reconnect" : `Connect ${app.name}`} onPress={goConnect} fullWidth />
      ) : null}

      {conn && (conn.status === "building" || conn.status === "capturing" || (conn.status as string) === "needs_code") ? (
        <Button
          label="View progress"
          onPress={() =>
            router.push({ pathname: "/build/[connectionId]", params: { connectionId: conn._id, slug: app.slug } })
          }
          fullWidth
        />
      ) : null}

      {tools.length > 0 ? (
        <View>
          <SectionHeader title={`Tools · ${tools.length}`} />
          <Card>
            {tools.map((t, i) => (
              <View key={t.name}>
                {i > 0 ? <Divider inset={space.lg} /> : null}
                <View style={styles.tool}>
                  <Text variant="bodyMedium" style={styles.toolTitle} numberOfLines={1}>
                    {t.title}
                  </Text>
                  <View style={styles.tag}>
                    <Text variant="micro" color={t.kind === "write" ? colors.text : colors.textSecondary}>
                      {t.kind === "write" ? "Write" : "Read"}
                    </Text>
                  </View>
                </View>
              </View>
            ))}
          </Card>
        </View>
      ) : null}

      {conn ? (
        <View>
          <SectionHeader title="Recent activity" />
          {activity.length === 0 ? (
            <Card style={styles.empty}>
              <Text variant="body" color={colors.textSecondary}>
                No calls yet. Ask your assistant to use {app.name}.
              </Text>
            </Card>
          ) : (
            <Card>
              {activity.map((item, i) => (
                <View key={item._id}>
                  {i > 0 ? <Divider inset={64} /> : null}
                  <ActivityRow item={item} app={app} now={now} />
                </View>
              ))}
            </Card>
          )}
        </View>
      ) : null}

      {conn ? (
        <Button label="Disconnect" kind="danger" onPress={confirmDisconnect} loading={removing} fullWidth />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  loading: { paddingVertical: space.xl },
  hero: { flexDirection: "row", alignItems: "center", gap: space.lg, paddingTop: space.sm },
  heroText: { flex: 1, gap: space.xs },
  statusLine: { flexDirection: "row", alignItems: "center", gap: 6 },
  tool: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingVertical: 14 },
  toolTitle: { flex: 1 },
  tag: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  empty: { padding: space.lg },
});
