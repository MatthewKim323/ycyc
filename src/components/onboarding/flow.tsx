import { useQueries, useQuery } from "convex/react";
import { type Href, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BackHandler, StyleSheet, View } from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AiLoginSheet } from "@/components/ai-login";
import { BackButton } from "@/components/back-button";
import { useScrim } from "@/components/onboarding-chrome";
import { PressableScale } from "@/components/pressable-scale";
import { Text } from "@/components/text";
import { api } from "@/hooks/convex";
import { useOnboarding } from "@/hooks/onboarding";
import { useUser } from "@/hooks/user";
import { useAiPlans } from "@/lib/agent";
import { useInstalledApps } from "@/lib/installed-apps";
import { colors, space, stageIn, stageOut } from "@/theme";

import { ConnectStep } from "./connect-step";
import { ProgressDots } from "./progress-dots";
import { How, Pick, PickAI, Ready, Welcome } from "./steps";

type Step = "welcome" | "ai" | "how" | "pick" | "connect" | "ready";
type ConnectPhase = "intro" | "loading" | "signin" | "code" | "build" | "error";

const DOTS: Step[] = ["ai", "how", "pick", "connect", "ready"];
const BACK: Partial<Record<Step, Step>> = {
  ai: "welcome",
  how: "ai",
  pick: "how",
  connect: "pick",
};
// Light scrim only where text sits on the dots. Never black.
const SCRIM: Record<Step, number> = {
  welcome: 0,
  ai: 0.3,
  how: 0.3,
  pick: 0.3,
  connect: 0.32,
  ready: 0.15,
};

/**
 * The whole first run as one screen over one shader: steps crossfade in place, the dots
 * spring between them, and the first app is connected without leaving onboarding.
 */
export function OnboardingFlow() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { userId } = useUser();
  const { finish } = useOnboarding();
  const apps = useQuery(api.apps.list);
  const installed = useInstalledApps();
  const { token } = useAiPlans();
  // Memoized: a new object each render makes Convex resubscribe during render (infinite re-render crash).
  const queries = useMemo(
    () => (token ? { state: { query: api.aiOnboarding.state, args: { token } } } : ({} as Record<string, never>)),
    [token],
  );
  const result = useQueries(queries);
  const state = result.state instanceof Error ? undefined : result.state;
  const planReady = !!state?.provider && (state.step === "connect_apps" || state.step === "ready");

  const [requestedStep, setStep] = useState<Step>("welcome");
  const step = planReady || requestedStep === "welcome" ? requestedStep : "ai";
  const [slug, setSlug] = useState<string | null>(null);
  const [ready, setReady] = useState<{ slug: string; name: string } | null>(null);
  const [connectPhase, setConnectPhase] = useState<ConnectPhase>("intro");

  useScrim(SCRIM[step]);

  const advance = (next: Step) => setStep(planReady ? next : "ai");

  // Mid-build there is nothing to go back to; the connection keeps going either way.
  const canBack = !!BACK[step] && !(step === "connect" && (connectPhase === "build" || connectPhase === "loading"));
  const back = useCallback(() => {
    const to = BACK[step];
    if (to) setStep(to);
  }, [step]);

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!canBack) return step !== "welcome";
      back();
      return true;
    });
    return () => sub.remove();
  }, [canBack, back, step]);

  const leave = async (to: Href) => {
    if (!planReady) { setStep("ai"); return; }
    await finish();
    router.replace(to);
  };

  const onReady = useCallback((app: { slug: string; name: string }) => {
    setReady(app);
    setStep(planReady ? "ready" : "ai");
  }, [planReady]);

  const dotIndex = DOTS.indexOf(step);
  const bottom = insets.bottom;

  return (
    <View style={[styles.flex, { paddingTop: insets.top }]}>
      {/* The bar's height is always reserved so content never jumps when it fades in. */}
      <View style={styles.barSlot}>
        {step !== "welcome" ? (
          <Animated.View entering={FadeIn.duration(280)} exiting={FadeOut.duration(200)} style={styles.bar}>
            <View style={styles.side}>
              {canBack ? (
                <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(160)}>
                  <BackButton onPress={back} />
                </Animated.View>
              ) : null}
            </View>
            <ProgressDots count={DOTS.length} index={Math.max(0, dotIndex)} />
            <View style={[styles.side, styles.sideRight]}>
              {planReady && step !== "ai" ? (
                <PressableScale
                  onPress={() => leave("/")}
                  hitSlop={12}
                  scaleTo={0.94}
                  haptic="selection"
                  accessibilityLabel="Skip for now"
                >
                  <Text variant="bodyMedium" color={colors.textTertiary}>
                    Skip
                  </Text>
                </PressableScale>
              ) : null}
            </View>
          </Animated.View>
        ) : null}
      </View>

      <View style={styles.flex}>
        <Animated.View key={step} entering={stageIn} exiting={stageOut} style={StyleSheet.absoluteFill}>
          {step === "welcome" ? <Welcome bottomInset={bottom} onNext={() => setStep("ai")} /> : null}
          {step === "ai" ? (
            <PickAI bottomInset={bottom} onNext={() => advance("how")} />
          ) : null}
          {step === "how" ? <How bottomInset={bottom} onNext={() => advance("pick")} /> : null}
          {step === "pick" ? (
            <Pick
              apps={apps}
              installed={installed}
              userId={userId}
              bottomInset={bottom}
              onPick={(s) => {
                if (!planReady) { setStep("ai"); return; }
                setSlug(s);
                setConnectPhase("intro");
                setStep("connect");
              }}
            />
          ) : null}
          {step === "connect" && slug ? (
            <ConnectStep
              slug={slug}
              bottomInset={bottom}
              onPhase={setConnectPhase}
              onReady={onReady}
              onPickAnother={() => advance("pick")}
            />
          ) : null}
          {step === "ready" && ready ? (
            <Ready
              app={ready}
              bottomInset={bottom}
              planReady={planReady}
              onNext={() => leave("/agent")}
            />
          ) : null}
        </Animated.View>
      </View>
      <AiLoginSheet />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  barSlot: { height: 48 },
  bar: {
    ...StyleSheet.absoluteFill,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space.gutter + 4,
  },
  side: { width: 72 },
  sideRight: { alignItems: "flex-end" },
});
