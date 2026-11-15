import { v } from "convex/values";
import type { BuildStep, CaptureEntry, SessionBundle } from "../src/lib/contract";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { catalogApp } from "./catalog";
import { connectionStatus } from "./schema";
import { recipeAt } from "./lib/recipeStore";

export const MAX_CAPTURE_ENTRIES = 300;
const CHUNK_BYTES = 700_000; // stay well under the 1 MiB document limit
const MAX_REQ_BODY = 8 * 1024;
const MAX_RES_BODY = 16 * 1024;

export const INITIAL_STEPS: BuildStep[] = [
  { key: "signin", label: "Signed in", status: "pending" },
  { key: "capture", label: "Watching requests", status: "pending" },
  { key: "map", label: "Mapping endpoints", status: "pending" },
  { key: "generate", label: "Generating tools", status: "pending" },
  { key: "verify", label: "Verifying", status: "pending" },
  { key: "publish", label: "Publishing", status: "pending" },
];

function publicConnection(c: Doc<"connections">) {
  const { sessionJson, authCacheJson, authCacheAt, ...rest } = c;
  return { ...rest, hasSession: !!sessionJson };
}

function trimEntry(e: CaptureEntry): CaptureEntry {
  return {
    ...e,
    reqBody: e.reqBody && e.reqBody.length > MAX_REQ_BODY ? e.reqBody.slice(0, MAX_REQ_BODY) : e.reqBody,
    resBody: e.resBody && e.resBody.length > MAX_RES_BODY ? e.resBody.slice(0, MAX_RES_BODY) : e.resBody,
  };
}

export const start = mutation({
  args: { userId: v.id("users"), appSlug: v.string() },
  handler: async (ctx, { userId, appSlug }): Promise<Id<"connections">> => {
    if (!catalogApp(appSlug)) throw new Error(`Unknown app: ${appSlug}`);
    const user = await ctx.db.get(userId);
    if (!user) throw new Error("Unknown user");
    const now = Date.now();
    const existing = await ctx.db
      .query("connections")
      .withIndex("by_user_app", (q) => q.eq("userId", userId).eq("appSlug", appSlug))
      .first();
    if (existing) {
      await ctx.db.patch(existing._id, { status: "needs_login", error: undefined, updatedAt: now });
      return existing._id;
    }
    return await ctx.db.insert("connections", {
      userId,
      appSlug,
      status: "needs_login",
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const submitLogin = mutation({
  args: {
    connectionId: v.id("connections"),
    session: v.any(), // SessionBundle
    capture: v.array(v.any()), // CaptureEntry[]
  },
  handler: async (ctx, { connectionId, session, capture }) => {
    const conn = await ctx.db.get(connectionId);
    if (!conn) throw new Error("Unknown connection");
    const now = Date.now();
    const bundle: SessionBundle = { ...(session ?? {}), capturedAt: session?.capturedAt ?? now };

    // Replace any earlier capture for this connection, keep the newest entries only.
    const old = await ctx.db
      .query("captures")
      .withIndex("by_connection", (q) => q.eq("connectionId", connectionId))
      .collect();
    for (const doc of old) await ctx.db.delete(doc._id);

    const entries = (capture as CaptureEntry[])
      .filter((e) => e && typeof e.url === "string")
      .sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0))
      .slice(-MAX_CAPTURE_ENTRIES)
      .map(trimEntry);

    let chunk: CaptureEntry[] = [];
    let bytes = 0;
    let index = 0;
    const flush = async () => {
      if (chunk.length === 0) return;
      await ctx.db.insert("captures", {
        connectionId,
        appSlug: conn.appSlug,
        chunk: index++,
        count: chunk.length,
        bytes,
        entriesJson: JSON.stringify(chunk),
        createdAt: now,
      });
      chunk = [];
      bytes = 0;
    };
    for (const e of entries) {
      const size = JSON.stringify(e).length;
      if (bytes + size > CHUNK_BYTES) await flush();
      chunk.push(e);
      bytes += size;
    }
    await flush();

    await ctx.db.patch(connectionId, {
      status: "building",
      sessionJson: JSON.stringify(bundle),
      authCacheJson: undefined,
      authCacheAt: undefined,
      error: undefined,
      updatedAt: now,
    });

    const buildId = await ctx.db.insert("builds", {
      connectionId,
      userId: conn.userId,
      appSlug: conn.appSlug,
      status: "running",
      steps: INITIAL_STEPS,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.pipeline.run, { buildId });
    return { buildId, captured: entries.length };
  },
});

export const mine = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const rows = await ctx.db
      .query("connections")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const out = [];
    for (const c of rows) {
      const app = catalogApp(c.appSlug);
      if (!app) continue;
      const recipe = c.status === "live" ? await recipeAt(ctx, c.appSlug, c.recipeVersion) : null;
      out.push({
        ...publicConnection(c),
        app,
        toolCount: recipe?.tools.length ?? 0,
        tools: recipe?.tools.map((t) => ({ name: t.name, title: t.title, kind: t.kind })) ?? [],
      });
    }
    out.sort((a, b) => b.updatedAt - a.updatedAt);
    return out;
  },
});

export const disconnect = mutation({
  args: { connectionId: v.id("connections") },
  handler: async (ctx, { connectionId }) => {
    const conn = await ctx.db.get(connectionId);
    if (!conn) return null;
    const caps = await ctx.db
      .query("captures")
      .withIndex("by_connection", (q) => q.eq("connectionId", connectionId))
      .collect();
    for (const d of caps) await ctx.db.delete(d._id);
    const builds = await ctx.db
      .query("builds")
      .withIndex("by_connection", (q) => q.eq("connectionId", connectionId))
      .collect();
    for (const d of builds) await ctx.db.delete(d._id);
    const pending = await ctx.db
      .query("approvals")
      .withIndex("by_user_status", (q) => q.eq("userId", conn.userId).eq("status", "pending"))
      .collect();
    for (const a of pending) {
      if (a.connectionId === connectionId) await ctx.db.patch(a._id, { status: "denied", decidedAt: Date.now() });
    }
    await ctx.db.delete(connectionId);
    return null;
  },
});

// ---- internal ----

export const get = internalQuery({
  args: { connectionId: v.id("connections") },
  handler: async (ctx, { connectionId }) => ctx.db.get(connectionId),
});

export const liveForUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const rows = await ctx.db
      .query("connections")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    return rows;
  },
});

export const captureEntries = internalQuery({
  args: { connectionId: v.id("connections") },
  handler: async (ctx, { connectionId }): Promise<CaptureEntry[]> => {
    const chunks = await ctx.db
      .query("captures")
      .withIndex("by_connection", (q) => q.eq("connectionId", connectionId))
      .collect();
    return chunks.flatMap((c) => JSON.parse(c.entriesJson) as CaptureEntry[]);
  },
});

export const setStatus = internalMutation({
  args: {
    connectionId: v.id("connections"),
    status: connectionStatus,
    error: v.optional(v.string()),
    recipeVersion: v.optional(v.number()),
  },
  handler: async (ctx, { connectionId, status, error, recipeVersion }) => {
    const conn = await ctx.db.get(connectionId);
    if (!conn) return;
    const now = Date.now();
    await ctx.db.patch(connectionId, {
      status,
      error,
      updatedAt: now,
      ...(recipeVersion !== undefined ? { recipeVersion } : {}),
      ...(status === "live" ? { liveAt: now } : {}),
    });
  },
});

export const saveAuthCache = internalMutation({
  args: { connectionId: v.id("connections"), json: v.optional(v.string()) },
  handler: async (ctx, { connectionId, json }) => {
    const conn = await ctx.db.get(connectionId);
    if (!conn) return;
    await ctx.db.patch(connectionId, {
      authCacheJson: json,
      authCacheAt: json ? Date.now() : undefined,
    });
  },
});

// Executor token refresh writes the rotated session back.
export const updateSession = internalMutation({
  args: { connectionId: v.id("connections"), json: v.string() },
  handler: async (ctx, { connectionId, json }) => {
    const conn = await ctx.db.get(connectionId);
    if (!conn) return;
    await ctx.db.patch(connectionId, { sessionJson: json });
  },
});
