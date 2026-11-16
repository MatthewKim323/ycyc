import { Image } from "expo-image";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, { FadeIn, FadeOut, ZoomIn } from "react-native-reanimated";

import type { AgentProvider } from "@/lib/agent";
import { takesPrefill } from "@/lib/agent/handoff";
import { colors, enter, space, springs } from "@/theme";

import { Icon } from "../icon";
import { PressableScale } from "../pressable-scale";
import { Text } from "../text";

const pop = ZoomIn.springify().damping(springs.pop.damping).stiffness(springs.pop.stiffness).mass(springs.pop.mass);

// App Store icons (iTunes lookup, 256 px). Plans share their assistant's mark.
const LOGOS: Record<string, number> = {
  claude: require("@/assets/assistants/claude.png"),
  "claude-plan": require("@/assets/assistants/claude.png"),
  chatgpt: require("@/assets/assistants/chatgpt.png"),
  "chatgpt-plan": require("@/assets/assistants/chatgpt.png"),
  grok: require("@/assets/assistants/grok.png"),
  perplexity: require("@/assets/assistants/perplexity.png"),
  gemini: require("@/assets/assistants/gemini.png"),
  muse: require("@/assets/assistants/muse.png"),
};

/** The assistant's real app icon in a squircle (same corner ratio as AppGlyph). */
export function AssistantLogo({ id, size = 40 }: { id: string; size?: number }) {
  const logo = LOGOS[id];
  const box = { width: size, height: size, borderRadius: Math.round(size * 0.27) };
  if (!logo) return <View style={[styles.logoEmpty, box]} />;
  return (
    <View style={[styles.logoWrap, box]}>
      <Image source={logo} style={StyleSheet.absoluteFill} contentFit="cover" transition={0} accessibilityIgnoresInvertColors />
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.logoRim, { borderRadius: box.borderRadius }]} />
    </View>
  );
}

/** What the header and menu call an assistant: plans by name, handoffs as the app. */
export function assistantLabel(p: AgentProvider): string {
  return p.kind === "handoff" ? `${p.name} app` : p.name;
}

/**
 * Dropdown under the header. Plans first (connected ones switch, the rest start sign-in), then
 * the assistant apps that open with the message prefilled or copied.
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
        {inapp.length > 0 ? <Section title="Your plan" /> : null}
        {inapp.map((p, i) => {
          const connected = p.isConnected();
          return (
            <Row
              key={p.id}
              index={i}
              id={p.id}
              label={p.name}
              sub={connected ? "Your plan" : `Use your ${p.name} plan`}
              live={connected}
              connect={!connected}
              selected={connected && p.id === currentId}
              onPress={() => (connected ? onPick(p.id) : onConnect(p))}
            />
          );
        })}
        {inapp.length > 0 && handoff.length > 0 ? <View style={styles.divider} /> : null}
        {handoff.length > 0 ? <Section title="Or use the app" /> : null}
        {handoff.map((p, i) => (
          <Row
            key={p.id}
            index={inapp.length + i}
            id={p.id}
            label={p.name}
            sub={takesPrefill(p.id) ? "Opens with your message" : "Copies your message, opens the app"}
            selected={p.id === currentId}
            onPress={() => onPick(p.id)}
          />
        ))}
      </Animated.View>
    </>
  );
}

function Section({ title }: { title: string }) {
  return (
    <Text variant="micro" color={colors.textTertiary} style={styles.section}>
      {title}
    </Text>
  );
}

function Row({
  index,
  id,
  label,
  sub,
  live,
  connect,
  selected,
  onPress,
}: {
  index: number;
  id: string;
  label: string;
  sub: string;
  live?: boolean;
  connect?: boolean;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Animated.View entering={enter(index)}>
      <PressableScale
        onPress={onPress}
        haptic="selection"
        accessibilityRole="menuitem"
        accessibilityState={{ selected }}
        accessibilityLabel={connect ? `Connect your ${label} plan` : `${label}, ${sub}`}
        style={styles.row}
      >
        <AssistantLogo id={id} size={30} />
        <View style={styles.text}>
          <Text variant="bodyMedium" numberOfLines={1}>
            {label}
          </Text>
          <View style={styles.subRow}>
            {live ? <View style={styles.dot} /> : null}
            <Text variant="caption" color={colors.textTertiary} numberOfLines={1}>
              {sub}
            </Text>
          </View>
        </View>
        {connect ? (
          <View style={styles.pill}>
            <Text variant="micro">Connect</Text>
          </View>
        ) : selected ? (
          <Icon name="check" size={18} />
        ) : null}
      </PressableScale>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  menu: {
    position: "absolute",
    alignSelf: "center",
    width: 296,
    paddingVertical: 6,
    backgroundColor: colors.surface2,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    transformOrigin: "top center",
  },
  section: { paddingHorizontal: space.lg, paddingTop: space.sm, paddingBottom: 2 },
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
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.28)",
  },
  logoWrap: { overflow: "hidden", borderCurve: "continuous", backgroundColor: colors.surface2 },
  logoRim: { borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(255,255,255,0.14)", borderCurve: "continuous" },
  logoEmpty: { backgroundColor: colors.surface2, borderCurve: "continuous" },
});
