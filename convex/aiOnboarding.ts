import { v } from "convex/values";
import { query } from "./_generated/server";

// Mobile onboarding order is server-derived: subscription first, apps second.
// A cached local onboarding flag must not substitute for a connected AI plan.
export const state = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    if (!token || token.length > 256) throw new Error("Your yuzu session is unavailable. Reopen the app.");
    const user = await ctx.db.query("users").withIndex("by_mcpToken", (q) => q.eq("mcpToken", token)).unique();
    if (!user) throw new Error("Your yuzu session is unavailable. Reopen the app.");
    const providers = await ctx.db.query("aiProviderSessions").withIndex("by_user", (q) => q.eq("userId", user._id)).collect();
    const selected = providers.find((row) => row.status === "connected" && row.selected && row.credentialsCipher);
    if (!selected) return { step: "connect_ai" as const, provider: null, connectedApps: 0, ready: false };
    const apps = await ctx.db.query("connections").withIndex("by_user", (q) => q.eq("userId", user._id)).collect();
    const live = apps.filter((row) => row.status === "live").length;
    return { step: live ? "ready" as const : "connect_apps" as const, provider: selected.provider,
      connectedApps: live, ready: live > 0 };
  },
});
