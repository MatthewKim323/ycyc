import { useConvexAuth, useMutation } from "convex/react";
import * as Crypto from "expo-crypto";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

import { useAccount } from "./account";
import { api, type Id } from "./convex";
import { store } from "./storage";

const DEVICE_KEY = "yuzu.deviceId";
const USER_KEY = "yuzu.user";

type UserState = {
  userId: Id<"users"> | null;
  mcpUrl: string | null;
  /** True once we have tried the network at least once. */
  ready: boolean;
  error: string | null;
};

type UserContextValue = UserState & {
  /** After account deletion: forget this device's identity and start a fresh user. */
  resetIdentity: () => Promise<void>;
};

const UserContext = createContext<UserContextValue>({
  userId: null,
  mcpUrl: null,
  ready: false,
  error: null,
  resetIdentity: async () => {},
});

async function deviceId(): Promise<string> {
  const existing = await store.get(DEVICE_KEY);
  if (existing) return existing;
  const id = Crypto.randomUUID();
  await store.set(DEVICE_KEY, id);
  return id;
}

export function UserProvider({ children }: { children: ReactNode }) {
  const { enabled } = useAccount();
  return enabled ? <ClerkUserProvider>{children}</ClerkUserProvider> : <IdentityProvider>{children}</IdentityProvider>;
}

function ClerkUserProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useConvexAuth();
  return <IdentityProvider authenticated={isAuthenticated}>{children}</IdentityProvider>;
}

function IdentityProvider({ children, authenticated = false }: { children: ReactNode; authenticated?: boolean }) {
  const ensure = useMutation(api.users.ensure);
  const link = useMutation(api.users.linkAccount);
  const { loaded, profile } = useAccount();
  const [state, setState] = useState<UserState>({ userId: null, mcpUrl: null, ready: false, error: null });
  // Which Clerk user the last identity pass ran for (undefined: none yet).
  const linkedFor = useRef<string | null | undefined>(undefined);
  // Bumped by resetIdentity to rerun the identity pass with a new device id.
  const [epoch, setEpoch] = useState(0);

  const resetIdentity = useCallback(async () => {
    await store.set(DEVICE_KEY, Crypto.randomUUID());
    await store.set(USER_KEY, "");
    setState({ userId: null, mcpUrl: null, ready: false, error: null });
    setEpoch((e) => e + 1);
  }, []);

  // If Clerk can't load (offline), fall back to the device identity instead of waiting forever.
  const [clerkTimedOut, setClerkTimedOut] = useState(false);
  useEffect(() => {
    if (loaded) return;
    const t = setTimeout(() => setClerkTimedOut(true), 4000);
    return () => clearTimeout(t);
  }, [loaded]);
  const proceed = loaded || clerkTimedOut;

  const clerkUserId = profile?.clerkUserId ?? null;

  // Paint the cached identity immediately, then confirm with the server.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cached = await store.get(USER_KEY);
        if (cached && !cancelled) {
          const parsed = JSON.parse(cached) as { userId: Id<"users">; mcpUrl: string };
          setState((s) => (s.userId ? s : { ...s, userId: parsed.userId, mcpUrl: parsed.mcpUrl }));
        }
      } catch {
        // ignore a bad cache
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!proceed) return;
    let cancelled = false;
    const signedOut = !!linkedFor.current && !clerkUserId;
    linkedFor.current = clerkUserId;
    (async () => {
      if (signedOut) {
        // The account keeps its user; this device starts fresh.
        await store.set(DEVICE_KEY, Crypto.randomUUID());
        if (!cancelled) setState({ userId: null, mcpUrl: null, ready: false, error: null });
      }
      for (let attempt = 0; attempt < 5 && !cancelled; attempt++) {
        try {
          const id = await deviceId();
          // Keep device access while Clerk/Convex auth is loading or unavailable.
          // A linked account is read only after Convex verifies the Clerk JWT.
          const device = await ensure({ deviceId: id });
          let res = device;
          let linkFailed = false;
          if (clerkUserId && authenticated) {
            try {
              res = await link({ deviceId: id, clerkUserId, token: device.mcpUrl.split("/").pop() });
            } catch { linkFailed = true; }
          }
          if (cancelled) return;
          setState({ userId: res.userId, mcpUrl: res.mcpUrl, ready: true,
            error: linkFailed ? "Couldn't sync your Google account. You can keep using this device." : null });
          await store.set(USER_KEY, JSON.stringify({ userId: res.userId, mcpUrl: res.mcpUrl }));
          if (linkFailed && attempt < 4) {
            await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
            continue;
          }
          return;
        } catch {
          if (cancelled) return;
          setState((s) => ({ ...s, ready: true, error: "Couldn't sync your identity. Try again." }));
          await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ensure, link, proceed, clerkUserId, authenticated, epoch]);

  return <UserContext.Provider value={{ ...state, resetIdentity }}>{children}</UserContext.Provider>;
}

export function useUser() {
  return useContext(UserContext);
}

/** Google sign-in for any screen. `configured` is false without a Clerk key: render no account UI then. */
export function useAuth() {
  const { enabled, loaded, profile, signInWithGoogle, signOut } = useAccount();
  return {
    configured: enabled,
    loaded,
    signedIn: !!profile,
    signInWithGoogle,
    signOut,
    user: profile ? { name: profile.name, email: profile.email, imageUrl: profile.imageUrl } : null,
  };
}
