import { Image } from "expo-image";
import { StyleSheet, View } from "react-native";

import { Icon } from "@/components/icon";
import { Text } from "@/components/text";
import { colors, fonts } from "@/theme";

/** Up to two initials from a name, else the first letter of an email. */
export function initials(name?: string | null, email?: string | null): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  if (parts.length === 1) return parts[0][0].toUpperCase();
  const e = (email ?? "").trim();
  return e ? e[0].toUpperCase() : "";
}

/** Google photo when there is one, else a monochrome monogram, else the identity glyph. */
export function Avatar({
  size,
  imageUrl,
  name,
  email,
}: {
  size: number;
  imageUrl?: string | null;
  name?: string | null;
  email?: string | null;
}) {
  const r = size / 2;
  if (imageUrl) {
    return (
      <Image
        source={{ uri: imageUrl }}
        style={[styles.base, { width: size, height: size, borderRadius: r }]}
        contentFit="cover"
        transition={180}
        accessibilityIgnoresInvertColors
      />
    );
  }
  const letters = initials(name, email);
  return (
    <View style={[styles.base, styles.mono, { width: size, height: size, borderRadius: r }]}>
      {letters ? (
        <Text
          color={colors.text}
          style={{ fontFamily: fonts.semibold, fontSize: Math.round(size * 0.38), lineHeight: Math.round(size * 0.46), letterSpacing: -0.4 }}
        >
          {letters}
        </Text>
      ) : (
        <Icon name="fingerprint" size={Math.round(size * 0.52)} opacity={0.85} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  base: { backgroundColor: colors.surface2, overflow: "hidden" },
  mono: {
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
});
