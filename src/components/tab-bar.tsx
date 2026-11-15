import type { BottomTabBarProps } from "expo-router/js-tabs";
import * as Haptics from "expo-haptics";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, space } from "@/theme";

import { Icon, type IconName } from "./icon";
import { PressableScale } from "./pressable-scale";
import { Text } from "./text";

const TABS: Record<string, { label: string; icon: IconName }> = {
  index: { label: "Today", icon: "home" },
  library: { label: "Apps", icon: "library" },
  link: { label: "Link", icon: "link" },
};

function TabItem({ focused, label, icon, onPress }: { focused: boolean; label: string; icon: IconName; onPress: () => void }) {
  const [playKey, setPlayKey] = useState(0);
  return (
    <PressableScale
      style={styles.item}
      scaleTo={0.9}
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={label}
      onPress={() => {
        setPlayKey((k) => k + 1);
        onPress();
      }}
    >
      <Icon name={icon} size={26} playKey={playKey} opacity={focused ? 1 : 0.4} />
      <Text variant="micro" color={focused ? colors.text : colors.textTertiary}>
        {label}
      </Text>
    </PressableScale>
  );
}

export function TabBar({ state, emitter, navigateToTab }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, space.sm) }]}>
      {state.routes.map((route, index) => {
        const tab = TABS[route.name];
        if (!tab) return null;
        const focused = state.index === index;
        return (
          <TabItem
            key={route.key}
            focused={focused}
            label={tab.label}
            icon={tab.icon}
            onPress={() => {
              const event = emitter.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
              if (!focused && !event.defaultPrevented) {
                Haptics.selectionAsync().catch(() => {});
                navigateToTab(route.key);
              }
            }}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    backgroundColor: colors.bg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: space.sm,
  },
  item: { flex: 1, alignItems: "center", gap: 2 },
});
