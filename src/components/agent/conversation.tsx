import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import type { CatalogEntry } from "@/hooks/convex";
import type { ActionStatus, AgentAction, AgentMessage } from "@/lib/agent";
import { colors, enter, fadeIn, fonts, layout, radius, space } from "@/theme";

import { AppGlyph } from "../app-glyph";
import { StatusDot } from "../status-dot";
import { Text } from "../text";

/**
 * In-app conversation: the person's messages in subtle bubbles, the assistant's words as plain
 * text, and anything it did in an app as a card with that app's logo.
 */
export function Conversation({
  messages,
  streaming,
  appBySlug,
}: {
  messages: AgentMessage[];
  streaming: boolean;
  appBySlug: Map<string, CatalogEntry>;
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
                <Text key={i} style={styles.assistantText}>
                  {p.text}
                </Text>
              ) : (
                <ActionCard key={p.id} action={p} app={appBySlug.get(p.appSlug)} />
              ),
            )}
            {streaming && m.id === lastId ? <Thinking /> : null}
          </Animated.View>
        ),
      )}
    </View>
  );
}

const STATUS_TEXT: Record<ActionStatus, string> = {
  running: "Working",
  ok: "Done",
  needs_approval: "Waiting for you",
  error: "Didn't go through",
};

function ActionCard({ action, app }: { action: AgentAction; app: CatalogEntry | undefined }) {
  const dot = action.status === "running" ? "building" : action.status === "error" ? "error" : action.status === "ok" ? "live" : "idle";
  return (
    <Animated.View entering={enter(0)} layout={layout} style={styles.card}>
      <AppGlyph app={app ?? { slug: action.appSlug, category: "other" }} size={32} />
      <View style={styles.cardText}>
        <Text variant="bodyMedium" numberOfLines={2}>
          {action.title}
        </Text>
        <Text variant="caption" color={colors.textSecondary} numberOfLines={1}>
          {[app?.name, action.detail].filter(Boolean).join(" · ")}
        </Text>
      </View>
      <View style={styles.cardStatus}>
        <StatusDot state={dot} size={6} />
        <Text variant="caption" color={action.status === "error" ? colors.error : colors.textTertiary}>
          {STATUS_TEXT[action.status]}
        </Text>
      </View>
    </Animated.View>
  );
}

/** Soft breathing dot while the reply is still coming in. */
function Thinking() {
  const o = useSharedValue(0.35);
  useEffect(() => {
    o.set(withRepeat(withSequence(withTiming(1, { duration: 600 }), withTiming(0.35, { duration: 600 })), -1));
  }, [o]);
  const style = useAnimatedStyle(() => ({ opacity: o.get() }));
  return <Animated.View style={[styles.thinking, style]} />;
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
