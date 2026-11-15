import { StyleSheet, View } from "react-native";
import Animated from "react-native-reanimated";

import { Icon, type IconName } from "@/components/icon";
import { Text } from "@/components/text";
import { colors, enter, radius, space } from "@/theme";

export function BenefitRow({ icon, title, body, index }: { icon: IconName; title: string; body: string; index: number }) {
  return (
    <Animated.View entering={enter(index + 2)} style={styles.row}>
      <View style={styles.icon}>
        <Icon name={icon} size={22} autoPlay />
      </View>
      <View style={styles.text}>
        <Text variant="rowTitle">{title}</Text>
        <Text variant="caption" color={colors.textSecondary}>
          {body}
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: space.lg },
  icon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  text: { flex: 1, gap: 2 },
});
