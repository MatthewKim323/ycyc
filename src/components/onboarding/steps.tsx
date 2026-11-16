import { useQueries } from "convex/react";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useEffect, useState } from "react";
import { ActivityIndicator, Linking, ScrollView, StyleSheet, View } from "react-native";
import Animated, { FadeIn, FadeInDown, LinearTransition } from "react-native-reanimated";

import { copyFor, taglineFor } from "@/components/app-copy";
import { Button } from "@/components/button";
import { CopyButton } from "@/components/copy-button";
import { GoogleButton } from "@/components/google-button";
import { displayLink } from "@/components/mcp-link-card";
import { Glass } from "@/components/onboarding-chrome";
import { PressableScale } from "@/components/pressable-scale";
import { Reveal } from "@/components/reveal";
import { SuccessMark } from "@/components/success-mark";
import { Text } from "@/components/text";
import { api, type CatalogEntry, type Id } from "@/hooks/convex";
import { useAuth } from "@/hooks/user";
import {
  openLogin,
  PLAN_PROVIDER_ID,
  rememberPick,
  selectPlan,
  useAiPlans,
  type PlanId,
  type ProviderStatus,
} from "@/lib/agent";
import { installedFirst, type InstalledApps } from "@/lib/installed-apps";
import { colors, enter, fonts, layout, space } from "@/theme";

import { AppIcon, PopularChips, SearchField, SearchResults } from "./app-search";

export const CLAUDE_CONNECTORS = "https://claude.ai/customize/connectors?modal=add-custom-connector";

const ORDER = ["myfitnesspal", "strong", "duolingo", "cronometer", "parkmobile"];
const rank = (slug: string) => {
  const i = ORDER.indexOf(slug);
  return i === -1 ? ORDER.length : i;
};

/** Ready apps in house order, apps found on the phone first. */
export function sortCatalog<T extends { slug: string }>(apps: T[], installed: InstalledApps): T[] {
  return installedFirst(
    [...apps].sort((a, b) => rank(a.slug) - rank(b.slug)),
    installed,
  );
}

export function Welcome({ bottomInset, onNext }: { bottomInset: number; onNext: () => void }) {
  const auth = useAuth();
  const [signingIn, setSigningIn] = useState(false);
  const [failed, setFailed] = useState(false);
  const google = auth.configured && !auth.signedIn;

  const continueWithGoogle = async () => {
    setSigningIn(true);
    setFailed(false);
    const result = await auth.signInWithGoogle();
    setSigningIn(false);
    if (result === "signed-in") onNext();
    else if (result === "failed") setFailed(true);
  };

  return (
    <View style={[styles.screen, styles.welcome, { paddingBottom: bottomInset + space.lg }]}>
      <Reveal delay={200} style={styles.wordmark}>
        <Text variant="heading">yuzu</Text>
      </Reveal>
      <View style={styles.bottom}>
        <View>
          <Reveal delay={350}>
            <Text style={styles.hero}>Your apps,</Text>
          </Reveal>
          <Reveal delay={430}>
            <Text style={styles.hero}>in every AI.</Text>
          </Reveal>
        </View>
        <Reveal delay={560}>
          <Text variant="body" color={colors.textSecondary}>
            Connect the apps you already use. Use them from Claude, ChatGPT, Grok and Muse.
          </Text>
        </Reveal>
        <Reveal delay={700} style={styles.cta}>
          {google ? (
            <View>
              <GoogleButton onPress={continueWithGoogle} loading={signingIn || !auth.loaded} />
              {failed ? (
                <Animated.View entering={FadeIn.duration(200)}>
                  <Text variant="caption" color={colors.error} style={[styles.center, styles.authError]}>
                    Google sign-in didn&rsquo;t finish. Try again.
                  </Text>
                </Animated.View>
              ) : null}
              <PressableScale
                onPress={onNext}
                haptic="selection"
                disabled={signingIn}
                style={styles.textButton}
                accessibilityLabel="Continue without an account"
              >
                <Text variant="bodyMedium" color={colors.textSecondary}>
                  Continue without an account
                </Text>
              </PressableScale>
            </View>
          ) : (
            <Button label="Get started" onPress={onNext} fullWidth />
          )}
        </Reveal>
      </View>
    </View>
  );
}

const PLANS: { plan: PlanId; title: string }[] = [
  { plan: "claude", title: "Claude plan" },
  { plan: "codex", title: "ChatGPT plan" },
];

function planState(row: ProviderStatus | undefined): { text: string; live: boolean } {
  if (row?.status === "connected") return { text: "Connected", live: true };
  if (row?.status === "starting" || row?.status === "authorizing") return { text: "Signing in", live: false };
  return { text: "Connect", live: false };
}

/** Pick your AI: sign in a Claude or ChatGPT plan, or keep using an assistant app. Never blocks. */
export function PickAI({
  bottomInset,
  onNext,
  onOwnAssistant,
}: {
  bottomInset: number;
  onNext: () => void;
  onOwnAssistant: () => void;
}) {
  const { token, status } = useAiPlans();
  const queries = token ? { state: { query: api.aiOnboarding.state, args: { token } } } : ({} as Record<string, never>);
  const result = useQueries(queries) as { state?: { step: string; provider: PlanId | null } | Error };
  const state = result.state instanceof Error ? undefined : result.state;
  const selected = state?.provider ?? status?.find((s) => s.selected)?.provider ?? null;
  const connectedCount = status?.filter((s) => s.status === "connected").length ?? 0;
  const anyConnected = connectedCount > 0;

  const choose = (plan: PlanId, row: ProviderStatus | undefined) => {
    if (row?.status === "connected") {
      selectPlan(plan);
      rememberPick(PLAN_PROVIDER_ID[plan]);
      return;
    }
    openLogin(plan).catch(() => {});
  };

  return (
    <View style={[styles.screen, { paddingTop: space.xxl, paddingBottom: bottomInset + space.lg }]}>
      <View style={styles.top}>
        <Reveal delay={0}>
          <Text style={styles.title}>Pick your AI</Text>
        </Reveal>
        <Reveal delay={80}>
          <Text variant="body" color={colors.textSecondary}>
            Use the plan you already pay for. It answers right inside yuzu.
          </Text>
        </Reveal>
        <Animated.View entering={enter(3)}>
          <Glass>
            {PLANS.map((p, i) => {
              const row = status?.find((s) => s.provider === p.plan);
              const st = planState(row);
              const isSelected = selected === p.plan && st.live;
              return (
                <View key={p.plan} style={i > 0 && styles.divider}>
                  <PressableScale
                    onPress={() => choose(p.plan, row)}
                    haptic="selection"
                    scaleTo={0.98}
                    style={styles.appRow}
                    accessibilityLabel={`${p.title}, ${st.text}`}
                    accessibilityState={{ selected: isSelected }}
                  >
                    <View style={styles.flex}>
                      <Text variant="rowTitle">{p.title}</Text>
                    </View>
                    <Animated.View key={st.text} entering={FadeIn.duration(200)} style={styles.onPhone}>
                      {st.live ? <View style={styles.liveDot} /> : null}
                      <Text variant="label" color={st.live ? colors.text : colors.textSecondary}>
                        {isSelected && connectedCount > 1 ? "In use" : st.text}
                      </Text>
                    </Animated.View>
                  </PressableScale>
                </View>
              );
            })}
          </Glass>
        </Animated.View>
      </View>

      <Animated.View entering={FadeIn.delay(320).duration(280)} style={styles.actions}>
        {anyConnected ? (
          <Animated.View entering={FadeIn.duration(200)} layout={layout}>
            <Button label="Continue" onPress={onNext} fullWidth />
          </Animated.View>
        ) : null}
        <PressableScale
          onPress={onOwnAssistant}
          haptic="selection"
          style={styles.textButton}
          accessibilityLabel="I'll use my own assistant app"
        >
          <Text variant="bodyMedium" color={colors.textSecondary}>
            I&rsquo;ll use my own assistant app
          </Text>
        </PressableScale>
      </Animated.View>
    </View>
  );
}

const HOW = [
  {
    title: "Sign in to an app",
    body: "Right inside yuzu, on its own login page.",
  },
  { title: "yuzu sets it up", body: "You watch it happen, step by step." },
  {
    title: "Add one link to your assistant",
    body: "Then ask: log my lunch, what did I bench last week.",
  },
];

export function How({ bottomInset, onNext }: { bottomInset: number; onNext: () => void }) {
  return (
    <View style={[styles.screen, { paddingTop: space.xxl, paddingBottom: bottomInset + space.lg }]}>
      <View style={styles.top}>
        <Reveal delay={0}>
          <Text style={styles.title}>Set it up once.</Text>
        </Reveal>
        <Glass style={styles.howCard}>
          {HOW.map((r, i) => (
            <Animated.View key={r.title} entering={enter(i + 2)} style={styles.howRow}>
              <View style={styles.num}>
                <Text variant="label">{i + 1}</Text>
              </View>
              <View style={styles.flex}>
                <Text variant="rowTitle">{r.title}</Text>
                <Text variant="caption" color={colors.textSecondary}>
                  {r.body}
                </Text>
              </View>
            </Animated.View>
          ))}
        </Glass>
      </View>
      <Reveal delay={320}>
        <Button label="Pick your first app" onPress={onNext} fullWidth />
      </Reveal>
    </View>
  );
}

export function Pick({
  apps,
  installed,
  userId,
  bottomInset,
  onPick,
}: {
  apps: CatalogEntry[] | undefined;
  installed: InstalledApps;
  userId: Id<"users"> | null;
  bottomInset: number;
  onPick: (slug: string) => void;
}) {
  const [query, setQuery] = useState("");
  const sorted = sortCatalog(apps ?? [], installed);
  const searching = query.trim().length > 0;

  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={[styles.pickContent, { paddingBottom: bottomInset + space.xxl }]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      showsVerticalScrollIndicator={false}
    >
      <Reveal delay={0}>
        <Text style={styles.title}>Pick your first app</Text>
      </Reveal>
      <Animated.View entering={enter(1)}>
        <SearchField value={query} onChange={setQuery} />
      </Animated.View>

      {searching ? (
        <Animated.View key="results" entering={FadeIn.duration(200)} layout={layout}>
          <Glass>
            <SearchResults query={query} userId={userId} onConnect={onPick} />
          </Glass>
        </Animated.View>
      ) : (
        <Animated.View key="ready" entering={FadeIn.duration(200)} layout={layout} style={styles.readyBlock}>
          <Glass>
            {apps === undefined ? (
              <ActivityIndicator color={colors.textTertiary} style={styles.loading} />
            ) : (
              sorted.map((a, i) => (
                <Animated.View
                  key={a.slug}
                  entering={enter(i + 2)}
                  layout={LinearTransition.duration(240)}
                  style={i > 0 && styles.divider}
                >
                  <PressableScale
                    onPress={() => onPick(a.slug)}
                    haptic="selection"
                    scaleTo={0.98}
                    style={styles.appRow}
                    accessibilityLabel={`Connect ${a.name}`}
                  >
                    <AppIcon app={a} size={44} />
                    <View style={styles.flex}>
                      <Text variant="rowTitle" numberOfLines={1}>
                        {a.name}
                      </Text>
                      {installed[a.slug] ? (
                        <View style={styles.onPhone}>
                          <View style={styles.liveDot} />
                          <Text variant="caption" color={colors.text}>
                            On your phone
                          </Text>
                        </View>
                      ) : (
                        <Text variant="caption" color={colors.textSecondary} numberOfLines={1}>
                          {"discovered" in a && a.discovered ? "yuzu learns it" : taglineFor(a)}
                        </Text>
                      )}
                    </View>
                  </PressableScale>
                </Animated.View>
              ))
            )}
          </Glass>
          <PopularChips onPick={setQuery} />
        </Animated.View>
      )}
    </ScrollView>
  );
}

export function Ready({
  app,
  bottomInset,
  onNext,
  planReady = false,
}: {
  app: { slug: string; name: string };
  bottomInset: number;
  onNext: () => void;
  /** A Claude/ChatGPT plan is connected: finish into the Agent tab instead of the link step. */
  planReady?: boolean;
}) {
  const example = copyFor(app.slug)?.prompts[0];
  return (
    <View style={[styles.screen, { paddingBottom: bottomInset + space.lg }]}>
      <View style={styles.readyHero}>
        <SuccessMark size={80} />
        <Animated.View entering={FadeInDown.delay(260).duration(320)}>
          <Text style={[styles.title, styles.center]}>{app.name} is ready</Text>
        </Animated.View>
        {example ? (
          <Animated.View entering={FadeInDown.delay(340).duration(320)}>
            <Text variant="body" color={colors.textSecondary} style={styles.center}>
              {planReady ? "Try asking" : "Soon you can ask"}: &ldquo;{example}&rdquo;
            </Text>
          </Animated.View>
        ) : null}
      </View>
      <Animated.View entering={FadeIn.delay(480).duration(280)}>
        <Button label={planReady ? "Done" : "Add to your assistant"} onPress={onNext} fullWidth />
      </Animated.View>
    </View>
  );
}

export function Assistant({
  mcpUrl,
  bottomInset,
  onDone,
  onOthers,
}: {
  mcpUrl: string | null;
  bottomInset: number;
  onDone: () => void;
  onOthers: () => void;
}) {
  const [opened, setOpened] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 2400);
    return () => clearTimeout(id);
  }, [copied]);

  const openClaude = async () => {
    if (mcpUrl) {
      await Clipboard.setStringAsync(mcpUrl);
      setCopied(true);
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setOpened(true);
    Linking.openURL(CLAUDE_CONNECTORS).catch(() => {});
  };

  return (
    <View style={[styles.screen, { paddingTop: space.xxl, paddingBottom: bottomInset + space.lg }]}>
      <View style={styles.top}>
        <Reveal delay={0}>
          <Text style={styles.title}>Add yuzu to your assistant</Text>
        </Reveal>
        <Reveal delay={80}>
          <Text variant="body" color={colors.textSecondary}>
            One link for every app you connect. Paste it once as a custom connector.
          </Text>
        </Reveal>
        <Animated.View entering={enter(3)}>
          <Glass style={styles.linkCard}>
            <View style={styles.flex}>
              <Text variant="label" color={colors.textSecondary}>
                Your link
              </Text>
              {mcpUrl ? (
                <Text variant="bodyMedium" numberOfLines={1} ellipsizeMode="middle">
                  {displayLink(mcpUrl)}
                </Text>
              ) : (
                <ActivityIndicator color={colors.textTertiary} style={styles.linkLoading} />
              )}
            </View>
            <CopyButton value={mcpUrl} kind="secondary" />
          </Glass>
        </Animated.View>
        {copied ? (
          <Animated.View entering={FadeInDown.duration(240)} layout={layout}>
            <Text variant="caption" color={colors.textSecondary}>
              Link copied. Paste it as the connector URL in Claude.
            </Text>
          </Animated.View>
        ) : null}
        <Animated.View entering={enter(4)} layout={layout}>
          <PressableScale onPress={onOthers} haptic="selection" scaleTo={0.98} accessibilityLabel="Other assistants">
            <Glass style={styles.othersRow}>
              <View style={styles.flex}>
                <Text variant="rowTitle">Other assistants</Text>
                <Text variant="caption" color={colors.textSecondary}>
                  ChatGPT, Grok, Muse and more
                </Text>
              </View>
              <Text variant="label" color={colors.textSecondary}>
                Open
              </Text>
            </Glass>
          </PressableScale>
        </Animated.View>
      </View>

      <Animated.View entering={FadeIn.delay(320).duration(280)} style={styles.actions}>
        <Animated.View key={opened ? "done" : "claude"} entering={FadeIn.duration(200)} layout={layout}>
          {opened ? (
            <Button label="Done" onPress={onDone} fullWidth />
          ) : (
            <Button label="Set up in Claude" onPress={openClaude} haptic="none" fullWidth />
          )}
        </Animated.View>
        <PressableScale
          onPress={opened ? openClaude : onDone}
          haptic="selection"
          style={styles.textButton}
          accessibilityLabel={opened ? "Open Claude again" : "Done"}
        >
          <Text variant="bodyMedium" color={colors.textSecondary}>
            {opened ? "Open Claude again" : "Done"}
          </Text>
        </PressableScale>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { textAlign: "center" },
  screen: {
    flex: 1,
    paddingHorizontal: space.gutter,
    justifyContent: "space-between",
  },
  // Pulls the wordmark up into the empty bar slot: 24 pt under the safe area.
  welcome: { marginTop: -24 },
  wordmark: { alignItems: "center" },
  bottom: { gap: space.md },
  hero: {
    fontFamily: fonts.semibold,
    fontSize: 34,
    lineHeight: 40,
    letterSpacing: -0.8,
    color: colors.text,
  },
  title: {
    fontFamily: fonts.semibold,
    fontSize: 30,
    lineHeight: 36,
    letterSpacing: -0.6,
    color: colors.text,
  },
  cta: { marginTop: space.lg },
  authError: { marginTop: space.sm },
  top: { gap: space.xl },
  howCard: { padding: space.xl, gap: space.xl },
  howRow: { flexDirection: "row", gap: space.md, alignItems: "flex-start" },
  num: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.textSecondary,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  pickContent: {
    paddingHorizontal: space.gutter,
    paddingTop: space.xl,
    gap: space.xl,
  },
  readyBlock: { gap: space.xl },
  loading: { paddingVertical: space.xl },
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.1)",
  },
  appRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  onPhone: { flexDirection: "row", alignItems: "center", gap: 6 },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.live,
  },
  readyHero: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: space.md,
    paddingHorizontal: space.md,
  },
  linkCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    padding: space.lg,
  },
  linkLoading: { alignSelf: "flex-start", marginTop: 4 },
  othersRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    padding: space.lg,
  },
  actions: { gap: space.xs },
  textButton: {
    alignSelf: "center",
    paddingVertical: space.md,
    paddingHorizontal: space.xl,
  },
});
