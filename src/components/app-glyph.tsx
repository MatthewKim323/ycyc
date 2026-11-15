import { Image, StyleSheet, View } from "react-native";

import type { CatalogApp } from "@/lib/contract";
import { colors } from "@/theme";

import { APP_COPY } from "./app-copy";
import { Icon, type IconName } from "./icon";

const BY_CATEGORY: Record<CatalogApp["category"], IconName> = {
  nutrition: "apple",
  training: "pushups",
  cycle: "lotus",
  other: "api",
};

export function appIcon(app: Pick<CatalogApp, "slug" | "category">): IconName {
  return BY_CATEGORY[app.category] ?? "api";
}

/** The app's real App Store icon when we have it, otherwise a monochrome Lordicon tile. */
export function AppGlyph({
  app,
  size = 44,
  playKey,
}: {
  app: Pick<CatalogApp, "slug" | "category">;
  size?: number;
  playKey?: number | string;
}) {
  const logo = APP_COPY[app.slug]?.logo;
  const r = Math.round(size * 0.27);
  if (logo) {
    return <Image source={logo} style={[styles.logo, { width: size, height: size, borderRadius: r }]} accessibilityIgnoresInvertColors />;
  }
  return (
    <View style={[styles.tile, { width: size, height: size, borderRadius: r }]}>
      <Icon name={appIcon(app)} size={Math.round(size * 0.6)} playKey={playKey} />
    </View>
  );
}

const styles = StyleSheet.create({
  logo: { backgroundColor: colors.surface2 },
  tile: {
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
});
