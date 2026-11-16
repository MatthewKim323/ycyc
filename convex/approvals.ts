import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, internalQuery, mutation, query, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { displayName } from "./catalog";
import { resolveApp } from "./lib/appResolver";
import { assistantValidator } from "./schema";
import { sanitizeForConvex } from "./lib/sanitize";
import { publicToolData } from "./lib/publicToolData";

// Pending approvals stay answerable this long (the assistant can call check_approval later).
export const APPROVAL_TTL_MS = 15 * 60_000;
const GRANT_MS = 60 * 60_000;

async function learnedOwner(ctx: Pick<QueryCtx, "db" | "auth">, userId: Id<"users">, token?: string) {
  const user = await ctx.db.get(userId);
  if (!user) return null;
  if (token && token.length <= 256 && user.mcpToken === token) return user;
  const identity = await ctx.auth.getUserIdentity();
  return user.clerkUserId && identity?.subject === user.clerkUserId ? user : null;
}

export type RequestPreview = { method: string; path: string; args: Record<string, unknown> };
export async function previewForApproval(ctx: Pick<QueryCtx, "db">, row: Doc<"approvals">): Promise<RequestPreview | null> {
  if (!row.learnedWriteId) return null;
  const intent = await ctx.db.get(row.learnedWriteId);
  const user = await ctx.db.get(row.userId);
  if (!intent || !user || intent.userId !== row.userId || intent.approvalId !== row._id || intent.expiresAt <= Date.now()) return null;
  try {
    if (intent.previewJson.length > 16 * 1024) return null;
    const value = JSON.parse(intent.previewJson) as RequestPreview;
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(value.method) || typeof value.path !== "string" ||
      !value.path.startsWith("/") || value.path.startsWith("//") || value.path.length > 2048 || /[?#\r\n]/.test(value.path) ||
      !value.args || typeof value.args !== "object" || Array.isArray(value.args)) return null;
    const metadata = publicToolData({ method: value.method, path: value.path }, user.mcpToken);
    return { ...metadata, args: publicToolData(value.args, user.mcpToken) };
  } catch { return null; }
}

// One line for the approval sheet when a write has consequences worth saying out loud.
export function warningFor(appSlug: string, tool: string): string | undefined {
  if (appSlug === "parkmobile" && (tool === "start_parking" || tool === "extend_parking")) return "Charges your card";
  if (/(^|_)(delete|remove)(_|$)/.test(tool)) return `Removes it from ${displayName(appSlug)}`;
  return undefined;
}

export const pending = query({
  args: { userId: v.id("users"), token: v.optional(v.string()) },
  handler: async (ctx, { userId, token }) => {
    const now = Date.now();
    const rows = await ctx.db
      .query("approvals")
      .withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", "pending"))
      .order("desc")
      .collect();
    const canReadLearned = rows.some((row) => row.learnedWriteId) ? await learnedOwner(ctx, userId, token) : null;
    const live = rows.filter((r) => r.expiresAt > now && (!r.learnedWriteId || canReadLearned));
    const names: Record<string, string> = {};
    for (const r of live) names[r.appSlug] ??= (await resolveApp(ctx, r.appSlug))?.name ?? displayName(r.appSlug);
    return Promise.all(live.map(async (r) => {
      const requestPreview = await previewForApproval(ctx, r);
      return {
        _id: r._id,
        appSlug: r.appSlug,
        appName: names[r.appSlug],
        tool: r.tool,
        title: r.title,
        summary: r.summary,
        warning: r.warning,
        args: r.learnedWriteId ? requestPreview?.args ?? {} : sanitizeForConvex(JSON.parse(r.argsJson) as Record<string, unknown>),
        oneTimeOnly: !!r.learnedWriteId,
        requestPreview,
        assistant: r.assistant,
        createdAt: r.createdAt,
        expiresAt: r.expiresAt,
      };
    }));
  },
});

export const decide = mutation({
  args: {
    approvalId: v.id("approvals"),
    decision: v.union(v.literal("approve"), v.literal("deny"), v.literal("approve_hour")),
    token: v.optional(v.string()),
  },
  handler: async (ctx, { approvalId, decision, token }) => {
    const row = await ctx.db.get(approvalId);
    if (!row) throw new Error("Unknown approval");
    if (row.learnedWriteId) {
      if (!(await learnedOwner(ctx, row.userId, token))) throw new Error("This approval is unavailable.");
      if (decision === "approve_hour") throw new Error("Learned app changes require one-time approval.");
    }
    if (row.status !== "pending") return { status: row.status };
    const now = Date.now();
    if (row.expiresAt <= now) {
      await ctx.db.patch(approvalId, { status: "expired", decidedAt: now });
      return { status: "expired" as const };
    }
    if (row.learnedWriteId && decision === "approve" && !(await previewForApproval(ctx, row))) throw new Error("This request is unavailable. Ask for a new approval.");
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
