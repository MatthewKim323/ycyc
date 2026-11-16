import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import type { Activity, CatalogEntry, PendingApproval } from "@/hooks/convex";
import type { ActionStatus, AgentAction, AgentMessage } from "@/lib/agent";
import { colors, enter, fadeIn, fonts, layout, radius, space } from "@/theme";

import { AppGlyph } from "../app-glyph";
import { StatusDot } from "../status-dot";
import { Text } from "../text";

/** Activity and approvals the cards settle against ("Done", "Waiting for you", "Didn't go through"). */
export type Receipts = { feed: Activity[] | undefined; pending: PendingApproval[] | undefined };

/**
 * In-app conversation: the person's messages in subtle bubbles, the assistant's words as plain
 * text, and anything it did in an app as a card with that app's logo.
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
          <Animated.View key={m.id} entering={fadeIn} layout={layout} style={styles.assistant}>
            {m.parts.map((p, i) =>
              p.type === "text" ? (
                <StreamingText key={i} text={p.text} live={streaming && m.id === lastId} />
              ) : p.type === "error" ? (
                <Animated.View key={i} entering={fadeIn}>
                  <Text variant="body" color={colors.textSecondary}>
                    {p.text}
                  </Text>
                </Animated.View>
              ) : (
                <ActionCard key={p.id} action={p} app={appBySlug.get(p.appSlug)} status={settle(p, receipts)} />
              ),
            )}
            {streaming && m.id === lastId && !m.parts.some((p) => p.type === "text") ? <Thinking /> : null}
          </Animated.View>
        ),
      )}
    </View>
  );
}

// A tool_end only means the call returned; the receipt says whether the write happened.
const WINDOW = 15_000;
function settle(a: AgentAction, { feed, pending }: Receipts): ActionStatus {
  if (a.status !== "ok" || !a.tool || !a.at) return a.status;
  const since = a.at - WINDOW;
  if (pending?.some((p) => p.appSlug === a.appSlug && p.tool === a.tool && p.createdAt >= since)) return "needs_approval";
  const hit = feed?.find((f) => f.appSlug === a.appSlug && f.tool === a.tool && f.at >= since);
  if (!hit) return "ok";
  if (hit.status === "pending_approval") return "needs_approval";
  if (hit.status === "denied" || hit.status === "error") return "error";
  return "ok";
}

const FADE_MS = 320;

/**
 * Assistant text that fades in per chunk. One Text node, so lines wrap naturally: the newest
 * chunks are drawn with rising opacity and merge into the settled text once fully in.
 */
function StreamingText({ text, live }: { text: string; live: boolean }) {
  const reduced = useReducedMotion();
  const [seen, setSeen] = useState(live ? 0 : text.length);
  // at < 0: arrived this render, stamped by the frame clock.
  const [segs, setSegs] = useState<{ start: number; at: number }[]>([]);
  const [now, setNow] = useState(0);

  if (text.length !== seen) {
    setSeen(text.length);
    if (text.length > seen && !reduced) setSegs((s) => [...s, { start: seen, at: -1 }]);
    else if (text.length < seen) setSegs([]);
  }

  const fading = segs.length > 0;
  useEffect(() => {
    if (!fading) return;
    let raf = 0;
    const step = () => {
      const t = Date.now();
      setNow(t);
      setSegs((s) => {
        const next = s.map((x) => (x.at < 0 ? { ...x, at: t } : x)).filter((x) => t - x.at < FADE_MS);
        return next.length === s.length && next.every((x, i) => x.at === s[i]!.at) ? s : next;
      });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [fading]);

  if (!fading) return <Text style={styles.assistantText}>{text}</Text>;

  const first = segs[0]!.start;
  return (
    <Text style={styles.assistantText}>
      {text.slice(0, first)}
      {segs.map((seg, i) => {
        const end = segs[i + 1]?.start ?? text.length;
        const alpha = seg.at < 0 ? 0.15 : Math.min(1, 0.15 + (now - seg.at) / FADE_MS);
        return (
          <Text key={seg.start} style={{ color: `rgba(255,255,255,${alpha.toFixed(2)})` }}>
            {text.slice(seg.start, end)}
          </Text>
        );
      })}
    </Text>
  );
}

const STATUS_TEXT: Record<ActionStatus, string> = {
  running: "Working",
  ok: "Done",
  needs_approval: "Waiting for you",
  error: "Didn't go through",
};

function ActionCard({ action, app, status }: { action: AgentAction; app: CatalogEntry | undefined; status: ActionStatus }) {
  const dot = status === "running" ? "building" : status === "error" ? "error" : status === "ok" ? "live" : "idle";
  const name = app?.name ?? "your app";
  const title = action.title || (status === "running" ? `Working in ${name}` : `Used ${name}`);
  return (
    <Animated.View entering={enter(0)} layout={layout} style={styles.card}>
      <AppGlyph app={app ?? { slug: action.appSlug, category: "other" }} size={32} />
      <View style={styles.cardText}>
        <Text variant="bodyMedium" numberOfLines={2}>
          {title}
        </Text>
        {app?.name || action.detail ? (
          <Text variant="caption" color={colors.textSecondary} numberOfLines={1}>
            {[app?.name, action.detail].filter(Boolean).join(" · ")}
          </Text>
        ) : null}
      </View>
      <Animated.View key={status} entering={fadeIn} style={styles.cardStatus}>
        <StatusDot state={dot} size={6} />
        <Text variant="caption" color={status === "error" ? colors.error : colors.textTertiary}>
          {STATUS_TEXT[status]}
        </Text>
      </Animated.View>
    </Animated.View>
  );
}

/** Soft breathing dot while the reply is still coming in. */
function Thinking() {
  const reduced = useReducedMotion();
  const o = useSharedValue(0.35);
  useEffect(() => {
    if (reduced) {
      o.set(0.7);
      return;
    }
    o.set(withRepeat(withSequence(withTiming(1, { duration: 600 }), withTiming(0.35, { duration: 600 })), -1));
  }, [o, reduced]);
  const style = useAnimatedStyle(() => ({ opacity: o.get() }));
  return <Animated.View entering={fadeIn} style={[styles.thinking, style]} accessibilityLabel="Thinking" />;
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
  assistantText: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 24, color: colors.text },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    padding: space.md,
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardText: { flex: 1, gap: 2 },
  cardStatus: { flexDirection: "row", alignItems: "center", gap: 6 },
  thinking: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.text, marginTop: space.xs },
});
