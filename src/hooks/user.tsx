import { useMutation } from "convex/react";
import * as Crypto from "expo-crypto";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

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

const UserContext = createContext<UserState>({ userId: null, mcpUrl: null, ready: false, error: null });

async function deviceId(): Promise<string> {
  const existing = await store.get(DEVICE_KEY);
  if (existing) return existing;
  const id = Crypto.randomUUID();
  await store.set(DEVICE_KEY, id);
  return id;
}

export function UserProvider({ children }: { children: ReactNode }) {
  const ensure = useMutation(api.users.ensure);
  const link = useMutation(api.users.linkAccount);
  const { loaded, profile } = useAccount();
  const [state, setState] = useState<UserState>({ userId: null, mcpUrl: null, ready: false, error: null });
  // Which Clerk user the last identity pass ran for (undefined: none yet).
  const linkedFor = useRef<string | null | undefined>(undefined);

  // If Clerk can't load (offline), fall back to the device identity instead of waiting forever.
  const [clerkTimedOut, setClerkTimedOut] = useState(false);
  useEffect(() => {
    if (loaded) return;
    const t = setTimeout(() => setClerkTimedOut(true), 4000);
    return () => clearTimeout(t);
  }, [loaded]);
  const proceed = loaded || clerkTimedOut;

  const clerkUserId = profile?.clerkUserId ?? null;
  const email = profile?.email;
  const name = profile?.name;
  const imageUrl = profile?.imageUrl;

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
          const res = clerkUserId
            ? await link({ deviceId: id, clerkUserId, email, name, imageUrl })
            : await ensure({ deviceId: id });
          if (cancelled) return;
          setState({ userId: res.userId, mcpUrl: res.mcpUrl, ready: true, error: null });
          await store.set(USER_KEY, JSON.stringify({ userId: res.userId, mcpUrl: res.mcpUrl }));
          return;
        } catch (e) {
          if (cancelled) return;
          setState((s) => ({ ...s, ready: true, error: e instanceof Error ? e.message : String(e) }));
          await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ensure, link, proceed, clerkUserId, email, name, imageUrl]);

  return <UserContext.Provider value={state}>{children}</UserContext.Provider>;
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
