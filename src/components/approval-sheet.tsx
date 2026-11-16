import { useMutation, useQuery } from "convex/react";
import * as Haptics from "expo-haptics";
import { useState } from "react";
import { Modal, ScrollView, StyleSheet, View } from "react-native";
import Animated, { FadeIn, FadeOut, SlideInDown, SlideOutDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { api, type PendingApproval } from "@/hooks/convex";
import { assistantName } from "@/hooks/format";
import { useUser } from "@/hooks/user";
import { colors, radius, space, springs } from "@/theme";

import { looksInternal, verbForTool } from "./app-copy";
import { AppGlyph } from "./app-glyph";
import { Button } from "./button";
import { PressableScale } from "./pressable-scale";
import { Text } from "./text";

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() && !Number.isNaN(Number(v)) ? Number(v) : undefined);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Turns an approval's args into a headline plus a few plain facts. Never shows ids or keys. */
function describe(a: PendingApproval) {
  const args = a.args ?? {};
  const verb = verbForTool(a.appSlug, a.tool) ?? (looksInternal(a.title) ? "Make a change" : a.title);
  const meal = str(args.meal)?.toLowerCase();
  let action = verb;
  if (meal && /log a meal/i.test(verb)) {
    action = /snack/.test(meal) ? "Log a snack" : `Log ${meal}`;
  }

  const name = str(args.name) ?? str(args.food) ?? str(args.description) ?? str(args.title);
  const primary = name ?? (!looksInternal(a.summary) ? a.summary : undefined) ?? action;
  const kcal = num(args.calories) ?? num(args.kcal);

  const facts: string[] = [];
  const servings = num(args.servings) ?? num(args.serving_multiplier) ?? num(args.amount);
  if (servings !== undefined) facts.push(`${servings} ${servings === 1 ? "serving" : "servings"}`);
  if (meal) facts.push(cap(meal));
  const minutes = num(args.minutes);
  if (minutes !== undefined) facts.push(`${minutes} min`);
  if (Array.isArray(args.exercises)) facts.push(`${args.exercises.length} exercises`);
  const date = str(args.date);
  if (!date || date === todayISO()) {
    if (meal || servings !== undefined) facts.push("Today");
  } else {
    const d = new Date(`${date}T12:00:00`);
    if (!Number.isNaN(d.getTime())) facts.push(d.toLocaleDateString(undefined, { month: "short", day: "numeric" }));
  }

  return { action, primary, kcal, facts };
}

/** Bottom sheet for anything an assistant wants to change. Approve or Not now, from any screen. */
export function ApprovalSheet() {
  const { userId, mcpUrl } = useUser();
  const token = mcpUrl?.split("?")[0]?.split("/").filter(Boolean).pop();
  const insets = useSafeAreaInsets();
  const pending = useQuery(api.approvals.pending, userId ? { userId, token } : "skip");
  const decide = useMutation(api.approvals.decide);
  // Profile setting "Approvals: Allow for an hour" makes Approve grant the hour.
  const me = useQuery(api.profile.me, userId ? { userId } : "skip");
  const approveHour = me?.prefs?.approvalsDefault === "hour";
  const [busy, setBusy] = useState<"approve" | "approve_hour" | "deny" | null>(null);
  const [failedFor, setFailedFor] = useState<string | null>(null);

  const current = pending?.[0];
  const visible = !!current;

  const act = async (decision: "approve" | "approve_hour" | "deny") => {
    if (!current || busy || (current.oneTimeOnly && decision === "approve_hour")) return;
    setFailedFor(null);
    setBusy(decision);
    try {
      const effective = decision === "approve" && approveHour && !current.oneTimeOnly ? "approve_hour" : decision;
      await decide({ approvalId: current._id, decision: effective, token });
      if (decision !== "deny") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      else Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    } catch {
      setFailedFor(current._id);
    } finally {
      setBusy(null);
    }
  };

  const d = current ? describe(current) : null;
  const warning = current ? str((current as { warning?: unknown }).warning) : undefined;

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={() => act("deny")}>
      {current && d ? (
        <View style={styles.root}>
          <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(200)} style={[StyleSheet.absoluteFill, styles.scrim]} />
          <Animated.View
            key={current._id}
            entering={SlideInDown.springify().damping(springs.sheet.damping).stiffness(springs.sheet.stiffness)}
            exiting={SlideOutDown.duration(200)}
            style={[styles.sheet, { paddingBottom: insets.bottom + space.lg }]}
          >
            <View style={styles.grabber} />
            <View style={styles.head}>
              <AppGlyph app={{ slug: current.appSlug, category: "other" }} size={44} />
              <View style={styles.headText}>
                <Text variant="body" color={colors.textSecondary}>
                  {assistantName(current.assistant)} wants to
                </Text>
                <Text variant="heading">
                  {d.action} in {current.appName}
                </Text>
              </View>
            </View>

            <View style={styles.detail}>
              <View style={styles.detailTop}>
                <Text variant="rowTitle" style={styles.flex} numberOfLines={2}>
                  {d.primary}
                </Text>
                {d.kcal !== undefined ? (
                  <Text variant="rowTitle" style={styles.tabular}>
                    {Math.round(d.kcal)} kcal
                  </Text>
                ) : null}
              </View>
              {d.facts.length > 0 ? (
                <View style={styles.facts}>
                  {d.facts.map((f) => (
                    <Text key={f} variant="caption" color={colors.textSecondary} style={styles.tabular}>
                      {f}
                    </Text>
                  ))}
                </View>
              ) : null}
            </View>
            {current.oneTimeOnly && current.requestPreview ? (
              <ScrollView style={styles.preview} contentContainerStyle={styles.previewContent}>
                <Text variant="caption" color={colors.textSecondary}>
                  One-time change · {current.requestPreview.method} {current.requestPreview.path}
                </Text>
                {Object.entries(current.requestPreview.args).map(([key, value]) => (
                  <View key={key} style={styles.previewField}>
                    <Text variant="caption" color={colors.textSecondary}>{cap(key.replace(/[_-]+/g, " "))}</Text>
                    <Text variant="body">{typeof value === "string" ? value : JSON.stringify(value, null, 2)}</Text>
                  </View>
                ))}
              </ScrollView>
            ) : null}
            {warning ? (
              <Text variant="caption" color={colors.textSecondary} style={styles.warning}>
                {warning}
              </Text>
            ) : null}
            {failedFor === current._id ? (
              <Text variant="caption" color={colors.error}>Couldn&rsquo;t save your decision. Try again.</Text>
            ) : null}

            <View style={styles.actions}>
              <Button label="Approve" onPress={() => act("approve")} haptic="none" loading={busy === "approve"} disabled={!!busy || (current.oneTimeOnly && !current.requestPreview)} fullWidth />
              {!current.oneTimeOnly ? <PressableScale
                onPress={() => act("approve_hour")}
                disabled={!!busy}
                haptic="none"
                scaleTo={0.96}
                accessibilityLabel="Allow for 1 hour"
                style={styles.textButton}
              >
                <Text variant="bodyMedium" color={busy === "approve_hour" ? colors.textTertiary : colors.textSecondary}>
                  Allow for 1 hour
                </Text>
              </PressableScale> : null}
              <Button label="Not now" kind="secondary" onPress={() => act("deny")} haptic="none" loading={busy === "deny"} disabled={!!busy} fullWidth />
            </View>
          </Animated.View>
        </View>
      ) : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end" },
  scrim: { backgroundColor: "rgba(0,0,0,0.6)" },
  sheet: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderColor: colors.border,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: space.xl,
    paddingTop: space.md,
    gap: space.xl,
  },
  grabber: { alignSelf: "center", width: 36, height: 4, borderRadius: radius.pill, backgroundColor: colors.borderStrong },
  head: { flexDirection: "row", alignItems: "center", gap: space.md },
  headText: { flex: 1, gap: 2 },
  detail: {
    padding: space.lg,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    gap: space.md,
  },
  detailTop: { flexDirection: "row", alignItems: "baseline", gap: space.md },
  preview: { maxHeight: 220 },
  previewContent: { gap: space.md },
  previewField: { gap: space.xs },
  flex: { flex: 1 },
  facts: { flexDirection: "row", flexWrap: "wrap", gap: space.lg },
  tabular: { fontVariant: ["tabular-nums"] },
  actions: { gap: space.sm },
  warning: { marginTop: -space.md, paddingHorizontal: space.xs },
  textButton: { alignSelf: "center", paddingVertical: space.sm, paddingHorizontal: space.xl },
});
