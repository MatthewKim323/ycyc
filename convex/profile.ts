import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id, TableNames } from "./_generated/dataModel";
import { action, internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";

// Assistants the Link tab knows how to set up; other ids (in-app, texting) are not "where yuzu is used".
const ASSISTANTS = new Set(["claude", "chatgpt", "grok", "muse"]);
const IN_APP = new Set(["ycyc", "yuzu"]);
const DAY = 86_400_000;
const XP_PER_ACTION = 10;
const XP_PER_APP = 50;
// Upper bound on activity rows read for stats; plenty for a streak and lifetime XP at this scale.
const SCAN = 2000;

const approvalsDefault = v.union(v.literal("ask"), v.literal("hour"));
const prefsValidator = v.object({
  approvalsDefault: v.optional(approvalsDefault),
  weeklyRecap: v.optional(v.boolean()),
});

export type ProfilePrefs = { approvalsDefault: "ask" | "hour"; weeklyRecap: boolean };
const DEFAULT_PREFS: ProfilePrefs = { approvalsDefault: "ask", weeklyRecap: true };

async function profileFor(ctx: QueryCtx, userId: Id<"users">): Promise<Doc<"profiles"> | null> {
  return await ctx.db
    .query("profiles")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .first();
}

function prefsOf(p: Doc<"profiles"> | null): ProfilePrefs {
  return {
    approvalsDefault: p?.prefs?.approvalsDefault ?? DEFAULT_PREFS.approvalsDefault,
    weeklyRecap: p?.prefs?.weeklyRecap ?? DEFAULT_PREFS.weeklyRecap,
  };
}

/** Day index in the user's zone (offset in minutes, as Date.getTimezoneOffset returns). */
function dayIndex(at: number, tzOffset: number): number {
  return Math.floor((at - tzOffset * 60_000) / DAY);
}

export const me = query({
  args: { userId: v.id("users"), tzOffset: v.optional(v.number()) },
  handler: async (ctx, { userId, tzOffset = 0 }) => {
    const user = await ctx.db.get(userId);
    if (!user) return null;
    const profile = await profileFor(ctx, userId);

    const connections = await ctx.db
      .query("connections")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const live = connections.filter((c) => c.status === "live").sort((a, b) => (b.liveAt ?? b.updatedAt) - (a.liveAt ?? a.updatedAt));
    const apps = [...new Set(live.map((c) => c.appSlug))];

    const rows = await ctx.db
      .query("activity")
      .withIndex("by_user_at", (q) => q.eq("userId", userId))
      .order("desc")
      .take(SCAN);
    const actions = rows.filter((r) => r.status === "ok" && !IN_APP.has(r.assistant));

    const now = Date.now();
    const actionsThisWeek = actions.filter((r) => r.at >= now - 7 * DAY).length;

    // Consecutive days with at least one action, ending today (or yesterday, so a streak survives the morning).
    const days = new Set(actions.map((r) => dayIndex(r.at, tzOffset)));
    const today = dayIndex(now, tzOffset);
    let cursor = days.has(today) ? today : today - 1;
    let streakDays = 0;
    while (days.has(cursor)) {
      streakDays++;
      cursor--;
    }

    const assistants: string[] = [];
    for (const r of rows) {
      if (ASSISTANTS.has(r.assistant) && !assistants.includes(r.assistant)) assistants.push(r.assistant);
    }

    return {
      name: profile?.displayName ?? user.name,
      googleName: user.name,
      email: user.email,
      imageUrl: user.imageUrl,
      plan: user.plan,
      signedIn: !!user.clerkUserId,
      memberSince: user.createdAt,
      stats: {
        apps: apps.length,
        actionsThisWeek,
        streakDays,
        xp: actions.length * XP_PER_ACTION + apps.length * XP_PER_APP,
      },
      assistants,
      apps,
      prefs: prefsOf(profile),
    };
  },
});

async function upsertProfile(
  ctx: MutationCtx,
  userId: Id<"users">,
  patch: Partial<Pick<Doc<"profiles">, "displayName" | "avatarSeed" | "prefs">>,
) {
  const existing = await ctx.db
    .query("profiles")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .first();
  if (existing) await ctx.db.patch(existing._id, { ...patch, updatedAt: Date.now() });
  else await ctx.db.insert("profiles", { userId, ...patch, updatedAt: Date.now() });
}

// Empty name clears the override, so the Google name shows again.
export const update = mutation({
  args: { userId: v.id("users"), name: v.string() },
  handler: async (ctx, { userId, name }) => {
    const user = await ctx.db.get(userId);
    if (!user) throw new Error("No such user");
    const clean = name.replace(/\s+/g, " ").trim().slice(0, 60);
    await upsertProfile(ctx, userId, { displayName: clean || undefined });
    return { name: clean || user.name };
  },
});

export const setPrefs = mutation({
  args: { userId: v.id("users"), prefs: prefsValidator },
  handler: async (ctx, { userId, prefs }) => {
    const user = await ctx.db.get(userId);
    if (!user) throw new Error("No such user");
    const current = prefsOf(await profileFor(ctx, userId));
    const next: ProfilePrefs = {
      approvalsDefault: prefs.approvalsDefault ?? current.approvalsDefault,
      weeklyRecap: prefs.weeklyRecap ?? current.weeklyRecap,
    };
    await upsertProfile(ctx, userId, { prefs: next });
    return next;
  },
});

/** For the approvals owner: the user's default for new write approvals. */
export const prefsFor = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => prefsOf(await profileFor(ctx, userId)),
});

// ---- export ----

export const collectExport = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    if (!user) return null;
    const profile = await profileFor(ctx, userId);
    const connections = await ctx.db
      .query("connections")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const activity = await ctx.db
      .query("activity")
      .withIndex("by_user_at", (q) => q.eq("userId", userId))
      .order("desc")
      .take(1000);
    const approvals = await ctx.db
      .query("approvals")
      .withIndex("by_user_status", (q) => q.eq("userId", userId))
      .take(500);
    const iso = (t?: number) => (t ? new Date(t).toISOString() : undefined);
    // No session material, tokens, captures or tool arguments: just what you connected and what ran.
    return {
      exportedAt: new Date().toISOString(),
      account: {
        name: profile?.displayName ?? user.name,
        email: user.email,
        plan: user.plan,
        signedInWithGoogle: !!user.clerkUserId,
        memberSince: iso(user.createdAt),
      },
      prefs: prefsOf(profile),
      connections: connections.map((c) => ({
        app: c.appSlug,
        status: c.status,
        connectedAt: iso(c.createdAt),
        liveAt: iso(c.liveAt),
        lastUpdated: iso(c.updatedAt),
      })),
      activity: activity.map((a) => ({
        at: iso(a.at),
        app: a.appSlug,
        assistant: a.assistant,
        action: a.tool,
        kind: a.kind,
        summary: a.summary,
        status: a.status,
      })),
      approvals: approvals.map((a) => ({
        at: iso(a.createdAt),
        app: a.appSlug,
        action: a.title,
        assistant: a.assistant,
        status: a.status,
        decidedAt: iso(a.decidedAt),
      })),
    };
  },
});

export const exportData = action({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }): Promise<{ json: string; connections: number; activity: number }> => {
    const data = await ctx.runQuery(internal.profile.collectExport, { userId });
    if (!data) throw new Error("No such user");
    return {
      json: JSON.stringify(data, null, 2),
      connections: data.connections.length,
      activity: data.activity.length,
    };
  },
});

// ---- delete ----

const BATCH = 100;

/** Deletes one slice of the user's data. Returns false while anything is left. */
export const deleteSlice = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }): Promise<boolean> => {
    const db = ctx.db;
    const drop = async (docs: { _id: Id<TableNames> }[]) => {
      for (const d of docs) await db.delete(d._id);
      return docs.length > 0;
    };

    // Connections with their captures and builds (captures are large, so small slices).
    const conn = await db
      .query("connections")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (conn) {
      const caps = await db
        .query("captures")
        .withIndex("by_connection", (q) => q.eq("connectionId", conn._id))
        .take(10);
      const builds = await db
        .query("builds")
        .withIndex("by_connection", (q) => q.eq("connectionId", conn._id))
        .take(BATCH);
      await drop(caps);
      await drop(builds);
      if (caps.length < 10 && builds.length < BATCH) await db.delete(conn._id);
      return false;
    }

    // AI threads: events and turns first, then the thread.
    const thread = await db
      .query("aiThreads")
      .withIndex("by_user_updated", (q) => q.eq("userId", userId))
      .first();
    if (thread) {
      const events = await db
        .query("aiEvents")
        .withIndex("by_thread_seq", (q) => q.eq("threadId", thread._id))
        .take(BATCH);
      if (await drop(events)) return false;
      const turns = await db
        .query("aiTurns")
        .withIndex("by_thread_created", (q) => q.eq("threadId", thread._id))
        .take(BATCH);
      if (await drop(turns)) return false;
      await db.delete(thread._id);
      return false;
    }

    if (await drop(await db.query("aiTurns").withIndex("by_user_status", (q) => q.eq("userId", userId)).take(BATCH))) return false;
    if (await drop(await db.query("aiProviderSessions").withIndex("by_user", (q) => q.eq("userId", userId)).take(BATCH))) return false;
    if (await drop(await db.query("pluginInstallations").withIndex("by_user", (q) => q.eq("userId", userId)).take(BATCH))) return false;
    if (await drop(await db.query("appLearnedTools").withIndex("by_user", (q) => q.eq("userId", userId)).take(BATCH))) return false;
    if (await drop(await db.query("appLearnedWrites").withIndex("by_user_request", (q) => q.eq("userId", userId)).take(BATCH))) return false;
    if (await drop(await db.query("appLearningEvidence").withIndex("by_user_app", (q) => q.eq("userId", userId)).take(BATCH))) return false;
    if (await drop(await db.query("activity").withIndex("by_user_at", (q) => q.eq("userId", userId)).take(BATCH))) return false;
    if (await drop(await db.query("approvals").withIndex("by_user_status", (q) => q.eq("userId", userId)).take(BATCH))) return false;
    if (await drop(await db.query("calls").withIndex("by_user_status", (q) => q.eq("userId", userId)).take(BATCH))) return false;
    if (await drop(await db.query("lookupNames").withIndex("by_user_app", (q) => q.eq("userId", userId)).take(BATCH))) return false;
    if (await drop(await db.query("todaySummaries").withIndex("by_user", (q) => q.eq("userId", userId)).take(BATCH))) return false;
    if (await drop(await db.query("approvalGrants").withIndex("by_scope", (q) => q.eq("userId", userId)).take(BATCH))) return false;
    // No user index on these two; they stay small.
    if (await drop(await db.query("mcpSessions").filter((q) => q.eq(q.field("userId"), userId)).take(BATCH))) return false;
    if (await drop(await db.query("appRequests").filter((q) => q.eq(q.field("userId"), userId)).take(BATCH))) return false;
    if (await drop(await db.query("profiles").withIndex("by_user", (q) => q.eq("userId", userId)).take(BATCH))) return false;

    if (await db.get(userId)) await db.delete(userId);
    return true;
  },
});

export const deleteAccount = action({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }): Promise<{ deleted: true }> => {
    for (let i = 0; i < 500; i++) {
      const done: boolean = await ctx.runMutation(internal.profile.deleteSlice, { userId });
      if (done) return { deleted: true };
    }
    throw new Error("Deletion did not finish. Try again.");
  },
});
