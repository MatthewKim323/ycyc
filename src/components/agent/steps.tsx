import { useMutation, useQuery } from "convex/react";
import * as Haptics from "expo-haptics";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import { api, type CatalogEntry, type PendingApproval } from "@/hooks/convex";
import { useUser } from "@/hooks/user";
import type { ActionStatus, AgentAction } from "@/lib/agent";
import { colors, fadeIn, fadeOut, hairline, layout, space, springs } from "@/theme";

import { looksInternal, verbForTool } from "../app-copy";
import { Button } from "../button";
import { Icon } from "../icon";
import { Text } from "../text";

export type Step = { action: AgentAction; status: ActionStatus; approval?: PendingApproval };

const lower = (s: string) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s);
const appName = (a: AgentAction, apps: Map<string, CatalogEntry>) => apps.get(a.appSlug)?.name ?? "your app";

/** The line shown while a step runs, e.g. "Find exercises in Strong". */
export function liveLabel(step: Step, apps: Map<string, CatalogEntry>) {
  const name = appName(step.action, apps);
  return step.action.title ? `${step.action.title} in ${name}` : `Working in ${name}`;
}

function stepLabel(step: Step, apps: Map<string, CatalogEntry>) {
  const name = appName(step.action, apps);
  const title = step.action.title;
  if (step.status === "error") return title ? `Couldn't ${lower(title)}` : `Couldn't reach ${name}`;
  if (step.status === "needs_approval") return `${title || `Change ${name}`}, waiting for you`;
  return title || `Used ${name}`;
}

function summary(steps: Step[], apps: Map<string, CatalogEntry>) {
  const names = [...new Set(steps.map((s) => appName(s.action, apps)))];
  const who = names.length <= 2 ? names.join(" and ") : `${names.slice(0, 2).join(", ")} and ${names.length - 2} more`;
  return `Used ${who} · ${steps.length} ${steps.length === 1 ? "step" : "steps"}`;
}

/** Quiet grey line with a soft pulse while the assistant works. Labels crossfade in place. */
export function ThinkingLine({ label }: { label: string }) {
  const reduced = useReducedMotion();
  const o = useSharedValue(1);
  useEffect(() => {
    if (reduced) return;
    o.set(withRepeat(withSequence(withTiming(0.4, { duration: 750 }), withTiming(1, { duration: 750 })), -1));
  }, [o, reduced]);
  const style = useAnimatedStyle(() => ({ opacity: o.get() }));
  return (
    <Animated.View entering={fadeIn} exiting={fadeOut} layout={layout} style={style} accessibilityLabel={label}>
      <Animated.View key={label} entering={fadeIn}>
        <Text variant="body" color={colors.textSecondary} numberOfLines={1}>
          {label}
        </Text>
      </Animated.View>
    </Animated.View>
  );
}

/** Finished steps collapsed to one line; tap to see each one. */
export function StepTrail({ steps, apps }: { steps: Step[]; apps: Map<string, CatalogEntry> }) {
  const [open, setOpen] = useState(false);
  const turn = useSharedValue(180);
  useEffect(() => {
    turn.set(withSpring(open ? 270 : 180, springs.layout));
  }, [open, turn]);
  const chevron = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.get()}deg` }] }));

  // Same label and outcome collapse into one line with a count.
  const rows: { label: string; error: boolean; count: number }[] = [];
  for (const s of steps) {
    const label = stepLabel(s, apps);
    const hit = rows.find((r) => r.label === label);
    if (hit) hit.count++;
    else rows.push({ label, error: s.status === "error", count: 1 });
  }

  return (
    <Animated.View entering={fadeIn} layout={layout} style={styles.trail}>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={styles.head}
      >
        <Text variant="body" color={colors.textSecondary} numberOfLines={1} style={styles.headText}>
          {summary(steps, apps)}
        </Text>
        <Animated.View style={chevron}>
          <Icon name="back" size={14} opacity={0.5} />
        </Animated.View>
      </Pressable>
      {open ? (
        <Animated.View entering={fadeIn} exiting={fadeOut} layout={layout} style={styles.list}>
          {rows.map((r) => (
            <Text key={r.label} variant="caption" color={r.error ? colors.error : colors.textTertiary}>
              {r.count > 1 ? `${r.label} ×${r.count}` : r.label}
            </Text>
          ))}
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

function approvalSummary(a: PendingApproval, apps: Map<string, CatalogEntry>) {
  const verb = verbForTool(a.appSlug, a.tool) ?? (looksInternal(a.title) ? "Make a change" : a.title);
  return `${verb} in ${apps.get(a.appSlug)?.name ?? "your app"}`;
}

/** One row per change waiting on the person: what it does, Approve and Deny. */
export function ApprovalRow({ approval, apps }: { approval: PendingApproval; apps: Map<string, CatalogEntry> }) {
  const { userId, mcpUrl } = useUser();
  const token = mcpUrl?.split("?")[0]?.split("/").filter(Boolean).pop();
  const decide = useMutation(api.approvals.decide);
  const me = useQuery(api.profile.me, userId ? { userId } : "skip");
  const approveHour = me?.prefs?.approvalsDefault === "hour" && !approval.oneTimeOnly;
  const [busy, setBusy] = useState<"approve" | "deny" | null>(null);
  const [failed, setFailed] = useState(false);

  const act = async (decision: "approve" | "deny") => {
    if (busy) return;
    setBusy(decision);
    setFailed(false);
    try {
      await decide({ approvalId: approval._id, decision: decision === "approve" && approveHour ? "approve_hour" : decision, token });
      if (decision === "approve") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch {
      setFailed(true);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Animated.View entering={fadeIn} exiting={fadeOut} layout={layout} style={styles.approval}>
      <View style={styles.approvalText}>
        <Text variant="body" numberOfLines={2}>
          {approvalSummary(approval, apps)}
        </Text>
        {failed ? (
          <Text variant="caption" color={colors.error}>
            {"That didn't go through. Try again."}
          </Text>
        ) : null}
      </View>
      <Button label="Deny" kind="secondary" size="small" onPress={() => act("deny")} loading={busy === "deny"} disabled={!!busy} />
      <Button label="Approve" size="small" onPress={() => act("approve")} loading={busy === "approve"} disabled={!!busy} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  trail: { gap: space.sm },
  head: { flexDirection: "row", alignItems: "center", gap: space.xs, alignSelf: "flex-start" },
  headText: { flexShrink: 1 },
  list: {
    gap: space.xs,
    marginLeft: space.xs,
    paddingLeft: space.md,
    borderLeftWidth: hairline,
    borderLeftColor: colors.borderStrong,
  },
  approval: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
    paddingVertical: space.sm,
    borderTopWidth: hairline,
    borderBottomWidth: hairline,
    borderColor: colors.border,
  },
  approvalText: { flex: 1, gap: 2 },
});
