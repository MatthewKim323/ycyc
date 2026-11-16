import { StyleSheet, View } from "react-native";
import Animated from "react-native-reanimated";

import type { CatalogApp } from "@/lib/contract";
import { colors, enter, radius, space } from "@/theme";

import { PressableScale } from "../pressable-scale";
import { Text } from "../text";

export type Suggestion = { prompt: string; app: Pick<CatalogApp, "slug" | "category" | "name"> };

/** Example asks from the person's live apps, quiet grey text. Tapping one fills the composer. */
export function Suggestions({ items, onPick }: { items: Suggestion[]; onPick: (s: Suggestion) => void }) {
  return (
    <View style={styles.list}>
      {items.map((s, i) => (
        <Animated.View key={`${s.app.slug}-${s.prompt}`} entering={enter(i + 2)}>
          <PressableScale
            onPress={() => onPick(s)}
            haptic="selection"
            scaleTo={0.98}
            accessibilityLabel={`${s.prompt}, ${s.app.name}`}
            style={styles.chip}
          >
            <Text variant="body" color={colors.textSecondary} numberOfLines={2} style={styles.prompt}>
              {capitalize(s.prompt)}
            </Text>
          </PressableScale>
        </Animated.View>
      ))}
    </View>
  );
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const styles = StyleSheet.create({
  list: { gap: space.sm },
  chip: {
    paddingVertical: 14,
    paddingHorizontal: space.lg,
    borderRadius: radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  prompt: { flex: 1 },
});
