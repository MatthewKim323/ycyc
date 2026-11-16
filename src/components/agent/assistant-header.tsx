import { StyleSheet, View, type LayoutChangeEvent } from "react-native";
import Animated from "react-native-reanimated";

import type { AgentProvider } from "@/lib/agent";
import { colors, fadeIn, fadeOut, space } from "@/theme";

import { Icon } from "../icon";
import { PressableScale } from "../pressable-scale";
import { Text } from "../text";
import { AssistantLogo, assistantLabel } from "./assistant-menu";

/** Top-center switcher: which AI answers, and whether it's your plan. Tap to change. */
export function AssistantHeader({
  provider,
  open,
  onPress,
  onNewChat,
  onMenu,
  onHistory,
  historyOpen = false,
  onLayout,
}: {
  provider: AgentProvider | null;
  open: boolean;
  onPress: () => void;
  onNewChat: (() => void) | null;
  /** Opens the chats drawer. */
  onMenu?: () => void;
  /** Recent chats dropdown; null hides the control. */
  onHistory?: (() => void) | null;
  historyOpen?: boolean;
  onLayout?: (e: LayoutChangeEvent) => void;
}) {
  const plan = provider?.kind === "inapp";
  const label = provider ? assistantLabel(provider) : null;
  return (
    <View style={styles.bar} onLayout={onLayout}>
      <View style={[styles.side, styles.left]}>
        {onMenu ? (
          <PressableScale onPress={onMenu} haptic="selection" hitSlop={6} accessibilityLabel="Chats" style={styles.iconButton}>
            <Icon name="chat" size={22} />
          </PressableScale>
        ) : null}
        {onHistory ? (
          <Animated.View entering={fadeIn} exiting={fadeOut}>
            <PressableScale
              onPress={onHistory}
              haptic="selection"
              hitSlop={6}
              accessibilityLabel="Recent chats"
              accessibilityState={{ expanded: historyOpen }}
              style={[styles.iconButton, historyOpen && styles.switcherOpen]}
            >
              <Icon name="clock" size={20} opacity={0.8} />
            </PressableScale>
          </Animated.View>
        ) : null}
      </View>
      {label ? (
        <PressableScale
          onPress={onPress}
          haptic="selection"
          scaleTo={0.96}
          hitSlop={8}
          accessibilityLabel={`Assistant: ${label}${plan ? ", your plan" : ""}. Change`}
          accessibilityState={{ expanded: open }}
          style={[styles.switcher, open && styles.switcherOpen]}
        >
          <Animated.View key={provider?.id} entering={fadeIn} style={styles.center}>
            {provider ? <AssistantLogo id={provider.id} size={26} /> : null}
            <View style={styles.labels}>
              <Text variant="rowTitle" numberOfLines={1}>
                {label}
              </Text>
              {plan ? (
                <View style={styles.sub}>
                  <View style={styles.dot} />
                  <Text variant="micro" color={colors.textSecondary}>
                    Your plan
                  </Text>
                </View>
              ) : null}
            </View>
          </Animated.View>
        </PressableScale>
      ) : (
        <View />
      )}
      <View style={[styles.side, styles.right]}>
        {onNewChat ? (
          <Animated.View entering={fadeIn} exiting={fadeOut}>
            <PressableScale onPress={onNewChat} hitSlop={12} scaleTo={0.94} haptic="selection" accessibilityLabel="New chat">
              <Text variant="bodyMedium" color={colors.textSecondary}>
                New chat
              </Text>
            </PressableScale>
          </Animated.View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    height: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space.gutter,
  },
  side: { width: 80 },
  left: { flexDirection: "row", alignItems: "center", gap: 2, marginLeft: -space.sm },
  right: { alignItems: "flex-end" },
  iconButton: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },
  switcher: {
    minHeight: 40,
    paddingLeft: space.sm,
    paddingRight: space.lg,
    paddingVertical: 4,
    borderRadius: 20,
    justifyContent: "center",
  },
  switcherOpen: { backgroundColor: colors.surface2 },
  center: { flexDirection: "row", alignItems: "center", gap: space.sm },
  labels: { alignItems: "flex-start", flexShrink: 1 },
  sub: { flexDirection: "row", alignItems: "center", gap: 5 },
  dot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: colors.live },
});
