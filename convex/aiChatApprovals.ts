import { v } from "convex/values";
import { query } from "./_generated/server";
import { catalogApp } from "./catalog";
import { publicToolData } from "./lib/publicToolData";

// Subscribe separately to approvalResult after deciding, for the eventual receipt.
export const pendingApprovals = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    if (!token || token.length > 256) throw new Error("Your yuzu session is unavailable. Reopen the app.");
    const user = await ctx.db.query("users").withIndex("by_mcpToken", (q) => q.eq("mcpToken", token)).unique();
    if (!user) throw new Error("Your yuzu session is unavailable. Reopen the app.");
    const rows = await ctx.db.query("approvals").withIndex("by_user_status", (q) => q.eq("userId", user._id).eq("status", "pending"))
      .order("desc").take(10);
    return rows.map((row) => publicToolData({
      approvalId: row._id, appSlug: row.appSlug, appName: catalogApp(row.appSlug)?.name ?? row.appSlug,
      tool: row.tool, title: row.title, summary: row.summary, warning: row.warning,
      args: JSON.parse(row.argsJson) as Record<string, unknown>,
      status: row.status, createdAt: row.createdAt, expiresAt: row.expiresAt,
    }, token));
  },
});

export const approvalResult = query({
  args: { token: v.string(), approvalId: v.id("approvals") },
  handler: async (ctx, { token, approvalId }) => {
    if (!token || token.length > 256) throw new Error("Your yuzu session is unavailable. Reopen the app.");
    const user = await ctx.db.query("users").withIndex("by_mcpToken", (q) => q.eq("mcpToken", token)).unique();
    if (!user) throw new Error("Your yuzu session is unavailable. Reopen the app.");
    const row = await ctx.db.get(approvalId);
    if (!row || row.userId !== user._id) throw new Error("This approval is unavailable.");
    return publicToolData({ approvalId: row._id, status: row.status, runState: row.runState ?? null,
      result: row.resultJson ? JSON.parse(row.resultJson) as Record<string, unknown> : null }, token);
  },
});
