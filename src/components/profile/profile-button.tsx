import { useRouter, type Href } from "expo-router";
import { StyleSheet } from "react-native";

import { PressableScale } from "@/components/pressable-scale";

import { Avatar } from "./avatar";
import { useMe } from "./use-profile";

/** Header avatar (34 pt) that opens the profile sheet. */
export function ProfileButton() {
  const router = useRouter();
  const { me } = useMe();
  return (
    <PressableScale
      onPress={() => router.push("/profile" as Href)}
      haptic="selection"
      scaleTo={0.92}
      hitSlop={8}
      accessibilityLabel="Profile"
      style={styles.button}
    >
      <Avatar size={34} imageUrl={me?.imageUrl} name={me?.name} email={me?.email} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  button: { borderRadius: 17 },
});
