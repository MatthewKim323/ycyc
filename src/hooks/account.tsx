import { ClerkProvider, useAuth, useSSO, useUser as useClerkUser } from "@clerk/clerk-expo";
import { tokenCache } from "@clerk/clerk-expo/token-cache";
import * as AuthSession from "expo-auth-session";
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

// Standalone builds return to yuzu://sso-callback. Allowlist it in Clerk (Native applications).
const redirectUrl = AuthSession.makeRedirectUri({ scheme: "yuzu", path: "sso-callback" });

function ClerkAccount({ children }: { children: ReactNode }) {
  const { isLoaded, signOut } = useAuth();
  const { user } = useClerkUser();
  const { startSSOFlow } = useSSO();

  const signInWithGoogle = useCallback(async (): Promise<GoogleResult> => {
    try {
      const { createdSessionId, setActive, authSessionResult } = await startSSOFlow({
        strategy: "oauth_google",
        redirectUrl,
      });
      if (createdSessionId && setActive) {
        await setActive({ session: createdSessionId });
        return "signed-in";
      }
      const kind = authSessionResult?.type;
      return kind === "cancel" || kind === "dismiss" ? "cancelled" : "failed";
    } catch {
      return "failed";
    }
  }, [startSSOFlow]);

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
