import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import { store } from "./storage";

const KEY = "yuzu.onboarded";

type OnboardingState = {
  /** null while the flag loads. */
  onboarded: boolean | null;
  finish: () => Promise<void>;
  /** Sends the app back to onboarding (after account deletion). */
  restart: () => Promise<void>;
};

const Ctx = createContext<OnboardingState>({
  onboarded: null,
  finish: async () => {},
  restart: async () => {},
});

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const [onboarded, setOnboarded] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    store
      .get(KEY)
      .then((v) => !cancelled && setOnboarded(v === "1"))
      .catch(() => !cancelled && setOnboarded(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const finish = useCallback(async () => {
    setOnboarded(true);
    await store.set(KEY, "1").catch(() => {});
  }, []);

  const restart = useCallback(async () => {
    await store.set(KEY, "0").catch(() => {});
    setOnboarded(false);
  }, []);

  return <Ctx.Provider value={{ onboarded, finish, restart }}>{children}</Ctx.Provider>;
}

export function useOnboarding() {
  return useContext(Ctx);
}
