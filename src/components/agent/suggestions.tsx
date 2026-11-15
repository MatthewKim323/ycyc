import { StyleSheet, View } from "react-native";
import Animated from "react-native-reanimated";

import type { CatalogApp } from "@/lib/contract";
import { colors, enter, radius, space } from "@/theme";

import { AppGlyph } from "../app-glyph";
import { PressableScale } from "../pressable-scale";
import { Text } from "../text";

export type Suggestion = { prompt: string; app: Pick<CatalogApp, "slug" | "category" | "name"> };

/** Example asks from the person's live apps. Tapping one fills the composer. */
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
            <AppGlyph app={s.app} size={24} />
            <Text variant="body" numberOfLines={2} style={styles.prompt}>
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
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  prompt: { flex: 1, color: colors.text },
});
