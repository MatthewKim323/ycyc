import { useMutation, useQueries, useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, TextInput, View } from "react-native";
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppGlyph } from "@/components/app-glyph";
import { BackButton } from "@/components/back-button";
import { mergeSteps, StepList, useDwell, type DisplayStep } from "@/components/build-steps";
import { Button } from "@/components/button";
import { CaptureWebView } from "@/components/capture-webview";
import { CodeEntry } from "@/components/code-entry";
import { CredentialsForm } from "@/components/credentials-form";
import { FlowProgress } from "@/components/flow-progress";
import { Icon } from "@/components/icon";
import { PressableScale } from "@/components/pressable-scale";
import { SuccessMark } from "@/components/success-mark";
import { Text } from "@/components/text";
import { api, type Id } from "@/hooks/convex";
import { hostOf } from "@/hooks/format";
import { useOnboarding } from "@/hooks/onboarding";
import { useUser } from "@/hooks/user";
import { captureConfigFor, magicLinkFor } from "@/lib/capture/apps";
import type { CaptureEntry, CatalogApp, SessionBundle } from "@/lib/contract";
import { useAiPlans } from "@/lib/agent";
import { copyFor, plainError, type Capability } from "@/components/app-copy";
import { colors, enter, layout, radius, space, springs, stageIn, stageOut } from "@/theme";

// Added by the backend for apps that email a verification code (Strong).
const submitCodeRef = makeFunctionReference<"mutation", { connectionId: Id<"connections">; code: string }, unknown>(
  "connections:submitCode",
);


type Stage = "loading" | "missing" | "signin" | "code" | "build" | "learn" | "live" | "error";
type GlyphApp = Pick<CatalogApp, "slug" | "category">;

function BreathingGlyph({ app }: { app: GlyphApp }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.set(withRepeat(withTiming(1, { duration: 1800, easing: Easing.out(Easing.quad) }), -1));
  }, [t]);
  const ring = useAnimatedStyle(() => ({ opacity: 0.35 * (1 - t.get()), transform: [{ scale: 1 + 0.35 * t.get() }] }));
  return (
    <View style={styles.glyphWrap}>
      <Animated.View pointerEvents="none" style={[styles.breath, ring]} />
      <AppGlyph app={app} size={64} />
    </View>
  );
}

function CanList({ can }: { can: Capability[] }) {
  return (
    <View style={styles.tools}>
      <Text variant="label" color={colors.textSecondary}>
        Your assistant can
      </Text>
      {can.map((c, i) => (
        <Animated.View key={c.verb} entering={enter(i)} style={styles.toolRow}>
          <Text variant="bodyMedium" style={styles.flex} numberOfLines={1}>
            {c.verb}
          </Text>
          {c.asks ? (
            <Text variant="caption" color={colors.textSecondary}>
              Asks you first
            </Text>
          ) : null}
        </Animated.View>
      ))}
    </View>
  );
}

function BuildStage({
  app,
  steps,
  can,
  onShown,
  onSettled,
}: {
  app: GlyphApp & { name: string };
  steps: DisplayStep[];
  can: Capability[];
  onShown: (n: number) => void;
  onSettled: () => void;
}) {
  const shown = useDwell(steps, onSettled);
  const doneCount = shown.filter((s) => s.status === "done").length;
  useEffect(() => onShown(doneCount), [doneCount, onShown]);
  const showCan = doneCount >= 2 && can.length > 0;

  return (
    <ScrollView contentContainerStyle={styles.buildContent} showsVerticalScrollIndicator={false}>
      <View style={styles.hero}>
        <BreathingGlyph app={app} />
        <Animated.View entering={enter(0)}>
          <Text variant="heading" style={styles.center}>
            Setting up {app.name}
          </Text>
        </Animated.View>
      </View>
      <StepList steps={shown} />
      {showCan ? (
        <Animated.View entering={enter(0)} layout={layout}>
          <CanList can={can} />
        </Animated.View>
      ) : null}
    </ScrollView>
  );
}

function LiveStage({
  app,
  can,
  firstConnect,
  mcpUrl,
  bottomInset,
  onDone,
  onShowMe,
}: {
  app: GlyphApp & { name: string };
  can: Capability[];
  firstConnect: boolean;
  mcpUrl: string | null;
  bottomInset: number;
  onDone: () => void;
  onShowMe: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [copiedOnce, setCopiedOnce] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(id);
  }, [copied]);

  const example = copyFor(app.slug)?.prompts[0];

  const copy = async () => {
    if (!mcpUrl) return;
    await Clipboard.setStringAsync(mcpUrl);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setCopied(true);
    setCopiedOnce(true);
  };

  return (
    <View style={styles.flex}>
      <ScrollView contentContainerStyle={styles.liveContent} showsVerticalScrollIndicator={false}>
        <SuccessMark />
        <Animated.View entering={FadeInDown.delay(260).duration(280)}>
          <Text variant="title" style={styles.center}>
            {app.name} is ready
          </Text>
        </Animated.View>
        <Animated.View entering={FadeInDown.delay(320).duration(280)}>
          <Text variant="body" color={colors.textSecondary} style={styles.center}>
            {firstConnect
              ? example
                ? `Ask any assistant: "${example}"`
                : "Ask any assistant to use it."
              : "Already in your assistants. Nothing to paste."}
          </Text>
        </Animated.View>
        {can.length > 0 ? (
          <Animated.View entering={FadeIn.delay(380).duration(280)} style={styles.liveCan}>
            <CanList can={can} />
          </Animated.View>
        ) : null}
      </ScrollView>

      <Animated.View
        entering={FadeIn.delay(420).duration(280)}
        style={[styles.footer, { paddingBottom: bottomInset + space.md }]}
      >
        {firstConnect ? (
          <>
            {copiedOnce ? (
              <Animated.View
                entering={FadeInDown.springify().damping(springs.enter.damping)}
                layout={layout}
                style={styles.pasteRow}
              >
                <Text variant="caption" color={colors.textSecondary} style={styles.flex}>
                  Paste it in your assistant&apos;s connector settings.
                </Text>
                <Button label="Show me" kind="secondary" size="small" onPress={onShowMe} />
              </Animated.View>
            ) : null}
            <Animated.View layout={layout}>
              <Button
                label={copied ? "Copied" : copiedOnce ? "Copy again" : "Copy your link"}
                onPress={copy}
                haptic="none"
                disabled={!mcpUrl}
                fullWidth
              />
            </Animated.View>
            <PressableScale onPress={onDone} haptic="selection" style={styles.textButton} accessibilityLabel="Done">
              <Text variant="bodyMedium" color={colors.textSecondary}>
                Done
              </Text>
            </PressableScale>
          </>
        ) : (
          <Button label="Done" onPress={onDone} fullWidth />
        )}
      </Animated.View>
    </View>
  );
}

/** One modal for Sign in, Set up and Done. The progress bar at the top never resets. */
export default function ConnectFlow() {
  const params = useLocalSearchParams<{ connectionId: string; slug?: string; onboarding?: string }>();
  const connectionId = params.connectionId as Id<"connections">;
  const onboarding = !!params.onboarding;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { userId, mcpUrl } = useUser();
  const { finish, onboarded } = useOnboarding();
  const { token } = useAiPlans();
  const planQueries = token ? { state: { query: api.aiOnboarding.state, args: { token } } } : ({} as Record<string, never>);
  const planResult = useQueries(planQueries);
  const planState = planResult.state instanceof Error ? undefined : planResult.state;
  const planReady = !!planState?.provider && (planState.step === "connect_apps" || planState.step === "ready");
  const checkingPlan = !!token && planResult.state === undefined;

  const conns = useQuery(api.connections.mine, userId ? { userId } : "skip");
  const conn = conns?.find((c) => c._id === connectionId);
  const slug = conn?.appSlug ?? params.slug;
  const app = useQuery(api.apps.get, slug ? { slug } : "skip");
  const build = useQuery(api.builds.forConnection, connectionId ? { connectionId } : "skip");
  const submitLogin = useMutation(api.connections.submitLogin);
  const submitCode = useMutation(submitCodeRef);
  const start = useMutation(api.connections.start);

  const [web, setWeb] = useState({ phase: "login" as "login" | "capturing", requests: 0, loggedIn: false });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settled, setSettled] = useState(false);
  const [shownSteps, setShownSteps] = useState(0);
  const [firstConnect, setFirstConnect] = useState<boolean | null>(null);
  const [openedLive, setOpenedLive] = useState<boolean | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [startUrl, setStartUrl] = useState<string | undefined>(undefined);
  const [magicOpen, setMagicOpen] = useState(false);
  const [magicText, setMagicText] = useState("");
  const [magicError, setMagicError] = useState<string | null>(null);

  const status = conn?.status as string | undefined;

  // Captured once, on the first render that has data (derived state, not an effect).
  if (conns && firstConnect === null) {
    setFirstConnect(conns.filter((c) => c._id !== connectionId && c.status === "live").length === 0);
  }
  if (status && openedLive === null) setOpenedLive(status === "live");

  useEffect(() => {
    if (web.loggedIn) Haptics.selectionAsync().catch(() => {});
  }, [web.loggedIn]);

  const captureReady = status === "capturing" && build?.status === "done";
  const preSubmit = status === "needs_login" || (status === "capturing" && !captureReady);
  const isWeb = app?.route === "web";

  let stage: Stage;
  if (!conns || app === undefined) stage = "loading";
  else if (!conn || !app) stage = "missing";
  else if (status === "needs_code") stage = "code";
  else if (captureReady) stage = "learn";
  else if (preSubmit) stage = isWeb && web.loggedIn ? "build" : "signin";
  else if (status === "building") stage = "build";
  else if (status === "live") stage = settled || openedLive ? "live" : "build";
  else stage = "error";

  // Before submitLogin lands, the capture itself is the "reading" step.
  const steps: DisplayStep[] =
    preSubmit && isWeb && web.loggedIn
      ? [
          { key: "signin", label: "Signing in", status: "done" },
          { key: "read", label: "Learning the app", status: "running" },
          { key: "test", label: "Checking it works", status: "pending" },
          { key: "ready", label: "Ready", status: "pending" },
        ]
      : mergeSteps(build?.steps);

  const can = slug ? (copyFor(slug)?.can ?? []) : [];

  const fills: [number, number, number] =
    stage === "signin"
      ? [isWeb && web.loggedIn ? 1 : 0.33, 0, 0]
      : stage === "code"
        ? [0.66, 0, 0]
        : stage === "build"
          ? [1, Math.max(0.06, shownSteps / 4), 0]
          : stage === "live"
            ? [1, 1, 1]
            : stage === "learn"
              ? [1, 0, 0]
            : stage === "error"
              ? [1, shownSteps / 4, 0]
              : [0, 0, 0];
  const active: 0 | 1 | 2 = stage === "live" ? 2 : stage === "build" || stage === "learn" || stage === "error" ? 1 : 0;

  const onSettled = useCallback(() => setSettled(true), []);

  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/");
  };

  const leave = async (to: "/" | "/link" | "/agent") => {
    if (to === "/agent" && !planReady) {
      router.dismissAll();
      router.replace("/onboarding");
      return;
    }
    if (onboarding || (to === "/agent" && onboarded === false)) {
      await finish();
      router.dismissAll();
      router.replace(to);
    } else {
      router.dismissTo(to);
    }
  };

  const submit = async (session: SessionBundle, capture: CaptureEntry[]) => {
    setSubmitting(true);
    setError(null);
    try {
      await submitLogin({ connectionId, session, capture });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save your sign-in. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const retry = async () => {
    if (!userId || !app) return;
    setError(null);
    setSettled(false);
    setShownSteps(0);
    setWeb({ phase: "login", requests: 0, loggedIn: false });
    setStartUrl(undefined);
    setAttempt((n) => n + 1);
    await start({ userId, appSlug: app.slug });
  };

  const domain = app ? hostOf(app.webOrigin ?? app.loginUrl) : "";
  const showWebView = !!app && isWeb && preSubmit;
  const magic = app ? captureConfigFor(app.slug, app.loginUrl, app.webOrigin).magicLink : undefined;

  // Magic sign-in (ParkMobile): load the pasted link in the capture browser instead of the login page.
  const submitMagicLink = () => {
    if (!app) return;
    const url = magicLinkFor(app.slug, magicText);
    if (!url) {
      setMagicError(`That isn't a ${app.name} sign-in link.`);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      return;
    }
    setStartUrl(url);
    setMagicOpen(false);
    setMagicText("");
    setWeb({ phase: "login", requests: 0, loggedIn: false });
    setAttempt((n) => n + 1);
  };
  const signingIn = stage === "signin" || stage === "code";
  const codePrompt =
    build?.steps.find((s) => s.key === "signin")?.detail ?? (app ? `Enter the code ${app.name} emailed you.` : "");

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={styles.side}>
          <BackButton onPress={close} />
        </View>
        <View style={styles.headCenter}>
          <Text variant="label" numberOfLines={1}>
            {app ? (signingIn && isWeb ? `Sign in to ${app.name}` : app.name) : ""}
          </Text>
          {app && isWeb && signingIn ? (
            <View style={styles.domain}>
              <Icon name="fingerprint" size={12} opacity={0.6} />
              <Text variant="micro" color={colors.textTertiary} numberOfLines={1}>
                {domain}
              </Text>
            </View>
          ) : null}
        </View>
        <View style={[styles.side, styles.sideRight]} />
      </View>

      <FlowProgress fills={fills} active={active} />

      {showWebView && magic && stage === "signin" ? (
        <View style={styles.magicBar}>
          <Button label={magic.label} kind="secondary" size="small" onPress={() => setMagicOpen(true)} />
        </View>
      ) : null}

      <View style={styles.body}>
        {showWebView ? (
          <View key={`web-${attempt}`} style={[StyleSheet.absoluteFill, styles.webWrap]}>
            <CaptureWebView
              app={app}
              startUrl={startUrl}
              onProgress={setWeb}
              onDone={({ session, capture }) => submit(session, capture)}
            />
          </View>
        ) : null}

        {showWebView && magic && magicOpen ? (
          <Animated.View entering={stageIn} exiting={stageOut} style={[styles.stage, styles.magicPanel]}>
            <Text variant="heading">{magic.label}</Text>
            <TextInput
              value={magicText}
              onChangeText={(t) => {
                setMagicText(t);
                setMagicError(null);
              }}
              placeholder="https://"
              placeholderTextColor={colors.textTertiary}
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              multiline
              style={[styles.magicInput, magicError ? styles.magicInputError : null]}
              selectionColor={colors.text}
            />
            <Text variant="caption" color={magicError ? colors.error : colors.textSecondary}>
              {magicError ?? magic.hint}
            </Text>
            <Button label="Continue" onPress={submitMagicLink} disabled={!magicText.trim()} fullWidth />
            <PressableScale onPress={() => setMagicOpen(false)} haptic="selection" style={styles.textButton} accessibilityLabel="Cancel">
              <Text variant="bodyMedium" color={colors.textSecondary}>
                Cancel
              </Text>
            </PressableScale>
          </Animated.View>
        ) : null}

        {stage === "loading" ? (
          <Animated.View key="loading" entering={stageIn} exiting={stageOut} style={styles.centerFill}>
            <ActivityIndicator color={colors.textTertiary} />
          </Animated.View>
        ) : null}

        {stage === "missing" ? (
          <Animated.View key="missing" entering={stageIn} style={styles.centerFill}>
            <Text variant="body" color={colors.textSecondary}>
              This connection was removed.
            </Text>
          </Animated.View>
        ) : null}

        {stage === "signin" && app && !isWeb ? (
          <Animated.View key="form" entering={stageIn} exiting={stageOut} style={[styles.stage, styles.opaque]}>
            <CredentialsForm
              appName={app.name}
              bottomInset={insets.bottom}
              submitting={submitting}
              error={error}
              onSubmit={(username, password) => submit({ credentials: { username, password }, capturedAt: Date.now() }, [])}
            />
          </Animated.View>
        ) : null}

        {stage === "code" && app ? (
          <Animated.View key="code" entering={stageIn} exiting={stageOut} style={[styles.stage, styles.codeStage]}>
            <CodeEntry
              title="Check your email"
              prompt={codePrompt}
              onSubmit={async (code) => {
                await submitCode({ connectionId, code });
              }}
            />
          </Animated.View>
        ) : null}

        {stage === "build" && app ? (
          <Animated.View key={`build-${attempt}`} entering={stageIn} exiting={stageOut} style={[styles.stage, styles.opaque]}>
            <BuildStage app={app} steps={steps} can={can} onShown={setShownSteps} onSettled={onSettled} />
          </Animated.View>
        ) : null}

        {stage === "live" && app ? (
          <Animated.View key="live" entering={stageIn} style={[styles.stage, styles.opaque]}>
            <LiveStage
              app={app}
              can={can}
              firstConnect={firstConnect ?? false}
              mcpUrl={mcpUrl}
              bottomInset={insets.bottom}
              onDone={() => leave("/")}
              onShowMe={() => leave("/link")}
            />
          </Animated.View>
        ) : null}

        {stage === "learn" && app ? (
          <Animated.View key="learn" entering={stageIn} style={[styles.stage, styles.opaque]}>
            <View style={styles.errorContent}>
              <AppGlyph app={app} size={64} />
              <Text variant="title" style={styles.center}>Capture ready</Text>
              <Text variant="body" color={colors.textSecondary} style={styles.center}>
                Your assistant can now inspect the captured requests and test tools for this app.
              </Text>
            </View>
            <View style={[styles.footer, { paddingBottom: insets.bottom + space.md }]}>
              <Button label="Continue in agent" onPress={() => leave("/agent")} disabled={checkingPlan} fullWidth />
            </View>
          </Animated.View>
        ) : null}

        {stage === "error" && app ? (
          <Animated.View key="error" entering={stageIn} style={[styles.stage, styles.opaque]}>
            <View style={styles.errorContent}>
              <AppGlyph app={app} size={64} />
              <Text variant="title" style={styles.center}>
                Couldn&apos;t connect {app.name}
              </Text>
              <Text variant="body" color={colors.error} style={styles.center}>
                {plainError(build?.error ?? conn?.error, "Something went wrong while setting it up.")}
              </Text>
            </View>
            <View style={[styles.footer, { paddingBottom: insets.bottom + space.md }]}>
              <Button label="Try again" onPress={retry} fullWidth />
            </View>
          </Animated.View>
        ) : null}

        {error && showWebView ? (
          <Animated.View entering={FadeInDown.duration(240)} style={[styles.toast, { bottom: insets.bottom + space.lg }]}>
            <Text variant="label">{error}</Text>
          </Animated.View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  center: { textAlign: "center" },
  header: { height: 52, flexDirection: "row", alignItems: "center", paddingHorizontal: space.gutter },
  side: { width: 92 },
  sideRight: { alignItems: "flex-end" },
  headCenter: { flex: 1, alignItems: "center", gap: 2 },
  domain: { flexDirection: "row", alignItems: "center", gap: 4 },
  counter: {
    flexDirection: "row",
    backgroundColor: colors.surface2,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: colors.border,
  },
  body: { flex: 1, marginTop: space.md },
  webWrap: { backgroundColor: "#FFFFFF" },
  stage: { ...StyleSheet.absoluteFill },
  opaque: { backgroundColor: colors.bg },
  codeStage: { backgroundColor: colors.bg, paddingTop: space.xxl, paddingHorizontal: space.gutter },
  centerFill: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg,
  },
  buildContent: { paddingHorizontal: space.xl, paddingTop: space.xxl, paddingBottom: space.xxl, gap: space.xl },
  hero: { alignItems: "center", gap: space.lg, marginBottom: space.sm },
  glyphWrap: { width: 64, height: 64, alignItems: "center", justifyContent: "center" },
  breath: {
    position: "absolute",
    width: 64,
    height: 64,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: colors.text,
  },
  tools: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
    gap: space.md,
  },
  toolsHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  toolRow: { flexDirection: "row", alignItems: "center", gap: space.md },
  tag: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  liveContent: { alignItems: "center", paddingHorizontal: space.xl, paddingTop: 72, gap: space.md },
  successCircle: {
    backgroundColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: space.md,
  },
  liveCan: { marginTop: space.lg, alignSelf: "stretch" },
  magicBar: { paddingHorizontal: space.gutter, paddingTop: space.md, alignItems: "flex-start" },
  magicPanel: { backgroundColor: colors.bg, padding: space.gutter, paddingTop: space.xl, gap: space.md },
  magicInput: {
    minHeight: 96,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    padding: space.md,
    color: colors.text,
    fontFamily: "Inter_400Regular",
    fontSize: 15,
    textAlignVertical: "top",
  },
  magicInputError: { borderColor: colors.error },
  summary: {
    marginTop: space.lg,
    alignSelf: "stretch",
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: space.lg,
    paddingVertical: 14,
  },
  footer: { paddingHorizontal: space.gutter, paddingTop: space.md, gap: space.sm },
  pasteRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.md,
  },
  textButton: { alignSelf: "center", paddingVertical: space.md, paddingHorizontal: space.xl },
  errorContent: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.md, paddingHorizontal: space.xl },
  toast: {
    position: "absolute",
    left: space.gutter,
    right: space.gutter,
    backgroundColor: colors.surface2,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.error,
    padding: space.md,
  },
});
