import { StyleSheet, View } from "react-native";
import Animated from "react-native-reanimated";

import type { Activity, CatalogEntry, PendingApproval } from "@/hooks/convex";
import type { ActionStatus, AgentAction, AgentMessage } from "@/lib/agent";
import { colors, enter, fadeIn, fonts, layout, space } from "@/theme";

import { Text } from "../text";
import { Markdown } from "./markdown";
import { ApprovalRow, StepTrail, ThinkingLine, liveLabel, type Step } from "./steps";

/** Activity and approvals the steps settle against. */
export type Receipts = { feed: Activity[] | undefined; pending: PendingApproval[] | undefined };

/**
 * In-app conversation: the person's messages in subtle bubbles, the assistant's work as one quiet
 * line (live while it runs, collapsible once done), then the answer as rich text.
 */
export function Conversation({
  messages,
  streaming,
  appBySlug,
  receipts,
}: {
  messages: AgentMessage[];
  streaming: boolean;
  appBySlug: Map<string, CatalogEntry>;
  receipts: Receipts;
}) {
  const lastId = messages[messages.length - 1]?.id;
  return (
    <View style={styles.thread}>
      {messages.map((m) =>
        m.role === "user" ? (
          <Animated.View key={m.id} entering={enter(0)} layout={layout} style={styles.userBubble}>
            <Text style={styles.userText}>{m.parts.map((p) => (p.type === "text" ? p.text : "")).join("")}</Text>
          </Animated.View>
        ) : (
          <AssistantMessage
            key={m.id}
            message={m}
            live={streaming && m.id === lastId}
            appBySlug={appBySlug}
            receipts={receipts}
          />
        ),
      )}
    </View>
  );
}

function AssistantMessage({
  message,
  live,
  appBySlug,
  receipts,
}: {
  message: AgentMessage;
  live: boolean;
  appBySlug: Map<string, CatalogEntry>;
  receipts: Receipts;
}) {
  const steps: Step[] = [];
  for (const p of message.parts) {
    if (p.type !== "action") continue;
    const approval = waitingOn(p, receipts.pending);
    steps.push({ action: p, approval, status: approval ? "needs_approval" : settle(p, receipts) });
  }
  const last = message.parts[message.parts.length - 1];
  // Live line while the newest thing is a step (or nothing has arrived yet); text takes over after.
  const working = live && (!last || last.type === "action");
  const current = [...steps].reverse().find((s) => s.status === "running") ?? steps[steps.length - 1];
  const approvals = steps.flatMap((s) => (s.approval ? [s.approval] : []));
  const uniqueApprovals = approvals.filter((a, i) => approvals.findIndex((b) => b._id === a._id) === i);

  return (
    <Animated.View entering={fadeIn} layout={layout} style={styles.assistant}>
      {working ? (
        <ThinkingLine label={current && last?.type === "action" ? liveLabel(current, appBySlug) : "Thinking"} />
      ) : steps.length ? (
        <StepTrail steps={steps} apps={appBySlug} />
      ) : null}
      {uniqueApprovals.map((a) => (
        <ApprovalRow key={a._id} approval={a} apps={appBySlug} />
      ))}
      {message.parts.map((p, i) =>
        p.type === "text" ? (
          <Markdown key={i} text={p.text} />
        ) : p.type === "error" ? (
          <Animated.View key={i} entering={fadeIn}>
            <Text variant="body" color={colors.textSecondary}>
              {p.text}
            </Text>
          </Animated.View>
        ) : null,
      )}
    </Animated.View>
  );
}

// A tool_end only means the call returned; the receipt says whether the write happened.
const WINDOW = 15_000;

function waitingOn(a: AgentAction, pending: PendingApproval[] | undefined) {
  if (!a.tool || !a.at || a.status === "error") return undefined;
  const since = a.at - WINDOW;
  return pending?.find((p) => p.appSlug === a.appSlug && p.tool === a.tool && p.createdAt >= since);
}

function settle(a: AgentAction, { feed }: Receipts): ActionStatus {
  if (a.status !== "ok" || !a.tool || !a.at) return a.status;
  const since = a.at - WINDOW;
  const hit = feed?.find((f) => f.appSlug === a.appSlug && f.tool === a.tool && f.at >= since);
  if (!hit) return "ok";
  if (hit.status === "pending_approval") return "needs_approval";
  if (hit.status === "denied" || hit.status === "error") return "error";
  return "ok";
}

const styles = StyleSheet.create({
  thread: { gap: space.xl, paddingTop: space.lg },
  userBubble: {
    alignSelf: "flex-end",
    maxWidth: "82%",
    backgroundColor: colors.surface2,
    borderRadius: 22,
    paddingHorizontal: space.lg,
    paddingVertical: 10,
  },
  userText: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 22, color: colors.text },
  assistant: { gap: space.md },
});
