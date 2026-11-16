import { useQueries, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState, type ComponentRef } from "react";
import { AppState, Keyboard, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AiLoginSheet } from "@/components/ai-login";
import { AssistantHeader } from "@/components/agent/assistant-header";
import { AssistantMenu, assistantLabel } from "@/components/agent/assistant-menu";
import { Composer } from "@/components/agent/composer";
import { Conversation } from "@/components/agent/conversation";
import { HistoryDrawer, type HistoryThread } from "@/components/agent/history-drawer";
import { HistoryMenu } from "@/components/agent/history-menu";
import { RecentRow } from "@/components/agent/recent";
import { Suggestions, type Suggestion } from "@/components/agent/suggestions";
import { APP_COPY } from "@/components/app-copy";
import { AppGlyph } from "@/components/app-glyph";
import { Icon } from "@/components/icon";
import { SectionHeader } from "@/components/layout";
import { PressableScale } from "@/components/pressable-scale";
import { Text } from "@/components/text";
import { api, type CatalogEntry, type MyConnection } from "@/hooks/convex";
import { useNow } from "@/hooks/format";
import { useUser } from "@/hooks/user";
import { PLAN_PROVIDER_ID, planForProvider, selectPlan, useActiveThread, useAgent, useAiPlans, type AgentProvider } from "@/lib/agent";
import { colors, enter, fadeIn, fonts, layout, radius, space } from "@/theme";

const RECENT = 3;
// Enough recent activity to settle the cards of the current reply.
const RECEIPTS = 20;
const SUGGESTIONS = 3;
// Light up the newest activity row when the person comes back within this window of a handoff.
const RETURN_WINDOW = 10 * 60 * 1000;

type ThreadList = FunctionReturnType<typeof api.aiChat.threads>;

/** Up to four asks, round-robin across live apps so each one shows up. */
function buildSuggestions(live: MyConnection[]): Suggestion[] {
  const out: Suggestion[] = [];
  for (let round = 0; round < 2 && out.length < SUGGESTIONS; round++) {
    for (const c of live) {
      const prompt = APP_COPY[c.app.slug]?.prompts[round];
      if (prompt && out.length < SUGGESTIONS) out.push({ prompt, app: c.app });
    }
  }
  return out;
}

export default function AgentScreen() {
  const router = useRouter();
  const { learningThread, learningProvider } = useLocalSearchParams<{ learningThread?: string; learningProvider?: string }>();
  const insets = useSafeAreaInsets();
  const { userId } = useUser();
  const now = useNow();
  const apps = useQuery(api.apps.list);
  const connections = useQuery(api.connections.mine, userId ? { userId } : "skip");
  const feed = useQuery(api.activity.feed, userId ? { userId, limit: RECEIPTS } : "skip");
  const pending = useQuery(api.approvals.pending, userId ? { userId } : "skip");
  const { token } = useAiPlans();

  const appBySlug = useMemo(() => new Map<string, CatalogEntry>((apps ?? []).map((a) => [a.slug, a])), [apps]);
  const live = useMemo(() => (connections ?? []).filter((c) => c.status === "live"), [connections]);
  const agentApps = useMemo(() => live.map((c) => ({ slug: c.app.slug, name: c.app.name })), [live]);
  const suggestions = useMemo(() => buildSuggestions(live), [live]);

  const agent = useAgent({ userId, apps: agentApps });
  const { provider, lastHandoffAt } = agent;
  const selectAgent = agent.select, openAgentThread = agent.open;
  const openedLearning = useRef<string | null>(null);
  useEffect(() => {
    if (!learningThread || (learningProvider !== "claude" && learningProvider !== "codex")) return;
    const desired = PLAN_PROVIDER_ID[learningProvider];
    if (provider?.id !== desired) { selectAgent(desired); return; }
    if (openedLearning.current === learningThread) return;
    openedLearning.current = learningThread;
    openAgentThread(learningThread);
    router.setParams({ learningThread: undefined, learningProvider: undefined });
  }, [learningThread, learningProvider, provider?.id, selectAgent, openAgentThread, router]);

  // Past chats exist only for the in-app plans. useQueries so an unknown token doesn't throw;
  // the input is memoized because a fresh object each render loops forever.
  const planId = provider?.kind === "inapp" ? planForProvider(provider) : null;
  const threadQueries = useMemo(
    () => (token && planId ? { list: { query: api.aiChat.threads, args: { token } } } : ({} as Record<string, never>)),
    [token, planId],
  );
  const threadRows = (useQueries(threadQueries) as { list?: ThreadList | Error }).list;
  const threads = useMemo<HistoryThread[]>(
    () =>
      !threadRows || threadRows instanceof Error || !planId
        ? []
        : threadRows
            .filter((t) => t.provider === planId)
            .map((t) => ({ threadId: t.threadId, title: t.title, updatedAt: t.updatedAt })),
    [threadRows, planId],
  );
  const activeThread = useActiveThread(planId);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const [text, setText] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [headerH, setHeaderH] = useState(52);
  const [flash, setFlash] = useState(0);
  const [failed, setFailed] = useState<string | null>(null);
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);

  // Back from the assistant: light up the newest row, and again if a new one lands on top.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active" && lastHandoffAt && Date.now() - lastHandoffAt < RETURN_WINDOW) setFlash((f) => f + 1);
    });
    return () => sub.remove();
  }, [lastHandoffAt]);

  const topId = feed?.[0]?._id;
  const prevTop = useRef(topId);
  useEffect(() => {
    const changed = !!topId && !!prevTop.current && topId !== prevTop.current;
    prevTop.current = topId;
    if (changed && lastHandoffAt && Date.now() - lastHandoffAt < RETURN_WINDOW) setFlash((f) => f + 1);
  }, [topId, lastHandoffAt]);

  const inConversation = agent.messages.length > 0;
  const newChat = () => {
    agent.reset();
    setFailed(null);
  };

  const openThread = (threadId: string) => {
    setHistoryOpen(false);
    setDrawerOpen(false);
    if (threadId === activeThread && inConversation) return;
    setFailed(null);
    agent.open(threadId);
  };

  const recent = (feed ?? []).slice(0, RECENT);

  const send = async () => {
    if (!provider) return;
    setMenuOpen(false);
    setHistoryOpen(false);
    setFailed(null);
    Keyboard.dismiss();
    // Clear right away like any chat; the draft comes back only if the send fails.
    const draft = text;
    setText("");
    const restore = () => setText((cur) => (cur ? cur : draft));
    try {
      const res = await agent.send(draft);
      if (!res) restore();
    } catch (e) {
      restore();
      setFailed(
        provider.kind === "handoff"
          ? `Couldn't open ${provider.name}. Your message is copied.`
          : sendError(e, provider.name),
      );
    }
  };

  const pick = (id: string) => {
    agent.select(id);
    const plan = planForProvider(agent.providers.find((p) => p.id === id));
    if (plan) selectPlan(plan);
    setMenuOpen(false);
  };

  const connect = (p: AgentProvider) => {
    setMenuOpen(false);
    // Closing the sheet without finishing isn't a failure; nothing to report.
    p.connect()
      .then(() => agent.select(p.id))
      .catch(() => {});
  };

  return (
    <HistoryDrawer
      open={drawerOpen}
      onOpenChange={(o) => {
        setDrawerOpen(o);
        if (o) {
          setMenuOpen(false);
          setHistoryOpen(false);
        }
      }}
      threads={threads}
      currentId={activeThread}
      onPick={openThread}
      onNewChat={() => {
        setDrawerOpen(false);
        newChat();
      }}
    >
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.root}>
        <View style={[styles.root, { paddingTop: insets.top }]}>
          <AssistantHeader
            provider={provider}
            open={menuOpen}
            onPress={() => {
              setHistoryOpen(false);
              setMenuOpen((o) => !o);
            }}
            onNewChat={inConversation ? newChat : null}
            onMenu={() => {
              setMenuOpen(false);
              setHistoryOpen(false);
              setDrawerOpen(true);
            }}
            onHistory={
              threads.length > 0
                ? () => {
                    setMenuOpen(false);
                    setHistoryOpen((o) => !o);
                  }
                : null
            }
            historyOpen={historyOpen}
            onLayout={(e) => setHeaderH(e.nativeEvent.layout.height)}
          />

          <ScrollView
            ref={scrollRef}
            style={styles.root}
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            showsVerticalScrollIndicator={false}
            onContentSizeChange={() => {
              if (inConversation) scrollRef.current?.scrollToEnd({ animated: true });
            }}
          >
            {inConversation ? (
              <Conversation
                messages={agent.messages}
                streaming={agent.status === "streaming"}
                appBySlug={appBySlug}
                receipts={{ feed, pending }}
              />
            ) : (
              <>
                <Animated.View entering={fadeIn} style={styles.hero}>
                  <Text style={styles.prompt}>Ask your apps anything</Text>

                  {live.length > 0 ? (
                    <View style={styles.stack} accessibilityLabel={`Attached: ${live.map((c) => c.app.name).join(", ")}`}>
                      {live.slice(0, 5).map((c, i) => (
                        <View key={c._id} style={[styles.stackItem, i > 0 && styles.stackOverlap]}>
                          <AppGlyph app={c.app} size={22} />
                        </View>
                      ))}
                    </View>
                  ) : null}
                </Animated.View>

                {suggestions.length > 0 ? (
                  <Suggestions
                    items={suggestions}
                    onPick={(s) => {
                      setText(s.prompt.charAt(0).toUpperCase() + s.prompt.slice(1));
                      setFailed(null);
                    }}
                  />
                ) : connections && live.length === 0 && connections.length === 0 ? (
                  <Animated.View entering={enter(2)} layout={layout}>
                    <PressableScale
                      onPress={() => router.push("/add")}
                      haptic="light"
                      scaleTo={0.98}
                      accessibilityLabel="Connect an app"
                      style={styles.connect}
                    >
                      <Icon name="plus" size={24} />
                      <Text variant="rowTitle" style={styles.flex}>
                        Connect an app
                      </Text>
                      <Icon name="back" size={18} opacity={0.5} style={styles.forward} />
                    </PressableScale>
                  </Animated.View>
                ) : null}

                {recent.length > 0 ? (
                  <Animated.View entering={enter(6)} layout={layout}>
                    <SectionHeader title="Recent" />
                    <View>
                      {recent.map((item, i) => (
                        <RecentRow
                          key={item._id}
                          item={item}
                          app={appBySlug.get(item.appSlug)}
                          now={now}
                          index={i + 6}
                          flash={i === 0 ? flash : 0}
                          quiet
                          onPress={() =>
                            appBySlug.has(item.appSlug)
                              ? router.push({ pathname: "/app/[slug]", params: { slug: item.appSlug } })
                              : router.push("/library")
                          }
                        />
                      ))}
                    </View>
                  </Animated.View>
                ) : null}
              </>
            )}
          </ScrollView>

          <Composer
            value={text}
            onChangeText={(t) => {
              setText(t);
              if (failed) setFailed(null);
            }}
            onSend={send}
            onStop={agent.stop}
            canSend={!!provider}
            busy={agent.status !== "idle"}
            running={agent.status !== "idle" && provider?.kind === "inapp"}
            error={failed}
            label={provider?.kind === "inapp" ? `${assistantLabel(provider)} plan` : null}
          />

          {menuOpen ? (
            <AssistantMenu
              providers={agent.providers}
              currentId={provider?.id ?? null}
              top={insets.top + headerH}
              onPick={pick}
              onConnect={connect}
              onClose={() => setMenuOpen(false)}
            />
          ) : null}

          {historyOpen && threads.length > 0 ? (
            <HistoryMenu
              threads={threads}
              currentId={activeThread}
              top={insets.top + headerH}
              onPick={openThread}
              onAll={() => {
                setHistoryOpen(false);
                setDrawerOpen(true);
              }}
              onClose={() => setHistoryOpen(false)}
            />
          ) : null}
        </View>
        <AiLoginSheet />
      </KeyboardAvoidingView>
    </HistoryDrawer>
  );
}

/** Plain words for a send that didn't start. */
function sendError(e: unknown, name: string): string {
  const msg = e instanceof Error ? e.message : "";
  if (/wait for your current reply/i.test(msg)) return "Your last reply is still running. Stop it or wait.";
  if (/connect and select/i.test(msg)) return `Reconnect your ${name} plan from the menu up top.`;
  return `${name} didn't answer. Try again.`;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  forward: { transform: [{ scaleX: -1 }] },
  content: { flexGrow: 1, paddingHorizontal: space.gutter, paddingBottom: space.lg, gap: space.xl },
  hero: { flex: 1, minHeight: 140, alignItems: "center", justifyContent: "center", gap: space.lg },
  prompt: {
    fontFamily: fonts.semibold,
    fontSize: 24,
    lineHeight: 30,
    letterSpacing: -0.5,
    color: colors.text,
    textAlign: "center",
  },
  stack: { flexDirection: "row" },
  stackItem: { borderRadius: 8, borderWidth: 2, borderColor: colors.bg },
  stackOverlap: { marginLeft: -6 },
  connect: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    padding: space.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
