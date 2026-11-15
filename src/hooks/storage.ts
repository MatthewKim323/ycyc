import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

// SecureStore is native only; the web preview keeps the same keys in localStorage.
export const store = {
  get: async (key: string): Promise<string | null> =>
    Platform.OS === "web" ? (globalThis.localStorage?.getItem(key) ?? null) : SecureStore.getItemAsync(key),
  set: async (key: string, value: string): Promise<void> =>
    Platform.OS === "web" ? globalThis.localStorage?.setItem(key, value) : SecureStore.setItemAsync(key, value),
};
