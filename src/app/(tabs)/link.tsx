import { useQuery } from "convex/react";
import { useState } from "react";
import * as Clipboard from "expo-clipboard";
import { Linking, Platform, StyleSheet, View } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";

import { Button } from "@/components/button";
import { CopyButton } from "@/components/copy-button";
import { Icon } from "@/components/icon";
import { Screen } from "@/components/layout";
import { displayLink } from "@/components/mcp-link-card";
import { PressableScale } from "@/components/pressable-scale";
import { Text } from "@/components/text";
import { api } from "@/hooks/convex";
import { timeAgo, useNow } from "@/hooks/format";
import { useUser } from "@/hooks/user";
import { colors, enter, layout, space } from "@/theme";

type Assistant = {
  key: "claude" | "chatgpt" | "grok" | "muse";
  name: string;
  letter: string;
  tile: { bg: string; fg: string; border?: string };
  hint: string;
  steps: string[];
};

const ASSISTANTS: Assistant[] = [
  {
    key: "claude",
    name: "Claude",
    letter: "C",
    tile: { bg: "#D97757", fg: "#FFFFFF" },
    hint: "Settings, Connectors, Add",
    steps: ["Settings, Connectors, Add custom connector", "Name it ycyc and paste your link"],
  },
  {
    key: "chatgpt",
    name: "ChatGPT",
    letter: "G",
    tile: { bg: "#FFFFFF", fg: "#000000" },
    hint: "On the web, chatgpt.com/plugins",
    steps: [
      "On the web, open chatgpt.com/plugins",
      "Tap +, add a custom server, paste your link, choose No authentication",
      "Create it as a plugin and install it",
      "In a chat, type @ycyc",
    ],
  },
  {
    key: "grok",
    name: "Grok",
    letter: "X",
    tile: { bg: colors.surface2, fg: "#FFFFFF", border: colors.borderStrong },
    hint: "Settings, Connectors, Add",
    steps: ["Settings, Connectors, Add", "Paste your link and save", "Ask Grok to use ycyc"],
  },
  {
    key: "muse",
    name: "Muse",
    letter: "M",
    tile: { bg: "#1D4ED8", fg: "#FFFFFF" },
    hint: "Settings, Connectors, Add",
    steps: ["Settings, Connectors, Add", "Paste your link and save", "Ask Muse to use ycyc"],
  },
];

const MONO = Platform.select({ ios: "Menlo", default: "monospace" });

function AssistantRow({
  a,
  lastUsed,
  now,
  first,
  link,
}: {
  a: Assistant;
  lastUsed?: number;
  now: number;
  first: boolean;
  link: string | null;
}) {
  const [open, setOpen] = useState(false);
  const added = lastUsed !== undefined;
  return (
    <Animated.View layout={layout} style={[styles.row, !first && styles.rowBorder]}>
      <View style={styles.rowTop}>
        <View style={[styles.letter, { backgroundColor: a.tile.bg, borderColor: a.tile.border ?? a.tile.bg }]}>
          <Text variant="rowTitle" color={a.tile.fg}>
            {a.letter}
          </Text>
        </View>
        <View style={styles.rowText}>
          <Text variant="rowTitle">{a.name}</Text>
          <Text variant="caption" color={colors.textSecondary}>
            {added ? `Added · used ${timeAgo(lastUsed, now) === "now" ? "just now" : `${timeAgo(lastUsed, now)} ago`}` : a.hint}
          </Text>
        </View>
        {added ? (
          <View style={styles.check}>
            <Icon name="checkBlack" size={14} />
          </View>
        ) : (
          <Button label={open ? "Hide" : "How"} kind="secondary" size="small" onPress={() => setOpen((o) => !o)} />
        )}
      </View>
      {a.key === "claude" && !added && link ? (
        <View style={styles.setup}>
          <Button
            label="Set up in Claude"
            size="small"
            onPress={async () => {
              await Clipboard.setStringAsync(link).catch(() => {});
              await Linking.openURL("https://claude.ai/customize/connectors?modal=add-custom-connector").catch(() => {});
            }}
          />
          <Text variant="micro" color={colors.textTertiary}>
            Copies your link, then opens Claude. Paste it and name it ycyc.
          </Text>
        </View>
      ) : null}
      {open && !added ? (
        <Animated.View entering={FadeIn.duration(220)} style={styles.steps}>
          {a.steps.map((s, i) => (
            <View key={s} style={styles.step}>
              <Text variant="label" color={colors.textTertiary} style={styles.stepNum}>
                {i + 1}
              </Text>
              <Text variant="body" style={styles.flex}>
                {s}
              </Text>
            </View>
          ))}
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

function DevCommand({ label, command, copyValue }: { label: string; command: string; copyValue: string | null }) {
  return (
    <View style={styles.dev}>
      <Text variant="label" color={colors.textSecondary}>
        {label}
      </Text>
      <View style={styles.codeRow}>
        <Text style={styles.code} selectable numberOfLines={2}>
          {command}
        </Text>
        <CopyButton value={copyValue} kind="secondary" />
      </View>
    </View>
  );
}

export default function LinkScreen() {
  const { userId, mcpUrl } = useUser();
  const now = useNow();
  const feed = useQuery(api.activity.feed, userId ? { userId, limit: 200 } : "skip");
  const [devOpen, setDevOpen] = useState(false);

  const lastUsed = new Map<string, number>();
  for (const a of feed ?? []) if (!lastUsed.has(a.assistant)) lastUsed.set(a.assistant, a.at);

  const link = mcpUrl ?? "";
  const claudeCode = `claude mcp add --transport http ycyc ${link}`;
  const codex = `codex mcp add ycyc --url ${link}`;

  return (
    <Screen contentStyle={styles.content}>
      <Animated.View entering={enter(0)} style={styles.head}>
        <Text style={styles.title}>One link,{"\n"}every assistant</Text>
        <Text variant="body" color={colors.textSecondary}>
          Paste it once. Every app you add shows up on its own.
        </Text>
      </Animated.View>

      <Animated.View entering={enter(1)} style={styles.linkRow}>
        <Text variant="body" color="#D4D4D4" numberOfLines={1} style={styles.flex}>
          {displayLink(mcpUrl) ?? "Creating your link"}
        </Text>
        <CopyButton value={mcpUrl} />
      </Animated.View>

      <Animated.View entering={enter(2)} style={styles.card}>
        {ASSISTANTS.map((a, i) => (
          <AssistantRow key={a.key} a={a} lastUsed={lastUsed.get(a.key)} now={now} first={i === 0} link={mcpUrl} />
        ))}
      </Animated.View>

      <Animated.View entering={enter(3)} layout={layout} style={styles.devCard}>
        <PressableScale
          onPress={() => setDevOpen((o) => !o)}
          haptic="selection"
          scaleTo={0.98}
          accessibilityLabel={devOpen ? "Hide developer setup" : "Show developer setup"}
          style={styles.devHead}
        >
          <Text variant="bodyMedium" color={colors.textSecondary}>
            For developers
          </Text>
          <Text variant="label" color={colors.textTertiary}>
            {devOpen ? "Hide" : "Show"}
          </Text>
        </PressableScale>
        {devOpen ? (
          <Animated.View entering={FadeIn.duration(220)} style={styles.devBody}>
            <DevCommand label="Claude Code" command={claudeCode} copyValue={mcpUrl ? claudeCode : null} />
            <DevCommand label="Codex" command={codex} copyValue={mcpUrl ? codex : null} />
            <View style={styles.dev}>
              <Text variant="label" color={colors.textSecondary}>
                Cursor
              </Text>
              <View style={styles.codeRow}>
                <Text variant="body" style={styles.flex}>
                  Settings, MCP, Add server, paste your link
                </Text>
                <CopyButton value={mcpUrl} kind="secondary" label="Copy link" />
              </View>
            </View>
          </Animated.View>
        ) : null}
      </Animated.View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 20, gap: 26, paddingTop: space.lg },
  head: { gap: space.sm },
  title: { fontFamily: "Inter_600SemiBold", fontSize: 30, lineHeight: 36, letterSpacing: -0.6, color: colors.text },
  flex: { flex: 1 },
  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    padding: space.lg,
    borderRadius: 18,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: 18, backgroundColor: colors.surface, overflow: "hidden" },
  row: { paddingVertical: 14, paddingHorizontal: space.lg, gap: space.md },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 14 },
  letter: { width: 40, height: 40, borderRadius: 12, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  rowText: { flex: 1, gap: 2 },
  check: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.accent, alignItems: "center", justifyContent: "center" },
  steps: { gap: space.sm, paddingLeft: 54 },
  setup: { alignItems: "flex-start", gap: 6, paddingLeft: 54 },
  step: { flexDirection: "row", gap: space.sm },
  stepNum: { width: 14, paddingTop: 2 },
  devCard: { borderWidth: 1, borderColor: colors.border, borderRadius: 18, overflow: "hidden" },
  devHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: space.lg },
  devBody: { paddingHorizontal: space.lg, paddingBottom: space.lg, gap: space.lg },
  dev: { gap: 6 },
  codeRow: { flexDirection: "row", alignItems: "center", gap: space.md },
  code: {
    flex: 1,
    fontFamily: MONO,
    fontSize: 12,
    lineHeight: 17,
    color: "#D4D4D4",
    backgroundColor: colors.surface2,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    overflow: "hidden",
  },
});
