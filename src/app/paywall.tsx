import { useAction } from "convex/react";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/button";
import { Icon } from "@/components/icon";
import { BenefitRow } from "@/components/paywall/benefit-row";
import { PaywallSuccess } from "@/components/paywall/paywall-success";
import { usePlan } from "@/components/paywall/use-plan";
import { PressableScale } from "@/components/pressable-scale";
import { Text } from "@/components/text";
import { api } from "@/hooks/convex";
import { colors, enter, fonts, space, stageIn } from "@/theme";

type Stage = "idle" | "opening" | "waiting";

export default function Paywall() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { userId, isPro, loading } = usePlan();
  const createCheckout = useAction(api.whop.createCheckout);
  const [stage, setStage] = useState<Stage>("idle");
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (isPro && stage !== "idle") WebBrowser.dismissBrowser().catch(() => {});
  }, [isPro, stage]);

  const close = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/");
  };

  const goPro = async () => {
    if (!userId) return;
    setNote(null);
    setStage("opening");
    try {
      const { url } = await createCheckout({ userId });
      setStage("waiting");
      await WebBrowser.openBrowserAsync(url, {
        presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
        controlsColor: colors.text,
        toolbarColor: colors.bg,
      });
    } catch (e) {
      setStage("idle");
      setNote(e instanceof Error ? e.message : "Checkout did not open. Try again.");
    }
  };

  const restore = () => {
    setNote(isPro ? null : "No Pro plan on this device yet.");
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.topBar}>
        <PressableScale onPress={close} hitSlop={12} scaleTo={0.94} haptic="selection" accessibilityLabel="Close">
          <Text variant="bodyMedium" color={colors.textSecondary}>
            Close
          </Text>
        </PressableScale>
        {!isPro ? (
          <PressableScale onPress={restore} hitSlop={12} scaleTo={0.94} haptic="selection" accessibilityLabel="Restore">
            <Text variant="bodyMedium" color={colors.textSecondary}>
              Restore
            </Text>
          </PressableScale>
        ) : null}
      </View>

      {isPro ? (
        <View style={styles.body}>
          <PaywallSuccess onDone={close} />
        </View>
      ) : (
        <View style={styles.body}>
          <View style={styles.hero}>
            <Animated.View entering={enter(0)} style={styles.badge}>
              <Icon name="star" size={28} autoPlay />
            </Animated.View>
            <Animated.View entering={enter(1)} style={styles.titleBlock}>
              <Text style={styles.headline}>ycyc Pro</Text>
              <Text variant="body" color={colors.textSecondary}>
                $9.99 a month. Free includes 1 app.
              </Text>
            </Animated.View>
            <View style={styles.benefits}>
              <BenefitRow index={0} icon="library" title="Unlimited apps" body="Connect every app you use." />
              <BenefitRow index={1} icon="chat" title="iMessage agent" body="Text your apps from Messages." />
              <BenefitRow index={2} icon="clock" title="Cancel anytime" body="Billed monthly through Whop." />
            </View>
          </View>

          <View style={styles.footer}>
            {stage === "waiting" ? (
              <Animated.View entering={stageIn} style={styles.waiting}>
                <ActivityIndicator size="small" color={colors.textSecondary} />
                <Text variant="caption" color={colors.textSecondary}>
                  Waiting for payment
                </Text>
              </Animated.View>
            ) : null}
            {note ? (
              <Text variant="caption" color={colors.textSecondary} style={styles.centered}>
                {note}
              </Text>
            ) : null}
            <Button
              label={stage === "waiting" ? "Open checkout again" : "Go Pro"}
              onPress={goPro}
              loading={stage === "opening"}
              disabled={!userId || loading}
              haptic="medium"
              fullWidth
            />
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  topBar: {
    height: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space.gutter,
  },
  body: { flex: 1, paddingHorizontal: space.gutter },
  hero: { flex: 1, justifyContent: "center", gap: space.xxl },
  badge: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  titleBlock: { gap: space.sm },
  headline: { fontFamily: fonts.semibold, fontSize: 44, lineHeight: 50, letterSpacing: -1.2, color: colors.text },
  benefits: { gap: space.xl },
  footer: { gap: space.md, paddingBottom: space.lg },
  waiting: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.sm },
  centered: { textAlign: "center" },
});
