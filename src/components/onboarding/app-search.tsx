import { useAction, useMutation } from "convex/react";
import { makeFunctionReference } from "convex/server";
import { Image } from "expo-image";
import { memo, useEffect, useRef, useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import Animated, {
  FadeIn,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { AppGlyph } from "@/components/app-glyph";
import { Button } from "@/components/button";
import { PressableScale } from "@/components/pressable-scale";
import { Text } from "@/components/text";
import type { Id } from "@/hooks/convex";
import type { CatalogApp } from "@/lib/contract";
import { colors, enter, fonts, layout, radius, space, stageOut } from "@/theme";

export type SearchStatus = "ready" | "learnable" | "phone_only";
export type SearchResult = {
  slug?: string;
  trackId?: string | number;
  name: string;
  iconUrl?: string;
  developer?: string;
  genre?: string;
  webUrl?: string;
  status: SearchStatus;
};

// Backend functions land while this ships; references stay loose so the UI builds either way.
const searchRef = makeFunctionReference<"action", { query: string }, SearchResult[]>("apps:search");
const requestRef = makeFunctionReference<
  "mutation",
  { userId: Id<"users">; trackId: string | number; name: string },
  unknown
>("apps:request");
const addCustomRef = makeFunctionReference<"mutation", { trackId: string | number }, string | { slug: string }>(
  "apps:addCustom",
);

export const POPULAR = ["Strava", "Peloton", "Headspace", "Lose It!", "Oura", "Uber Eats"];

const STATUS_LINE: Record<SearchStatus, string> = {
  ready: "Ready to connect",
  learnable: "yuzu learns it as you sign in",
  phone_only: "Phone only",
};

/** Debounced live search. `results` is null while the query is empty. */
export function useAppSearch(query: string) {
  const search = useAction(searchRef);
  const [state, setState] = useState<{
    q: string;
    results: SearchResult[] | null;
    failed: boolean;
  }>({
    q: "",
    results: null,
    failed: false,
  });
  const q = query.trim();

  useEffect(() => {
    if (!q) return;
    let cancelled = false;
    const id = setTimeout(async () => {
      try {
        const res = await search({ query: q });
        if (!cancelled)
          setState({
            q,
            results: Array.isArray(res) ? res : [],
            failed: false,
          });
      } catch {
        if (!cancelled) setState({ q, results: [], failed: true });
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [q, search]);

  if (!q) return { results: null, loading: false, failed: false };
  const fresh = state.q === q;
  return {
    results: fresh ? state.results : null,
    loading: !fresh,
    failed: fresh && state.failed,
  };
}

/** Turns a search result into a connectable slug (adds learnable apps to the catalog first). */
export function useResolveResult() {
  const addCustom = useMutation(addCustomRef);
  return async (r: SearchResult): Promise<string | null> => {
    if (r.status === "ready" && r.slug) return r.slug;
    if (r.status !== "learnable") return null;
    const res = await addCustom({ trackId: r.trackId ?? r.slug ?? r.name });
    return typeof res === "string" ? res : (res?.slug ?? null);
  };
}

export function SearchField({
  value,
  onChange,
  onFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  onFocus?: () => void;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={[styles.field, focused && styles.fieldFocused]}>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder="Search any app"
        placeholderTextColor={colors.textTertiary}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        clearButtonMode="never"
        onFocus={() => {
          setFocused(true);
          onFocus?.();
        }}
        onBlur={() => setFocused(false)}
        selectionColor={colors.text}
        style={styles.input}
        accessibilityLabel="Search any app"
      />
      {value ? (
        <Animated.View entering={FadeIn.duration(160)} exiting={stageOut}>
          <PressableScale
            onPress={() => onChange("")}
            hitSlop={10}
            scaleTo={0.94}
            haptic="selection"
            accessibilityLabel="Clear search"
          >
            <Text variant="label" color={colors.textSecondary}>
              Clear
            </Text>
          </PressableScale>
        </Animated.View>
      ) : null}
    </View>
  );
}

/** Popular names as pills; tapping one searches for it. */
export function PopularChips({ onPick }: { onPick: (name: string) => void }) {
  return (
    <View style={styles.popular}>
      <Text variant="label" color={colors.textSecondary}>
        Popular
      </Text>
      <View style={styles.chips}>
        {POPULAR.map((name, i) => (
          <Animated.View key={name} entering={enter(i)}>
            <PressableScale
              onPress={() => onPick(name)}
              haptic="selection"
              style={styles.chip}
              accessibilityLabel={`Search ${name}`}
            >
              <Text variant="label">{name}</Text>
            </PressableScale>
          </Animated.View>
        ))}
      </View>
    </View>
  );
}

/** The app's icon: remote store icon when the catalog has one, otherwise our glyph. */
export function AppIcon({
  app,
  size,
}: {
  app: Pick<CatalogApp, "slug" | "category"> & { iconUrl?: string };
  size: number;
}) {
  if (app.iconUrl) {
    return (
      <Image
        source={{ uri: app.iconUrl }}
        style={{
          width: size,
          height: size,
          borderRadius: Math.round(size * 0.27),
        }}
        contentFit="cover"
        transition={160}
      />
    );
  }
  return <AppGlyph app={app} size={size} />;
}

function Skeleton() {
  const reduced = useReducedMotion();
  const t = useSharedValue(0.5);
  useEffect(() => {
    if (!reduced) t.set(withRepeat(withTiming(1, { duration: 700 }), -1, true));
  }, [t, reduced]);
  const pulse = useAnimatedStyle(() => ({ opacity: t.get() }));
  return (
    <Animated.View entering={FadeIn.duration(160)} exiting={stageOut} style={pulse}>
      {[0, 1, 2, 3].map((i) => (
        <View key={i} style={[styles.row, i > 0 && styles.divider]}>
          <View style={styles.skelIcon} />
          <View style={styles.rowText}>
            <View style={[styles.skelLine, { width: "46%" }]} />
            <View style={[styles.skelLine, styles.skelThin, { width: "64%" }]} />
          </View>
        </View>
      ))}
    </Animated.View>
  );
}

const ResultRow = memo(function ResultRow({
  r,
  index,
  userId,
  onConnect,
}: {
  r: SearchResult;
  index: number;
  userId: Id<"users"> | null;
  onConnect: (r: SearchResult) => Promise<void>;
}) {
  const request = useMutation(requestRef);
  const [requested, setRequested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const tappable = r.status !== "phone_only";

  const ask = async () => {
    if (!userId || requested) return;
    setBusy(true);
    try {
      await request({
        userId,
        trackId: r.trackId ?? r.slug ?? r.name,
        name: r.name,
      });
      setRequested(true);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const open = async () => {
    setBusy(true);
    setFailed(false);
    try {
      await onConnect(r);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const body = (
    <>
      <AppIcon app={{ slug: r.slug ?? r.name, category: "other", iconUrl: r.iconUrl }} size={44} />
      <View style={styles.rowText}>
        <Text variant="rowTitle" numberOfLines={1}>
          {r.name}
        </Text>
        <Text variant="caption" color={failed ? colors.error : colors.textSecondary} numberOfLines={1}>
          {failed ? "Couldn't do that. Try again." : STATUS_LINE[r.status]}
        </Text>
      </View>
      {r.status === "phone_only" ? (
        <Button
          label={requested ? "Requested" : "Ask for it"}
          kind="secondary"
          size="small"
          onPress={ask}
          loading={busy}
          disabled={requested || !userId}
        />
      ) : null}
    </>
  );

  return (
    <Animated.View entering={enter(index)} exiting={stageOut} layout={layout} style={index > 0 && styles.divider}>
      {tappable ? (
        <PressableScale
          onPress={open}
          disabled={busy}
          haptic="selection"
          scaleTo={0.98}
          style={[styles.row, busy && styles.busy]}
          accessibilityLabel={`Connect ${r.name}`}
        >
          {body}
        </PressableScale>
      ) : (
        <View style={styles.row}>{body}</View>
      )}
    </Animated.View>
  );
});

/** Live results for a non-empty query: skeleton while loading, rows, or a plain empty state. */
export function SearchResults({
  query,
  userId,
  onConnect,
}: {
  query: string;
  userId: Id<"users"> | null;
  onConnect: (slug: string) => void;
}) {
  const { results, loading } = useAppSearch(query);
  const resolve = useResolveResult();
  const resolving = useRef(false);

  const connect = async (r: SearchResult) => {
    if (resolving.current) return;
    resolving.current = true;
    try {
      const slug = await resolve(r);
      if (slug) onConnect(slug);
      else throw new Error("unresolved");
    } finally {
      resolving.current = false;
    }
  };

  if (loading || !results) return <Skeleton />;
  if (results.length === 0) {
    return (
      <Animated.View entering={FadeIn.duration(200)} style={styles.empty}>
        <Text variant="bodyMedium" color={colors.textSecondary}>
          No apps match
        </Text>
      </Animated.View>
    );
  }
  return (
    <Animated.View layout={layout}>
      {results.map((r, i) => (
        <ResultRow key={`${r.trackId ?? r.slug ?? r.name}`} r={r} index={i} userId={userId} onConnect={connect} />
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  field: {
    height: 46,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.18)",
    backgroundColor: "rgba(11,11,11,0.8)",
    paddingHorizontal: space.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: space.sm,
  },
  fieldFocused: { borderColor: "rgba(255,255,255,0.4)" },
  input: {
    flex: 1,
    height: "100%",
    color: colors.text,
    fontFamily: fonts.regular,
    fontSize: 16,
  },
  popular: { gap: space.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  chip: {
    paddingHorizontal: 14,
    height: 34,
    justifyContent: "center",
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.18)",
    backgroundColor: "rgba(11,11,11,0.8)",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  divider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(255,255,255,0.1)",
  },
  rowText: { flex: 1, gap: 4 },
  busy: { opacity: 0.6 },
  skelIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: colors.surface2,
  },
  skelLine: { height: 12, borderRadius: 6, backgroundColor: colors.surface2 },
  skelThin: { height: 10 },
  empty: { paddingVertical: space.xl, alignItems: "center" },
});
