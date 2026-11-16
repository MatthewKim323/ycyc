import { useEffect, useRef, useState, type ComponentRef } from "react";
import { Platform, StyleSheet, TextInput, View } from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  useReducedMotion,
  ZoomIn,
  withSpring,
  withTiming,
  type EntryAnimationsValues,
} from "react-native-reanimated";

import { Icon } from "@/components/icon";
import { PressableScale } from "@/components/pressable-scale";
import { Text } from "@/components/text";
import { colors, enter, fonts, layout, radius, space, springs, type } from "@/theme";

import { Avatar } from "./avatar";

// Grows out of the small header avatar the sheet was opened from.
function avatarIn(_: EntryAnimationsValues) {
  "worklet";
  return {
    initialValues: { opacity: 0, transform: [{ scale: 0.42 }, { translateY: -18 }] },
    animations: {
      opacity: withTiming(1, { duration: 220 }),
      transform: [{ scale: withSpring(1, springs.pop) }, { translateY: withSpring(0, springs.enter) }],
    },
  };
}

// Web supports only the predefined builders.
const webAvatarIn = ZoomIn.springify().damping(springs.pop.damping).stiffness(springs.pop.stiffness);

export function ProfileHeader({
  name,
  email,
  imageUrl,
  onRename,
}: {
  name?: string;
  email?: string;
  imageUrl?: string;
  onRename: (next: string) => Promise<void>;
}) {
  const reduced = useReducedMotion();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  // Shown until the server name moves off `base`, so the new name never flickers back.
  const [pending, setPending] = useState<{ value: string; base: string } | null>(null);
  const input = useRef<ComponentRef<typeof TextInput>>(null);
  // autoFocus loses the race with the press that opened the field on web; focus once it is mounted.
  useEffect(() => {
    if (!editing) return;
    const t = setTimeout(() => input.current?.focus(), 60);
    return () => clearTimeout(t);
  }, [editing]);
  // Return and blur both fire when the field closes; commit once.
  const committed = useRef(false);

  const shown = pending && (name ?? "") === pending.base ? pending.value : (name ?? "");

  const begin = () => {
    committed.current = false;
    setDraft(shown);
    setEditing(true);
  };

  const commit = async () => {
    if (committed.current) return;
    committed.current = true;
    setEditing(false);
    const next = draft.replace(/\s+/g, " ").trim();
    if (next === shown) return;
    setPending({ value: next, base: name ?? "" });
    try {
      await onRename(next);
    } catch {
      setPending(null);
    }
  };

  return (
    <View style={styles.wrap}>
      <Animated.View entering={reduced ? undefined : Platform.OS === "web" ? webAvatarIn : avatarIn}>
        <Avatar size={88} imageUrl={imageUrl} name={shown} email={email} />
      </Animated.View>

      <Animated.View entering={enter(1)} layout={layout} style={styles.nameSlot}>
        {editing ? (
          <Animated.View key="edit" entering={FadeIn.duration(160)} exiting={FadeOut.duration(120)} layout={layout} style={styles.field}>
            <TextInput
              ref={input}
              value={draft}
              onChangeText={setDraft}
              autoFocus
              placeholder="Your name"
              placeholderTextColor={colors.textTertiary}
              maxLength={60}
              returnKeyType="done"
              autoCapitalize="words"
              autoCorrect={false}
              selectionColor={colors.text}
              onSubmitEditing={commit}
              onBlur={commit}
              style={styles.input}
              accessibilityLabel="Your name"
            />
          </Animated.View>
        ) : (
          <Animated.View key="show" entering={FadeIn.duration(180)} exiting={FadeOut.duration(120)} layout={layout}>
            <PressableScale onPress={begin} haptic="selection" accessibilityLabel={shown ? `Edit name, ${shown}` : "Add your name"} style={styles.nameRow}>
              <Text variant="title" color={shown ? colors.text : colors.textSecondary} numberOfLines={1} style={styles.name}>
                {shown || "Add your name"}
              </Text>
              <Icon name="pencil" size={18} opacity={0.5} />
            </PressableScale>
          </Animated.View>
        )}
      </Animated.View>

      <Animated.View entering={enter(2)} layout={layout} style={styles.meta}>
        <Text variant="body" color={colors.textSecondary} numberOfLines={1} style={styles.email}>
          {email ?? "Not signed in"}
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", gap: space.md, paddingTop: space.sm },
  nameSlot: { minHeight: 44, justifyContent: "center", alignSelf: "stretch", alignItems: "center", marginTop: space.xs },
  nameRow: { flexDirection: "row", alignItems: "center", gap: space.sm, paddingHorizontal: space.sm, paddingVertical: space.xs },
  name: { maxWidth: 280 },
  field: {
    alignSelf: "stretch",
    marginHorizontal: space.xxl,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  input: {
    ...type.title,
    fontFamily: fonts.semibold,
    color: colors.text,
    textAlign: "center",
    paddingVertical: space.xs,
    paddingHorizontal: space.md,
  },
  meta: { flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: -space.xs },
  email: { maxWidth: 240 },
});
