import { useQuery } from "convex/react";
import { type Href, useRouter } from "expo-router";
import { ActivityIndicator, StyleSheet, useWindowDimensions, View } from "react-native";
import Animated from "react-native-reanimated";

import { AddTile, AppTile } from "@/components/app-tile";
import { Screen } from "@/components/layout";
import { statusLook } from "@/components/rows";
import { Text } from "@/components/text";
import { api, type MyConnection } from "@/hooks/convex";
import { useUser } from "@/hooks/user";
import { colors, enter, space } from "@/theme";

const GUTTER = 20;
const COL_GAP = 18;

export default function YourApps() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { userId } = useUser();
  const connections = useQuery(api.connections.mine, userId ? { userId } : "skip");
  const tileWidth = (Math.min(width, 520) - GUTTER * 2 - COL_GAP * 2) / 3;

  const open = (c: MyConnection) => {
    const status = c.status as string;
    if (status === "live") router.push({ pathname: "/app/[slug]", params: { slug: c.appSlug } });
    else if (status === "building" || status === "capturing" || status === "needs_code")
      router.push({ pathname: "/build/[connectionId]", params: { connectionId: c._id, slug: c.appSlug } });
    else router.push({ pathname: "/connect/[slug]", params: { slug: c.appSlug } });
  };

  return (
    <Screen contentStyle={styles.content}>
      <Animated.View entering={enter(0)}>
        <Text style={styles.title}>Your apps</Text>
      </Animated.View>

      {userId && connections === undefined ? (
        <ActivityIndicator color={colors.textTertiary} style={styles.loading} />
      ) : (
        <View style={styles.grid}>
          {(connections ?? []).map((c, i) => (
            <AppTile
              key={c._id}
              app={c.app}
              ready={c.status === "live"}
              note={statusLook(c.status).label}
              index={i + 1}
              width={tileWidth}
              onPress={() => open(c)}
            />
          ))}
          <AddTile index={(connections?.length ?? 0) + 1} width={tileWidth} onPress={() => router.push("/add" as Href)} />
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: GUTTER, gap: space.xxl, paddingTop: space.lg },
  title: { fontFamily: "Inter_600SemiBold", fontSize: 30, lineHeight: 36, letterSpacing: -0.6, color: colors.text },
  loading: { paddingVertical: space.xl },
  grid: { flexDirection: "row", flexWrap: "wrap", columnGap: COL_GAP, rowGap: 28 },
});
