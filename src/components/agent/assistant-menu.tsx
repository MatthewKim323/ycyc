import { Pressable, StyleSheet, View } from "react-native";
import Animated, { FadeIn, FadeOut, ZoomIn } from "react-native-reanimated";

import type { AgentProvider } from "@/lib/agent";
import { colors, space, springs } from "@/theme";

import { Icon } from "../icon";
import { PressableScale } from "../pressable-scale";
import { Text } from "../text";

const pop = ZoomIn.springify().damping(springs.pop.damping).stiffness(springs.pop.stiffness).mass(springs.pop.mass);

/** What the header and menu call an assistant: plans by name, handoffs as the app. */
export function assistantLabel(p: AgentProvider): string {
  return p.kind === "handoff" ? `${p.name} app` : p.name;
}

/**
 * Dropdown under the header. Plans first (connected ones switch, the rest start sign-in), then
 * the assistant apps that open with the message prefilled.
 */
export function AssistantMenu({
  providers,
  currentId,
  top,
  onPick,
  onConnect,
  onClose,
}: {
  providers: AgentProvider[];
  currentId: string | null;
  top: number;
  onPick: (id: string) => void;
  onConnect: (p: AgentProvider) => void;
  onClose: () => void;
}) {
  const handoff = providers.filter((p) => p.kind === "handoff");
  const inapp = providers.filter((p) => p.kind === "inapp");
  return (
    <>
      <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(160)} style={StyleSheet.absoluteFill}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
      </Animated.View>
      <Animated.View entering={pop} exiting={FadeOut.duration(140)} style={[styles.menu, { top }]}>
        {inapp.map((p) =>
          p.isConnected() ? (
            <Row key={p.id} label={p.name} sub="Your plan" live selected={p.id === currentId} onPress={() => onPick(p.id)} />
          ) : (
            <Row key={p.id} label={`Connect your ${p.name} plan`} selected={false} onPress={() => onConnect(p)} />
          ),
        )}
        {inapp.length > 0 && handoff.length > 0 ? <View style={styles.divider} /> : null}
        {handoff.map((p) => (
          <Row key={p.id} label={assistantLabel(p)} sub="Opens the app" selected={p.id === currentId} onPress={() => onPick(p.id)} />
        ))}
      </Animated.View>
    </>
  );
}

function Row({
  label,
  sub,
  live,
  selected,
  onPress,
}: {
  label: string;
  sub?: string;
  live?: boolean;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <PressableScale
      onPress={onPress}
      haptic="selection"
      scaleTo={0.98}
      accessibilityRole="menuitem"
      accessibilityState={{ selected }}
      accessibilityLabel={sub ? `${label}, ${sub}` : label}
      style={styles.row}
    >
      <View style={styles.text}>
        <Text variant="bodyMedium" numberOfLines={1}>
          {label}
        </Text>
        {sub ? (
          <View style={styles.subRow}>
            {live ? <View style={styles.dot} /> : null}
            <Text variant="caption" color={colors.textTertiary} numberOfLines={1}>
              {sub}
            </Text>
          </View>
        ) : null}
      </View>
      {selected ? <Icon name="check" size={18} /> : null}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  menu: {
    position: "absolute",
    alignSelf: "center",
    width: 260,
    paddingVertical: 6,
    backgroundColor: colors.surface2,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    transformOrigin: "top center",
  },
  row: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  text: { flex: 1, gap: 1 },
  subRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.live },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.borderStrong, marginVertical: 6 },
});
