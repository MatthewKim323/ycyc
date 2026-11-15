import { useMutation } from "convex/react";
import * as Crypto from "expo-crypto";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

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
  const [state, setState] = useState<UserState>({ userId: null, mcpUrl: null, ready: false, error: null });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Paint the cached identity immediately, then confirm with the server.
      try {
        const cached = await store.get(USER_KEY);
        if (cached && !cancelled) {
          const parsed = JSON.parse(cached) as { userId: Id<"users">; mcpUrl: string };
          setState((s) => ({ ...s, userId: parsed.userId, mcpUrl: parsed.mcpUrl }));
        }
      } catch {
        // ignore a bad cache
      }
      for (let attempt = 0; attempt < 5 && !cancelled; attempt++) {
        try {
          const id = await deviceId();
          const res = await ensure({ deviceId: id });
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
  }, [ensure]);

  return <UserContext.Provider value={state}>{children}</UserContext.Provider>;
}

export function useUser() {
  return useContext(UserContext);
}
