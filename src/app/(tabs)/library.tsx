import { useQuery } from "convex/react";
import { useRouter } from "expo-router";
import { ActivityIndicator, StyleSheet, View } from "react-native";

import { AppTile, type TileState } from "@/components/app-tile";
import { LargeTitle, Screen, SectionHeader } from "@/components/layout";
import { statusLook } from "@/components/rows";
import { api, type CatalogEntry, type MyConnection } from "@/hooks/convex";
import { useUser } from "@/hooks/user";
import { colors, space } from "@/theme";

function tileState(conn: MyConnection | undefined): TileState {
  if (!conn) return { kind: "available" };
  if (conn.status === "live") return { kind: "live", tools: conn.toolCount };
  const look = statusLook(conn.status, conn.toolCount);
  return { kind: "status", dot: look.dot, label: conn.status === "error" && conn.error ? conn.error : look.label };
}

export default function AppsScreen() {
  const router = useRouter();
  const { userId } = useUser();
  const apps = useQuery(api.apps.list);
  const connections = useQuery(api.connections.mine, userId ? { userId } : "skip");

  const bySlug = new Map((connections ?? []).map((c) => [c.appSlug, c]));
  const mine = (apps ?? []).filter((a) => bySlug.has(a.slug));
  const rest = (apps ?? []).filter((a) => !bySlug.has(a.slug));

  const open = (app: CatalogEntry) => {
    const c = bySlug.get(app.slug);
    const status = c?.status as string | undefined;
    if (!c) router.push({ pathname: "/connect/[slug]", params: { slug: app.slug } });
    else if (status === "live") router.push({ pathname: "/app/[slug]", params: { slug: app.slug } });
    else if (status === "building" || status === "capturing" || status === "needs_code")
      router.push({ pathname: "/build/[connectionId]", params: { connectionId: c._id, slug: app.slug } });
    else router.push({ pathname: "/connect/[slug]", params: { slug: app.slug } });
  };

  const loading = apps === undefined || (!!userId && connections === undefined);

  return (
    <Screen>
      <LargeTitle>Apps</LargeTitle>

      {loading ? <ActivityIndicator color={colors.textTertiary} style={styles.loading} /> : null}

      {mine.length > 0 ? (
        <View>
          <SectionHeader title={`Connected · ${mine.length}`} />
          <View style={styles.grid}>
            {mine.map((a, i) => (
              <AppTile key={a.slug} app={a} index={i} state={tileState(bySlug.get(a.slug))} onPress={() => open(a)} />
            ))}
          </View>
        </View>
      ) : null}

      {rest.length > 0 ? (
        <View>
          <SectionHeader title={mine.length > 0 ? "Add another" : "Pick an app"} />
          <View style={styles.grid}>
            {rest.map((a, i) => (
              <AppTile key={a.slug} app={a} index={mine.length + i} state={{ kind: "available" }} onPress={() => open(a)} />
            ))}
          </View>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  loading: { paddingVertical: space.xl },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space.md },
});
