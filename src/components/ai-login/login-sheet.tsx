import { useAction, useMutation } from "convex/react";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, TextInput, View } from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  SlideInDown,
  SlideOutDown,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/button";
import { PressableScale } from "@/components/pressable-scale";
import { SuccessMark } from "@/components/success-mark";
import { Text } from "@/components/text";
import { api } from "@/hooks/convex";
import { closeLogin, PLAN_NAME, PLAN_PROVIDER_ID, rememberPick, selectPlan, useAiPlans, useLoginRequest, type PlanId } from "@/lib/agent";
import { colors, fonts, layout, radius, space, springs } from "@/theme";

// Only the most recently mounted sheet renders, so onboarding and the Agent tab can both mount one.
const hosts: string[] = [];
const hostListeners = new Set<() => void>();
const topHost = () => hosts[hosts.length - 1] ?? null;
function useIsTopHost(id: string) {
  useEffect(() => {
    hosts.push(id);
    hostListeners.forEach((l) => l());
    return () => {
      const i = hosts.lastIndexOf(id);
      if (i >= 0) hosts.splice(i, 1);
      hostListeners.forEach((l) => l());
    };
  }, [id]);
  const top = useSyncExternalStore(
    (l) => {
      hostListeners.add(l);
      return () => hostListeners.delete(l);
    },
    topHost,
    topHost,
  );
  return top === id;
}

const sheetIn = SlideInDown.springify().damping(springs.sheet.damping).stiffness(springs.sheet.stiffness);

/** Bottom sheet that signs a Claude or ChatGPT plan in. Opened by openLogin(plan). */
export function AiLoginSheet() {
  const id = useId();
  const top = useIsTopHost(id);
  const req = useLoginRequest();
  const visible = top && !!req;
  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={() => closeLogin(false)}>
      {visible && req ? <Sheet key={req.plan} plan={req.plan} /> : null}
    </Modal>
  );
}

type LocalError = { message: string } | null;

function Sheet({ plan }: { plan: PlanId }) {
  const insets = useSafeAreaInsets();
  const { token, status, failed } = useAiPlans();
  const startLogin = useMutation(api.aiProviders.startLogin);
  const submitCode = useAction(api.providerActions.submitCode);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [localError, setLocalError] = useState<LocalError>(null);
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [opened, setOpened] = useState(false);
  const started = useRef(false);
  const name = PLAN_NAME[plan];

  const row = status?.find((s) => s.provider === plan);
  const fresh = !!row && (row.status === "connected" || (!!attemptId && row.attemptId === attemptId));

  const start = async () => {
    if (!token) return;
    setLocalError(null);
    setSubmitted(false);
    setCode("");
    setOpened(false);
    try {
      const r = await startLogin({ token, provider: plan });
      setAttemptId(r.attemptId);
    } catch (e) {
      const msg = e instanceof Error ? e.message.replace(/^.*Uncaught Error: /, "").split("\n")[0] : "";
      setLocalError({ message: /wait a few seconds/i.test(msg) ? "Give it a few seconds, then try again." : `Couldn't start ${name} sign-in. Try again.` });
    }
  };

  useEffect(() => {
    if (started.current || !token) return;
    started.current = true;
    void start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Connected: pick it for chat, show the check, then close.
  const connected = row?.status === "connected";
  useEffect(() => {
    if (!connected) return;
    selectPlan(plan);
    rememberPick(PLAN_PROVIDER_ID[plan]);
    const t = setTimeout(() => closeLogin(true), 1500);
    return () => clearTimeout(t);
  }, [connected, plan]);

  let view: "starting" | "authorizing" | "connected" | "error" = "starting";
  let errorText = "";
  if (localError) {
    view = "error";
    errorText = localError.message;
  } else if (failed || !token) {
    view = failed ? "error" : "starting";
    errorText = "Couldn't reach yuzu. Try again.";
  } else if (connected) view = "connected";
  else if (fresh && row?.status === "authorizing") view = "authorizing";
  else if (fresh && row?.status === "error") {
    view = "error";
    errorText = row.error ?? `${name} sign-in didn't finish. Try again.`;
  }

  const openPage = async () => {
    if (!row?.loginUrl) return;
    if (plan === "codex" && row.userCode) await Clipboard.setStringAsync(row.userCode).catch(() => {});
    setOpened(true);
    WebBrowser.openBrowserAsync(row.loginUrl, {
      presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
      controlsColor: colors.text,
    }).catch(() => {});
  };

  const sendCode = async () => {
    const trimmed = code.trim();
    if (!token || !attemptId || !trimmed || submitting || submitted) return;
    setSubmitting(true);
    try {
      const result = await submitCode({ token, provider: "claude", attemptId, code: trimmed });
      if (!result.ok) throw new Error("code_rejected");
      setSubmitted(true);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    } catch {
      setLocalError({ message: "That code didn't go through. Start again to get a new one." });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.root}>
      <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(200)} style={[StyleSheet.absoluteFill, styles.scrim]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => closeLogin(false)} accessibilityLabel="Close" />
      </Animated.View>
      <Animated.View
        entering={sheetIn}
        exiting={SlideOutDown.duration(200)}
        layout={layout}
        style={[styles.sheet, { paddingBottom: insets.bottom + space.lg }]}
      >
        <View style={styles.grabber} />
        <View style={styles.head}>
          <Text variant="heading">{view === "connected" ? `${name} is connected` : `Connect your ${name} plan`}</Text>
          {row?.loginExpiresAt && (view === "authorizing" || view === "starting") ? <Countdown until={row.loginExpiresAt} /> : null}
        </View>

        <Animated.View key={view} entering={FadeIn.duration(220)} exiting={FadeOut.duration(120)} style={styles.body}>
          {view === "starting" ? <Starting name={name} /> : null}

          {view === "authorizing" && plan === "codex" ? (
            <>
              <Text variant="body" color={colors.textSecondary}>
                Enter this code on the page that opens.
              </Text>
              <View style={styles.codeBox}>
                <Text style={styles.code} selectable accessibilityLabel={`Code ${row?.userCode ?? ""}`}>
                  {row?.userCode ?? ""}
                </Text>
              </View>
              <View style={styles.actions}>
                <Button label={opened ? "Open the page again" : "Copy code and open"} onPress={openPage} fullWidth disabled={!row?.loginUrl} />
                <CopyText value={row?.userCode ?? null} />
              </View>
            </>
          ) : null}

          {view === "authorizing" && plan === "claude" ? (
            <>
              <Text variant="body" color={colors.textSecondary}>
                {opened ? "Paste the code from the page." : "Sign in on Claude, then paste the code it gives you."}
              </Text>
              {opened ? (
                <Animated.View entering={FadeIn.duration(220)} style={styles.actions}>
                  <TextInput
                    value={code}
                    onChangeText={setCode}
                    placeholder="Paste code"
                    placeholderTextColor={colors.textTertiary}
                    selectionColor={colors.text}
                    keyboardAppearance="dark"
                    autoCapitalize="none"
                    autoCorrect={false}
                    editable={!submitted}
                    style={styles.input}
                    accessibilityLabel="Code from Claude"
                    onSubmitEditing={sendCode}
                  />
                  <Button
                    label={submitted ? "Checking" : "Continue"}
                    onPress={sendCode}
                    loading={submitting || submitted}
                    disabled={!code.trim()}
                    fullWidth
                  />
                  {!submitted ? (
                    <PressableScale onPress={openPage} haptic="selection" style={styles.textButton} accessibilityLabel="Open Claude again">
                      <Text variant="bodyMedium" color={colors.textSecondary}>
                        Open Claude again
                      </Text>
                    </PressableScale>
                  ) : null}
                </Animated.View>
              ) : (
                <Button label="Open Claude" onPress={openPage} fullWidth disabled={!row?.loginUrl} />
              )}
            </>
          ) : null}

          {view === "connected" ? (
            <View style={styles.success}>
              <SuccessMark size={64} />
              <Text variant="body" color={colors.textSecondary}>
                Ask your apps anything with {name}.
              </Text>
            </View>
          ) : null}

          {view === "error" ? (
            <>
              <Text variant="body" color={colors.textSecondary}>
                {errorText}
              </Text>
              <Button label="Try again" onPress={start} fullWidth />
            </>
          ) : null}
        </Animated.View>

        {view !== "connected" ? (
          <PressableScale onPress={() => closeLogin(false)} haptic="selection" style={styles.textButton} accessibilityLabel="Not now">
            <Text variant="bodyMedium" color={colors.textTertiary}>
              Not now
            </Text>
          </PressableScale>
        ) : null}
      </Animated.View>
    </KeyboardAvoidingView>
  );
}

/** Calm progress while the backend starts the sign-in. Slow is normal, never an error. */
function Starting({ name }: { name: string }) {
  const reduced = useReducedMotion();
  const x = useSharedValue(0);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!reduced) x.set(withRepeat(withTiming(1, { duration: 1400 }), -1, false));
    const t = setTimeout(() => setSlow(true), 8000);
    return () => clearTimeout(t);
  }, [reduced, x]);
  const bar = useAnimatedStyle(() => ({ transform: [{ translateX: -120 + x.get() * 360 }] }));
  return (
    <View style={styles.starting}>
      <View style={styles.track}>
        {reduced ? <View style={[styles.bar, styles.barStatic]} /> : <Animated.View style={[styles.bar, bar]} />}
      </View>
      <Text variant="body" color={colors.textSecondary}>
        {slow ? `Still starting ${name}. The first time takes up to a minute.` : `Starting ${name} sign-in`}
      </Text>
    </View>
  );
}

function Countdown({ until }: { until: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, Math.round((until - now) / 1000));
  const label = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
  return (
    <Text variant="caption" color={colors.textTertiary} style={styles.tabular} accessibilityLabel={`${label} left`}>
      {label}
    </Text>
  );
}

function CopyText({ value }: { value: string | null }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(t);
  }, [copied]);
  return (
    <PressableScale
      onPress={async () => {
        if (!value) return;
        await Clipboard.setStringAsync(value).catch(() => {});
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
        setCopied(true);
      }}
      disabled={!value}
      haptic="none"
      style={styles.textButton}
      accessibilityLabel="Copy code"
    >
      <Text variant="bodyMedium" color={colors.textSecondary}>
        {copied ? "Copied" : "Copy code"}
      </Text>
    </PressableScale>
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
  head: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: space.md },
  body: { gap: space.lg },
  actions: { gap: space.sm },
  codeBox: {
    paddingVertical: space.xl,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    alignItems: "center",
  },
  code: { fontFamily: fonts.semibold, fontSize: 34, lineHeight: 40, letterSpacing: 4, color: colors.text, fontVariant: ["tabular-nums"] },
  input: {
    height: 52,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.bg,
    paddingHorizontal: space.lg,
    fontFamily: fonts.regular,
    fontSize: 16,
    color: colors.text,
  },
  success: { alignItems: "center", gap: space.md, paddingVertical: space.md },
  starting: { gap: space.md },
  track: { height: 3, borderRadius: 2, backgroundColor: colors.surface2, overflow: "hidden" },
  bar: { width: 120, height: 3, borderRadius: 2, backgroundColor: colors.text },
  barStatic: { width: "40%", opacity: 0.6 },
  textButton: { alignSelf: "center", paddingVertical: space.sm, paddingHorizontal: space.xl },
  tabular: { fontVariant: ["tabular-nums"] },
});

