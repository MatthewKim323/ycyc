import { useMutation, useQuery } from "convex/react";
import { makeFunctionReference } from "convex/server";
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, TextInput, View } from "react-native";
import Animated, {
  Easing,
  FadeIn,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { copyFor, plainError, type Capability } from "@/components/app-copy";
import { mergeSteps, StepList, useDwell, type DisplayStep } from "@/components/build-steps";
import { Button } from "@/components/button";
import { CaptureWebView } from "@/components/capture-webview";
import { CodeEntry } from "@/components/code-entry";
import { CredentialsForm } from "@/components/credentials-form";
import { Icon } from "@/components/icon";
import { Glass } from "@/components/onboarding-chrome";
import { PressableScale } from "@/components/pressable-scale";
import { Reveal } from "@/components/reveal";
import { Text } from "@/components/text";
import { api, type Id } from "@/hooks/convex";
import { useUser } from "@/hooks/user";
import { captureConfigFor, hostOf, magicLinkFor } from "@/lib/capture/apps";
import type { CaptureEntry, CatalogApp, SessionBundle } from "@/lib/contract";
import { colors, enter, fonts, layout, radius, space, stageIn, stageOut } from "@/theme";

import { AppIcon } from "./app-search";

const submitCodeRef = makeFunctionReference<"mutation", { connectionId: Id<"connections">; code: string }, unknown>(
  "connections:submitCode",
);

type Phase = "intro" | "loading" | "signin" | "code" | "build" | "error";
type IconApp = Pick<CatalogApp, "slug" | "category"> & {
  name: string;
  iconUrl?: string;
};

/** Two reads and the first write, or three reads when the app has no writes. */
function highlights(slug: string): Capability[] {
  const can = copyFor(slug)?.can ?? [];
  const reads = can.filter((c) => !c.asks);
  const write = can.find((c) => c.asks);
  return write ? [...reads.slice(0, 2), write] : reads.slice(0, 3);
}

function BreathingIcon({ app }: { app: IconApp }) {
  const reduced = useReducedMotion();
  const t = useSharedValue(0);
  useEffect(() => {
    if (!reduced) t.set(withRepeat(withTiming(1, { duration: 1800, easing: Easing.out(Easing.quad) }), -1));
  }, [t, reduced]);
  const ring = useAnimatedStyle(() => ({
    opacity: 0.35 * (1 - t.get()),
    transform: [{ scale: 1 + 0.35 * t.get() }],
  }));
  return (
    <View style={styles.glyphWrap}>
      {reduced ? null : <Animated.View pointerEvents="none" style={[styles.breath, ring]} />}
      <AppIcon app={app} size={64} />
    </View>
  );
}

function Build({ app, steps, onSettled }: { app: IconApp; steps: DisplayStep[]; onSettled: () => void }) {
  const shown = useDwell(steps, onSettled);
  const done = shown.filter((s) => s.status === "done").length;
  const can = copyFor(app.slug)?.can ?? [];
  return (
    <ScrollView contentContainerStyle={styles.buildContent} showsVerticalScrollIndicator={false}>
      <View style={styles.hero}>
        <BreathingIcon app={app} />
        <Animated.View entering={enter(0)}>
          <Text variant="heading" style={styles.center}>
            Setting up {app.name}
          </Text>
        </Animated.View>
      </View>
      <Animated.View entering={enter(1)}>
        <Glass style={styles.cardPad}>
          <StepList steps={shown} />
        </Glass>
      </Animated.View>
      {done >= 2 && can.length > 0 ? (
        <Animated.View entering={enter(0)} layout={layout}>
          <Glass style={[styles.cardPad, styles.canCard]}>
            <Text variant="label" color={colors.textSecondary}>
              Your assistant can
            </Text>
            {can.map((c, i) => (
              <Animated.View key={c.verb} entering={enter(i)} style={styles.canRow}>
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
          </Glass>
        </Animated.View>
      ) : null}
    </ScrollView>
  );
}

/**
 * The first connection, inside onboarding: what connecting means, sign in, watch it build.
 * Same backend calls as the connect modal, drawn over the shader instead of a black modal.
 */
export function ConnectStep({
  slug,
  bottomInset,
  onPhase,
  onReady,
  onPickAnother,
}: {
  slug: string;
  bottomInset: number;
  onPhase?: (phase: Phase) => void;
  onReady: (app: { slug: string; name: string }) => void;
  onPickAnother: () => void;
}) {
  const { userId } = useUser();
  const app = useQuery(api.apps.get, { slug });
  const start = useMutation(api.connections.start);
  const submitLogin = useMutation(api.connections.submitLogin);
  const submitCode = useMutation(submitCodeRef);
  const [connectionId, setConnectionId] = useState<Id<"connections"> | null>(null);
  const conns = useQuery(api.connections.mine, userId && connectionId ? { userId } : "skip");
  const build = useQuery(api.builds.forConnection, connectionId ? { connectionId } : "skip");
  const conn = conns?.find((c) => c._id === connectionId);

  const [web, setWeb] = useState({
    phase: "login" as "login" | "capturing",
    requests: 0,
    loggedIn: false,
  });
  const [starting, setStarting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settled, setSettled] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [startUrl, setStartUrl] = useState<string | undefined>(undefined);
  const [magicOpen, setMagicOpen] = useState(false);
  const [magicText, setMagicText] = useState("");
  const [magicError, setMagicError] = useState<string | null>(null);

  const status = conn?.status as string | undefined;
  const isWeb = app?.route === "web";
  const preSubmit = status === "needs_login" || status === "capturing";

  let phase: Phase;
  if (!connectionId) phase = "intro";
  else if (!conn || !app) phase = "loading";
  else if (status === "needs_code") phase = "code";
  else if (preSubmit) phase = isWeb && web.loggedIn ? "build" : "signin";
  else if (status === "building" || status === "live") phase = "build";
  else phase = "error";

  useEffect(() => onPhase?.(phase), [phase, onPhase]);
  useEffect(() => {
    if (web.loggedIn) Haptics.selectionAsync().catch(() => {});
  }, [web.loggedIn]);

  const onSettled = useCallback(() => setSettled(true), []);
  useEffect(() => {
    if (settled && status === "live" && app) onReady({ slug: app.slug, name: app.name });
  }, [settled, status, app, onReady]);

  const steps: DisplayStep[] =
    preSubmit && isWeb && web.loggedIn
      ? [
          { key: "signin", label: "Signing in", status: "done" },
          { key: "read", label: "Learning the app", status: "running" },
          { key: "test", label: "Checking it works", status: "pending" },
          { key: "ready", label: "Ready", status: "pending" },
        ]
      : mergeSteps(build?.steps);

  const begin = async () => {
    if (!userId || !app) return;
    setError(null);
    setStarting(true);
    try {
      setConnectionId(await start({ userId, appSlug: app.slug }));
    } catch {
      setError("Couldn't start. Try again.");
    } finally {
      setStarting(false);
    }
  };

  const submit = async (session: SessionBundle, capture: CaptureEntry[]) => {
    if (!connectionId) return;
    setSubmitting(true);
    setError(null);
    try {
      await submitLogin({ connectionId, session, capture });
    } catch (e) {
      setError(
        e instanceof Error
          ? plainError(e.message, "Couldn't save your sign-in. Try again.")
          : "Couldn't save your sign-in. Try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const retry = async () => {
    if (!userId || !app) return;
    setError(null);
    setSettled(false);
    setWeb({ phase: "login", requests: 0, loggedIn: false });
    setStartUrl(undefined);
    setAttempt((n) => n + 1);
    setConnectionId(await start({ userId, appSlug: app.slug }));
  };

  const magic = app ? captureConfigFor(app.slug, app.loginUrl, app.webOrigin).magicLink : undefined;
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

  if (app === undefined) {
    return (
      <View style={styles.centerFill}>
        <ActivityIndicator color={colors.textTertiary} />
      </View>
    );
  }
  if (app === null) {
    return (
      <View style={[styles.centerFill, styles.gap]}>
        <Text variant="body" color={colors.textSecondary}>
          This app isn&apos;t available yet.
        </Text>
        <Button label="Pick another app" kind="secondary" onPress={onPickAnother} />
      </View>
    );
  }

  const iconApp: IconApp = app as IconApp;
  const caps = highlights(app.slug);
  const domain = hostOf(app.webOrigin ?? app.loginUrl ?? "");
  const codePrompt = build?.steps.find((s) => s.key === "signin")?.detail ?? `Enter the code ${app.name} emailed you.`;

  return (
    <View style={styles.flex}>
      {phase === "intro" ? (
        <Animated.View
          key="intro"
          entering={stageIn}
          exiting={stageOut}
          style={[styles.stage, { paddingBottom: bottomInset + space.lg }]}
        >
          <ScrollView contentContainerStyle={styles.introContent} showsVerticalScrollIndicator={false}>
            <Reveal delay={0} style={styles.introHead}>
              <AppIcon app={iconApp} size={72} />
              <Text style={[styles.title, styles.center]}>Connect {app.name}</Text>
            </Reveal>
            {caps.length ? (
              <Animated.View entering={enter(2)} style={styles.section}>
                <Text variant="label" color={colors.textSecondary} style={styles.sectionLabel}>
                  Your assistants can
                </Text>
                <Glass>
                  {caps.map((c, i) => (
                    <View key={c.verb} style={[styles.capRow, i > 0 && styles.divider]}>
                      <Text variant="body" numberOfLines={1} style={styles.capVerb}>
                        {c.verb}
                      </Text>
                      {c.asks ? (
                        <Text variant="caption" color={colors.textSecondary}>
                          Asks you first
                        </Text>
                      ) : null}
                    </View>
                  ))}
                </Glass>
              </Animated.View>
            ) : null}
            <Animated.View entering={enter(3)} style={styles.notes}>
              {magic ? (
                <Text variant="caption" color={colors.textSecondary} style={styles.center}>
                  {app.name} sends you a sign-in link by email or text.
                </Text>
              ) : null}
              <Text variant="caption" color={colors.textSecondary} style={styles.center}>
                yuzu never stores your password.
              </Text>
            </Animated.View>
          </ScrollView>
          {error ? (
            <Text variant="caption" color={colors.error} style={[styles.center, styles.errorLine]}>
              {error}
            </Text>
          ) : null}
          <Animated.View entering={enter(4)}>
            <Button label="Continue" onPress={begin} loading={starting} disabled={!userId} fullWidth />
          </Animated.View>
        </Animated.View>
      ) : null}

      {phase === "loading" ? (
        <Animated.View key="loading" entering={stageIn} exiting={stageOut} style={styles.centerFill}>
          <ActivityIndicator color={colors.textTertiary} />
        </Animated.View>
      ) : null}

      {phase === "signin" && isWeb ? (
        <Animated.View
          key={`web-${attempt}`}
          entering={stageIn}
          exiting={stageOut}
          style={[styles.stage, { paddingBottom: bottomInset + space.sm }]}
        >
          <View style={styles.signinHead}>
            <Text variant="heading" numberOfLines={1}>
              Sign in to {app.name}
            </Text>
            <View style={styles.domain}>
              <Icon name="fingerprint" size={12} opacity={0.6} />
              <Text variant="micro" color={colors.textSecondary} numberOfLines={1}>
                {domain}
              </Text>
            </View>
            {magic ? (
              <Button
                label={magic.label}
                kind="secondary"
                size="small"
                onPress={() => setMagicOpen(true)}
                style={styles.magicBtn}
              />
            ) : null}
          </View>
          <Glass style={styles.webCard}>
            <CaptureWebView
              app={app}
              startUrl={startUrl}
              onProgress={setWeb}
              onDone={({ session, capture }) => submit(session, capture)}
            />
            {magic && magicOpen ? (
              <Animated.View entering={stageIn} exiting={stageOut} style={styles.magicPanel}>
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
                <PressableScale
                  onPress={() => setMagicOpen(false)}
                  haptic="selection"
                  style={styles.textButton}
                  accessibilityLabel="Cancel"
                >
                  <Text variant="bodyMedium" color={colors.textSecondary}>
                    Cancel
                  </Text>
                </PressableScale>
              </Animated.View>
            ) : null}
          </Glass>
          {error ? (
            <Animated.View entering={FadeIn.duration(240)} style={styles.toast}>
              <Text variant="label">{error}</Text>
            </Animated.View>
          ) : null}
        </Animated.View>
      ) : null}

      {phase === "signin" && !isWeb ? (
        <Animated.View
          key="form"
          entering={stageIn}
          exiting={stageOut}
          style={[styles.stage, { paddingBottom: bottomInset + space.sm }]}
        >
          <Glass style={styles.formCard}>
            <CredentialsForm
              appName={app.name}
              bottomInset={space.lg}
              submitting={submitting}
              error={error}
              onSubmit={(username, password) =>
                submit(
                  {
                    credentials: { username, password },
                    capturedAt: Date.now(),
                  },
                  [],
                )
              }
            />
          </Glass>
        </Animated.View>
      ) : null}

      {phase === "code" && connectionId ? (
        <Animated.View key="code" entering={stageIn} exiting={stageOut} style={styles.stage}>
          <Glass style={styles.codeCard}>
            <CodeEntry
              title="Check your email"
              prompt={codePrompt}
              onSubmit={async (code) => {
                await submitCode({ connectionId, code });
              }}
            />
          </Glass>
        </Animated.View>
      ) : null}

      {phase === "build" ? (
        <Animated.View key={`build-${attempt}`} entering={stageIn} exiting={stageOut} style={styles.stage}>
          <Build app={iconApp} steps={steps} onSettled={onSettled} />
        </Animated.View>
      ) : null}

      {phase === "error" ? (
        <Animated.View
          key="error"
          entering={stageIn}
          exiting={stageOut}
          style={[styles.stage, { paddingBottom: bottomInset + space.lg }]}
        >
          <View style={styles.errorContent}>
            <AppIcon app={iconApp} size={64} />
            <Text style={[styles.title, styles.center]}>Couldn&apos;t connect {app.name}</Text>
            <Text variant="body" color={colors.textSecondary} style={styles.center}>
              {plainError(build?.error ?? conn?.error, "Something went wrong while setting it up.")}
            </Text>
          </View>
          <View style={styles.errorActions}>
            <Button label="Try again" onPress={retry} fullWidth />
            <Button label="Pick another app" kind="secondary" onPress={onPickAnother} fullWidth />
          </View>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { textAlign: "center" },
  gap: { gap: space.lg },
  stage: { ...StyleSheet.absoluteFill, paddingHorizontal: space.gutter },
  centerFill: {
    ...StyleSheet.absoluteFill,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontFamily: fonts.semibold,
    fontSize: 28,
    lineHeight: 34,
    letterSpacing: -0.5,
    color: colors.text,
  },
  introContent: {
    paddingTop: space.xxl,
    gap: space.xl,
    paddingBottom: space.lg,
  },
  introHead: { alignItems: "center", gap: space.lg },
  section: { gap: space.sm },
  sectionLabel: { paddingHorizontal: space.xs },
  capRow: {
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  capVerb: { flex: 1, fontSize: 16, lineHeight: 22 },
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.1)",
  },
  notes: { gap: space.xs },
  errorLine: { marginBottom: space.sm },
  signinHead: {
    paddingTop: space.lg,
    paddingBottom: space.md,
    gap: 4,
    alignItems: "center",
  },
  domain: { flexDirection: "row", alignItems: "center", gap: 4 },
  magicBtn: { marginTop: space.sm },
  webCard: { flex: 1, backgroundColor: "#FFFFFF", borderRadius: 20 },
  magicPanel: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.surface,
    padding: space.gutter,
    paddingTop: space.xl,
    gap: space.md,
  },
  magicInput: {
    minHeight: 96,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.bg,
    padding: space.md,
    color: colors.text,
    fontFamily: fonts.regular,
    fontSize: 15,
    textAlignVertical: "top",
  },
  magicInputError: { borderColor: colors.error },
  textButton: {
    alignSelf: "center",
    paddingVertical: space.md,
    paddingHorizontal: space.xl,
  },
  toast: {
    position: "absolute",
    left: space.gutter * 2,
    right: space.gutter * 2,
    bottom: space.xxl,
    backgroundColor: colors.surface2,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.error,
    padding: space.md,
  },
  formCard: { flex: 1, marginTop: space.lg },
  codeCard: { marginTop: space.xxl, padding: space.xl },
  buildContent: {
    paddingTop: space.xxl,
    paddingBottom: space.xxl,
    gap: space.xl,
  },
  hero: { alignItems: "center", gap: space.lg, marginBottom: space.sm },
  glyphWrap: {
    width: 64,
    height: 64,
    alignItems: "center",
    justifyContent: "center",
  },
  breath: {
    position: "absolute",
    width: 64,
    height: 64,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: colors.text,
  },
  cardPad: { padding: space.xl },
  canCard: { gap: space.md },
  canRow: { flexDirection: "row", alignItems: "center", gap: space.md },
  errorContent: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: space.md,
  },
  errorActions: { gap: space.sm },
});
