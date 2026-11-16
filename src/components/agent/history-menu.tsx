import { Pressable, StyleSheet, View } from "react-native";
import Animated, { FadeIn, FadeOut, ZoomIn } from "react-native-reanimated";

import { colors, hairline, space, springs } from "@/theme";

import { PressableScale } from "../pressable-scale";
import { Text } from "../text";
import { ThreadRow, type HistoryThread } from "./history-drawer";

const pop = ZoomIn.springify().damping(springs.pop.damping).stiffness(springs.pop.stiffness).mass(springs.pop.mass);
const RECENT = 5;

/** Compact dropdown under the header: the latest chats, then "All chats" for the drawer. */
export function HistoryMenu({
  threads,
  currentId,
  top,
  onPick,
  onAll,
  onClose,
}: {
  threads: HistoryThread[];
  currentId: string | null;
  top: number;
  onPick: (threadId: string) => void;
  onAll: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(160)} style={StyleSheet.absoluteFill}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
      </Animated.View>
      <Animated.View entering={pop} exiting={FadeOut.duration(140)} style={[styles.menu, { top }]}>
        {threads.slice(0, RECENT).map((t) => (
          <ThreadRow
            key={t.threadId}
            thread={t}
            current={t.threadId === currentId}
            currentBg={colors.borderStrong}
            onPress={() => onPick(t.threadId)}
          />
        ))}
        <View style={styles.divider} />
        <PressableScale onPress={onAll} haptic="selection" accessibilityLabel="All chats" style={styles.all}>
          <Text variant="bodyMedium">All chats</Text>
        </PressableScale>
      </Animated.View>
    </>
  );
}

const styles = StyleSheet.create({
  menu: {
    position: "absolute",
    left: space.gutter,
    width: 268,
    paddingVertical: 6,
    backgroundColor: colors.surface2,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    transformOrigin: "top left",
  },
  divider: {
    height: hairline,
    backgroundColor: colors.borderStrong,
    marginVertical: 6,
  },
  all: {
    minHeight: 44,
    justifyContent: "center",
    marginHorizontal: space.sm,
    paddingHorizontal: space.md,
    borderRadius: 12,
  },
});
