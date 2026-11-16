import { useAuth as useClerkAuth } from "@clerk/clerk-expo";
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, useFonts } from "@expo-google-fonts/inter";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { DarkTheme, Stack, ThemeProvider, type Theme } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, type ReactNode } from "react";
import { View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ApprovalSheet } from "@/components/approval-sheet";
import { DeviceRelay } from "@/components/device-relay";
import { AccountProvider, useAccount } from "@/hooks/account";
import { OnboardingProvider, useOnboarding } from "@/hooks/onboarding";
import { UserProvider, useUser } from "@/hooks/user";
import { colors } from "@/theme";

SplashScreen.preventAutoHideAsync().catch(() => {});

const convex = new ConvexReactClient(process.env.EXPO_PUBLIC_CONVEX_URL!, {
  unsavedChangesWarning: false,
});

function AppConvexProvider({ children }: { children: ReactNode }) {
  const { enabled } = useAccount();
  return enabled ? (
    <ConvexProviderWithClerk client={convex} useAuth={useClerkAuth}>{children}</ConvexProviderWithClerk>
  ) : (
    <ConvexProvider client={convex}>{children}</ConvexProvider>
  );
}

const theme: Theme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.bg,
    card: colors.bg,
    border: colors.border,
    primary: colors.text,
    text: colors.text,
  },
};

export const unstable_settings = {
  anchor: "(tabs)",
};

function Relay() {
  const { userId } = useUser();
  return <DeviceRelay userId={userId} />;
}

function RootStack({ fontsReady }: { fontsReady: boolean }) {
  const { onboarded } = useOnboarding();
  const ready = fontsReady && onboarded !== null;

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!ready) return <View style={{ flex: 1, backgroundColor: colors.bg }} />;

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.bg },
        animation: "default",
      }}
    >
      <Stack.Screen name="(tabs)" options={{ animation: "fade" }} />
      <Stack.Screen name="onboarding" options={{ animation: "fade", gestureEnabled: false }} />
      <Stack.Screen
        name="connect/[slug]"
        options={{
          presentation: "formSheet",
          sheetAllowedDetents: "fitToContents",
          sheetGrabberVisible: true,
          sheetCornerRadius: 24,
          contentStyle: { backgroundColor: colors.surface },
        }}
      />
      <Stack.Screen name="build/[connectionId]" options={{ presentation: "fullScreenModal", gestureEnabled: false }} />
      <Stack.Screen name="app/[slug]" options={{ animation: "slide_from_right" }} />
      <Stack.Screen name="paywall" options={{ presentation: "modal" }} />
      <Stack.Screen name="add" options={{ presentation: "modal" }} />
      <Stack.Screen name="profile/index" options={{ presentation: "modal", contentStyle: { backgroundColor: colors.bg } }} />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold });

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaProvider>
        <AccountProvider>
          <AppConvexProvider>
            <UserProvider>
              <OnboardingProvider>
                <ThemeProvider value={theme}>
                  <StatusBar style="light" />
                  <RootStack fontsReady={fontsLoaded || !!fontError} />
                  <Relay />
                  <ApprovalSheet />
                </ThemeProvider>
              </OnboardingProvider>
            </UserProvider>
          </AppConvexProvider>
        </AccountProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
