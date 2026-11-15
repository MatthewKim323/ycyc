import { useRouter } from "expo-router";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/button";
import { useBackdropDim } from "@/components/onboarding-chrome";
import { Reveal } from "@/components/reveal";
import { Text } from "@/components/text";
import { colors, fonts, space } from "@/theme";

export default function Welcome() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  useBackdropDim(0);
  return (
    <View style={[styles.screen, { paddingTop: insets.top + space.xl, paddingBottom: insets.bottom + space.lg }]}>
      <Reveal delay={200} style={styles.top}>
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
          <Button label="Get started" onPress={() => router.push("/onboarding/how")} fullWidth />
        </Reveal>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: space.gutter, justifyContent: "space-between" },
  top: { alignItems: "center" },
  bottom: { gap: space.md },
  hero: { fontFamily: fonts.semibold, fontSize: 34, lineHeight: 40, letterSpacing: -0.8, color: colors.text },
  cta: { marginTop: space.lg },
});
