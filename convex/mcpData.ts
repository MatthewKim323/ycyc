import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";
import { assistantValidator } from "./schema";
import { recipeAt, stripSource } from "./lib/recipeStore";

// Everything tools/list and tools/call need for one MCP token, in one round trip.
export const context = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_mcpToken", (q) => q.eq("mcpToken", token))
      .unique();
    if (!user) return null;
    const conns = await ctx.db
      .query("connections")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .collect();
    // Recipes travel as JSON strings: their inputSchemas may hold "$" keys Convex values reject.
    const live: { conn: Doc<"connections">; recipeJson: string }[] = [];
    for (const conn of conns) {
      if (conn.status !== "live") continue;
      const recipe = stripSource(await recipeAt(ctx, conn.appSlug, conn.recipeVersion));
      if (recipe) live.push({ conn, recipeJson: JSON.stringify(recipe) });
    }
    return {
      user,
      connections: conns.map((c) => ({ appSlug: c.appSlug, status: c.status, error: c.error })),
      live,
    };
  },
});

export const session = internalQuery({
  args: { sessionId: v.string() },
  handler: async (ctx, { sessionId }) =>
    ctx.db
      .query("mcpSessions")
      .withIndex("by_sessionId", (q) => q.eq("sessionId", sessionId))
      .first(),
});

export const saveSession = internalMutation({
  args: {
    sessionId: v.string(),
    userId: v.id("users"),
    clientName: v.optional(v.string()),
    assistant: assistantValidator,
    protocolVersion: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.insert("mcpSessions", { ...args, createdAt: Date.now() });
  },
});
