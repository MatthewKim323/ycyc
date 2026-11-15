import Constants, { ExecutionEnvironment } from "expo-constants";
import { useEffect, useState } from "react";
import { AppState, Linking, Platform } from "react-native";

/**
 * URL schemes of the supported apps. iOS only answers canOpenURL for schemes listed in
 * `ios.infoPlist.LSApplicationQueriesSchemes` (app.json), so keep the two in sync.
 */
// Only schemes with a public source. MyFitnessPal, Strong and ParkMobile publish none we trust yet.
export const APP_SCHEMES: Record<string, string> = {
  duolingo: "duolingo",
  cronometer: "cronometer",
};

export type InstalledApps = Record<string, boolean>;

/**
 * Detection only means something in our own iOS build. Expo Go can't query our schemes,
 * Android needs manifest queries we don't ship, and web has no apps.
 */
const canDetect = Platform.OS === "ios" && Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;

let cache: InstalledApps | null = null;
let pending: Promise<InstalledApps> | null = null;
const listeners = new Set<(v: InstalledApps) => void>();

async function probe(): Promise<InstalledApps> {
  const entries = await Promise.all(
    Object.entries(APP_SCHEMES).map(async ([slug, scheme]) => {
      try {
        return [slug, await Linking.canOpenURL(`${scheme}://`)] as const;
      } catch {
        return [slug, false] as const;
      }
    }),
  );
  return Object.fromEntries(entries);
}

function refresh() {
  if (!canDetect || pending) return;
  pending = probe()
    .then((v) => {
      cache = v;
      listeners.forEach((l) => l(v));
      return v;
    })
    .finally(() => {
      pending = null;
    });
}

if (canDetect) {
  AppState.addEventListener("change", (s) => s === "active" && refresh());
}

/**
 * Which supported apps are on this phone, by slug. Empty when detection isn't possible
 * (Expo Go, Android, web), so callers simply show nothing.
 */
export function useInstalledApps(): InstalledApps {
  const [installed, setInstalled] = useState<InstalledApps>(() => cache ?? {});
  useEffect(() => {
    if (!canDetect) return;
    listeners.add(setInstalled);
    if (!cache) refresh();
    return () => {
      listeners.delete(setInstalled);
    };
  }, []);
  return installed;
}

/** Stable sort that puts apps found on the phone first. */
export function installedFirst<T extends { slug: string }>(apps: T[], installed: InstalledApps): T[] {
  return apps
    .map((a, i) => ({ a, i }))
    .sort((x, y) => Number(!!installed[y.a.slug]) - Number(!!installed[x.a.slug]) || x.i - y.i)
    .map(({ a }) => a);
}
