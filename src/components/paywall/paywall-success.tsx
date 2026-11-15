import { StyleSheet, View } from "react-native";
import Animated from "react-native-reanimated";

import { Button } from "@/components/button";
import { SuccessMark } from "@/components/success-mark";
import { Text } from "@/components/text";
import { colors, enter, fonts, space, stageIn } from "@/theme";

export function PaywallSuccess({ onDone }: { onDone: () => void }) {
  return (
    <Animated.View entering={stageIn} style={styles.wrap}>
      <View style={styles.center}>
        <SuccessMark size={88} />
        <Animated.View entering={enter(1)} style={styles.copy}>
          <Text style={styles.headline}>You are on Pro</Text>
          <Text variant="body" color={colors.textSecondary} style={styles.centered}>
            Connect every app you use and text your agent from iMessage.
          </Text>
        </Animated.View>
      </View>
      <Button label="Done" onPress={onDone} fullWidth />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, justifyContent: "space-between", paddingBottom: space.lg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.sm },
  copy: { alignItems: "center", gap: space.sm, paddingHorizontal: space.xl },
  headline: { fontFamily: fonts.semibold, fontSize: 34, lineHeight: 40, letterSpacing: -0.8, color: colors.text },
  centered: { textAlign: "center" },
});
