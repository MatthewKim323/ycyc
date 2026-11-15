import { useMutation, useQuery } from "convex/react";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, View } from "react-native";
import Animated from "react-native-reanimated";

import { copyFor, plainError } from "@/components/app-copy";
import { AppGlyph } from "@/components/app-glyph";
import { BackButton } from "@/components/back-button";
import { Button } from "@/components/button";
import { Screen } from "@/components/layout";
import { plainSummary, statusLook } from "@/components/rows";
import { Text } from "@/components/text";
import { api } from "@/hooks/convex";
import { assistantName, timeAgo, useNow } from "@/hooks/format";
import { useUser } from "@/hooks/user";
import { colors, enter, space } from "@/theme";

const ASSISTANTS = ["claude", "chatgpt", "grok", "muse"];

function listJoin(names: string[]) {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function lowerFirst(s: string) {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

export default function AppDetail() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const now = useNow();
  const { userId } = useUser();
  const app = useQuery(api.apps.get, slug ? { slug } : "skip");
  const connections = useQuery(api.connections.mine, userId ? { userId } : "skip");
  const feed = useQuery(api.activity.feed, userId ? { userId, limit: 100 } : "skip");
  const disconnect = useMutation(api.connections.disconnect);
  const [removing, setRemoving] = useState(false);

  const conn = connections?.find((c) => c.appSlug === slug);
  const copy = slug ? copyFor(slug) : undefined;
  const recent = (feed ?? []).filter((a) => a.appSlug === slug).slice(0, 6);

  // Assistants this person actually uses; before any use, the four we support.
  const used = [...new Set((feed ?? []).map((a) => a.assistant).filter((a) => ASSISTANTS.includes(a)))];
  const inLine = `In ${listJoin((used.length ? used : ASSISTANTS).map(assistantName))}`;

  const back = () => (router.canGoBack() ? router.back() : router.replace("/library"));

  const confirmDisconnect = () => {
    if (!conn || !app) return;
    Alert.alert(`Remove ${app.name}?`, "Your assistants won't be able to use it until you add it again.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
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

  if (!app) {
    return (
      <Screen header={<Header onBack={back} />}>
        {app === undefined ? (
          <ActivityIndicator color={colors.textTertiary} style={styles.loading} />
        ) : (
          <Text variant="body" color={colors.textSecondary}>
            This app isn&apos;t available.
          </Text>
        )}
      </Screen>
    );
  }

  const ready = conn?.status === "live";
  const note = conn && !ready ? statusLook(conn.status).label : null;
  const goConnect = () => router.push({ pathname: "/connect/[slug]", params: { slug: app.slug } });
  const status = conn?.status as string | undefined;

  return (
    <Screen header={<Header onBack={back} />}>
      <Animated.View entering={enter(0)} style={styles.hero}>
        <AppGlyph app={app} size={60} />
        <View style={styles.heroText}>
          <Text style={styles.name}>{app.name}</Text>
          <Text variant="body" color={conn?.status === "error" ? colors.error : colors.textSecondary} numberOfLines={2}>
            {ready ? inLine : conn ? (conn.status === "error" ? plainError(conn.error, "Something went wrong") : note) : "Not added yet"}
          </Text>
        </View>
      </Animated.View>

      {!conn || status === "needs_login" || status === "error" ? (
        <Button label={conn ? "Sign in again" : `Add ${app.name}`} onPress={goConnect} fullWidth />
      ) : null}
      {conn && (status === "building" || status === "capturing" || status === "needs_code") ? (
        <Button
          label={status === "needs_code" ? "Enter your code" : "See progress"}
          onPress={() => router.push({ pathname: "/build/[connectionId]", params: { connectionId: conn._id, slug: app.slug } })}
          fullWidth
        />
      ) : null}

      {copy ? (
        <Animated.View entering={enter(1)} style={styles.section}>
          <Text variant="label" color={colors.textTertiary}>
            Your assistant can
          </Text>
          <View style={styles.card}>
            {copy.can.map((c, i) => (
              <View key={c.verb} style={[styles.canRow, i > 0 && styles.rowBorder]}>
                <Text variant="rowTitle" style={styles.flex}>
                  {c.verb}
                </Text>
                {c.asks ? (
                  <Text variant="label" color={colors.textSecondary}>
                    Asks you first
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
        </Animated.View>
      ) : null}

      {copy ? (
        <Animated.View entering={enter(2)} style={styles.section}>
          <Text variant="label" color={colors.textTertiary}>
            Try asking
          </Text>
          <View style={styles.prompts}>
            {copy.prompts.map((p) => (
              <View key={p} style={styles.prompt}>
                <Text variant="body" color="#D4D4D4">
                  &ldquo;{p}&rdquo;
                </Text>
              </View>
            ))}
          </View>
        </Animated.View>
      ) : null}

      {conn ? (
        <Animated.View entering={enter(3)} style={styles.section}>
          <Text variant="label" color={colors.textTertiary}>
            Recent
          </Text>
          {recent.length === 0 ? (
            <Text variant="body" color={colors.textSecondary}>
              Nothing yet. Try one of the prompts above.
            </Text>
          ) : (
            <View style={styles.recent}>
              {recent.map((a) => (
                <View key={a._id} style={styles.recentRow}>
                  <Text variant="body" style={styles.flex} numberOfLines={1}>
                    {assistantName(a.assistant)} {lowerFirst(plainSummary(a, app.name))}
                    {a.status === "denied" ? " (you said not now)" : a.status === "error" ? " (didn't go through)" : ""}
                  </Text>
                  <Text variant="body" color={colors.textTertiary} style={styles.tabular}>
                    {timeAgo(a.at, now)}
                  </Text>
                </View>
              ))}
            </View>
          )}
        </Animated.View>
      ) : null}

      {conn ? (
        <Button label={`Remove ${app.name}`} kind="danger" onPress={confirmDisconnect} loading={removing} fullWidth />
      ) : null}
    </Screen>
  );
}

function Header({ onBack }: { onBack: () => void }) {
  return (
    <View style={styles.header}>
      <BackButton onPress={onBack} />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { height: 48, flexDirection: "row", alignItems: "center", paddingHorizontal: space.gutter },
  loading: { paddingVertical: space.xl },
  hero: { flexDirection: "row", alignItems: "center", gap: 14, paddingTop: space.sm },
  heroText: { flex: 1, gap: 4 },
  name: { fontFamily: "Inter_600SemiBold", fontSize: 26, lineHeight: 32, letterSpacing: -0.5, color: colors.text },
  section: { gap: 10 },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: 18, backgroundColor: colors.surface, overflow: "hidden" },
  canRow: { flexDirection: "row", alignItems: "center", paddingVertical: 15, paddingHorizontal: space.lg, gap: space.md },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  flex: { flex: 1 },
  prompts: { gap: space.sm },
  prompt: { paddingVertical: space.md, paddingHorizontal: 14, borderRadius: 14, backgroundColor: colors.surface2 },
  recent: { gap: space.md },
  recentRow: { flexDirection: "row", gap: space.md, alignItems: "baseline" },
  tabular: { fontVariant: ["tabular-nums"] },
});
