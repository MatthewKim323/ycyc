import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { requestValidator } from "./schema";


// The phone's DeviceRelay subscribes to this and runs each request in a hidden WebView.
export const queued = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const rows = await ctx.db
      .query("calls")
      .withIndex("by_user_status", (q) => q.eq("userId", userId).eq("status", "queued"))
      .order("asc")
      .take(20);
    // Calls stay runnable for 60 s (longer than the executor waits) so a phone that opens late still runs them.
    const cutoff = Date.now() - 65_000;
    return rows.filter((r) => r.createdAt > cutoff).map((r) => ({
      _id: r._id,
      appSlug: r.appSlug,
      tool: r.tool,
      request: r.request,
      createdAt: r.createdAt,
    }));
  },
});

export const complete = mutation({
  args: {
    callId: v.id("calls"),
    response: v.object({ status: v.number(), body: v.string() }),
  },
  handler: async (ctx, { callId, response }) => {
    const row = await ctx.db.get(callId);
    if (!row || row.status !== "queued") return null;
    const body = response.body.length > 256 * 1024 ? response.body.slice(0, 256 * 1024) : response.body;
    await ctx.db.patch(callId, {
      status: "done",
      response: { status: response.status, body },
      completedAt: Date.now(),
    });
    return null;
  },
});

// ---- internal (executor "device") ----

export const enqueue = internalMutation({
  args: {
    userId: v.id("users"),
    connectionId: v.optional(v.id("connections")),
    appSlug: v.string(),
    tool: v.string(),
    request: requestValidator,
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("calls", { ...args, status: "queued", createdAt: Date.now() });
  },
});

export const get = internalQuery({
  args: { callId: v.id("calls") },
  handler: async (ctx, { callId }) => ctx.db.get(callId),
});

export const expire = internalMutation({
  args: { callId: v.id("calls") },
  handler: async (ctx, { callId }) => {
    const row = await ctx.db.get(callId);
    if (row && row.status === "queued") {
      await ctx.db.patch(callId, { status: "expired", completedAt: Date.now() });
    }
  },
});


// The phone's relay calls this every ~30 s while yuzu is open, so the backend knows it can run
// device calls right now instead of waiting on a phone that is closed.
export const heartbeat = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    if (user) await ctx.db.patch(userId, { relaySeenAt: Date.now() });
    return null;
  },
});
