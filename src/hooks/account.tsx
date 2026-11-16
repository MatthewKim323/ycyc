import { ClerkProvider, useAuth, useUser as useClerkUser } from "@clerk/expo";
import { useHostedAuth } from "@clerk/expo/hosted-auth";
import { tokenCache } from "@clerk/expo/token-cache";
import Constants, { ExecutionEnvironment } from "expo-constants";
import * as WebBrowser from "expo-web-browser";
import { createContext, useCallback, useContext, type ReactNode } from "react";

WebBrowser.maybeCompleteAuthSession();

// Without a key the app keeps its device identity and shows no account UI.
const PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;

export type Profile = { clerkUserId: string; email?: string; name?: string; imageUrl?: string };
export type GoogleResult = "signed-in" | "cancelled" | "failed";

type AccountState = {
  enabled: boolean;
  /** Clerk has restored (or ruled out) a session. Always true when disabled. */
  loaded: boolean;
  profile: Profile | null;
  signInWithGoogle: () => Promise<GoogleResult>;
  signOut: () => Promise<void>;
};

const DISABLED: AccountState = {
  enabled: false,
  loaded: true,
  profile: null,
  signInWithGoogle: async () => "failed",
  signOut: async () => {},
};

const AccountContext = createContext<AccountState>(DISABLED);

function ClerkAccount({ children }: { children: ReactNode }) {
  const { isLoaded, signOut } = useAuth();
  const { user } = useClerkUser();
  const { startHostedAuth } = useHostedAuth();

  const signInWithGoogle = useCallback(async (): Promise<GoogleResult> => {
    try {
      // Published Expo Go apps cannot rely on makeRedirectUri(). Use this
      // preview's real HTTPS manifest URL with Expo Go's registered exps URI.
      const updateUrl = Constants.executionEnvironment === ExecutionEnvironment.StoreClient
        ? Constants.expoConfig?.updates?.url : undefined;
      const redirectUrl = updateUrl?.startsWith("https://") && new URL(updateUrl).pathname.startsWith("/expo-preview/")
        ? updateUrl.replace(/^https:/, "exps:").replace(/\/$/, "") + "/--/hosted-auth-callback" : undefined;
      const { createdSessionId, authSessionResult } = await startHostedAuth({
        mode: "sign-in",
        ...(redirectUrl ? { redirectUrl } : {}),
      });
      // Hosted auth activates the session itself. Google is selected on the
      // Account Portal; callback validation and PKCE remain SDK-owned.
      if (createdSessionId) return "signed-in";
      const kind = authSessionResult?.type;
      return kind === "cancel" || kind === "dismiss" ? "cancelled" : "failed";
    } catch {
      return "failed";
    }
  }, [startHostedAuth]);

  const profile: Profile | null = user
    ? {
        clerkUserId: user.id,
        email: user.primaryEmailAddress?.emailAddress ?? undefined,
        name: user.fullName ?? user.firstName ?? undefined,
        imageUrl: user.imageUrl || undefined,
      }
    : null;

  const value: AccountState = {
    enabled: true,
    loaded: isLoaded,
    profile,
    signInWithGoogle,
    signOut: async () => {
      await signOut();
    },
  };

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export function AccountProvider({ children }: { children: ReactNode }) {
  if (!PUBLISHABLE_KEY) return <>{children}</>;
  return (
    <ClerkProvider publishableKey={PUBLISHABLE_KEY} tokenCache={tokenCache}>
      <ClerkAccount>{children}</ClerkAccount>
    </ClerkProvider>
  );
}

export function useAccount() {
  return useContext(AccountContext);
}
