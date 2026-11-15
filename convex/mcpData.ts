import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, internalQuery } from "./_generated/server";
import { assistantValidator } from "./schema";
import { CATALOG } from "./catalog";
import { bestRecipe, recipeAt, stripSource } from "./lib/recipeStore";
import { isPublicTool } from "./lib/recipeOverrides";

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
    // Apps not connected yet whose recipe has sessionless (public) tools, e.g. ParkMobile zone lookup.
    const publicRecipes: { appSlug: string; recipeJson: string }[] = [];
    for (const app of CATALOG) {
      if (live.some((l) => l.conn.appSlug === app.slug)) continue;
      const r = stripSource(await bestRecipe(ctx, app.slug));
      if (r && r.tools.some(isPublicTool)) {
        publicRecipes.push({ appSlug: app.slug, recipeJson: JSON.stringify({ ...r, tools: r.tools.filter(isPublicTool) }) });
      }
    }
    return {
      user,
      connections: conns.map((c) => ({ appSlug: c.appSlug, status: c.status, error: c.error })),
      live,
      publicRecipes,
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

export const names = internalQuery({
  args: { userId: v.id("users"), appSlug: v.string() },
  handler: async (ctx, { userId, appSlug }): Promise<Record<string, string>> => {
    const row = await ctx.db
      .query("lookupNames")
      .withIndex("by_user_app", (q) => q.eq("userId", userId).eq("appSlug", appSlug))
      .first();
    return row ? (JSON.parse(row.json) as Record<string, string>) : {};
  },
});

// Merge newly seen id -> label pairs, keeping the most recent 200.
export const rememberNames = internalMutation({
  args: { userId: v.id("users"), appSlug: v.string(), json: v.string() },
  handler: async (ctx, { userId, appSlug, json }) => {
    const fresh = JSON.parse(json) as Record<string, string>;
    if (Object.keys(fresh).length === 0) return;
    const row = await ctx.db
      .query("lookupNames")
      .withIndex("by_user_app", (q) => q.eq("userId", userId).eq("appSlug", appSlug))
      .first();
    const old = row ? (JSON.parse(row.json) as Record<string, string>) : {};
    for (const k of Object.keys(fresh)) delete old[k];
    const merged = Object.fromEntries([...Object.entries(old), ...Object.entries(fresh)].slice(-200));
    if (row) await ctx.db.patch(row._id, { json: JSON.stringify(merged), updatedAt: Date.now() });
    else await ctx.db.insert("lookupNames", { userId, appSlug, json: JSON.stringify(merged), updatedAt: Date.now() });
  },
});
