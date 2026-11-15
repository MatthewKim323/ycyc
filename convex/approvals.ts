import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { catalogApp } from "./catalog";
import { assistantValidator } from "./schema";
import { sanitizeForConvex } from "./lib/sanitize";

export const pending = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const now = Date.now();
    const rows = await ctx.db
      .query("approvals")
      .withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", "pending"))
      .order("desc")
      .collect();
    return rows
      .filter((r) => r.expiresAt > now)
      .map((r) => ({
        _id: r._id,
        appSlug: r.appSlug,
        appName: catalogApp(r.appSlug)?.name ?? r.appSlug,
        tool: r.tool,
        title: r.title,
        summary: r.summary,
        args: sanitizeForConvex(JSON.parse(r.argsJson) as Record<string, unknown>),
        assistant: r.assistant,
        createdAt: r.createdAt,
        expiresAt: r.expiresAt,
      }));
  },
});

export const decide = mutation({
  args: {
    approvalId: v.id("approvals"),
    decision: v.union(v.literal("approve"), v.literal("deny")),
  },
  handler: async (ctx, { approvalId, decision }) => {
    const row = await ctx.db.get(approvalId);
    if (!row) throw new Error("Unknown approval");
    if (row.status !== "pending") return { status: row.status };
    if (row.expiresAt < Date.now()) {
      await ctx.db.patch(approvalId, { status: "expired", decidedAt: Date.now() });
      return { status: "expired" as const };
    }
    const status = decision === "approve" ? ("approved" as const) : ("denied" as const);
    await ctx.db.patch(approvalId, { status, decidedAt: Date.now() });
    return { status };
  },
});

// ---- internal (MCP write path) ----

export const create = internalMutation({
  args: {
    userId: v.id("users"),
    connectionId: v.optional(v.id("connections")),
    appSlug: v.string(),
    tool: v.string(),
    title: v.string(),
    summary: v.string(),
    argsJson: v.string(),
    assistant: assistantValidator,
    ttlMs: v.number(),
  },
  handler: async (ctx, { ttlMs, ...args }) => {
    const now = Date.now();
    return await ctx.db.insert("approvals", {
      ...args,
      status: "pending",
      createdAt: now,
      expiresAt: now + ttlMs,
    });
  },
});

export const get = internalQuery({
  args: { approvalId: v.id("approvals") },
  handler: async (ctx, { approvalId }) => ctx.db.get(approvalId),
});

export const expire = internalMutation({
  args: { approvalId: v.id("approvals") },
  handler: async (ctx, { approvalId }) => {
    const row = await ctx.db.get(approvalId);
    if (row && row.status === "pending") {
      await ctx.db.patch(approvalId, { status: "expired", decidedAt: Date.now() });
    }
    return row?.status === "pending" ? "expired" : row?.status;
  },
});
