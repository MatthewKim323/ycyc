import { Slot, ThemeProvider, useTheme } from "expo-router";

import { OnboardingBackdrop } from "@/components/onboarding-chrome";

export default function OnboardingLayout() {
  const theme = useTheme();
  // Screens must be see-through so the one shader behind them shows on every step.
  // A Slot (not a native stack): iOS native stacks paint an opaque system background over the shader.
  const clear = { ...theme, colors: { ...theme.colors, background: "transparent", card: "transparent" } };
  return (
    <OnboardingBackdrop>
      <ThemeProvider value={clear}>
        <Slot />
      </ThemeProvider>
    </OnboardingBackdrop>
  );
}
