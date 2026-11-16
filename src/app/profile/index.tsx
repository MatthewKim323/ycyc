import { useAction, useMutation, useQuery } from "convex/react";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Platform, ScrollView, Share, StyleSheet, View } from "react-native";
import Animated from "react-native-reanimated";

import { APP_COPY } from "@/components/app-copy";
import { AppGlyph } from "@/components/app-glyph";
import { BackButton } from "@/components/back-button";
import { Icon } from "@/components/icon";
import { Screen } from "@/components/layout";
import { PressableScale } from "@/components/pressable-scale";
import { DeleteSheet } from "@/components/profile/delete-sheet";
import { ProfileHeader } from "@/components/profile/header";
import { ChoiceRow, Group, Row, RowDivider } from "@/components/profile/rows";
import { StatsRow } from "@/components/profile/stats";
import { profileTzOffset, useMe } from "@/components/profile/use-profile";
import { Text } from "@/components/text";
import { api, type CatalogEntry } from "@/hooks/convex";
import { assistantName } from "@/hooks/format";
import { useOnboarding } from "@/hooks/onboarding";
import { useAuth, useUser } from "@/hooks/user";
import { colors, enter, radius, space } from "@/theme";

type ApprovalsDefault = "ask" | "hour";
const APPROVAL_OPTIONS: { value: ApprovalsDefault; label: string }[] = [
  { value: "ask", label: "Ask every time" },
  { value: "hour", label: "Allow for an hour" },
];

function listJoin(names: string[]) {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function AppLogo({ slug, app, size }: { slug: string; app?: CatalogEntry; size: number }) {
  const iconUrl = (app as { iconUrl?: string } | undefined)?.iconUrl;
  if (!APP_COPY[slug]?.logo && iconUrl) {
    return <Image source={{ uri: iconUrl }} style={{ width: size, height: size, borderRadius: Math.round(size * 0.27) }} transition={150} />;
  }
  return <AppGlyph app={app ?? { slug, category: "other" }} size={size} />;
}

export default function ProfileScreen() {
  const router = useRouter();
  const { userId, me } = useMe();
  const { resetIdentity } = useUser();
  const { restart } = useOnboarding();
  const auth = useAuth();
  const catalog = useQuery(api.apps.list);

  const rename = useMutation(api.profile.update);
  const setPrefs = useMutation(api.profile.setPrefs).withOptimisticUpdate((store, args) => {
    const key = { userId: args.userId, tzOffset: profileTzOffset };
    const cur = store.getQuery(api.profile.me, key);
    if (!cur) return;
    store.setQuery(api.profile.me, key, {
      ...cur,
      prefs: {
        approvalsDefault: args.prefs.approvalsDefault ?? cur.prefs.approvalsDefault,
        weeklyRecap: args.prefs.weeklyRecap ?? cur.prefs.weeklyRecap,
      },
    });
  });
  const exportData = useAction(api.profile.exportData);
  const deleteAccount = useAction(api.profile.deleteAccount);

  const [exporting, setExporting] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [authNote, setAuthNote] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (!exportNote) return;
    const t = setTimeout(() => setExportNote(null), 2400);
    return () => clearTimeout(t);
  }, [exportNote]);

  const appBySlug = new Map((catalog ?? []).map((a) => [a.slug, a]));

  const close = () => (router.canGoBack() ? router.back() : router.replace("/"));

  const onExport = async () => {
    if (!userId) return;
    setExporting(true);
    try {
      const res = await exportData({ userId });
      if (Platform.OS === "web") {
        await Clipboard.setStringAsync(res.json);
        setExportNote("Copied");
      } else {
        await Share.share({ message: res.json, title: "yuzu data" });
      }
    } catch {
      setExportNote("Try again");
    } finally {
      setExporting(false);
    }
  };

  const onSignIn = async () => {
    setAuthNote(null);
    setSigningIn(true);
    const result = await auth.signInWithGoogle();
    setSigningIn(false);
    if (result === "failed") setAuthNote("Couldn't sign in. Try again.");
  };

  const onSignOut = async () => {
    setSigningOut(true);
    try {
      await auth.signOut();
      close();
    } finally {
      setSigningOut(false);
    }
  };

  const onDelete = async () => {
    if (!userId) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteAccount({ userId });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      if (auth.signedIn) await auth.signOut().catch(() => {});
      await resetIdentity();
      await restart();
      setDeleteOpen(false);
      if (router.canDismiss()) router.dismissAll();
      router.replace("/onboarding");
    } catch {
      setDeleteError("Couldn't delete your account. Try again.");
      setDeleting(false);
    }
  };

  const showSignIn = auth.configured && auth.loaded && !auth.signedIn;
  const assistants = me?.assistants ?? [];

  return (
    <Screen
      topInset={Platform.OS !== "ios"}
      header={
        <View style={styles.bar}>
          <BackButton label="Close" onPress={close} />
        </View>
      }
    >
      {me ? (
        <>
          <ProfileHeader
            name={me.name}
            email={me.email}
            imageUrl={me.imageUrl}
            plan={me.plan}
            onRename={async (name) => {
              if (userId) await rename({ userId, name });
            }}
          />

          {showSignIn ? (
            <Animated.View entering={enter(3)}>
              <Group>
                <Row icon="globe" title="Sign in with Google" onPress={onSignIn} navigates loading={signingIn} />
              </Group>
              {authNote ? (
                <Text variant="caption" color={colors.error} style={styles.note}>
                  {authNote}
                </Text>
              ) : null}
            </Animated.View>
          ) : null}

          <Animated.View entering={enter(4)}>
            <StatsRow stats={me.stats} delay={260} />
          </Animated.View>

          <Animated.View entering={enter(5)}>
            <Group title="Your apps">
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
                {me.apps.map((slug) => {
                  const app = appBySlug.get(slug);
                  const name = app?.name ?? slug;
                  return (
                    <PressableScale
                      key={slug}
                      onPress={() => router.push({ pathname: "/app/[slug]", params: { slug } })}
                      haptic="selection"
                      accessibilityLabel={name}
                      style={styles.appTile}
                    >
                      <AppLogo slug={slug} app={app} size={52} />
                      <Text variant="micro" color={colors.textSecondary} numberOfLines={1} style={styles.appName}>
                        {name}
                      </Text>
                    </PressableScale>
                  );
                })}
                <PressableScale onPress={() => router.push("/add")} haptic="selection" accessibilityLabel="Add an app" style={styles.appTile}>
                  <View style={styles.addTile}>
                    <Icon name="plus" size={26} opacity={0.8} />
                  </View>
                  <Text variant="micro" color={colors.textSecondary} numberOfLines={1} style={styles.appName}>
                    Add
                  </Text>
                </PressableScale>
              </ScrollView>
            </Group>
          </Animated.View>

          <Animated.View entering={enter(6)}>
            <Group title="Your assistants">
              <Row
                icon="link"
                title={assistants.length ? listJoin(assistants.map(assistantName)) : "Add yuzu to an assistant"}
                onPress={() => router.dismissTo("/link")}
                navigates
              />
            </Group>
          </Animated.View>

          <Animated.View entering={enter(7)}>
            <Group title="Plan">
              {me.plan === "pro" ? (
                <Row icon="star" title="yuzu Pro" />
              ) : (
                <Row icon="star" title="Upgrade to Pro" value="Free" onPress={() => router.push("/paywall")} navigates />
              )}
            </Group>
          </Animated.View>

          <Animated.View entering={enter(8)}>
            <Group title="Settings">
              <ChoiceRow
                icon="eye"
                title="Approvals"
                value={me.prefs.approvalsDefault}
                options={APPROVAL_OPTIONS}
                onChange={(approvalsDefault) => userId && setPrefs({ userId, prefs: { approvalsDefault } })}
              />
              <RowDivider inset={50} />
              <Row icon="external" title="Export my data" value={exportNote ?? undefined} onPress={onExport} loading={exporting} />
              <RowDivider inset={50} />
              <Row icon="fingerprint" title="yuzu never keeps your passwords" tone={colors.textSecondary} />
            </Group>
          </Animated.View>

          <Animated.View entering={enter(9)} style={styles.account}>
            {auth.signedIn ? (
              <Group>
                <Row title="Sign out" onPress={onSignOut} loading={signingOut} />
              </Group>
            ) : null}
            <Group>
              <Row title="Delete account" tone={colors.error} onPress={() => setDeleteOpen(true)} />
            </Group>
          </Animated.View>
        </>
      ) : (
        <View style={styles.placeholder}>
          <View style={styles.ghost} />
        </View>
      )}

      <DeleteSheet
        visible={deleteOpen}
        busy={deleting}
        error={deleteError}
        onCancel={() => {
          setDeleteOpen(false);
          setDeleteError(null);
        }}
        onConfirm={onDelete}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  bar: { height: 52, flexDirection: "row", alignItems: "center", paddingHorizontal: space.gutter },
  note: { marginTop: space.sm, paddingHorizontal: space.xs },
  strip: { paddingHorizontal: space.md, paddingVertical: space.lg, gap: space.sm },
  appTile: { width: 68, alignItems: "center", gap: space.sm },
  appName: { maxWidth: 68, textAlign: "center" },
  addTile: {
    width: 52,
    height: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  account: { gap: space.md },
  placeholder: { alignItems: "center", paddingTop: space.sm },
  ghost: { width: 88, height: 88, borderRadius: radius.pill, backgroundColor: colors.surface2 },
});
