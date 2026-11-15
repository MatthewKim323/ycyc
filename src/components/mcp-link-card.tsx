import { useRouter } from "expo-router";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import { colors, radius, space } from "@/theme";

import { Button } from "./button";
import { CopyButton } from "./copy-button";
import { Icon } from "./icon";
import { Text } from "./text";

export function McpLinkCard({
  url,
  showSetup = true,
  compact = false,
}: {
  url: string | null;
  showSetup?: boolean;
  compact?: boolean;
}) {
  const router = useRouter();
  const display = url ? url.replace(/^https?:\/\//, "") : null;
  if (compact) {
    return (
      <View style={[styles.card, styles.compact]}>
        <Icon name="link" size={20} />
        <View style={styles.compactText}>
          <Text variant="label" color={colors.textSecondary}>
            Your MCP link
          </Text>
          <Text variant="caption" color={colors.textTertiary} numberOfLines={1} ellipsizeMode="middle">
            {display ?? "Creating your link"}
          </Text>
        </View>
        <CopyButton value={url} />
      </View>
    );
  }
  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Icon name="link" size={22} autoPlay />
        <Text variant="label" color={colors.textSecondary}>
          Your MCP link
        </Text>
      </View>
      <View style={styles.urlBox}>
        {display ? (
          <Text variant="bodyMedium" numberOfLines={1} ellipsizeMode="middle" selectable>
            {display}
          </Text>
        ) : (
          <View style={styles.loading}>
            <ActivityIndicator size="small" color={colors.textTertiary} />
            <Text variant="body" color={colors.textTertiary}>
              Creating your link
            </Text>
          </View>
        )}
      </View>
      <View style={styles.actions}>
        <CopyButton value={url} label="Copy link" />
        {showSetup ? (
          <Button label="Add to an assistant" kind="secondary" size="small" onPress={() => router.navigate("/link")} />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
    gap: space.md,
  },
  head: { flexDirection: "row", alignItems: "center", gap: space.sm },
  urlBox: {
    backgroundColor: colors.surface2,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  loading: { flexDirection: "row", alignItems: "center", gap: space.sm },
  actions: { flexDirection: "row", gap: space.sm, flexWrap: "wrap" },
  compact: { flexDirection: "row", alignItems: "center", paddingVertical: space.md },
  compactText: { flex: 1, gap: 1 },
});
