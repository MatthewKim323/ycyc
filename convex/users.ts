import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { SITE_URL } from "./lib/env";

function randomToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function mcpUrlFor(token: string): string {
  return `${SITE_URL}/mcp/${token}`;
}

// Called on first launch (and every launch after): returns the same user for the same device.
export const ensure = mutation({
  args: { deviceId: v.string() },
  handler: async (ctx, { deviceId }) => {
    const existing = await ctx.db
      .query("users")
      .withIndex("by_deviceId", (q) => q.eq("deviceId", deviceId))
      .unique();
    if (existing) {
      return { userId: existing._id, mcpUrl: mcpUrlFor(existing.mcpToken), plan: existing.plan };
    }
    const mcpToken = randomToken();
    const userId = await ctx.db.insert("users", {
      deviceId,
      mcpToken,
      plan: "free",
      createdAt: Date.now(),
    });
    return { userId, mcpUrl: mcpUrlFor(mcpToken), plan: "free" as const };
  },
});

// After Google sign-in: the account's user follows the person, so this device switches to it.
// The device's previous anonymous user is detached (its deviceId is retired) so `ensure` stays unique.
export const linkAccount = mutation({
  args: {
    deviceId: v.string(),
    clerkUserId: v.string(),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
  },
  handler: async (ctx, { deviceId, clerkUserId, email, name, imageUrl }) => {
    const profile = { email, name, imageUrl };
    const current = await ctx.db
      .query("users")
      .withIndex("by_deviceId", (q) => q.eq("deviceId", deviceId))
      .unique();
    const account = await ctx.db
      .query("users")
      .withIndex("by_clerkUserId", (q) => q.eq("clerkUserId", clerkUserId))
      .first();

    if (account) {
      if (current && current._id !== account._id) {
        await ctx.db.patch(current._id, { deviceId: `${deviceId}#detached:${current._id}` });
      }
      await ctx.db.patch(account._id, { deviceId, ...profile });
      return { userId: account._id, mcpUrl: mcpUrlFor(account.mcpToken), plan: account.plan };
    }

    // First sign-in for this account: claim the device user, unless it already belongs to someone else.
    if (current && !current.clerkUserId) {
      await ctx.db.patch(current._id, { clerkUserId, ...profile });
      return { userId: current._id, mcpUrl: mcpUrlFor(current.mcpToken), plan: current.plan };
    }
    if (current) {
      await ctx.db.patch(current._id, { deviceId: `${deviceId}#detached:${current._id}` });
    }
    const mcpToken = randomToken();
    const userId = await ctx.db.insert("users", {
      deviceId,
      mcpToken,
      plan: "free",
      createdAt: Date.now(),
      clerkUserId,
      ...profile,
    });
    return { userId, mcpUrl: mcpUrlFor(mcpToken), plan: "free" as const };
  },
});

export const get = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    if (!user) return null;
    return { userId: user._id, plan: user.plan, mcpUrl: mcpUrlFor(user.mcpToken) };
  },
});

export const byToken = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    return await ctx.db
      .query("users")
      .withIndex("by_mcpToken", (q) => q.eq("mcpToken", token))
      .unique();
  },
});

export const setPlan = internalMutation({
  args: { userId: v.id("users"), plan: v.union(v.literal("free"), v.literal("pro")) },
  handler: async (ctx, { userId, plan }) => {
    await ctx.db.patch(userId, { plan });
  },
});

// Whop checkout metadata may carry any of these.
export const findForWebhook = internalQuery({
  args: { userId: v.optional(v.string()), deviceId: v.optional(v.string()), token: v.optional(v.string()) },
  handler: async (ctx, args) => {
    if (args.userId) {
      const id = ctx.db.normalizeId("users", args.userId);
      if (id) {
        const u = await ctx.db.get(id);
        if (u) return u;
      }
    }
    if (args.deviceId) {
      const u = await ctx.db
        .query("users")
        .withIndex("by_deviceId", (q) => q.eq("deviceId", args.deviceId!))
        .unique();
      if (u) return u;
    }
    if (args.token) {
      const u = await ctx.db
        .query("users")
        .withIndex("by_mcpToken", (q) => q.eq("mcpToken", args.token!))
        .unique();
      if (u) return u;
    }
    return null;
  },
});
