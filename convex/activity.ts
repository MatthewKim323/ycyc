import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { assistantValidator } from "./schema";

const activityStatus = v.union(
  v.literal("ok"),
  v.literal("error"),
  v.literal("pending_approval"),
  v.literal("denied"),
);

export const feed = query({
  args: { userId: v.id("users"), limit: v.optional(v.number()) },
  handler: async (ctx, { userId, limit }) => {
    const rows = await ctx.db
      .query("activity")
      .withIndex("by_user_at", (q) => q.eq("userId", userId))
      .order("desc")
      .take(Math.min(Math.max(limit ?? 50, 1), 200));
    return rows.map((r) => ({
      _id: r._id,
      appSlug: r.appSlug,
      assistant: r.assistant,
      tool: r.tool,
      kind: r.kind,
      summary: r.summary,
      status: r.status,
      at: r.at,
      approvalId: r.approvalId,
      detail: r.detail,
    }));
  },
});

export const log = internalMutation({
  args: {
    userId: v.id("users"),
    appSlug: v.string(),
    assistant: assistantValidator,
    tool: v.string(),
    kind: v.union(v.literal("read"), v.literal("write")),
    summary: v.string(),
    status: activityStatus,
    approvalId: v.optional(v.id("approvals")),
    detail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("activity", { ...args, at: Date.now() });
  },
});

export const update = internalMutation({
  args: {
    activityId: v.id("activity"),
    status: activityStatus,
    summary: v.optional(v.string()),
    detail: v.optional(v.string()),
  },
  handler: async (ctx, { activityId, status, summary, detail }) => {
    const row = await ctx.db.get(activityId);
    if (!row) return;
    await ctx.db.patch(activityId, {
      status,
      ...(summary !== undefined ? { summary } : {}),
      ...(detail !== undefined ? { detail } : {}),
    });
  },
});
