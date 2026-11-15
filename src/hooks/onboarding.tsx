import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import { store } from "./storage";

const KEY = "ycyc.onboarded";

type OnboardingState = {
  /** null while the flag loads. */
  onboarded: boolean | null;
  finish: () => Promise<void>;
};

const Ctx = createContext<OnboardingState>({
  onboarded: null,
  finish: async () => {},
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

  return <Ctx.Provider value={{ onboarded, finish }}>{children}</Ctx.Provider>;
}

export function useOnboarding() {
  return useContext(Ctx);
}
