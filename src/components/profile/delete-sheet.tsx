import * as Haptics from "expo-haptics";
import { useEffect } from "react";
import { Modal, Pressable, StyleSheet, View } from "react-native";
import Animated, { FadeIn, FadeOut, SlideInDown, SlideOutDown } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/button";
import { PressableScale } from "@/components/pressable-scale";
import { Text } from "@/components/text";
import { colors, radius, space, springs } from "@/theme";

/** In-app confirm for account deletion. Delete is the red pill; Cancel and the scrim close it. */
export function DeleteSheet({
  visible,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (visible) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={busy ? undefined : onCancel}>
      {visible ? (
        <View style={styles.root}>
          <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(200)} style={StyleSheet.absoluteFill}>
            <Pressable
              style={[StyleSheet.absoluteFill, styles.scrim]}
              onPress={busy ? undefined : onCancel}
              accessibilityLabel="Cancel"
              accessibilityRole="button"
            />
          </Animated.View>
          <Animated.View
            entering={SlideInDown.springify().damping(springs.sheet.damping).stiffness(springs.sheet.stiffness)}
            exiting={SlideOutDown.duration(200)}
            style={[styles.sheet, { paddingBottom: insets.bottom + space.lg }]}
          >
            <View style={styles.grabber} />
            <View style={styles.copy}>
              <Text variant="heading">Delete your account?</Text>
              <Text variant="body" color={colors.textSecondary}>
                Your apps, activity and settings are erased, and your assistants lose access right away. This can&apos;t be undone.
              </Text>
              {error ? (
                <Text variant="caption" color={colors.error}>
                  {error}
                </Text>
              ) : null}
            </View>
            <View style={styles.actions}>
              <PressableScale
                onPress={onConfirm}
                disabled={busy}
                haptic="medium"
                accessibilityLabel="Delete"
                accessibilityState={{ busy }}
                style={[styles.delete, busy && styles.busy]}
              >
                <Text variant="button" color="#FFFFFF">
                  {busy ? "Deleting" : "Delete"}
                </Text>
              </PressableScale>
              <Button label="Cancel" kind="secondary" onPress={onCancel} disabled={busy} fullWidth />
            </View>
          </Animated.View>
        </View>
      ) : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: "flex-end" },
  scrim: { backgroundColor: "rgba(0,0,0,0.6)" },
  sheet: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderColor: colors.border,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: space.xl,
    paddingTop: space.md,
    gap: space.xl,
  },
  grabber: { alignSelf: "center", width: 36, height: 4, borderRadius: radius.pill, backgroundColor: colors.borderStrong },
  copy: { gap: space.sm },
  actions: { gap: space.sm },
  delete: {
    height: 52,
    borderRadius: radius.pill,
    backgroundColor: colors.error,
    alignItems: "center",
    justifyContent: "center",
  },
  busy: { opacity: 0.6 },
});
