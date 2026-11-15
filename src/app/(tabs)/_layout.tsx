import { Redirect } from "expo-router";
import { Tabs } from "expo-router/js-tabs";

import { TabBar } from "@/components/tab-bar";
import { useOnboarding } from "@/hooks/onboarding";
import { colors } from "@/theme";

export default function TabsLayout() {
  const { onboarded } = useOnboarding();
  if (onboarded === false) return <Redirect href="/onboarding" />;
  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: colors.bg } }}
    >
      <Tabs.Screen name="index" options={{ title: "Today" }} />
      <Tabs.Screen name="library" options={{ title: "Apps" }} />
      <Tabs.Screen name="link" options={{ title: "Link" }} />
    </Tabs>
  );
}
