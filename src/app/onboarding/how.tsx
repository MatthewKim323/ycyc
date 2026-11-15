import { useRouter } from "expo-router";
import { StyleSheet, View } from "react-native";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/button";
import { useBackdropDim } from "@/components/onboarding-chrome";
import { Reveal } from "@/components/reveal";
import { Text } from "@/components/text";
import { colors, motion, space, springs } from "@/theme";

const ROWS = [
  { title: "Sign in to an app", body: "Right inside yuzu, on its own login page." },
  { title: "We set it up for you", body: "You watch it happen, step by step." },
  { title: "Paste one link into your assistants", body: "Then ask: log my lunch, what did I bench last week." },
];

export default function HowItWorks() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  useBackdropDim(0.55);
  return (
    <View style={[styles.screen, { paddingTop: insets.top + space.xxl, paddingBottom: insets.bottom + space.lg }]}>
      <View style={styles.top}>
        <Reveal delay={0}>
          <Text variant="title">Set it up once.</Text>
        </Reveal>
        <View style={styles.rows}>
          {ROWS.map((r, i) => (
            <Animated.View
              key={r.title}
              entering={FadeInDown.springify()
                .damping(springs.enter.damping)
                .stiffness(springs.enter.stiffness)
                .delay(120 + i * motion.stagger)}
              style={styles.row}
            >
              <View style={styles.num}>
                <Text variant="label">{i + 1}</Text>
              </View>
              <View style={styles.rowText}>
                <Text variant="rowTitle">{r.title}</Text>
                <Text variant="caption" color={colors.textSecondary}>
                  {r.body}
                </Text>
              </View>
            </Animated.View>
          ))}
        </View>
      </View>
      <Reveal delay={320}>
        <Button label="Pick your first app" onPress={() => router.push("/onboarding/apps")} fullWidth />
      </Reveal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: space.gutter, justifyContent: "space-between" },
  top: { gap: space.xxl },
  rows: { gap: space.xl },
  row: { flexDirection: "row", gap: space.md, alignItems: "flex-start" },
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
  rowText: { flex: 1, gap: 2 },
});
