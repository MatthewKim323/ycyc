import { Stack, ThemeProvider, useTheme } from "expo-router";

import { OnboardingBackdrop } from "@/components/onboarding-chrome";

export default function OnboardingLayout() {
  const theme = useTheme();
  // Screens must be see-through so the one shader behind them shows on every step.
  const clear = { ...theme, colors: { ...theme.colors, background: "transparent", card: "transparent" } };
  return (
    <OnboardingBackdrop>
      <ThemeProvider value={clear}>
        <Stack
          screenOptions={{
            headerShown: false,
            animation: "fade",
            animationDuration: 250,
            contentStyle: { backgroundColor: "transparent" },
          }}
        />
      </ThemeProvider>
    </OnboardingBackdrop>
  );
}
