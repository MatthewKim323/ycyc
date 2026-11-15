import { StyleSheet, View } from "react-native";

import type { CatalogApp } from "@/lib/contract";
import { colors } from "@/theme";

import { Icon, type IconName } from "./icon";

const BY_SLUG: Record<string, IconName> = {
  myfitnesspal: "apple",
  strong: "pushups",
  flo: "lotus",
};

const BY_CATEGORY: Record<CatalogApp["category"], IconName> = {
  nutrition: "apple",
  training: "pushups",
  cycle: "lotus",
  other: "api",
};

export function appIcon(app: Pick<CatalogApp, "slug" | "category">): IconName {
  return BY_SLUG[app.slug] ?? BY_CATEGORY[app.category] ?? "api";
}

export function AppGlyph({
  app,
  size = 44,
  playKey,
}: {
  app: Pick<CatalogApp, "slug" | "category">;
  size?: number;
  playKey?: number | string;
}) {
  return (
    <View style={[styles.tile, { width: size, height: size, borderRadius: Math.round(size * 0.28) }]}>
      <Icon name={appIcon(app)} size={Math.round(size * 0.66)} playKey={playKey} />
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
});
