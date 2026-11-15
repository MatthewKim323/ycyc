// Public base URL for HTTP actions (MCP, connect links). Convex sets CONVEX_SITE_URL automatically.
export const SITE_URL: string =
  (typeof process !== "undefined" && process.env.CONVEX_SITE_URL) ||
  "https://optimistic-newt-247.convex.site";

// Deep link base for /connect redirects. Override with DEEPLINK_BASE (e.g. an exp:// URL for Expo Go).
export function deeplinkBase(): string {
  const base = (typeof process !== "undefined" && process.env.DEEPLINK_BASE) || "yuzu://";
  return base.endsWith("/") ? base : base + "/";
}
