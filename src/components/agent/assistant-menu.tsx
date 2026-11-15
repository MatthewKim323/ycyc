import { Pressable, StyleSheet, View } from "react-native";
import Animated, { FadeIn, FadeOut, ZoomIn } from "react-native-reanimated";

import type { AgentProvider } from "@/lib/agent";
import { colors, space, springs } from "@/theme";

import { Icon } from "../icon";
import { PressableScale } from "../pressable-scale";
import { Text } from "../text";

const pop = ZoomIn.springify().damping(springs.pop.damping).stiffness(springs.pop.stiffness).mass(springs.pop.mass);

/**
 * Popover above the composer pill. Handoff assistants are always listed. In-app providers appear
 * only once one is registered; until it's signed in its row starts the sign-in instead.
 */
export function AssistantMenu({
  providers,
  currentId,
  bottom,
  onPick,
  onConnect,
  onClose,
}: {
  providers: AgentProvider[];
  currentId: string | null;
  bottom: number;
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
      <Animated.View entering={pop} exiting={FadeOut.duration(140)} style={[styles.menu, { bottom }]}>
        {handoff.map((p) => (
          <Row key={p.id} label={p.name} selected={p.id === currentId} onPress={() => onPick(p.id)} />
        ))}
        {inapp.length > 0 ? <View style={styles.divider} /> : null}
        {inapp.map((p) =>
          p.isConnected() ? (
            <Row key={p.id} label={p.name} selected={p.id === currentId} onPress={() => onPick(p.id)} />
          ) : (
            <Row key={p.id} label={`Connect your ${p.name} plan`} selected={false} onPress={() => onConnect(p)} />
          ),
        )}
      </Animated.View>
    </>
  );
}

function Row({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <PressableScale
      onPress={onPress}
      haptic="selection"
      scaleTo={0.98}
      accessibilityRole="menuitem"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      style={styles.row}
    >
      <Text variant="bodyMedium" numberOfLines={1} style={styles.label}>
        {label}
      </Text>
      {selected ? <Icon name="check" size={18} /> : null}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  menu: {
    position: "absolute",
    left: space.md + space.sm,
    minWidth: 220,
    paddingVertical: 6,
    backgroundColor: colors.surface2,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    transformOrigin: "bottom left",
  },
  row: {
    height: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    paddingHorizontal: space.lg,
  },
  label: { flex: 1 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.borderStrong, marginVertical: 6 },
});
