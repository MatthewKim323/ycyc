import { memo } from "react";
import { StyleSheet, View } from "react-native";
import Animated from "react-native-reanimated";

import type { Activity } from "@/hooks/convex";
import { assistantName, timeAgo } from "@/hooks/format";
import type { CatalogApp, ConnectionStatus } from "@/lib/contract";
import { colors, enter, layout, radius, space } from "@/theme";

import { looksInternal, verbForTool } from "./app-copy";
import { AppGlyph } from "./app-glyph";
import { PressableScale } from "./pressable-scale";
import type { DotState } from "./status-dot";
import { Text } from "./text";

export function statusLook(status: ConnectionStatus, _toolCount = 0): { dot: DotState; label: string } {
  switch (status) {
    case "live":
      return { dot: "live", label: "" };
    case "building":
    case "capturing":
      return { dot: "building", label: "Setting up" };
    case "needs_login":
      return { dot: "idle", label: "Sign in" };
    case "needs_code":
      return { dot: "building", label: "Enter code" };
    case "error":
      return { dot: "error", label: "Try again" };
  }
}

/** The activity summary in plain words; internal-looking text falls back to the capability verb. */
export function plainSummary(item: { summary: string; tool: string; appSlug: string }, appName: string): string {
  if (!looksInternal(item.summary)) return item.summary;
  return verbForTool(item.appSlug, item.tool) ?? `Used ${appName}`;
}

function RowShell({ children, onPress, label }: { children: React.ReactNode; onPress: () => void; label: string }) {
  return (
    <PressableScale onPress={onPress} accessibilityLabel={label} scaleTo={0.98} haptic="selection" style={styles.row}>
      {children}
    </PressableScale>
  );
}

export const ActivityRow = memo(function ActivityRow({
  item,
  app,
  now,
  index = 0,
  onPress,
}: {
  item: Activity;
  app?: Pick<CatalogApp, "slug" | "name" | "category">;
  now: number;
  index?: number;
  onPress?: () => void;
}) {
  const appName = app?.name ?? item.appSlug;
  const summary = plainSummary(item, appName);
  const statusText =
    item.status === "pending_approval"
      ? "Waiting for you"
      : item.status === "denied"
        ? "Denied"
        : item.status === "error"
          ? "Failed"
          : null;
  const body = (
    <>
      <AppGlyph app={app ?? { slug: item.appSlug, category: "other" }} size={36} />
      <View style={styles.rowText}>
        <Text variant="bodyMedium" numberOfLines={2}>
          {summary}
        </Text>
        <Text variant="caption" color={colors.textTertiary} numberOfLines={1}>
          {assistantName(item.assistant)} in {appName} · {timeAgo(item.at, now)}
          {statusText ? (
            <Text variant="caption" color={item.status === "error" ? colors.error : colors.textSecondary}>
              {"  "}
              {statusText}
            </Text>
          ) : null}
        </Text>
      </View>
    </>
  );
  return (
    <Animated.View entering={enter(index)} layout={layout}>
      {onPress ? (
        <RowShell onPress={onPress} label={summary}>
          {body}
        </RowShell>
      ) : (
        <View style={styles.row}>{body}</View>
      )}
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
  },
  rowText: { flex: 1, gap: 2 },
  approval: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    padding: space.lg,
    gap: space.md,
  },
  approvalHead: { flexDirection: "row", gap: space.md, alignItems: "flex-start" },
  approvalActions: { flexDirection: "row", alignItems: "center", gap: space.sm },
  expires: { flex: 1 },
});
