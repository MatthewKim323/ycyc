import Animated from "react-native-reanimated";

import { AssistantGuide } from "@/components/assistant-guide";
import { LargeTitle, Screen } from "@/components/layout";
import { McpLinkCard } from "@/components/mcp-link-card";
import { useUser } from "@/hooks/user";
import { enter } from "@/theme";

export default function LinkScreen() {
  const { mcpUrl } = useUser();
  return (
    <Screen>
      <LargeTitle sub="One link. Add it once to every assistant you use.">Link</LargeTitle>
      <Animated.View entering={enter(0)}>
        <McpLinkCard url={mcpUrl} showSetup={false} />
      </Animated.View>
      <Animated.View entering={enter(1)}>
        <AssistantGuide />
      </Animated.View>
    </Screen>
  );
}
