import * as Haptics from "expo-haptics";
import { memo, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { SlideOutLeft, SlideOutRight } from "react-native-reanimated";

import { api, type Activity, type PendingApproval } from "@/hooks/convex";
import { assistantName, timeAgo } from "@/hooks/format";
import type { CatalogApp, ConnectionStatus } from "@/lib/contract";
import { colors, enter, layout, radius, space, springs } from "@/theme";
import { useMutation } from "convex/react";

import { AppGlyph } from "./app-glyph";
import { Button } from "./button";
import { PressableScale } from "./pressable-scale";
import type { DotState } from "./status-dot";
import { Text } from "./text";

export function statusLook(status: ConnectionStatus, toolCount = 0): { dot: DotState; label: string } {
  switch (status) {
    case "live":
      return { dot: "live", label: toolCount ? `Live · ${toolCount} tools` : "Live" };
    case "building":
    case "capturing":
      return { dot: "building", label: "Building" };
    case "needs_login":
      return { dot: "idle", label: "Needs login" };
    case "needs_code":
      return { dot: "building", label: "Enter code" };
    case "error":
      return { dot: "error", label: "Error" };
  }
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
          {item.summary}
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
        <RowShell onPress={onPress} label={item.summary}>
          {body}
        </RowShell>
      ) : (
        <View style={styles.row}>{body}</View>
      )}
    </Animated.View>
  );
});

function useSecondsLeft(expiresAt: number) {
  const [left, setLeft] = useState(() => Math.max(0, Math.round((expiresAt - Date.now()) / 1000)));
  useEffect(() => {
    const id = setInterval(() => setLeft(Math.max(0, Math.round((expiresAt - Date.now()) / 1000))), 1000);
    return () => clearInterval(id);
  }, [expiresAt]);
  return left;
}

export const ApprovalCard = memo(function ApprovalCard({
  approval,
  app,
  index = 0,
}: {
  approval: PendingApproval;
  app?: Pick<CatalogApp, "slug" | "category">;
  index?: number;
}) {
  const decide = useMutation(api.approvals.decide);
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);
  const left = useSecondsLeft(approval.expiresAt);

  const act = async (decision: "approve" | "deny") => {
    setBusy(decision);
    try {
      await decide({ approvalId: approval._id, decision });
      if (decision === "approve") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      else Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    } catch {
      setBusy(null);
    }
  };

  return (
    <Animated.View
      entering={enter(index)}
      exiting={(busy === "deny" ? SlideOutLeft : SlideOutRight)
        .springify()
        .damping(springs.sheet.damping)
        .stiffness(springs.sheet.stiffness)}
      layout={layout}
      style={styles.approval}
    >
      <View style={styles.approvalHead}>
        <AppGlyph app={app ?? { slug: approval.appSlug, category: "other" }} size={36} />
        <View style={styles.rowText}>
          <Text variant="label" color={colors.textSecondary}>
            {assistantName(approval.assistant)} wants to {approval.title.toLowerCase()} in {approval.appName}
          </Text>
          <Text variant="bodyMedium">{approval.summary}</Text>
        </View>
      </View>
      <View style={styles.approvalActions}>
        <Text variant="caption" color={colors.textTertiary} style={styles.expires}>
          {left > 0 ? `${left}s left` : "Expiring"}
        </Text>
        <Button
          label="Deny"
          kind="secondary"
          size="small"
          haptic="none"
          loading={busy === "deny"}
          disabled={!!busy}
          onPress={() => act("deny")}
        />
        <Button
          label="Approve"
          size="small"
          haptic="none"
          loading={busy === "approve"}
          disabled={!!busy}
          onPress={() => act("approve")}
        />
      </View>
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
