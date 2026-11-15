import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { catalogApp } from "./catalog";
import { assistantValidator } from "./schema";
import { sanitizeForConvex } from "./lib/sanitize";

// Pending approvals stay answerable this long (the assistant can call check_approval later).
export const APPROVAL_TTL_MS = 15 * 60_000;
const GRANT_MS = 60 * 60_000;

// One line for the approval sheet when a write has consequences worth saying out loud.
export function warningFor(appSlug: string, tool: string): string | undefined {
  if (appSlug === "parkmobile" && (tool === "start_parking" || tool === "extend_parking")) return "Charges your card";
  if (/(^|_)(delete|remove)(_|$)/.test(tool)) return `Removes it from ${catalogApp(appSlug)?.name ?? appSlug}`;
  return undefined;
}

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
        warning: r.warning,
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
    decision: v.union(v.literal("approve"), v.literal("deny"), v.literal("approve_hour")),
  },
  handler: async (ctx, { approvalId, decision }) => {
    const row = await ctx.db.get(approvalId);
    if (!row) throw new Error("Unknown approval");
    if (row.status !== "pending") return { status: row.status };
    const now = Date.now();
    if (row.expiresAt < now) {
      await ctx.db.patch(approvalId, { status: "expired", decidedAt: now });
      return { status: "expired" as const };
    }
    if (decision === "deny") {
      await ctx.db.patch(approvalId, { status: "denied", decidedAt: now });
      if (row.activityId) await ctx.db.patch(row.activityId, { status: "denied", detail: "Denied on phone" });
      return { status: "denied" as const };
    }
    await ctx.db.patch(approvalId, { status: "approved", decidedAt: now });
    if (decision === "approve_hour") {
      const scope = await ctx.db
        .query("approvalGrants")
        .withIndex("by_scope", (q) => q.eq("userId", row.userId).eq("appSlug", row.appSlug).eq("tool", row.tool))
        .collect();
      for (const g of scope) if (g.assistant === row.assistant) await ctx.db.delete(g._id);
      await ctx.db.insert("approvalGrants", {
        userId: row.userId,
        assistant: row.assistant,
        appSlug: row.appSlug,
        tool: row.tool,
        expiresAt: now + GRANT_MS,
        createdAt: now,
      });
    }
    // The approved call runs in one place, exactly once (see approvalRunner.run).
    await ctx.scheduler.runAfter(0, internal.approvalRunner.run, { approvalId });
    return { status: "approved" as const };
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
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const approvalId = await ctx.db.insert("approvals", {
      ...args,
      warning: warningFor(args.appSlug, args.tool),
      status: "pending",
      createdAt: now,
      expiresAt: now + APPROVAL_TTL_MS,
    });
    const activityId = await ctx.db.insert("activity", {
      userId: args.userId,
      appSlug: args.appSlug,
      assistant: args.assistant,
      tool: args.tool,
      kind: "write",
      summary: args.summary,
      status: "pending_approval",
      approvalId,
      at: now,
    });
    await ctx.db.patch(approvalId, { activityId });
    await ctx.scheduler.runAfter(APPROVAL_TTL_MS, internal.approvals.expire, { approvalId });
    return approvalId;
  },
});

export const get = internalQuery({
  args: { approvalId: v.id("approvals") },
  handler: async (ctx, { approvalId }) => ctx.db.get(approvalId),
});

// check_approval: the id comes from the model, so normalize it and scope it to the user.
export const forUser = internalQuery({
  args: { id: v.string(), userId: v.id("users") },
  handler: async (ctx, { id, userId }) => {
    const approvalId = ctx.db.normalizeId("approvals", id.trim());
    if (!approvalId) return null;
    const row = await ctx.db.get(approvalId);
    return row && row.userId === userId ? row : null;
  },
});

export const activeGrant = internalQuery({
  args: { userId: v.id("users"), assistant: assistantValidator, appSlug: v.string(), tool: v.string() },
  handler: async (ctx, { userId, assistant, appSlug, tool }) => {
    const now = Date.now();
    const rows = await ctx.db
      .query("approvalGrants")
      .withIndex("by_scope", (q) => q.eq("userId", userId).eq("appSlug", appSlug).eq("tool", tool))
      .collect();
    return rows.find((g) => g.assistant === assistant && g.expiresAt > now) ?? null;
  },
});

// Returns true for exactly one caller.
export const claimRun = internalMutation({
  args: { approvalId: v.id("approvals") },
  handler: async (ctx, { approvalId }) => {
    const row = await ctx.db.get(approvalId);
    if (!row || row.status !== "approved" || row.runState) return false;
    await ctx.db.patch(approvalId, { runState: "running" });
    return true;
  },
});

export const storeResult = internalMutation({
  args: { approvalId: v.id("approvals"), ok: v.boolean(), text: v.string() },
  handler: async (ctx, { approvalId, ok, text }) => {
    const row = await ctx.db.get(approvalId);
    if (!row) return;
    await ctx.db.patch(approvalId, { runState: "done", resultJson: JSON.stringify({ ok, text }) });
    if (row.activityId) {
      await ctx.db.patch(row.activityId, { status: ok ? "ok" : "error", detail: ok ? undefined : text.slice(0, 300) });
    }
  },
});

// Nobody answered within APPROVAL_TTL_MS.
export const expire = internalMutation({
  args: { approvalId: v.id("approvals") },
  handler: async (ctx, { approvalId }) => {
    const row = await ctx.db.get(approvalId);
    if (!row || row.status !== "pending") return row?.status;
    await ctx.db.patch(approvalId, { status: "expired", decidedAt: Date.now() });
    if (row.activityId) await ctx.db.patch(row.activityId, { status: "denied", detail: "No answer on phone" });
    return "expired";
  },
});
