import { useRouter } from "expo-router";
import { StyleSheet, type StyleProp, type ViewStyle } from "react-native";

import { Icon } from "./icon";
import { PressableScale } from "./pressable-scale";

/** Width of the button, for a matching right spacer that keeps a header title centered. */
export const BACK_BUTTON_SIZE = 44;

/** Header back arrow. Defaults to router.back(); full-screen modals pass their own close action. */
export function BackButton({
  onPress,
  label = "Back",
  style,
}: {
  onPress?: () => void;
  label?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const router = useRouter();
  const go = onPress ?? (() => (router.canGoBack() ? router.back() : router.replace("/")));
  return (
    <PressableScale
      onPress={go}
      scaleTo={0.94}
      haptic="selection"
      accessibilityLabel={label}
      hitSlop={4}
      style={[styles.button, style]}
    >
      <Icon name="back" size={24} opacity={0.9} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  // Pulled left so the arrow lines up with the screen gutter instead of the hit area.
  button: {
    width: BACK_BUTTON_SIZE,
    height: BACK_BUTTON_SIZE,
    marginLeft: -10,
    alignItems: "center",
    justifyContent: "center",
  },
});
